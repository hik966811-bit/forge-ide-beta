// forge-roblox-mcp.js — MCP server giving Forge IDE live Roblox Studio access.
//
// Runs as a plain Node script over stdio (newline-delimited JSON-RPC) and
// relays tool calls to Roblox Studio over loopback HTTP. The Studio side is
// ForgeRobloxBridge.lua: install it into the Studio Plugins folder and open
// a place — the plugin polls this server for commands and posts results.
//
// Because Roblox Lua has no raw sockets, the bridge is HTTP (not TCP):
//   GET  127.0.0.1:8092/pending  -> next queued command {id, op, ...} or {id:null}
//   POST 127.0.0.1:8092/result   -> {id, ok, ...} resolves the waiting MCP call
//
// CONFIGURE in ~/.forge-ide/config.json:
//   "MCP_SERVERS": [
//     { "name": "roblox", "command": "node",
//       "args": ["C:/path/to/forge-roblox-mcp.js"],
//       "env": { "FORGE_ROBLOX_PORT": "8092" } }
//   ]
// Then /mcp list shows the roblox__* tools and the AI can use them.
'use strict';

const http = require('http');

const PORT = parseInt(process.env.FORGE_ROBLOX_PORT || '8092', 10);
const CMD_TIMEOUT_MS = 60000;

let nextId = 1;
const queue = [];          // commands waiting for Studio to poll
const pending = new Map(); // id -> { resolve, reject, timer }

function studioHint() {
  return 'Roblox Studio did not answer on 127.0.0.1:' + PORT +
    ' — open a place in Studio with ForgeRobloxBridge.lua installed in the Plugins folder.';
}

function enqueue(op) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      const qi = queue.findIndex(c => c.id === id);
      if (qi >= 0) queue.splice(qi, 1);
      reject(new Error(studioHint()));
    }, CMD_TIMEOUT_MS);
    // NOTE: timer is intentionally NOT unref'd — it keeps this process
    // alive while an MCP call waits for Studio.
    pending.set(id, { resolve, reject, timer });
    queue.push({ id, ...op });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/pending') {
    const cmd = queue.length > 0 ? queue.shift() : { id: null };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cmd));
  } else if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          clearTimeout(p.timer);
          p.resolve(msg);
        }
      } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  }
});

server.listen(PORT, '127.0.0.1');

const TOOLS = [
  { name: 'roblox_ping', description: 'Check the Roblox Studio link. Returns place name.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'roblox_console', description: 'Read Studio output log entries (errors, warnings).',
    inputSchema: { type: 'object', properties: {
      kinds: { type: 'string', description: 'all, error, or warning (default all)' },
      limit: { type: 'number', description: 'max entries (default 50)' } } } },
  { name: 'roblox_tree', description: 'List the DataModel tree (services and top-level instances).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'roblox_createscript', description: 'Create a Script/LocalScript/ModuleScript instance live in the open place.',
    inputSchema: { type: 'object', properties: {
      className: { type: 'string', description: 'Script, LocalScript, or ModuleScript (default Script)' },
      name: { type: 'string', description: 'Instance name (default ForgeScript)' },
      parent: { type: 'string', description: 'Dotted parent path, e.g. ServerScriptService (default)' },
      source: { type: 'string', description: 'Luau source code' } },
      required: ['source'] } },
  { name: 'roblox_exec', description: 'Run arbitrary Luau code inside the open Studio place and get printed output plus errors. Use for inspection and quick automation.',
    inputSchema: { type: 'object', properties: {
      code: { type: 'string', description: 'Luau code to run, e.g. "for _,c in ipairs(workspace:GetChildren()) do print(c.Name) end"' } },
      required: ['code'] } },
];

async function callTool(name, args) {
  switch (name) {
    case 'roblox_ping':    return enqueue({ op: 'ping' });
    case 'roblox_console': return enqueue({ op: 'console', kinds: args.kinds || 'all', limit: args.limit || 50 });
    case 'roblox_tree':    return enqueue({ op: 'tree' });
    case 'roblox_createscript': {
      if (!args.source) throw new Error('source is required');
      return enqueue({ op: 'createscript', className: args.className || 'Script',
        name: args.name || 'ForgeScript', parent: args.parent || 'ServerScriptService', source: args.source });
    }
    case 'roblox_exec': {
      if (!args.code) throw new Error('code is required');
      return enqueue({ op: 'exec', code: args.code });
    }
    default: throw new Error('Unknown tool: ' + name);
  }
}

// --- minimal MCP (newline-delimited JSON-RPC over stdio) ---

let buffer = '';

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function replyError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  // Notifications have no id — acknowledge silently.
  if (msg.id == null) return;
  try {
    if (msg.method === 'initialize') {
      reply(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'forge-roblox', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      reply(msg.id, { tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      const data = await callTool(name, args);
      reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
    } else {
      replyError(msg.id, 'Unknown method: ' + msg.method);
    }
  } catch (err) {
    replyError(msg.id, err.message);
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); }
    catch { /* ignore malformed input lines */ }
  }
});
