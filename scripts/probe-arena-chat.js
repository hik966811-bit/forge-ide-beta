// scripts/probe-arena-chat.js — open first Arena chat and dump message DOM
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
  await page.waitForTimeout(3000);

  // Collect chat links like the adapter does
  const chats = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/c/"]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      out.push({ href, text: (a.innerText || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120) });
    });
    return out;
  });
  console.log('CHATS', JSON.stringify(chats, null, 2));

  if (chats.length === 0) {
    console.log('NO CHATS found');
    await ctx.close();
    return;
  }

  const first = chats[0].href.startsWith('http') ? chats[0].href : 'https://arena.ai' + chats[0].href;
  await page.goto(first, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const vis = el => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width > 0 && r.height > 0;
    };

    // Candidate message containers
    const selectors = [
      '[class*="message"]', '[class*="Message"]',
      '[class*="turn"]', '[class*="Turn"]',
      '[class*="chat-item"]', '[class*="ChatItem"]',
      '[data-role]', '[data-message-author-role]',
      '[role="article"]', '[role="listitem"]',
      '[class*="bubble"]', '[class*="Bubble"]',
      '[class*="response"]', '[class*="Response"]',
      '[class*="prompt"]', '[class*="Prompt"]',
      '[class*="user"]', '[class*="assistant"]',
      '[class*="prose"]', '[class*="markdown"]',
      'article', 'main > div',
    ];
    const counts = {};
    for (const sel of selectors) {
      try { counts[sel] = document.querySelectorAll(sel).length; } catch { counts[sel] = -1; }
    }

    // Sample text blocks in main content
    const samples = [];
    const roots = [...document.querySelectorAll('main, [role="main"], [class*="conversation"], [class*="thread"], [class*="chat"]')];
    const scope = roots.length ? roots[0] : document.body;
    const els = [...scope.querySelectorAll('div, p, section, li')].filter(el => {
      if (!vis(el)) return false;
      const t = (el.innerText || '').trim();
      if (t.length < 20 || t.length > 800) return false;
      // Prefer leaf-ish blocks
      const childBlocks = el.querySelectorAll('div, p').length;
      return childBlocks <= 4;
    }).slice(0, 40);

    for (const el of els) {
      samples.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 160),
        attrs: [...el.attributes].map(a => `${a.name}=${(a.value || '').toString().slice(0, 60)}`).join(' | ').slice(0, 300),
        text: (el.innerText || '').trim().slice(0, 220),
        parentCls: ((el.parentElement && el.parentElement.className) || '').toString().slice(0, 120),
      });
    }

    // Author / role labels
    const authorish = [...document.querySelectorAll('[class*="author"], [class*="Author"], [class*="role"], [class*="Role"], [class*="sender"], [data-role], [data-author], [class*="avatar"]')]
      .slice(0, 30)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 140),
        text: (el.innerText || '').trim().slice(0, 80),
        data: [...el.attributes].filter(a => a.name.startsWith('data-') || a.name === 'role').map(a => `${a.name}=${a.value}`).join(','),
      }));

    return {
      url: location.href,
      title: document.title,
      counts,
      samples,
      authorish,
      bodyHead: document.body.innerText.slice(0, 1200),
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await ctx.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
