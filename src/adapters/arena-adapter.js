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
    this._modeChecked = false;
    this.selectors = {
      chatInput: [
        'textarea[placeholder*="Ask anything" i]',
        'textarea[placeholder*="Ask followup" i]',
        'textarea[placeholder*="followup" i]',
        'textarea[placeholder*="Ask" i]',
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="prompt" i]',
        '[contenteditable="true"][data-placeholder]',
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea',
        '[contenteditable="true"]',
      ],
      sendButton: [
        'button[type="submit"][aria-label*="Send" i]',
        'button[aria-label="Send message" i]',
        'button[aria-label*="Send" i]',
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

  /**
   * Return false when the arena.ai login wall is showing.
   * A visible "Log In" / "Sign Up" button means the session is not authenticated.
   */
  async isLoggedIn() {
    try {
      return await this.page.evaluate(() => {
        const vis = el => {
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
            && r.width > 0 && r.height > 0;
        };
        for (const el of document.querySelectorAll('button, a, [role="button"]')) {
          const t = (el.innerText || '').trim().toLowerCase();
          if ((t === 'log in' || t === 'sign in' || t === 'sign up' || t === 'log in to continue') && vis(el)) {
            return false;
          }
        }
        return true;
      });
    } catch {
      // On evaluation errors assume logged in so we never block a working session
      return true;
    }
  }

  /**
   * Best-effort: switch Arena out of Battle/Side-by-side into Direct mode
   * so responses are a single clean stream. Direct lives inside the mode
   * dropdown (trigger shows the current mode, e.g. "Battle").
   */
  async _ensureDirectMode() {
    if (this._modeChecked) return;
    this._modeChecked = true;
    try {
      const findDirect = () => this.page.evaluate(() => {
        const vis = el => {
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
            && r.width > 0 && r.height > 0;
        };
        const els = [...document.querySelectorAll('button, [role="tab"], [role="menuitem"], [role="option"], [role="menuitemradio"], a')];
        const direct = els.find(e => {
          if (!vis(e)) return false;
          const t = (e.innerText || '').trim().toLowerCase();
          return t === 'direct' || t.startsWith('direct\n') || t.startsWith('directchat') || /^direct\b/.test(t);
        });
        if (!direct) return { found: false };
        const active =
          direct.getAttribute('aria-selected') === 'true' ||
          direct.getAttribute('data-state') === 'active' ||
          direct.getAttribute('aria-pressed') === 'true' ||
          direct.classList.contains('active') ||
          direct.classList.contains('selected');
        if (active) return { found: true, active: true, clicked: false };
        direct.click();
        return { found: true, active: false, clicked: true };
      });

      let res = await findDirect().catch(() => ({ found: false }));

      // Direct is usually hidden inside the mode dropdown — open it first
      if (!res.found) {
        const opened = await this.page.evaluate(() => {
          const vis = el => {
            const s = window.getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
              && r.width > 0 && r.height > 0;
          };
          const modes = ['battle', 'agent mode', 'side by side', 'direct', 'auto'];
          const trigger = [...document.querySelectorAll('button')].find(e => {
            if (!vis(e)) return false;
            const t = (e.innerText || '').trim().toLowerCase();
            return modes.some(m => t === m || t.startsWith(m));
          });
          if (!trigger) return false;
          trigger.click();
          return true;
        }).catch(() => false);
        if (opened) {
          await this.page.waitForTimeout(500);
          res = await findDirect().catch(() => ({ found: false }));
        }
      }

      if (res && res.clicked) await this.page.waitForTimeout(600);
    } catch { /* mode switch is best-effort only */ }
  }

  async sendMessage(text) {
    // Fail fast when the login wall is up — never type into a dead input
    try {
      if (!(await this.isLoggedIn())) {
        const err = new Error(
          'Not logged into arena.ai — log in in the browser window, then retry.'
        );
        err.retryable = false;
        throw err;
      }
    } catch (e) {
      if (e.retryable === false) throw e;
    }

    if (await this._isCaptchaShowing()) {
      await this._waitForCaptchaClear(Date.now());
    }

    await this._ensureDirectMode();

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

      // The send button is disabled while the input is empty — poll until it
      // enables after the fill, up to 5s (React state may lag the fill).
      const sendDelayMs = Math.max(this.config.SEND_DELAY || 300, 5000);
      const startPoll = Date.now();
      let clicked = false;
      while (Date.now() - startPoll < sendDelayMs) {
        clicked = await this._clickSendButton();
        if (clicked) break;
        await this.page.waitForTimeout(100);
      }

      if (!clicked) {
        await this.page.keyboard.press('Enter');
      }

      await this.page.waitForTimeout(400);

      // Verify the text actually left the input (or the page navigated to /c/…)
      let sent = true;
      try {
        const cur = await el.inputValue({ timeout: 1500 });
        if (typeof cur === 'string' && cur.trim().length > 0) {
          await this.page.keyboard.press('Enter');
          await this.page.waitForTimeout(500);
          const cur2 = await el.inputValue({ timeout: 1500 }).catch(() => '');
          if (cur2 && cur2.trim().length > 0) sent = false;
        }
      } catch {
        // Element detached — Arena navigated to the new chat URL = sent
        sent = true;
      }

      if (!sent) {
        const loggedIn = await this.isLoggedIn().catch(() => true);
        const err = new Error(loggedIn
          ? 'Arena did not accept the message — the input still contains the text after send.'
          : 'Not logged into arena.ai — log in in the browser window, then retry.');
        err.retryable = !loggedIn;
        throw err;
      }
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
        if (await this._isCaptchaShowing()) {
          await this._waitForCaptchaClear(start);
        }
        const count = await this._getMessageCount();
        if (count > initialCount) { appeared = true; break; }
        await this.page.waitForTimeout(200);
      }

      if (!appeared) logger.warn('Response may have been delayed — continuing to wait...');

      // Phase 2: wait for text to stabilise
      let lastText    = '';
      let stableStart = null;
      let lastIndicatorUpdate = 0;
      let loginPoll   = 0;
      let captchaPoll = 0;

      while (Date.now() - start < timeout) {
        if (++captchaPoll >= 5) {
          captchaPoll = 0;
          if (await this._isCaptchaShowing()) {
            await this._waitForCaptchaClear(start);
          }
        }

        const text = await this._extractLastMessage();

        // Session can expire mid-response — bail out instead of spinning for 10 min
        if (++loginPoll >= 10) {
          loginPoll = 0;
          if (!(await this.isLoggedIn().catch(() => true))) {
            const err = new Error('Lost login to arena.ai — session expired. Log in again in the browser window.');
            err.retryable = false;
            throw err;
          }
        }

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
    // Short per-selector timeout: with the corrected selectors the first one
    // matches immediately; long waits here used to stall sends for minutes.
    for (const sel of this.selectors.chatInput) {
      try {
        const el = await this.page.waitForSelector(sel, {
          timeout: 4_000,
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
        '[data-message-author-role]',
        '[role="article"]',
        'main article',
        '[class*="assistant"]',
        '[data-role="assistant"]',
        '[class*="ai-message"]',
        '[class*="bot-message"]',
        '[class*="message-row"]',
        '[class*="chat-message"]',
        // Arena uses Tailwind — content lives in .prose; user bubbles are
        // right-aligned (items-end) containers.
        'main .prose',
        '[class*="items-end"]',
      ];
      for (const sel of candidates) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) return els.length;
        } catch {}
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

      // Arena Tailwind DOM: assistant replies are .prose outside the
      // right-aligned user bubble. After a send, the new reply sits BELOW
      // the last user message — prefer that band so we never return an older
      // greeting just because it is longer. Battle columns at the same
      // vertical band: take the longest (the live one keeps growing).
      {
        const isJunkHeader = t =>
          t.length < 40 && /^[a-z0-9][a-z0-9._-]{2,40}$/i.test(t);

        const prose = [...document.querySelectorAll('.prose')].filter(el => {
          if (el.closest('[class*="items-end"]')) return false;
          const t = (el.innerText || '').trim();
          return t.length > 10 && !isJunkHeader(t);
        });

        if (prose.length > 0) {
          const users = [...document.querySelectorAll('[class*="items-end"]')];
          let afterY = -Infinity;
          if (users.length > 0) {
            const r = users[users.length - 1].getBoundingClientRect();
            afterY = r.bottom;
          }

          let below = prose.filter(el => {
            try { return el.getBoundingClientRect().top >= afterY - 12; }
            catch { return false; }
          });
          const pool = below.length > 0 ? below : prose;

          let maxBottom = -Infinity;
          for (const el of pool) {
            try {
              const b = el.getBoundingClientRect().bottom;
              if (b > maxBottom) maxBottom = b;
            } catch {}
          }
          const band = pool.filter(el => {
            try { return el.getBoundingClientRect().bottom >= maxBottom - 48; }
            catch { return false; }
          });
          let best = band[0] || pool[0];
          for (const el of (band.length ? band : pool)) {
            if ((el.innerText || '').length > (best.innerText || '').length) best = el;
          }
          const t = getFullText(best);
          if (t.length > 10) return t;
        }
      }

      const directSelectors = [
        '[data-message-author-role="assistant"]',
        '[role="article"]:last-of-type',
        'main article:last-of-type',
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

      // Structural fallback: walk up from the composer and take the last
      // sibling block that isn't the input area (works without class names).
      const ta = document.querySelector('textarea, [contenteditable="true"]');
      if (ta) {
        let node = ta;
        for (let i = 0; i < 10 && node.parentElement; i++) {
          node = node.parentElement;
          const kids = [...node.children];
          if (kids.length >= 2) {
            const blocks = kids.filter(k =>
              !k.querySelector('textarea, [contenteditable="true"]') &&
              (k.innerText || '').trim().length > 20
            );
            if (blocks.length > 0) return getFullText(blocks[blocks.length - 1]);
          }
        }
      }

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

  // ── Captcha / security verification ────────────────────────────────────────

  async _isCaptchaShowing() {
    try {
      return await this.page.evaluate(() => {
        const vis = el => {
          if (!el) return false;
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
            && r.width > 0 && r.height > 0;
        };
        const selectors = [
          'iframe[src*="recaptcha"]',
          'iframe[src*="google.com/recaptcha"]',
          'iframe[src*="hcaptcha"]',
          'iframe[src*="turnstile"]',
          '.g-recaptcha',
          '[class*="cf-turnstile"]',
          '[data-sitekey]',
        ];
        for (const sel of selectors) {
          try {
            if ([...document.querySelectorAll(sel)].some(vis)) return true;
          } catch {}
        }
        const body = ((document.body && document.body.innerText) || '');
        return /Security Verification|I'?m not a robot|I am not a robot|Я не робот|complete this quick security check|Подтвердите, что вы человек|подтвердите, что вы не робот/i.test(body);
      });
    } catch {
      return false;
    }
  }

  /**
   * Captcha blocks headless progress — surface it in the IDE, reopen the
   * browser visible if hidden, then poll until the user clears it.
   */
  async _waitForCaptchaClear(since) {
    const timeoutMs = this.config.CAPTCHA_TIMEOUT || 5 * 60 * 1000;
    const deadline = (since || Date.now()) + timeoutMs;
    const model = (this.config && this.config.MODEL) || 'arena';

    if (logger.captchaRequired) logger.captchaRequired(model);

    if (typeof this.config.ensureBrowserVisible === 'function') {
      try { await this.config.ensureBrowserVisible('captcha'); } catch {}
    }

    logger.dim('  Complete the security check (captcha) in the browser window...');

    while (Date.now() < deadline) {
      if (!(await this._isCaptchaShowing().catch(() => false))) {
        logger.success('Security check cleared — continuing...');
        return true;
      }
      await this.page.waitForTimeout(1500);
    }

    const err = new Error(
      'Security check (captcha) on arena.ai was not completed in time — finish it in the browser window and retry.'
    );
    err.retryable = false;
    throw err;
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
      const cleanTitle = raw => {
        let t = (raw || '').trim().replace(/\s+/g, ' ');
        // Sidebar anchors glue vendor name + full first-prompt preview
        t = t.replace(/^(Anthropic|OpenAI|Google|Meta|xAI|Mistral|DeepSeek)\s*/i, '');
        if (/You are Forge Agent/i.test(t)) t = 'Forge Agent task';
        if (t.length > 60) t = t.slice(0, 57).trimEnd() + '...';
        return t || 'Arena chat';
      };
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
            const title = cleanTitle(a.textContent || a.innerText || '');
            if (!title) return;
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
          if (!href.includes('/c/')) return;
          const title = cleanTitle(a.textContent || a.innerText || '');
          if (!title || title.length < 2) return;
          seen.add(href);
          chats.push({ id: href, title, url: href.startsWith('http') ? href : location.origin + href });
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
            result += '\n```' + lang + '\n' + body + '\n```\n';
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

      const messages = [];
      const seen = new Set();

      // Collect blocks: user bubbles (right-aligned items-end) and assistant
      // content (.prose not inside items-end). Battle mode columns are not
      // chronological in DOM order — sort by vertical position.
      const nodes = [...document.querySelectorAll('[class*="items-end"], .prose')];
      const found = [];
      for (const el of nodes) {
        // Prefer the outermost bubble for user msgs; for .prose skip if nested
        // inside another .prose we will also visit.
        const cls = (el.className || '').toString();
        const isUserBubble = cls.includes('items-end');
        const isProse = cls.includes('prose');

        if (isProse && el.closest('[class*="items-end"]')) {
          // prose inside a user bubble — handled by the bubble itself
          continue;
        }
        if (isUserBubble && el.querySelector('[class*="items-end"]')) {
          // nested items-end — outer one carries the full bubble text
          continue;
        }

        // For user bubbles, take the raised inner bubble if present (drops
        // empty layout wrappers); otherwise the bubble itself.
        let target = el;
        if (isUserBubble) {
          const inner = el.querySelector('.bg-surface-raised, [class*="rounded-lg"]');
          if (inner) target = inner;
        }

        const text = getFullText(target);
        if (!text || text.length < 3) continue;

        // Skip pure model-name sticky headers (claude-…, gpt-…, etc.)
        if (/^[a-z0-9][a-z0-9._-]{2,40}$/i.test(text) && text.length < 40) continue;

        const key = text.slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);

        let top = 0;
        try { top = target.getBoundingClientRect().top + window.scrollY; } catch {}

        found.push({
          role: isUserBubble ? 'user' : 'assistant',
          text: text.slice(0, 5000),
          top,
        });
      }
      found.sort((a, b) => a.top - b.top);
      found.forEach(m => { delete m.top; });
      messages.push(...found);

      // Fallback: previous selector strategies if the Tailwind walk found nothing
      if (messages.length === 0) {
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
              const c = el.className || '';
              const isUser = c.includes('user') || el.getAttribute('data-role') === 'user';
              const isAssistant = c.includes('assistant') || c.includes('bot') || c.includes('ai') || el.getAttribute('data-role') === 'assistant';
              if (isUser || isAssistant) {
                messages.push({ role: isUser ? 'user' : 'assistant', text: text.slice(0, 5000) });
              }
            });
            if (messages.length > 0) break;
          } catch {}
        }
      }

      return messages;
    });
  }
}

module.exports = ArenaAdapter;
