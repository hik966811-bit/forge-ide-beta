// src/roblox.js — Roblox project detection, Rojo/Lune/Remodel helpers, Luau templates
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BRIDGE_PORT = 8092; // Forge Roblox bridge (Studio plugin <-> MCP server)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const ROJO_PROJECT_FILES = ['default.project.json', 'rojo.json'];

function isRojoProjectRoot(dir) {
  try {
    const abs = path.resolve(dir);
    return ROJO_PROJECT_FILES.some(f => {
      try { return fs.statSync(path.join(abs, f)).isFile(); } catch { return false; }
    });
  } catch {
    return false;
  }
}

/**
 * Walk up from startDir looking for a Roblox/Rojo project.
 * Returns { root, kind } where kind is 'rojo' (has rojo project file) or
 * 'studio' (folder holds .rbxl/.rbxlx place files), or null.
 */
function detectRobloxProject(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 12; i++) {
    if (isRojoProjectRoot(dir)) return { root: dir, kind: 'rojo' };
    try {
      const entries = fs.readdirSync(dir);
      if (entries.some(e => /\.rbxlx?$/i.test(e))) return { root: dir, kind: 'studio' };
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function whichBin(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    try {
      if (path.isAbsolute(c) && fs.existsSync(c)) return c;
    } catch {}
  }
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(cmd, [candidates[candidates.length - 1]], {
      encoding: 'utf8', timeout: 10000, shell: process.platform === 'win32',
    });
    const first = String(r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {}
  return null;
}

/**
 * Locate Rojo / Lune / Remodel binaries (env override, then PATH).
 * Returns { rojo, lune, remodel } with null for anything missing.
 */
function findRobloxTools() {
  return {
    rojo: whichBin([process.env.ROJO_PATH, 'rojo']),
    lune: whichBin([process.env.LUNE_PATH, 'lune']),
    remodel: whichBin([process.env.REMODEL_PATH, 'remodel']),
  };
}

/**
 * Find Roblox Studio installs (for hints only — Studio has no CLI).
 * Returns [{ version, path }].
 */
function findRobloxStudio() {
  const found = [];
  try {
    if (process.platform === 'win32') {
      const versions = path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions');
      if (fs.existsSync(versions)) {
        for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const exe = path.join(versions, entry.name, 'RobloxStudioBeta.exe');
          if (fs.existsSync(exe)) found.push({ version: entry.name, path: exe });
        }
      }
    } else if (process.platform === 'darwin') {
      const app = '/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio';
      if (fs.existsSync(app)) found.push({ version: 'studio', path: app });
    }
  } catch {}
  return found;
}

function studioPluginsDir() {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Plugins');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Documents', 'Roblox', 'Plugins');
  }
  return path.join(os.homedir(), '.roblox', 'Plugins');
}

/**
 * Scaffold a minimal Rojo project (default.project.json + src tree).
 */
function scaffoldRojoProject(root, name) {
  const projectFile = path.join(root, 'default.project.json');
  const project = {
    name: name || path.basename(root),
    servePort: 34872,
    tree: {
      $className: 'DataModel',
      ReplicatedStorage: {
        $className: 'ReplicatedStorage',
        Shared: { $path: 'src/shared' },
      },
      ServerScriptService: {
        $className: 'ServerScriptService',
        Server: { $path: 'src/server' },
      },
      StarterPlayer: {
        $className: 'StarterPlayer',
        StarterPlayerScripts: {
          $className: 'StarterPlayerScripts',
          Client: { $path: 'src/client' },
        },
      },
    },
  };
  fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'client'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n');
  return projectFile;
}

function runBin(binPath, args, timeoutMs) {
  const r = spawnSync(binPath, args, {
    encoding: 'utf8', timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
    windowsHide: true, maxBuffer: 10 * 1024 * 1024,
  });
  const out = (String(r.stdout || '') + String(r.stderr || '')).slice(-6000);
  return { code: r.status, signal: r.signal || null, timedOut: r.signal === 'SIGTERM' && r.status === null, output: out };
}

const LUAU_TEMPLATES = {
  serverscript: ({ name }) => [
    `-- ${name} (Server Script) — generated with Forge IDE`,
    `-- Place under ServerScriptService (via Rojo: src/server/).`,
    '',
    'local Players = game:GetService("Players")',
    '',
    `print("[${name}] server started")`,
    '',
    'Players.PlayerAdded:Connect(function(player)',
    '\tprint("[Forge] welcomed", player.Name)',
    'end)',
    '',
  ].join('\n'),
  localscript: ({ name }) => [
    `-- ${name} (LocalScript) — generated with Forge IDE`,
    `-- Place under StarterPlayerScripts (via Rojo: src/client/).`,
    '',
    'local Players = game:GetService("Players")',
    'local player = Players.LocalPlayer',
    '',
    `print("[${name}] client started for", player.Name)`,
    '',
  ].join('\n'),
  module: ({ name }) => [
    `-- ${name} (ModuleScript) — generated with Forge IDE`,
    `-- Place under ReplicatedStorage (via Rojo: src/shared/).`,
    '',
    `local ${name} = {}`,
    '',
    `function ${name}.hello(who)`,
    '\treturn ("Hello, %s!"):format(tostring(who or "world"))',
    'end',
    '',
    `return ${name}`,
    '',
  ].join('\n'),
  test: ({ name }) => [
    `-- ${name} — Lune test, run with: lune run ${name}.luau`,
    '-- Plain asserts: a failed assert stops the run with an error.',
    '',
    'local function check(cond, msg)',
    '\tif not cond then error("FAIL: " .. (msg or "assertion"), 2) end',
    '\tprint("ok - " .. (msg or "assertion"))',
    'end',
    '',
    'check(1 + 1 == 2, "sanity")',
    '',
    '-- TODO: require your ModuleScript logic here and test it.',
    'print("all tests passed")',
    '',
  ].join('\n'),
};

function newLuauContent(kind, name) {
  const clean = String(name || 'ForgeScript').replace(/[^A-Za-z0-9_]/g, '') || 'ForgeScript';
  const safe = /^[A-Za-z_]/.test(clean) ? clean : `Forge${clean}`;
  const tpl = LUAU_TEMPLATES[kind] || LUAU_TEMPLATES.serverscript;
  const ext = '.luau';
  return { name: safe, fileName: safe + ext, content: tpl({ name: safe }) };
}

module.exports = {
  BRIDGE_PORT,
  detectRobloxProject,
  isRojoProjectRoot,
  findRobloxTools,
  findRobloxStudio,
  studioPluginsDir,
  scaffoldRojoProject,
  runBin,
  newLuauContent,
};
