// src/mcp-client.js — MCP (Model Context Protocol) client
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const logger = require('./logger');

class MCPClient {
  constructor(name, command, args = [], env = {}) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.process = null;
    this.tools = [];
    this._id = 0;
    this._pending = new Map();
    this._buffer = '';
    this._ready = false;
    this._readyPromise = null;
    this._readyResolve = null;
  }

  async start() {
    this._readyPromise = new Promise(resolve => { this._readyResolve = resolve; });

    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
      shell: process.platform === 'win32',
    });

    this.process.stdout.on('data', (data) => this._onData(data));
    this.process.stderr.on('data', (data) => {
      logger.debug(`[MCP:${this.name}] stderr: ${data.toString().trim()}`);
    });
    this.process.on('error', (err) => {
      logger.error(`[MCP:${this.name}] spawn error: ${err.message}`);
      this._ready = false;
    });
    this.process.on('close', (code) => {
      logger.debug(`[MCP:${this.name}] exited with code ${code}`);
      this._ready = false;
    });

    // Initialize handshake
    const result = await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'forge-ide', version: '1.0.0' },
    });

    // Notify initialized
    await this._notify('notifications/initialized', {});

    this._ready = true;
    this._readyResolve?.(true);

    // List tools
    const toolsResult = await this._send('tools/list', {});
    this.tools = toolsResult?.tools || [];

    logger.info(`[MCP:${this.name}] connected, ${this.tools.length} tools`);
    return this.tools;
  }

  async waitForReady() {
    if (this._ready) return true;
    return this._readyPromise;
  }

  _onData(chunk) {
    this._buffer += chunk.toString();
    // MCP uses newline-delimited JSON-RPC
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this._handleMessage(msg);
      } catch (e) {
        logger.debug(`[MCP:${this.name}] parse error: ${e.message}`);
      }
    }
  }

  _handleMessage(msg) {
    // Response to a request
    if (msg.id != null && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  }

  async _send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this._id;
      this._pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.process.stdin.write(msg);
      // Timeout after 60s
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`MCP request ${method} timed out`));
        }
      }, 60000);
    });
  }

  async _notify(method, params) {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.process.stdin.write(msg);
  }

  async callTool(toolName, args) {
    const result = await this._send('tools/call', {
      name: toolName,
      arguments: args,
    });
    // MCP returns { content: [{ type: 'text', text: '...' }] }
    if (result?.content) {
      return result.content.map(c => c.text || JSON.stringify(c)).join('\n');
    }
    return JSON.stringify(result);
  }

  async stop() {
    if (this.process) {
      this._ready = false;
      this.process.kill();
      this.process = null;
    }
  }
}

// ─────────────────────────────────────────────
//  Manager: handles multiple MCP server connections
// ─────────────────────────────────────────────

class MCPManager {
  constructor() {
    this.clients = new Map();   // name -> MCPClient
    this.tools = new Map();     // toolName -> { client, toolDef }
  }

  async connectAll(serverConfigs = []) {
    const results = [];
    for (const srv of serverConfigs) {
      try {
        const client = new MCPClient(srv.name, srv.command, srv.args || [], srv.env || {});
        await client.start();
        this.clients.set(srv.name, client);
        // Register each tool
        for (const tool of client.tools) {
          const toolName = `${srv.name}__${tool.name}`;
          this.tools.set(toolName, { client, toolDef: tool });
          results.push({ server: srv.name, tool: toolName, description: tool.description });
        }
      } catch (err) {
        logger.error(`[MCP] Failed to connect ${srv.name}: ${err.message}`);
        results.push({ server: srv.name, error: err.message });
      }
    }
    return results;
  }

  getToolNames() {
    return [...this.tools.keys()];
  }

  getToolDescription(toolName) {
    const entry = this.tools.get(toolName);
    if (!entry) return null;
    const { toolDef } = entry;
    return toolDef.description || '';
  }

  getToolParameters(toolName) {
    const entry = this.tools.get(toolName);
    if (!entry) return null;
    return entry.toolDef.inputSchema?.properties || {};
  }

  async callTool(toolName, args) {
    const entry = this.tools.get(toolName);
    if (!entry) throw new Error(`Unknown MCP tool: ${toolName}`);
    return entry.client.callTool(entry.toolDef.name, args);
  }

  async disconnectAll() {
    for (const [name, client] of this.clients) {
      await client.stop();
    }
    this.clients.clear();
    this.tools.clear();
  }
}

module.exports = { MCPClient, MCPManager };
