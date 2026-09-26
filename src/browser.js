// src/browser.js — Playwright controller for model-specific adapters
'use strict';

const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const config       = require('./config');
const logger       = require('./logger');
const { Errors }   = require('./errors');
const { getAdapter, getModelUrl } = require('./adapter-factory');
const { runHealthCheckWithReAuth } = require('./health');

// ─────────────────────────────────────────────────────────────────────────────
//  ForgeBrowser class
// ─────────────────────────────────────────────────────────────────────────────

class ForgeBrowser {
  constructor() {
    this.context  = null;
    this.page     = null;
    this._closed  = false;
    this.adapter  = null;
    this._launchPromise = null;
    this._launchedOk    = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Idempotent + serialized entry point. The IDE server pre-launches the
   * browser in the background while the launcher ALSO calls agent.init() —
   * without this guard the two concurrent launch() calls interleave
   * _openContext (close/new races) and spray blank windows on one profile.
   */
  async launch() {
    if (this._launchPromise) return this._launchPromise;
    if (this._launchedOk && this.adapter && this.page && !this.page.isClosed()) {
      return; // already live — concurrent init collapses into a no-op
    }
    this._launchPromise = (async () => {
      try {
        await this._doLaunch();
        this._launchedOk = true;
      } catch (err) {
        this._launchedOk = false;
        throw err;
      } finally {
        this._launchPromise = null;
      }
    })();
    return this._launchPromise;
  }

  async _doLaunch() {
    const sessionDir = path.resolve(config.SESSION_DIR);
    const authDoneFile = path.join(sessionDir, '.browser-auth-done');
    const authDone = fs.existsSync(authDoneFile);

    if (!authDone) {
      logger.info('First browser launch detected — opening visible for login...');
      config.HEADLESS = false;
    } else {
      config.HEADLESS = true;
    }

    logger.info(`Launching browser for ${config.MODEL} with persistent session...`);

    await this._openContext(config.HEADLESS);
    await this._navigate(getModelUrl(config.MODEL));

    // Session may have expired since auth-done was written — reopen visible
    // so the user can actually log in (login wall can't be solved headless).
    if (config.HEADLESS && this.adapter && typeof this.adapter.isLoggedIn === 'function') {
      const loggedIn = await this.adapter.isLoggedIn().catch(() => true);
      if (!loggedIn) {
        logger.warn('Saved session is no longer logged in — reopening browser visible for login...');
        await this._openContext(false);
        await this._navigate(getModelUrl(config.MODEL));
      }
    }

    let loginRequired = false;

    await runHealthCheckWithReAuth(this.page, this.adapter, config, async () => {
      loginRequired = true;
      this._printLoginBanner();
      if (config.HEADLESS) {
        logger.warn('Browser was hidden — reopening it visible for login...');
        try { await this.context.close(); } catch {}
        this._closed = false;
        await this._openContext(false);
        await this._navigate(getModelUrl(config.MODEL));
      }
      await this._waitForLogin();
    });

    if (loginRequired) {
      // Only persist headless mode when login is actually confirmed
      let verified = false;
      if (this.adapter && typeof this.adapter.isLoggedIn === 'function') {
        verified = await this.adapter.isLoggedIn().catch(() => false);
      } else {
        verified = true; // adapter has no detector — ENTER / auto-wait counts
      }

      if (verified) {
        try {
          if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
          fs.writeFileSync(authDoneFile, JSON.stringify({ done: true, date: new Date().toISOString() }));
          config.HEADLESS = true;
          logger.success('Login saved! Browser will be hidden on next launch.');
        } catch (e) {}
      } else {
        logger.warn('Login not confirmed — browser stays visible on next launch.');
      }
    }

    logger.success('Browser ready!');
  }

  async _openContext(headless) {
    const sessionDir = path.resolve(config.SESSION_DIR);
    config.HEADLESS = headless;

    if (this.context) {
      try { await this.context.close(); } catch {}
      this.context = null;
    }

    this.context = await chromium.launchPersistentContext(sessionDir, {
      headless      : headless,
      viewport      : { width: 1280, height: 900 },
      locale        : 'en-US',
      timezoneId    : 'UTC',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
      userAgent     : [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        'Chrome/124.0.0.0 Safari/537.36',
      ].join(' '),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--disable-default-apps',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--lang=en-US',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const pages = this.context.pages();
    this.page   = pages.length > 0 ? pages[0] : await this.context.newPage();

    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'language',  { get: () => 'en-US' });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    this.adapter = getAdapter(config.MODEL, this.page, config);

    // Adapters call this when a captcha/security check blocks the page
    config.ensureBrowserVisible = async (reason) => {
      if (!config.HEADLESS) return;
      logger.warn(`Browser was hidden — reopening visible (${reason || 'captcha'})...`);
      try { await this.context.close(); } catch {}
      this._closed = false;
      await this._openContext(false);
      await this._navigate(getModelUrl(config.MODEL));
    };
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    this._launchedOk = false;
    try { await this.context?.close(); } catch {}
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async _navigate(url) {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.BROWSER_TIMEOUT || 90_000 });
      await this.page.waitForTimeout(1_500);
    } catch (err) {
      logger.warn(`Navigation warning: ${err.message}`);
    }
  }

