'use strict';

const { color, colors, stripAnsi, getWidth } = require('./tui');

/**
 * Convert a markdown-ish string into ANSI-styled terminal lines.
 * Deliberately lightweight — covers the constructs DeepSeek commonly
 * uses in explanatory answers, not a full CommonMark parser.
 *
 * @param {string} text
 * @returns {string[]} array of pre-styled, pre-wrapped lines ready to print
 */
function renderMarkdown(text) {
  if (!text) return [];

  const width = getWidth() - 2; // account for 2-space left margin used by caller
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];

  let inCodeBlock = false;
  let codeLang = '';

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];

    // ── Fenced code blocks ──────────────────────────────────────────────
    const fenceMatch = line.match(/^```(\w*)\s*$/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = fenceMatch[1] || '';
        out.push(color('gray', `  ┌─${codeLang ? ' ' + codeLang + ' ' : ''}${'─'.repeat(Math.max(0, width - codeLang.length - 4))}`));
      } else {
        inCodeBlock = false;
        out.push(color('gray', `  └${'─'.repeat(width - 1)}`));
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(color('gray', '  │ ') + color('lyellow', line));
      continue;
    }

    // ── Headers ──────────────────────────────────────────────────────────
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const txt   = h[2];
      const styled = level === 1
        ? colors(['bold', 'lcyan'], txt.toUpperCase())
        : level === 2
          ? colors(['bold', 'cyan'], txt)
          : colors(['bold', 'white'], txt);
      out.push('');
      out.push(styled);
      if (level <= 2) out.push(color('gray', '  ' + '─'.repeat(Math.min(width - 2, stripAnsi(txt).length + 2))));
      continue;
    }

    // ── Bullet lists ─────────────────────────────────────────────────────
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1].length;
      const content = _renderInline(bullet[2]);
      out.push(' '.repeat(indent) + color('cyan', '  •') + ' ' + content);
      continue;
    }

    // ── Numbered lists ───────────────────────────────────────────────────
    const numbered = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numbered) {
      const indent = numbered[1].length;
      const num    = numbered[2];
      const content = _renderInline(numbered[3]);
      out.push(' '.repeat(indent) + color('cyan', `  ${num}.`) + ' ' + content);
      continue;
    }

    // ── Blank line ───────────────────────────────────────────────────────
    if (line.trim() === '') {
      out.push('');
      continue;
    }

    // ── Regular paragraph line — inline formatting + word wrap ─────────
    const styled = _renderInline(line);
    out.push(...(_wrap(styled, width)));
  }

  if (inCodeBlock) out.push(color('gray', `  └${'─'.repeat(width - 1)}`));

  return out;
}

/**
 * Apply inline markdown formatting: **bold**, `code`, *italic*.
 */
function _renderInline(line) {
  return line
    .replace(/\*\*(.+?)\*\*/g, (_, t) => colors(['bold', 'white'], t))
    .replace(/`([^`]+)`/g, (_, t) => color('lyellow', t))
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, t) => color('italic', t));
}

/**
 * Word-wrap a (possibly ANSI-colored) line to fit terminal width,
 * measuring visible length only via stripAnsi.
 */
function _wrap(line, width) {
  if (stripAnsi(line).length <= width) return [line];

  const words = line.split(' ');
  const result = [];
  let cur = '';
  let curVisible = 0;

  for (const w of words) {
    const wVisible = stripAnsi(w).length;
    if (curVisible + wVisible + 1 > width && cur) {
      result.push(cur);
      cur = w;
      curVisible = wVisible;
    } else {
      cur = cur ? cur + ' ' + w : w;
      curVisible += wVisible + (curVisible ? 1 : 0);
    }
  }
  if (cur) result.push(cur);
  return result;
}

module.exports = { renderMarkdown };
