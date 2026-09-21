// src/permission-menu.js — Permission menus for CLI and IDE modes
'use strict';

const OPTIONS = [
  { key: 'once',    label: 'Allow Once' },
  { key: 'session', label: 'Allow for this Session' },
  { key: 'saved',   label: 'Allow for this Project (always)' },
  { key: 'deny',    label: 'Deny' },
  { key: 'stop',    label: 'Deny and Stop Task' },
];

// ── IDE Mode Support ────────────────────────────────────────────────────────
// When the IDE server is running, permission prompts are sent to the browser
// via SSE and the response comes back through an HTTP POST.

let _idePermissionCallback = null;

function setIDEPermissionCallback(callback) {
  _idePermissionCallback = callback;
}

function getIDEPermissionCallback() {
  return _idePermissionCallback;
}

/**
 * Show an arrow-key navigable permission menu.
 * Returns one of: 'once' | 'session' | 'saved' | 'deny' | 'stop'
 *
 * Falls back to auto-approving 'once' after 60s of no input, or
 * immediately if stdin is not a TTY (non-interactive / headless / CI) —
 * this NEVER hangs the process.
 */
async function showPermissionMenu({ label, detail }) {
  // IDE Mode: send permission request to browser UI and wait for response
  if (_idePermissionCallback) {
    return _idePermissionCallback({ label, detail, options: OPTIONS });
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // Non-interactive context — never block. Safe default: allow once.
    return 'once';
  }

  return new Promise((resolve) => {
    let selected = 0;
    let resolved = false;

    const render = (firstRender) => {
      if (!firstRender) {
        // Move cursor up to overwrite the previous render
        process.stdout.write(`\x1b[${OPTIONS.length + 4}A`);
      } else {
        process.stdout.write('\n');
      }
      process.stdout.write('\r\x1b[K\n');
      process.stdout.write(`\r\x1b[K  \x1b[33m🔒  Permission requested: ${label}\x1b[0m\n`);
      if (detail) {
        process.stdout.write(`\r\x1b[K  \x1b[90m   ${detail}\x1b[0m\n`);
      } else {
        process.stdout.write('\r\x1b[K\n');
      }
      OPTIONS.forEach((opt, i) => {
        const isSel = i === selected;
        const arrow = isSel ? '\x1b[36m❯\x1b[0m' : ' ';
        const text  = isSel ? `\x1b[1m\x1b[36m${opt.label}\x1b[0m` : `\x1b[90m${opt.label}\x1b[0m`;
        process.stdout.write(`\r\x1b[K  ${arrow} ${text}\n`);
      });
      process.stdout.write('\r\x1b[K  \x1b[90m↑↓ to navigate · Enter to confirm\x1b[0m\n');
    };

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup();
      process.stdout.write('\n');
      resolve(result);
    };

    const timer = setTimeout(() => finish('once'), 60_000);

    const onData = (chunk) => {
      const s = chunk.toString();

      if (s === '\u0003') { // Ctrl+C
        finish('stop');
        process.exit(130);
        return;
      }

      if (s === '\r' || s === '\n') {
        finish(OPTIONS[selected].key);
        return;
      }

      if (s === '\x1b[A') { // Up arrow
        selected = (selected - 1 + OPTIONS.length) % OPTIONS.length;
        render(false);
        return;
      }

      if (s === '\x1b[B') { // Down arrow
        selected = (selected + 1) % OPTIONS.length;
        render(false);
        return;
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);

    render(true);
  });
}

/**
 * Simple yes/no plan-level approval — also arrow-key based for consistency.
 * Returns 'approve' | 'reject'
 */
async function showApprovalMenu({ title, bodyLines = [] }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'approve';
  }

  const OPTS = [{ key: 'approve', label: 'Approve and Continue' }, { key: 'reject', label: 'Cancel' }];

  return new Promise((resolve) => {
    let selected = 0;
    let resolved = false;

    const render = (firstRender) => {
      if (!firstRender) {
        process.stdout.write(`\x1b[${bodyLines.length + OPTS.length + 4}A`);
      } else {
        process.stdout.write('\n');
      }
      process.stdout.write('\r\x1b[K\n');
      process.stdout.write(`\r\x1b[K  \x1b[36m📋  ${title}\x1b[0m\n`);
      bodyLines.forEach(line => process.stdout.write(`\r\x1b[K  ${line}\n`));
      OPTS.forEach((opt, i) => {
        const isSel = i === selected;
        const arrow = isSel ? '\x1b[36m❯\x1b[0m' : ' ';
        const text  = isSel ? `\x1b[1m\x1b[36m${opt.label}\x1b[0m` : `\x1b[90m${opt.label}\x1b[0m`;
        process.stdout.write(`\r\x1b[K  ${arrow} ${text}\n`);
      });
    };

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup();
      process.stdout.write('\n');
      resolve(result);
    };

    const timer = setTimeout(() => finish('approve'), 30_000);

    const onData = (chunk) => {
      const s = chunk.toString();
      if (s === '\u0003') { finish('reject'); process.exit(130); return; }
      if (s === '\r' || s === '\n') { finish(OPTS[selected].key); return; }
      if (s === '\x1b[A' || s === '\x1b[B') {
        selected = selected === 0 ? 1 : 0;
        render(false);
        return;
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);

    render(true);
  });
}

module.exports = { showPermissionMenu, showApprovalMenu, setIDEPermissionCallback, getIDEPermissionCallback };
