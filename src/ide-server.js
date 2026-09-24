// src/ide-server.js — HTTP & SSE server for Forge IDE
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const config = require('./config');
const logger = require('./logger');
const { setIDEPermissionCallback } = require('./permission-menu');

class IDEServer {
  constructor(options = {}) {
    this.port = options.port || 4040;
    this.host = options.host || '127.0.0.1';
    this.server = null;
    this.clients = new Set(); // SSE clients
    this.agent = null;
    this.isAgentRunning = false;
    this.currentTaskAbort = null;
    this.readCount = 0;
    this.searchCount = 0;
    this.staticDir = path.join(__dirname, 'ide');
    this._pendingPermissionResolve = null;
    this._stateFile = path.join(os.homedir(), '.forge-ide', 'ide-state.json');
    this._state = this._loadState();
    this.setupLoggerHooks();
    this.setupIDEPermissions();
  }

  _loadState() {
    try {
      if (fs.existsSync(this._stateFile)) {
        return JSON.parse(fs.readFileSync(this._stateFile, 'utf-8'));
      }
    } catch (e) {}
    return { workspace: null, chats: {}, activeChatId: null };
  }

  _saveState() {
    try {
      const dir = path.dirname(this._stateFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._stateFile, JSON.stringify(this._state, null, 2));
    } catch (e) {}
  }

  setAgent(agent) {
    this.agent = agent;
  }

  // Wire up permission-menu.js to route prompts through the IDE
  setupIDEPermissions() {
    setIDEPermissionCallback(({ label, detail, options }) => {
      return new Promise((resolve) => {
        this._pendingPermissionResolve = resolve;
        this.broadcast('permission_request', { label, detail, options });
        // Auto-approve after 120s if no response from IDE UI
        setTimeout(() => {
          if (this._pendingPermissionResolve === resolve) {
            this._pendingPermissionResolve = null;
            resolve('once');
          }
        }, 120_000);
      });
    });
  }

  // Hook into logger to broadcast all agent events to SSE clients
  setupLoggerHooks() {
    const origToolCall = logger.toolCall.bind(logger);
    logger.toolCall = (name, args) => {
      origToolCall(name, args);
      if (name === 'read' || name === 'read_file') this.readCount++;
      if (name === 'grep' || name === 'search' || name === 'websearch') this.searchCount++;
      this.broadcast('agent_tool_call', { name, args, readCount: this.readCount, searchCount: this.searchCount });
    };

    const origToolResult = logger.toolResult.bind(logger);
    logger.toolResult = (result, isError, toolName) => {
      origToolResult(result, isError, toolName);
      this.broadcast('agent_tool_result', {
        toolName: toolName || '',
        result: typeof result === 'string' ? result.slice(0, 1500) : String(result).slice(0, 1500),
        isError: Boolean(isError),
        readCount: this.readCount,
        searchCount: this.searchCount,
      });
    };

    const origThinking = logger.thinking.bind(logger);
    logger.thinking = (elapsedMs, charsReceived, thinkingText) => {
      origThinking(elapsedMs, charsReceived, thinkingText);
      this.broadcast('agent_thinking', {
        elapsedMs,
        charsReceived,
        thinkingText: typeof thinkingText === 'string' ? thinkingText : '',
        readCount: this.readCount,
        searchCount: this.searchCount,
      });
    };

    const origAnswer = logger.answer.bind(logger);
    logger.answer = (text) => {
      origAnswer(text);
      this.broadcast('agent_message', { role: 'assistant', text });
    };

    const origLoginRequired = logger.loginRequired.bind(logger);
    logger.loginRequired = (model) => {
      origLoginRequired(model);
      this.broadcast('login_required', { model: model || config.MODEL });
    };

    const origCaptchaRequired = logger.captchaRequired.bind(logger);
    logger.captchaRequired = (model) => {
      origCaptchaRequired(model);
      this.broadcast('captcha_required', { model: model || config.MODEL });
    };

    // Also intercept console.log for final agent output
    const origConsoleLog = console.log.bind(console);
    const self = this;
    console.log = function(...args) {
      origConsoleLog.apply(console, args);
      if (self.isAgentRunning && args.length > 0) {
        const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').trim();
        if (text && text.length > 20) {
          self.broadcast('agent_message', { role: 'assistant', text });
        }
      }
    };
  }

