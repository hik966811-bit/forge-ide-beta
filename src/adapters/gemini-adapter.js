// src/adapters/gemini-adapter.js — Gemini model adapter
'use strict';

const BaseAdapter = require('./base-adapter');
const logger      = require('../logger');

/**
 * Adapter for gemini.google.com
 */
class GeminiAdapter extends BaseAdapter {
  constructor(page, config) {
    super(page, config);
  }

  // ── Implement Abstract Methods ─────────────────────────────────────────────

  _getInputSelectors() {
    return [
      'rich-textarea .ql-editor',           // Quill editor inside rich-textarea
      'rich-textarea div[contenteditable]',  // contenteditable inside component
      '.ql-editor[contenteditable="true"]',  // Direct Quill editor
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      'textarea[aria-label*="Enter a prompt" i]',
      'textarea[placeholder*="Enter a prompt" i]',
      'textarea[aria-label*="prompt" i]',
      '[jsname="YPqjbf"]',                  // Common Gemini jsname
      'textarea',
    ];
  }

  _getSendSelectors() {
    return [
      'button[aria-label*="Send message" i]',
      'button[aria-label*="send message" i]',
      'button[jsname*="send" i]',
      '[data-test-id="send-button"]',
      'button.send-button',
      'button[aria-label="Send" i]',
      'button[mattooltip*="Send" i]',
      'button:has(mat-icon):not([disabled])',
      '.send-message-button',
    ];
  }

  _getStopSelectors() {
    return [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="stop" i]',
      'button[jsname*="stop" i]',
      '.stop-button',
      'button:has(mat-icon[data-mat-icon-name="stop"])',
    ];
  }

  _getNewChatSelectors() {
    return [
      'a[href="/app"]',
      'button[aria-label*="New chat" i]',
      'button[aria-label*="new chat" i]',
      '[data-test-id="new-conversation-button"]',
      'c-wiz a[href="/app"]',
      '.new-conversation-button',
      'a[jsname*="new" i]',
      'button[mattooltip*="New chat" i]',
    ];
  }

  _getResponseSelectors() {
    return [
      'model-response:last-child .markdown',
      'model-response:last-child',
      '.response-container:last-child .markdown-content',
      'message-content:last-child',
      '[data-response-index]:last-child',
      '.conversation-container .model-response:last-child',
      'div.model-response:last-child p',
    ];
  }

  getModelUrl() {
    return 'https://gemini.google.com/app';
  }

  // ── Overrides ──────────────────────────────────────────────────────────────

  async newChat() {
    this._isFirstMessage = true;
    try {
      await this.page.goto(this.getModelUrl(), {
        waitUntil: 'domcontentloaded',
        timeout: this.config.BROWSER_TIMEOUT || 30_000,
      });
      await this.page.waitForTimeout(2000);
    } catch (err) {
      logger.warn(`Gemini navigation failed: ${err.message}. Trying selector fallback.`);
      await this._clickElement(this._getNewChatSelectors(), { timeout: 10000 });
      await this.page.waitForTimeout(2000);
    }
  }

  async listChats() {
    return await this.page.evaluate(() => {
      const chats = [];
      const seen = new Set();

      const selectors = [
        'a[href*="/app/"]',
        'a[href*="/chat/"]',
        '[class*="sidebar"] a[href]',
        '[class*="chat-list"] a',
        '[class*="conversation-list"] a',
        '[class*="history"] a',
        'nav a[href*="chat"]',
        'a[data-test-id]',
      ];

      for (const sel of selectors) {
        try {
          const items = document.querySelectorAll(sel);
          items.forEach(a => {
            const href = a.getAttribute('href') || '';
            if (!href || seen.has(href)) return;
            if (!href.includes('/app') && !href.includes('/chat')) return;

            const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
            if (!title || title.length > 200) return;

            seen.add(href);
            const fullUrl = href.startsWith('http') ? href : location.origin + href;
            chats.push({ id: href, title, url: fullUrl });
          });
        } catch {}
      }

      if (chats.length === 0) {
        const allLinks = document.querySelectorAll('a[href]');
        allLinks.forEach(a => {
          const href = a.getAttribute('href') || '';
          if (seen.has(href)) return;
          const title = (a.textContent || '').trim().replace(/\s+/g, ' ');
          if (!title || title.length < 2 || title.length > 200) return;
          if (href.includes('/app') || href.includes('/chat')) {
            seen.add(href);
            const fullUrl = href.startsWith('http') ? href : location.origin + href;
            chats.push({ id: href, title, url: fullUrl });
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
      logger.warn(`Failed to navigate to Gemini chat: ${err.message}`);
      return false;
    }
  }

  async readChatMessages() {
    return await this.page.evaluate(() => {
      const messages = [];
      const selectors = [
        'model-response .markdown',
        'user-query .query-content',
        '[class*="message"]',
        '[class*="turn"]',
        '.conversation-container model-response',
        '.conversation-container user-query',
      ];

      for (const sel of selectors) {
        try {
          const items = document.querySelectorAll(sel);
          items.forEach(el => {
            const text = (el.innerText || '').trim();
            if (!text || text.length < 3) return;
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            const isUser = tag === 'user-query' || el.className.includes('user') || el.getAttribute('data-role') === 'user';
            const isAssistant = tag === 'model-response' || el.className.includes('model') || el.className.includes('assistant') || el.getAttribute('data-role') === 'assistant';
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

module.exports = GeminiAdapter;
