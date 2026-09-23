// src/adapters/arena-adapter.js — Arena (arena.ai) model adapter
'use strict';

const BaseAdapter = require('./base-adapter');
const logger      = require('../logger');
const { withSendRetry, withResponseRetry } = require('../retry');
const { ThinkingTracker, formatThinkingForLog } = require('../thinking');

const ARENA_URL = 'https://arena.ai';

/**
 * Adapter for arena.ai — multi-model chat (Grok, Claude, etc.)
 */
class ArenaAdapter extends BaseAdapter {
  constructor(page, config) {
    super(page, config);
    this._ensureThinkingTracker();
    this.selectors = {
      chatInput: [
        'textarea[placeholder*="Ask followup" i]',
        'textarea[placeholder*="followup" i]',
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="prompt" i]',
        '[contenteditable="true"][data-placeholder]',
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      sendButton: [
        'button[aria-label*="Send" i]',
        'button[aria-label*="send" i]',
        'button[data-testid*="send" i]',
        '[class*="send-button"]',
        '[class*="sendButton"]',
        'button[type="submit"]',
      ],
      stopButton: [
        'button[aria-label*="Stop" i]',
        'button[aria-label*="stop" i]',
        '[aria-label*="stop generating" i]',
        '[class*="stop-button"]',
        '[class*="stopButton"]',
      ],
      newChat: [
        'button[aria-label*="New Chat" i]',
        'a[href="/c"]',
        'a[href="/"]',
        '[class*="new-chat"]',
        'button:has-text("New Chat")',
      ],
      messageContainer: [
        '[class*="conversation"]',
        '[class*="message-list"]',
        '[class*="chat-messages"]',
        '[class*="messages"]',
        'main',
      ],
    };
  }

  // ── ThinkingTracker safety ─────────────────────────────────────────────────

  _ensureThinkingTracker() {
    if (this.thinkingTracker && typeof this.thinkingTracker.reset === 'function') return;
    try {
      this.thinkingTracker = new ThinkingTracker();
    } catch {
      this.thinkingTracker = {
        reset: () => {},
        update: () => {},
        get isThinking()      { return false; },
        get hasThinking()     { return false; },
        get thinkingContent() { return ''; },
        get responseContent() { return ''; },
      };
    }
  }

  // ── Core methods ───────────────────────────────────────────────────────────

  async sendMessage(text) {
    await withSendRetry(async () => {
      const { el, isTextarea } = await this._findInput();

      await el.click({ force: true });
      await this.page.waitForTimeout(100);

      await this.page.keyboard.press('Control+a');
      await this.page.waitForTimeout(50);

      if (isTextarea) {
        await el.fill(text);
      } else {
        await this.page.evaluate((element, content) => {
          element.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          document.execCommand('insertText', false, content);
          element.dispatchEvent(new InputEvent('input', { bubbles: true, data: content }));
        }, el, text);
      }

      const sendDelayMs = this.config.SEND_DELAY || 300;
      const startPoll = Date.now();
      let clicked = false;
      while (Date.now() - startPoll < sendDelayMs) {
        clicked = await this._clickSendButton();
        if (clicked) break;
        await this.page.waitForTimeout(50);
      }

      if (!clicked) {
        await this.page.keyboard.press('Enter');
      }

      await this.page.waitForTimeout(200);
    }, 'send message to Arena');
  }

