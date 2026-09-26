// forge-unity-mcp.js — MCP server giving Forge IDE live Unity Editor access.
//
// Runs as a plain Node script over stdio (newline-delimited JSON-RPC) and
// forwards tool calls to the Unity Editor over TCP (ForgeBridge.cs must be
// installed at Assets/Editor/Forge/ForgeBridge.cs and the project open).
//
// CONFIGURE in ~/.forge-ide/config.json:
//   "MCP_SERVERS": [
//     { "name": "unity", "command": "node",
//       "args": ["C:/path/to/forge-unity-mcp.js"],
//       "env": { "FORGE_UNITY_PORT": "8091" } }
//   ]
// Then /mcp list shows the unity__* tools and the AI can use them.
'use strict';

const net = require('net');

const PORT = parseInt(process.env.FORGE_UNITY_PORT || '8091', 10);
const TCP_TIMEOUT_MS = 65000;

function sendTcp(obj) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let buf = '';
    const done = (err, val) => {
      try { sock.destroy(); } catch {}
      if (err) reject(err);
      else resolve(val);
    };
    const timer = setTimeout(() => done(new Error(
      'Unity Editor did not answer on 127.0.0.1:' + PORT +
      ' — open the project in the Editor with ForgeBridge.cs installed.'
    )), TCP_TIMEOUT_MS);
    sock.setTimeout(TCP_TIMEOUT_MS);
    sock.on('error', (e) => { clearTimeout(timer); done(e); });
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        clearTimeout(timer);
        const line = buf.slice(0, nl).trim();
        try { done(null, JSON.parse(line)); }
        catch (e) { done(new Error('Bad reply from Unity: ' + line.slice(0, 200))); }
      }
    });
    sock.connect(PORT, '127.0.0.1', () => {
      sock.write(JSON.stringify(obj) + '\n');
    });
  });
}

const TOOLS = [
  { name: 'unity_ping', description: 'Check the Unity Editor link. Returns Unity version and active scene.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'unity_console', description: 'Read Unity console entries (compile errors, exceptions).',
    inputSchema: { type: 'object', properties: {
      kinds: { type: 'string', description: 'all, error, or warning (default all)' },
      limit: { type: 'number', description: 'max entries (default 50)' } } } },
  { name: 'unity_play', description: 'Enter Play mode in the Editor.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'unity_stop', description: 'Exit Play mode in the Editor.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'unity_refresh', description: 'Refresh the AssetDatabase (imports new/changed scripts and assets).',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'unity_scene', description: 'Show the active scene path and root GameObjects.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'unity_create', description: 'Create a primitive GameObject in the active scene.',
    inputSchema: { type: 'object', properties: {
      shape: { type: 'string', description: 'Cube, Sphere, Capsule, Cylinder, Plane, Quad (default Cube)' },
      name: { type: 'string', description: 'GameObject name' },
      pos: { type: 'array', description: '[x, y, z] position (default [0,0,0])' } } } },
  { name: 'unity_exec', description: 'Run a static void C# method with no args (e.g. MyBuilder.BuildAll).',
    inputSchema: { type: 'object', properties: {
      method: { type: 'string', description: 'Full name, e.g. MyBuilder.BuildAll' } },
      required: ['method'] } },
];

async function callTool(name, args) {
  switch (name) {
    case 'unity_ping':    return sendTcp({ cmd: 'ping' });
    case 'unity_console': return sendTcp({ cmd: 'console', kinds: args.kinds || 'all', limit: args.limit || 50 });
    case 'unity_play':    return sendTcp({ cmd: 'play' });
    case 'unity_stop':    return sendTcp({ cmd: 'stop' });
    case 'unity_refresh': return sendTcp({ cmd: 'refresh' });
    case 'unity_scene':   return sendTcp({ cmd: 'scene' });
    case 'unity_create':  return sendTcp({ cmd: 'create', shape: args.shape || 'Cube', name: args.name || '', pos: args.pos || [0, 0, 0] });
    case 'unity_exec': {
      if (!args.method) throw new Error('method is required');
      return sendTcp({ cmd: 'exec', method: args.method });
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
        serverInfo: { name: 'forge-unity', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      reply(msg.id, { tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      const data = await callTool(name, args);
      reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(data) }] });
    } else {
      replyError(msg.id, 'Unknown method: ' + msg.method);
    }
  } catch (err) {
    replyError(msg.id, err.message || String(err));
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { handle(JSON.parse(t)); }
    catch (e) { /* ignore malformed input */ }
  }
});
process.stdin.resume();
