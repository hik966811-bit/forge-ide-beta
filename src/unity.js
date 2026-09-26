// src/unity.js — Unity project detection, Editor discovery, batch-mode runner
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BRIDGE_PORT = 8091;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // Unity builds are slow

function isUnityProjectRoot(dir) {
  try {
    const abs = path.resolve(dir);
    return fs.statSync(path.join(abs, 'Assets')).isDirectory() &&
           fs.existsSync(path.join(abs, 'ProjectSettings', 'ProjectVersion.txt'));
  } catch {
    return false;
  }
}

/**
 * Walk up from startDir looking for a Unity project root.
 * Returns { root, version } or null.
 */
function detectUnityProject(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 12; i++) {
    if (isUnityProjectRoot(dir)) {
      let version = 'unknown';
      try {
        const raw = fs.readFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
        const m = /m_EditorVersion:\s*(\S+)/.exec(raw);
        if (m) version = m[1];
      } catch {}
      return { root: dir, version };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Find installed Unity Editors. Checks UNITY_PATH, Unity Hub layout,
 * classic install path, and PATH. Returns [{ version, path }].
 */
function findUnityEditors() {
  const found = [];
  const seen = new Set();
  const add = (exePath) => {
    try {
      if (!exePath || seen.has(exePath)) return;
      if (fs.existsSync(exePath) && fs.statSync(exePath).isFile()) {
        seen.add(exePath);
        let version = 'unknown';
        const m = /(\d+\.\d+\.\d+[a-z]?\d*)/i.exec(exePath);
        if (m) version = m[1];
        found.push({ version, path: exePath });
      }
    } catch {}
  };

  if (process.env.UNITY_PATH) add(process.env.UNITY_PATH);
  if (process.platform === 'win32') {
    add('C:\\Program Files\\Unity\\Editor\\Unity.exe');
    try {
      const hub = 'C:\\Program Files\\Unity\\Hub\\Editor';
      if (fs.existsSync(hub)) {
        for (const entry of fs.readdirSync(hub, { withFileTypes: true })) {
          if (entry.isDirectory()) add(path.join(hub, entry.name, 'Editor', 'Unity.exe'));
        }
      }
    } catch {}
  } else if (process.platform === 'darwin') {
    add('/Applications/Unity/Hub/Editor');
    try {
      const hub = '/Applications/Unity/Hub/Editor';
      if (fs.existsSync(hub)) {
        for (const entry of fs.readdirSync(hub, { withFileTypes: true })) {
          if (entry.isDirectory()) add(path.join(hub, entry.name, 'Unity.app', 'Contents', 'MacOS', 'Unity'));
        }
      }
    } catch {}
    add('/Applications/Unity/Unity.app/Contents/MacOS/Unity');
  } else {
    add('/opt/Unity/Editor/Unity');
    try {
      const hub = `${os.homedir()}/Unity/Hub/Editor`;
      if (fs.existsSync(hub)) {
        for (const entry of fs.readdirSync(hub, { withFileTypes: true })) {
          if (entry.isDirectory()) add(path.join(hub, entry.name, 'Editor', 'Unity'));
        }
      }
    } catch {}
  }

  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const r = spawnSync(which, ['Unity'], { encoding: 'utf8', timeout: 10000, shell: process.platform === 'win32' });
    const out = String(r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const line of out) add(line);
  } catch {}

  return found;
}

function pickEditor(preferred) {
  const editors = findUnityEditors();
  if (editors.length === 0) {
    throw new Error(
      'No Unity Editor found. Install Unity Hub + an Editor, or set UNITY_PATH ' +
      'to Unity.exe (e.g. "C:\\Program Files\\Unity\\Hub\\Editor\\6000.0.0f1\\Editor\\Unity.exe").'
    );
  }
  if (preferred) {
    const hit = editors.find(e => e.version === preferred || e.path === preferred);
    if (hit) return hit;
  }
  return editors[0];
}

function editorLogPath() {
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Local', 'Unity', 'Editor', 'Editor.log');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Logs', 'Unity', 'Editor.log');
  return path.join(os.homedir(), '.config', 'unity3d', 'Editor.log');
}

/**
 * Last N lines of the Unity Editor log, with error lines highlighted first.
 */
function tailEditorLog(maxLines = 120) {
  const logFile = editorLogPath();
  if (!fs.existsSync(logFile)) {
    return { logFile, lines: [], note: 'Editor.log not found — Unity may never have run on this machine.' };
  }
  const content = fs.readFileSync(logFile, 'utf8').split(/\r?\n/);
  const tail = content.slice(-Math.max(1, maxLines));
  const errors = tail.filter(l => /error|exception|failed|NullReference/i.test(l)).slice(-30);
  return { logFile, lines: tail, errorLines: errors };
}