  async waitForResponse() {
    return withResponseRetry(async () => {
      const timeout     = this.config.RESPONSE_TIMEOUT === 0
        ? 24 * 60 * 60 * 1000
        : this.config.RESPONSE_TIMEOUT;
      const stableDelay = this.config.STABLE_DELAY;
      const start       = Date.now();

      this._ensureThinkingTracker();
      this.thinkingTracker.reset();

      // Phase 1: wait for a new message to appear
      const initialCount = await this._getMessageCount();
      let appeared = false;

      while (Date.now() - start < (this.config.APPEAR_TIMEOUT || 120_000)) {
        const count = await this._getMessageCount();
        if (count > initialCount) { appeared = true; break; }
        await this.page.waitForTimeout(200);
      }

      if (!appeared) logger.warn('Response may have been delayed — continuing to wait...');

      // Phase 2: wait for text to stabilise
      let lastText    = '';
      let stableStart = null;
      let lastIndicatorUpdate = 0;

      while (Date.now() - start < timeout) {
        const text = await this._extractLastMessage();

        this.thinkingTracker.update(text);

        if (text !== lastText) {
          lastText    = text;
          stableStart = null;
        } else if (text.length > 0) {
          if (!stableStart) stableStart = Date.now();
          else if (Date.now() - stableStart >= stableDelay) {
            if (!await this._isGenerating()) break;
            stableStart = null;
          }
        }

        const now = Date.now();
        if (now - lastIndicatorUpdate > 800) {
          const elapsedMs = now - start;
          logger.thinking(elapsedMs, text.length, this.thinkingTracker.thinkingContent || '');
          if (Math.round(elapsedMs / 1000) === 30) {
            logger.clearThinking();
            logger.dim('  Response is taking a while — this is normal for complex tasks or slow connections.');
          }
          lastIndicatorUpdate = now;
        }

        await this.page.waitForTimeout(this.config.GENERATION_POLL || 800);
      }

      logger.clearThinking();

      if (this.thinkingTracker.hasThinking && this.config.DEBUG) {
        logger.dim(formatThinkingForLog(this.thinkingTracker.thinkingContent));
      }

      const final   = await this._extractLastMessage();
      const cleaned = this._cleanText(final);

      if (!cleaned || cleaned.trim().length === 0) {
        const err = new Error('Empty response from Arena');
        err.retryable = true;
        throw err;
      }

      return cleaned;
    }, 'wait for Arena response');
  }

