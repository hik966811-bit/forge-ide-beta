// scripts/test-arena-read.js — run ArenaAdapter.readChatMessages against real chat
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const ArenaAdapter = require('../src/adapters/arena-adapter');

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
  await page.waitForTimeout(2500);

  const adapter = new ArenaAdapter(page, { BROWSER_TIMEOUT: 60000 });

  const chats = await adapter.listChats();
  console.log('LIST_CHATS', JSON.stringify(chats, null, 2));
  if (!chats.length) { console.log('NO CHATS'); await ctx.close(); return; }

  const ok = await adapter.navigateToChat(chats[0].url);
  console.log('NAV', ok);
  await page.waitForTimeout(3000);

  const msgs = await adapter.readChatMessages();
  console.log('READ_COUNT', msgs.length);
  msgs.forEach((m, i) => console.log(`[${i}] ${m.role}: ${m.text.slice(0, 160).replace(/\n/g, ' | ')}`));

  const last = await adapter._extractLastMessage();
  console.log('EXTRACT_LAST', (last || '').slice(0, 300).replace(/\n/g, ' | '));

  const count = await adapter._getMessageCount();
  console.log('MSG_COUNT', count);

  await ctx.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