  broadcast(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch (err) {
        this.clients.delete(res);
      }
    }
  }

  // Scan folder tree recursively
  getDirectoryTree(dirPath, currentDepth = 0, maxDepth = 4) {
    const name = path.basename(dirPath) || dirPath;
    const node = {
      name,
      path: dirPath,
      relativePath: path.relative(config.WORKING_DIR || process.cwd(), dirPath) || name,
      isDirectory: true,
      children: [],
    };

    if (currentDepth >= maxDepth) {
      node.hasMore = true;
      return node;
    }

    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      // Sort: directories first, then files
      items.sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) {
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        }
        return a.isDirectory() ? -1 : 1;
      });

      for (const item of items) {
        if (item.name === '.git' || item.name === 'node_modules' || item.name === '.next' || item.name === 'dist' || item.name === 'release') continue;
        const itemPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
          node.children.push(this.getDirectoryTree(itemPath, currentDepth + 1, maxDepth));
        } else {
          const ext = path.extname(item.name).toLowerCase();
          if (ext === '.ts') continue;
          node.children.push({
            name: item.name,
            path: itemPath,
            relativePath: path.relative(config.WORKING_DIR, itemPath),
            isDirectory: false,
            extension: ext,
          });
        }
      }
    } catch (err) {
      node.error = err.message;
    }
    return node;
  }

  // Browse system directories for Folder Picker
  async browseDirectory(targetDir) {
    if (!targetDir || targetDir === 'drives') {
      // Windows drives detection
      const drives = [];
      for (let i = 65; i <= 90; i++) {
        const driveLetter = String.fromCharCode(i) + ':\\';
        try {
          if (fs.existsSync(driveLetter)) {
            drives.push({ name: driveLetter, path: driveLetter, isDrive: true });
          }
        } catch (e) {}
      }
      return {
        current: 'drives',
        parent: null,
        items: drives,
        home: os.homedir(),
      };
    }

    const resolved = path.resolve(targetDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory not found: ${resolved}`);
    }

    const parent = path.dirname(resolved) !== resolved ? path.dirname(resolved) : null;
    const items = [];

    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('$') || entry.name === 'System Volume Information') continue;
          items.push({
            name: entry.name,
            path: path.join(resolved, entry.name),
            isDirectory: true,
          });
        }
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      // Access denied or read error
    }

    return {
      current: resolved,
      parent,
      items,
      home: os.homedir(),
    };
  }

  // Start HTTP Server
  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.port++;
          this.server.listen(this.port, this.host);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        logger.info(`Forge IDE running at: http://${this.host}:${this.port}`);
        this._initBrowserInBackground();
        this._initMCPInBackground();
        resolve(`http://${this.host}:${this.port}`);
      });
    });
  }

  async _initBrowserInBackground() {
    try {
      if (!this.agent) {
        const ForgeAgent = require('./agent');
        this.agent = new ForgeAgent();
      }
      if (!this.agent.browser || !this.agent.browser.adapter) {
        logger.info('Pre-launching browser for chat history...');
        await this.agent.init();
        logger.info('Browser ready for chat history.');
      }
    } catch (err) {
      logger.warn('Background browser init failed (will retry on first task): ' + err.message);
    }
  }

  async _initMCPInBackground() {
    try {
      const { initMCPServers } = require('./tools');
      await initMCPServers();
    } catch (err) {
      logger.warn('MCP init failed: ' + err.message);
    }
  }

  // Stop HTTP Server and close clients
  async stop() {
    if (this.server) {
      for (const client of this.clients) {
        try { client.end(); } catch (e) {}
      }
      this.clients.clear();
      this.server.close();
      this.server = null;
    }
    try {
      const { shutdownMCPServers } = require('./tools');
      await shutdownMCPServers();
    } catch (e) {}
  }

  // Handle incoming HTTP requests
  async handleRequest(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    try {
      // ── API Routes ──────────────────────────────────────────────────────────
      if (pathname === '/api/agent/events') {
        this.handleSSE(req, res);
        return;
      }

      if (pathname === '/api/workspace' && req.method === 'GET') {
        const workingDir = path.resolve(config.WORKING_DIR || process.cwd());
        const tree = this.getDirectoryTree(workingDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          dir: workingDir,
          name: path.basename(workingDir) || workingDir,
          tree,
          model: config.MODEL || 'deepseek',
          profile: config.ACTIVE_PROFILE || 'default',
        }));
        return;
      }

      if (pathname === '/api/workspace' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (!body.dir || !fs.existsSync(body.dir)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid directory path' }));
          return;
        }

        const newDir = path.resolve(body.dir);
        config.WORKING_DIR = newDir;
        this._state.workspace = newDir;
        this._saveState();
        if (this.agent) {
          const { PermissionStore } = require('./permission-store');
          const { getProjectContext } = require('./project-context');
          this.agent.permissionStore = new PermissionStore(newDir);
          this.agent.projectContext = getProjectContext(newDir);
          try {
            await this.agent.projectContext.getOrCreate();
          } catch (e) {}
        }

        const tree = this.getDirectoryTree(newDir);
        this.broadcast('workspace_changed', { dir: newDir, name: path.basename(newDir) });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          dir: newDir,
          name: path.basename(newDir),
          tree,
        }));
        return;
      }

      if (pathname === '/api/browse' && req.method === 'GET') {
        const dir = parsedUrl.searchParams.get('dir');
        const data = await this.browseDirectory(dir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
      }

      if (pathname === '/api/file' && req.method === 'GET') {
        const filePath = parsedUrl.searchParams.get('path');
        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }

        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path is a directory' }));
          return;
        }

        // Read file (up to 2MB)
        if (stat.size > 2 * 1024 * 1024) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File exceeds 2MB size limit for IDE editor' }));
          return;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const ext = path.extname(filePath).slice(1).toLowerCase();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          path: filePath,
          relativePath: path.relative(config.WORKING_DIR || process.cwd(), filePath),
          name: path.basename(filePath),
          content,
          extension: ext,
          size: stat.size,
          mtime: stat.mtimeMs,
        }));
        return;
      }

      if (pathname === '/api/file' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (!body.path) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path' }));
          return;
        }

        const targetPath = path.resolve(body.path);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, body.content ?? '', 'utf8');

        this.broadcast('file_saved', { path: targetPath });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: targetPath }));
        return;
      }

      if (pathname === '/api/file/create' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const targetPath = path.resolve(body.path);
        if (body.type === 'dir') {
          fs.mkdirSync(targetPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          if (!fs.existsSync(targetPath)) {
            fs.writeFileSync(targetPath, '', 'utf8');
          }
        }
        this.broadcast('tree_changed', { dir: config.WORKING_DIR });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: targetPath }));
        return;
      }

      if (pathname === '/api/file/delete' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const targetPath = path.resolve(body.path);
        if (fs.existsSync(targetPath)) {
          const stat = fs.statSync(targetPath);
          if (stat.isDirectory()) {
            fs.rmSync(targetPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(targetPath);
          }
          this.broadcast('tree_changed', { dir: config.WORKING_DIR });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathname === '/api/file/rename' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const oldPath = path.resolve(body.oldPath);
        const newPath = path.resolve(body.newPath);
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath);
          this.broadcast('tree_changed', { dir: config.WORKING_DIR });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathname === '/api/search' && req.method === 'GET') {
        const query = parsedUrl.searchParams.get('q') || '';
        const results = this.searchFiles(config.WORKING_DIR, query.toLowerCase());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
        return;
      }

      if (pathname === '/api/agent/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          running: this.isAgentRunning,
          model: config.MODEL || 'deepseek',
          workingDir: config.WORKING_DIR || process.cwd(),
          profile: config.ACTIVE_PROFILE || 'default',
        }));
        return;
      }

      if (pathname === '/api/agent/run' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (!body.task) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing task' }));
          return;
        }

        if (this.isAgentRunning) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Agent is already running a task' }));
          return;
        }

        this.isAgentRunning = true;
        this.readCount = 0;
        this.searchCount = 0;
        this.broadcast('agent_start', { task: body.task });

        // Run agent asynchronously in background
        (async () => {
          try {
            if (!this.agent) {
              const ForgeAgent = require('./agent');
              this.agent = new ForgeAgent();
            }
            if (!this.agent.browser || !this.agent.browser.adapter) {
              this.broadcast('agent_thinking', { elapsedMs: 0, charsReceived: 0 });
              logger.info('Launching browser session for ' + (config.MODEL || 'deepseek') + '...');
              await this.agent.init();
            }

            const result = await this.agent.run(body.task, null, body.history);
            let summary = (result || '').replace(/TASK_COMPLETE/g, '').trim();
            if (!summary) {
              summary = '';
            }
            this.broadcast('agent_done', { task: body.task, summary });
            this.broadcast('tree_changed', { dir: config.WORKING_DIR });
          } catch (err) {
            this.broadcast('agent_error', { error: err.message });
          } finally {
            this.isAgentRunning = false;
          }
        })();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Task queued' }));
        return;
      }

      if (pathname === '/api/agent/stop' && req.method === 'POST') {
        if (this.agent && this.isAgentRunning) {
          this.agent._running = false;
          this.isAgentRunning = false;
          this.broadcast('agent_stopped', { message: 'Task stopped by user' });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Permission response from IDE UI
      if (pathname === '/api/permission/respond' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (this._pendingPermissionResolve && body.decision) {
          const resolver = this._pendingPermissionResolve;
          this._pendingPermissionResolve = null;
          resolver(body.decision);
          this.broadcast('permission_resolved', { decision: body.decision });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathname === '/api/agent/new-chat' && req.method === 'POST') {
        if (this.agent && this.agent.browser) {
          try {
            await this.agent.browser.newChat();
          } catch (e) {}
        }
        this.broadcast('agent_new_chat', { success: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // Chat history is only valid for the active model — all three endpoints
      // share one browser adapter, so without this gate every section shows
      // the same (wrong provider's) chats. Arena Direct presets all report as 'arena'.
      const { getProvider } = require('./adapter-factory');
      if ((pathname === '/api/deepseek/chats' || pathname === '/api/gemini/chats' || pathname === '/api/arena/chats')
          && req.method === 'GET') {
        const want = pathname.split('/')[2]; // deepseek | gemini | arena
        if (getProvider(config.MODEL) !== want || !this.agent || !this.agent.browser || !this.agent.browser.adapter) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ chats: [] }));
          return;
        }
        try {
          const chats = await this.agent.browser.listChats();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ chats }));
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ chats: [], error: err.message }));
        }
        return;
      }

      if ((pathname === '/api/deepseek/open' || pathname === '/api/gemini/open' || pathname === '/api/arena/open')
          && req.method === 'POST') {
        const want = pathname.split('/')[2];
        const body = await this.readJsonBody(req);
        if (!body.url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url' }));
          return;
        }
        if (getProvider(config.MODEL) !== want || !this.agent || !this.agent.browser || !this.agent.browser.adapter) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Switch model to ${want} to open its chats` }));
          return;
        }
        try {
          const ok = await this.agent.browser.navigateToChat(body.url);
          const { getModelDisplayName } = require('./adapter-factory');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: ok, model: getModelDisplayName(config.MODEL) }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      if ((pathname === '/api/deepseek/messages' || pathname === '/api/gemini/messages' || pathname === '/api/arena/messages')
          && req.method === 'GET') {
        const want = pathname.split('/')[2];
        if (getProvider(config.MODEL) !== want || !this.agent || !this.agent.browser || !this.agent.browser.adapter) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messages: [] }));
          return;
        }
        try {
          const messages = await this.agent.browser.readChatMessages();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messages }));
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messages: [], error: err.message }));
        }
        return;
      }

      if (pathname === '/api/terminal/exec' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        const command = body.command;
        if (!command) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing command' }));
          return;
        }

        exec(command, { cwd: config.WORKING_DIR || process.cwd() }, (err, stdout, stderr) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            stdout: stdout || '',
            stderr: stderr || '',
            code: err ? (err.code || 1) : 0,
          }));
        });
        return;
      }

      if (pathname === '/api/window/action' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (body.action === 'close') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          setTimeout(() => process.exit(0), 400);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (pathname === '/api/browser-auth' && req.method === 'POST') {
        const fs = require('fs');
        const sessionDir = path.join(require('os').homedir(), '.forge-ide', 'session');
        const authFile = path.join(sessionDir, '.browser-auth-done');
        try {
          if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
          fs.writeFileSync(authFile, JSON.stringify({ done: true, date: new Date().toISOString() }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
        return;
      }

      if (pathname === '/api/browser-auth' && req.method === 'GET') {
        const fs = require('fs');
        const authFile = path.join(require('os').homedir(), '.forge-ide', 'session', '.browser-auth-done');
        const done = fs.existsSync(authFile);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ done }));
        return;
      }

      // ── Server-side persistence (survives localStorage clears) ────────────
      if (pathname === '/api/persist' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this._state));
        return;
      }

      if (pathname === '/api/persist' && req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (body.workspace !== undefined) this._state.workspace = body.workspace;
        if (body.chats !== undefined) this._state.chats = body.chats;
        if (body.activeChatId !== undefined) this._state.activeChatId = body.activeChatId;
        this._saveState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // ── MCP Status ──────────────────────────────────────────────────────
      if (pathname === '/api/mcp/status' && req.method === 'GET') {
        const { getMCPTools } = require('./tools');
        const tools = getMCPTools();
        const servers = config.MCP_SERVERS || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ servers, tools }));
        return;
      }

      // ── Static Files ────────────────────────────────────────────────────────
      let reqPath = pathname;
      if (reqPath === '/' || reqPath === '/index.html') {
        reqPath = '/index.html';
      }

      // Serve astramusic.wav from parent directory
      if (reqPath === '/astramusic.wav') {
        const wavPath = path.join(__dirname, '..', 'astramusic.wav');
        if (fs.existsSync(wavPath)) {
          res.writeHead(200, { 'Content-Type': 'audio/wav' });
          fs.createReadStream(wavPath).pipe(res);
          return;
        }
      }

      const filePath = path.join(this.staticDir, reqPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff',
          '.wav': 'audio/wav',
          '.mp3': 'audio/mpeg',
        };
        const contentType = mimeTypes[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Handle Server-Sent Events
  handleSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    this.clients.add(res);

    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  // Search files in workspace
  searchFiles(dirPath, query, maxResults = 25) {
    const results = [];
    const searchRecursive = (dir) => {
      if (results.length >= maxResults) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (entry.name === '.git' || entry.name === 'node_modules') continue;
          const full = path.join(dir, entry.name);
          const rel = path.relative(config.WORKING_DIR || process.cwd(), full);
          if (entry.name.toLowerCase().includes(query) || rel.toLowerCase().includes(query)) {
            results.push({
              name: entry.name,
              relativePath: rel,
              path: full,
              isDirectory: entry.isDirectory(),
            });
          }
          if (entry.isDirectory()) {
            searchRecursive(full);
          }
        }
      } catch (e) {}
    };
    searchRecursive(dirPath);
    return results;
  }

  // Read JSON body helper
  readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) {
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }
}

module.exports = IDEServer;