  async newChat() {
    this._isFirstMessage = true;
    try {
      await this.page.goto(this.getModelUrl(), {
        waitUntil: 'domcontentloaded',
        timeout: this.config.BROWSER_TIMEOUT || 90_000,
      });
      await this.page.waitForTimeout(1_500);
      logger.dim('Navigated to Arena home (new chat)');
    } catch (err) {
      logger.warn(`Navigation failed: ${err.message} — trying sidebar button`);
      await this._clickElement(this._getNewChatSelectors(), { timeout: 10000 });
      await this.page.waitForTimeout(1_500);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _getInputSelectors()      { return this.selectors.chatInput; }
  _getSendSelectors()       { return this.selectors.sendButton; }
  _getStopSelectors()       { return this.selectors.stopButton; }
  _getNewChatSelectors()    { return this.selectors.newChat; }
  _getResponseSelectors()   { return this.selectors.messageContainer; }
  getModelUrl()             { return this.config.ARENA_URL || ARENA_URL; }

  async _findInput() {
    for (const sel of this.selectors.chatInput) {
      try {
        const el = await this.page.waitForSelector(sel, {
          timeout: this.config.HEALTH_CHECK_TIMEOUT || 45_000,
          state: 'visible',
        });
        if (!el) continue;
        const tagName           = await el.evaluate(e => e.tagName.toLowerCase());
        const isContentEditable = await el.evaluate(e => e.isContentEditable);
        return { el, isTextarea: tagName === 'textarea' && !isContentEditable };
      } catch {}
    }
    throw new Error('Arena chat input not found');
  }

  async _clickSendButton() {
    for (const sel of this.selectors.sendButton) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible() && await el.isEnabled()) {
          await el.click();
          return true;
        }
      } catch {}
    }
    return false;
  }

  async _getMessageCount() {
    return await this.page.evaluate(() => {
      const candidates = [
        '[class*="assistant"]',
        '[data-role="assistant"]',
        '[class*="ai-message"]',
        '[class*="bot-message"]',
        '[class*="message-row"]',
        '[class*="chat-message"]',
      ];
      for (const sel of candidates) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return els.length;
      }
      return document.querySelectorAll('[class*="message"]').length;
    });
  }

  async _extractLastMessage() {
    return await this.page.evaluate(() => {
      function getFullText(el) {
        if (!el) return '';
        let result = '';
        function walk(node) {
          if (node.nodeType === Node.TEXT_NODE) { result += node.textContent; return; }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const tag = node.tagName.toLowerCase();
          if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            const lang = codeEl ? ((codeEl.className || '').match(/language-(\S+)/) || [])[1] || '' : '';
            const body = codeEl ? codeEl.textContent : node.textContent;
            result += '\n```' + lang + '\n' + body + '\n``\n';
            return;
          }
          if (tag === 'code') {
            const parentTag = node.parentElement && node.parentElement.tagName ? node.parentElement.tagName.toLowerCase() : '';
            if (parentTag !== 'pre') result += '`' + node.textContent + '`';
            return;
          }
          for (const child of node.childNodes) walk(child);
          if (['p','div','li','br','h1','h2','h3','h4','h5','h6'].includes(tag)) result += '\n';
        }
        walk(el);
        return result.trim();
      }

      const directSelectors = [
        '[class*="assistant"] [class*="message-content"]',
        '[class*="assistant"] [class*="content"]',
        '[data-role="assistant"]',
        '[class*="ai-message"] [class*="content"]',
        '[class*="response-content"]',
        '[class*="markdown"]:last-child',
        '[class*="prose"]:last-child',
      ];

      for (const sel of directSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          const t = getFullText(els[els.length - 1]);
          if (t.length > 10) return t;
        }
      }

      const allBlocks = Array.from(
        document.querySelectorAll('[class*="message"], [class*="turn"], [class*="chat-item"]')
      );
      const candidates = allBlocks.filter(el => {
        const cls = (el.className || '').toLowerCase();
        if (cls.includes('input') || cls.includes('user')) return false;
        if (el.querySelector('textarea, input[type="text"]')) return false;
        return (el.innerText || '').length > 20;
      });
      if (candidates.length > 0) return getFullText(candidates[candidates.length - 1]);

      return '';
    });
  }

  _cleanText(text) {
    if (!text) return '';
    return text
      .replace(/[\s\S]*?<\/think>/gi, '')
      .replace(/Thought for \d+ seconds?\s*/gi, '')
      .replace(/^(grok|claude|gpt|arena)[\w.\-]*\s*\n/i, '')
      .trim();
  }

  async _isGenerating() {
    return await this.page.evaluate(() => {
      const stopSelectors = [
        'button[aria-label*="Stop" i]',
        'button[aria-label*="stop" i]',
        '[class*="stop-button"]',
        '[class*="generating"]',
      ];
      for (const sel of stopSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const s = window.getComputedStyle(el);
          if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') return true;
        }
      }
      const loaderSelectors = ['[class*="typing"]','[class*="loading"]','[class*="spinner"]','[class*="blink"]','[class*="pulsing"]'];
      for (const sel of loaderSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const s = window.getComputedStyle(el);
          if (s.display !== 'none' && s.visibility !== 'hidden') return true;
        }
      }
      return false;
    });
  }

  async listChats() {
    return await this.page.evaluate(() => {
      const chats = [];
      const seen = new Set();
      const selectors = [
        'a[href*="/c/"]',
        '[class*="sidebar"] a[href]',
        '[class*="chat-list"] a',
        '[class*="conversation-list"] a',
        '[class*="history"] a',
        'nav a[href*="/c"]',
      ];
      for (const sel of selectors) {
        try {
          const items = document.querySelectorAll(sel);
          items.forEach(a => {
            const href = a.getAttribute('href') || '';
            if (!href || seen.has(href)) return;
            if (!href.includes('/c/')) return;
            const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
            if (!title || title.length > 200) return;
            seen.add(href);
            const fullUrl = href.startsWith('http') ? href : location.origin + href;
            chats.push({ id: href, title, url: fullUrl });
          });
        } catch {}
      }
      if (chats.length === 0) {
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href') || '';
          if (seen.has(href)) return;
          const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
          if (!title || title.length < 2 || title.length > 200) return;
          if (href.includes('/c/')) {
            seen.add(href);
            chats.push({ id: href, title, url: href.startsWith('http') ? href : location.origin + href });
          }
        });
      }
      return chats;
    });
  }

  async navigateToChat(chatUrl) {
    try {
      await this.page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(2000);
      return true;
    } catch (err) {
      logger.warn(`Failed to navigate to Arena chat: ${err.message}`);
      return false;
    }
  }

  async readChatMessages() {
    return await this.page.evaluate(() => {
      const messages = [];
      const selectors = [
        '[class*="message"]',
        '[class*="turn"]',
        '[class*="chat-item"]',
        '[data-role="user"]',
        '[data-role="assistant"]',
      ];
      for (const sel of selectors) {
        try {
          const items = document.querySelectorAll(sel);
          items.forEach(el => {
            const text = (el.innerText || '').trim();
            if (!text || text.length < 5) return;
            const cls = el.className || '';
            const isUser = cls.includes('user') || el.getAttribute('data-role') === 'user';
            const isAssistant = cls.includes('assistant') || cls.includes('bot') || cls.includes('ai') || el.getAttribute('data-role') === 'assistant';
            if (isUser || isAssistant) {
              messages.push({ role: isUser ? 'user' : 'assistant', text: text.slice(0, 5000) });
            }
          });
          if (messages.length > 0) break;
        } catch {}
      }
      return messages;
    });
  }
}

module.exports = ArenaAdapter;