/**
 * Run Unity headless. Returns { code, signal, logFile, logTail, logPath }.
 * Unity writes its own log to -logFile; we return the tail for the agent.
 */
function runUnityBatch({ editorPath, projectPath, cliArgs = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!fs.existsSync(editorPath)) throw new Error(`Unity Editor not found: ${editorPath}`);
  if (!isUnityProjectRoot(projectPath)) {
    throw new Error(`Not a Unity project root (need Assets/ + ProjectSettings/): ${projectPath}`);
  }
  const logDir = path.join(os.homedir(), '.forge-ide', 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
  const logPath = path.join(logDir, `unity-${Date.now().toString(36)}.log`);

  const args = [
    '-batchmode', '-nographics',
    '-projectPath', path.resolve(projectPath),
    '-logFile', logPath,
    ...cliArgs,
  ];
  const r = spawnSync(editorPath, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });

  let logTail = '';
  try {
    const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
    const errs = lines.filter(l => /error|exception|failed|NullReference/i.test(l)).slice(-25);
    logTail = [...(errs.length ? ['--- errors ---', ...errs, '--- last lines ---'] : []), ...lines.slice(-25)].join('\n');
  } catch {
    logTail = String(r.stdout || '') + String(r.stderr || '');
  }

  return {
    code: r.status,
    signal: r.signal || null,
    timedOut: r.signal === 'SIGTERM' && r.status === null,
    logFile: logPath,
    logTail: logTail.slice(-6000),
  };
}

const SCRIPT_TEMPLATES = {
  behaviour: ({ className }) => [
    'using UnityEngine;',
    '',
    `public class ${className} : MonoBehaviour`,
    '{',
    '    void Start()',
    '    {',
    '    }',
    '',
    '    void Update()',
    '    {',
    '    }',
    '}',
    '',
  ].join('\n'),
  editor: ({ className }) => [
    'using UnityEditor;',
    'using UnityEngine;',
    '',
    `public class ${className} : EditorWindow`,
    '{',
    `    [MenuItem("Forge/${className}")]`,
    '    public static void ShowWindow()',
    '    {',
    `        GetWindow<${className}>("${className}");`,
    '    }',
    '',
    '    void OnGUI()',
    '    {',
    '        GUILayout.Label("Built with Forge IDE", EditorStyles.boldLabel);',
    '    }',
    '}',
    '',
  ].join('\n'),
  mesh: ({ className }) => [
    'using UnityEngine;',
    '',
    '// Procedural mesh generated with Forge IDE — attach to an empty GameObject.',
    `[RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]`,
    `public class ${className} : MonoBehaviour`,
    '{',
    '    public float size = 1f;',
    '    public int segments = 24;',
    '',
    '    void Start()',
    '    {',
    '        GetComponent<MeshFilter>().mesh = BuildMesh();',
    '    }',
    '',
    '    Mesh BuildMesh()',
    '    {',
    '        var mesh = new Mesh { name = "' + className + '" };',
    '        var verts = new System.Collections.Generic.List<Vector3>();',
    '        var tris = new System.Collections.Generic.List<int>();',
    '        verts.Add(Vector3.zero);',
    '        for (int i = 0; i <= segments; i++)',
    '        {',
    '            float a = i / (float)segments * Mathf.PI * 2f;',
    '            verts.Add(new Vector3(Mathf.Cos(a) * size, 0f, Mathf.Sin(a) * size));',
    '            if (i > 0) { tris.Add(0); tris.Add(i); tris.Add(i + 1 > segments ? 1 : i + 1); }',
    '        }',
    '        mesh.SetVertices(verts);',
    '        mesh.SetTriangles(tris, 0);',
    '        mesh.RecalculateNormals();',
    '        return mesh;',
    '    }',
    '}',
    '',
  ].join('\n'),
};

function newScriptContent(kind, className) {
  const clean = String(className || 'ForgeScript').replace(/[^A-Za-z0-9_]/g, '') || 'ForgeScript';
  const name = /^[A-Za-z_]/.test(clean) ? clean : `Forge${clean}`;
  const tpl = SCRIPT_TEMPLATES[kind] || SCRIPT_TEMPLATES.behaviour;
  return { className: name, content: tpl({ className: name }) };
}

module.exports = {
  BRIDGE_PORT,
  detectUnityProject,
  isUnityProjectRoot,
  findUnityEditors,
  pickEditor,
  editorLogPath,
  tailEditorLog,
  runUnityBatch,
  newScriptContent,
};
