// src/ide-launcher.js — Desktop app launcher for Forge Agent IDE (No Electron)
'use strict';

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const IDEServer = require('./ide-server');
const logger = require('./logger');
const config = require('./config');

class IDELauncher {
  constructor(options = {}) {
    this.port = options.port || 4040;
    this.server = new IDEServer({ port: this.port });
    this.agent = null;
    this.appProcess = null;
  }

  setAgent(agent) {
    this.agent = agent;
    this.server.setAgent(agent);
  }

  // Find Chrome or Edge to run in Standalone App Window Mode (--app)
  findAppBrowser() {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    ];

    for (const exe of candidates) {
      try {
        if (fs.existsSync(exe)) return exe;
      } catch (e) {}
    }
    return null;
  }

  async launch() {
    // 1. Start IDE Server
    const url = await this.server.start();

    // 2. Launch Standalone Native App Window
    const browserExe = this.findAppBrowser();
    if (browserExe) {
      logger.info(`Opening Forge IDE Desktop App...`);
      // Use a separate user-data-dir so it doesn't conflict with
      // the DeepSeek puppeteer session or any other Chrome instance
      const ideProfileDir = path.join(os.tmpdir(), 'forge-agent-ide-profile');
      if (!fs.existsSync(ideProfileDir)) {
        fs.mkdirSync(ideProfileDir, { recursive: true });
      }
      const args = [
        `--app=${url}`,
        `--user-data-dir=${ideProfileDir}`,
        '--window-size=1440,900',
        '--disable-extensions',
        '--disable-plugins',
        '--no-first-run',
        '--no-default-browser-check',
      ];

      this.appProcess = spawn(browserExe, args, {
        detached: true,
        stdio: 'ignore',
      });
      this.appProcess.unref();
    } else {
      // Fallback to start URL in default browser
      logger.info(`Opening Forge IDE in browser: ${url}`);
      exec(`start ${url}`);
    }

    // 3. Launch DeepSeek browser session so the AI model is ready and connected
    if (this.agent) {
      try {
        logger.info(`Launching browser for ${config.MODEL || 'deepseek'}...`);
        await this.agent.init();
        logger.success(`${config.MODEL || 'deepseek'} browser ready!`);
      } catch (err) {
        logger.warn(`Browser session launch note: ${err.message}`);
      }
    }

    return url;
  }
}

module.exports = IDELauncher;