  async newChat() {
    if (!this.adapter) throw new Error('Browser not initialized');
    return await this.adapter.newChat();
  }

  // ── Login handling ─────────────────────────────────────────────────────────

  _printLoginBanner() {
    console.log('');
    logger.warn('╔══════════════════════════════════════════════╗');
    logger.warn('║  LOGIN REQUIRED                              ║');
    logger.warn('║                                              ║');
    logger.warn(`║  1. Log in to ${config.MODEL} in the browser`.padEnd(47) + '║');
    logger.warn('║  2. Detected automatically — or press ENTER  ║');
    logger.warn('╚══════════════════════════════════════════════╝');
    console.log('');
  }

  async _waitForEnter() {
    return new Promise(resolve => {
      const stdin   = process.stdin;
      const wasRaw  = stdin.isRaw;
      const wasPaused = !stdin.readable;

      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.resume();

      const handler = chunk => {
        const s = chunk.toString();
        if (s.includes('\n') || s.includes('\r')) {
          stdin.removeListener('data', handler);
          if (stdin.isTTY && wasRaw) stdin.setRawMode(true);
          if (wasPaused)            stdin.pause();
          resolve();
        }
      };

      stdin.on('data', handler);
    });
  }

  /**
   * Wait for the user to finish logging in.
   * Auto-detects via adapter.isLoggedIn() when available (polls every 2s);
   * ENTER also skips the wait. Falls back to ENTER-only for adapters
   * without a login detector. Needed because in IDE mode the process stdin
   * is not interactive, so ENTER-only would hang forever.
   */
  async _waitForLogin() {
    const timeoutMs = 15 * 60 * 1000;
    const start = Date.now();
    const canPoll = this.adapter && typeof this.adapter.isLoggedIn === 'function';

    if (!canPoll) {
      logger.dim('  Press ENTER after logging in...');
      await this._waitForEnter();
      return;
    }

    logger.dim('  Waiting for login — log in in the browser window (auto-detected)...');
    if (logger.loginRequired) logger.loginRequired(config.MODEL);

    // Optional ENTER skip (TTY only) racing against login polling
    let stdinHandler   = null;
    let restoreStdin   = null;
    const enterPromise = new Promise(resolve => {
      const stdin = process.stdin;
      if (stdin && stdin.isTTY) {
        const wasPaused = !stdin.readable;
        stdin.setRawMode(false);
        stdin.resume();
        stdinHandler = chunk => {
          const s = chunk.toString();
          if (s.includes('\n') || s.includes('\r')) resolve('enter');
        };
        stdin.on('data', stdinHandler);
        restoreStdin = () => {
          try { stdin.setRawMode(true); } catch {}
          if (wasPaused) { try { stdin.pause(); } catch {} }
        };
      }
    });

    try {
      while (Date.now() - start < timeoutMs) {
        try {
          if (await this.adapter.isLoggedIn()) {
            logger.success('Login detected!');
            return;
          }
        } catch { /* transient evaluate errors — keep polling */ }

        const winner = await Promise.race([
          enterPromise,
          new Promise(r => setTimeout(() => r('tick'), 2000)),
        ]);
        if (winner === 'enter') return;
      }
      logger.warn('Login wait timed out after 15 minutes — continuing anyway.');
    } finally {
      if (stdinHandler) {
        try { process.stdin.removeListener('data', stdinHandler); } catch {}
      }
      if (restoreStdin) restoreStdin();
    }
  }

