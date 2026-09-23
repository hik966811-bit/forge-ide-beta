// scripts/debug-arena.js — probe arena.ai real DOM with Forge's session
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');

const SESSION = path.join(os.homedir(), '.forge-ide', 'session');

(async () => {
  const ctx = await chromium.launchPersistentContext(SESSION, {
    headless: true,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-sandbox'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  const pages = ctx.pages();
  const page = pages.length ? pages[0] : await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));

  await page.goto('https://arena.ai', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const vis = el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
    };
    const inputs = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')].map(el => ({
      tag: el.tagName.toLowerCase(),
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || '',
      visible: vis(el),
      rect: JSON.parse(JSON.stringify(el.getBoundingClientRect())),
      cls: (el.className || '').toString().slice(0, 200),
      editable: el.isContentEditable,
    }));
    const buttons = [...document.querySelectorAll('button, [role="button"]')].map(el => ({
      aria: el.getAttribute('aria-label') || '',
      text: (el.innerText || '').trim().slice(0, 60),
      type: el.getAttribute('type') || '',
      visible: vis(el),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      cls: (el.className || '').toString().slice(0, 160),
      svg: !!el.querySelector('svg'),
    })).filter(b => b.visible);
    const loginWall = /log in|sign in|sign up|continue with|create account/i.test(document.body.innerText.slice(0, 3000));
    return {
      url: location.href,
      title: document.title,
      loginWall,
      bodyHead: document.body.innerText.slice(0, 800),
      inputs,
      buttons: buttons.slice(0, 40),
      msgLike: [...document.querySelectorAll('[class*="message"], [class*="turn"], [class*="chat"], [class*="conversation"]')]
        .slice(0, 30)
        .map(el => ({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 140) })),
      chatLinks: [...document.querySelectorAll('a[href*="/c/"]')].slice(0, 5).map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').trim().slice(0, 80) })),
      loginButtons: [...document.querySelectorAll('button, a, [role="button"]')].filter(el => {
        const t = (el.innerText || '').trim().toLowerCase();
        return t === 'log in' || t === 'sign in' || t === 'sign up' || t === 'log in to continue';
      }).map(el => ({ tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim(), visible: vis(el) })),
    };
  });

  // Mirror ArenaAdapter.isLoggedIn / selector resolution without importing the adapter
  const adapterProbe = await page.evaluate(() => {
    const vis = el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
    };
    let isLoggedIn = true;
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const t = (el.innerText || '').trim().toLowerCase();
      if ((t === 'log in' || t === 'sign in' || t === 'sign up' || t === 'log in to continue') && vis(el)) {
        isLoggedIn = false;
        break;
      }
    }
    const inputSelectors = [
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
    ];
    const sendSelectors = [
      'button[type="submit"][aria-label*="Send" i]',
      'button[aria-label="Send message" i]',
      'button[aria-label*="Send" i]',
      'button[data-testid*="send" i]',
      '[class*="send-button"]',
      '[class*="sendButton"]',
      'button[type="submit"]',
    ];
    const firstMatch = sels => {
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          if (el && vis(el)) return s;
        } catch {}
      }
      return null;
    };
    const modeButtons = [...document.querySelectorAll('button, [role="tab"], a')].filter(el => {
      const t = (el.innerText || '').trim();
      return vis(el) && (t === 'Direct' || t.startsWith('Direct\n') || t === 'Battle' || t.startsWith('Battle\n'));
    }).map(el => ({
      text: (el.innerText || '').trim(),
      active: el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-state') === 'active' || el.classList.contains('active'),
    }));
    return {
      isLoggedIn,
      inputMatch: firstMatch(inputSelectors),
      sendMatch: firstMatch(sendSelectors),
      sendDisabled: (() => {
        const el = document.querySelector('button[type="submit"][aria-label*="Send" i], button[aria-label="Send message" i]');
        return el ? (el.disabled === true || el.getAttribute('aria-disabled') === 'true') : null;
      })(),
      modeButtons,
      messageCountCandidates: [
        ['[data-message-author-role]', document.querySelectorAll('[data-message-author-role]').length],
        ['[role="article"]', document.querySelectorAll('[role="article"]').length],
        ['main article', document.querySelectorAll('main article').length],
        ['[class*="message"]', document.querySelectorAll('[class*="message"]').length],
      ],
    };
  });

  console.log(JSON.stringify({ ...info, adapterProbe }, null, 2));
  await ctx.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