  // ── Sending Messages ───────────────────────────────────────────────────────

  async sendMessage(text) {
    if (!this.adapter) throw new Error('Browser not initialized');
    
    try {
      return await this.adapter.sendMessage(text);
    } catch (firstErr) {
      const msg = firstErr.message.toLowerCase();
      // If it looks like a selector error or timeout, wait and retry once
      if (msg.includes('not found') || msg.includes('selector') || msg.includes('timeout')) {
        logger.warn('Send failed — waiting 3s and retrying...');
        await this.page.waitForTimeout(3000);
        
        try {
          return await this.adapter.sendMessage(text);
        } catch (secondErr) {
          // Take debug screenshot on final failure
          try {
            const debugPath = '/tmp/forge-selector-debug.png';
            await this.page.screenshot({ path: debugPath });
            logger.dim(`Debug screenshot saved: ${debugPath}`);
          } catch (e) {}
          throw secondErr;
        }
      }
      throw firstErr;
    }
  }

  // ── Waiting for Response ───────────────────────────────────────────────────

  async waitForResponse() {
    if (!this.adapter) throw new Error('Browser not initialized');
    return await this.adapter.waitForResponse();
  }

  async listChats() {
    if (!this.adapter) throw new Error('Browser not initialized');
    try {
      return await this.adapter.listChats();
    } catch (err) {
      return [];
    }
  }

  async navigateToChat(chatUrl) {
    if (!this.adapter) throw new Error('Browser not initialized');
    try {
      return await this.adapter.navigateToChat(chatUrl);
    } catch (err) {
      return false;
    }
  }

  async readChatMessages() {
    if (!this.adapter) throw new Error('Browser not initialized');
    try {
      return await this.adapter.readChatMessages();
    } catch (err) {
      return [];
    }
  }

  // ── Debug / Calibration Utilities ─────────────────────────────────────────

  /**
   * Dump useful DOM information to stdout.
   */
  async dumpDebugInfo() {
    const info = await this.page.evaluate(() => {
      const classFreq = {};
      document.querySelectorAll('*').forEach(el => {
        el.classList.forEach(c => {
          if (c.match(/message|chat|input|send|stop|markdown|content|assistant|user|bot/i)) {
            classFreq[c] = (classFreq[c] || 0) + 1;
          }
        });
      });

      const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable]')).map(e => ({
        tag         : e.tagName,
        id          : e.id || null,
        class       : e.className?.slice(0, 80) || null,
        placeholder : e.placeholder || null,
        editable    : e.isContentEditable,
        visible     : e.offsetParent !== null,
      }));

      return {
        url    : window.location.href,
        title  : document.title,
        classes: Object.entries(classFreq).sort((a, b) => b[1] - a[1]).slice(0, 40),
        inputs,
      };
    });

    console.log('\n' + '═'.repeat(60));
    console.log('  DOM DEBUG INFO');
    console.log('═'.repeat(60));
    console.log('URL   :', info.url);
    console.log('Title :', info.title);
    console.log('\nInput elements:');
    info.inputs.forEach(i => console.log(' ', JSON.stringify(i)));
    console.log('\nMatching CSS classes (by frequency):');
    info.classes.forEach(([cls, count]) => console.log(`  ${String(count).padStart(3)}x  .${cls}`));
    console.log('═'.repeat(60) + '\n');
  }

  /** Take a screenshot (for debugging) */
  async screenshot(filePath = '/tmp/forge-agent-debug.png') {
    await this.page.screenshot({ path: filePath, fullPage: false });
    logger.info(`Screenshot saved: ${filePath}`);
  }
}

module.exports = ForgeBrowser;
