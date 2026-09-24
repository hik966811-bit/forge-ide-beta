// src/arena-models.js — Preset Arena Direct-mode model URLs
'use strict';

const ARENA_BASE = 'https://arena.ai/text/direct?model_a=';

/**
 * Selectable models that run through arena.ai Direct mode.
 * Key = value stored in config.MODEL / shown in /model and Settings.
 */
const ARENA_MODELS = {
  chatgpt: {
    label : 'ChatGPT (Arena)',
    modelId: 'gpt-5.5-instant',
    url   : `${ARENA_BASE}gpt-5.5-instant`,
  },
  claude: {
    label : 'Claude (Arena)',
    modelId: 'claude-sonnet-5-high',
    url   : `${ARENA_BASE}claude-sonnet-5-high`,
  },
  qwen: {
    label : 'Qwen (Arena)',
    modelId: 'qwen3.7-plus',
    url   : `${ARENA_BASE}qwen3.7-plus`,
  },
  minimax: {
    label : 'MiniMax (Arena)',
    modelId: 'minimax-m3',
    url   : `${ARENA_BASE}minimax-m3`,
  },
  glm: {
    label : 'GLM (Arena)',
    modelId: 'glm-5v-turbo',
    url   : `${ARENA_BASE}glm-5v-turbo`,
  },
  grok: {
    label : 'Grok (Arena)',
    modelId: 'grok-4.6-high',
    url   : `${ARENA_BASE}grok-4.6-high`,
  },
};

function isArenaModel(name) {
  const n = String(name || '').toLowerCase().trim();
  return n === 'arena' || n === 'arena.ai' || Object.prototype.hasOwnProperty.call(ARENA_MODELS, n);
}

function getArenaModelInfo(name) {
  return ARENA_MODELS[String(name || '').toLowerCase().trim()] || null;
}

function getArenaUrl(name) {
  const info = getArenaModelInfo(name);
  return info ? info.url : 'https://arena.ai';
}

/**
 * Rewrite a saved Arena chat URL (/c/…) so it opens with the given model
 * in Direct mode. Generic arena home URLs are returned unchanged.
 */
function withArenaModel(chatUrl, modelName) {
  try {
    const info = getArenaModelInfo(modelName);
    if (!info) return chatUrl;
    const target = new URL(chatUrl, 'https://arena.ai');
    target.searchParams.set('model_a', info.modelId);
    if (!target.searchParams.has('mode')) target.searchParams.set('mode', 'direct');
    return target.toString();
  } catch {
    return chatUrl;
  }
}

module.exports = {
  ARENA_MODELS,
  isArenaModel,
  getArenaModelInfo,
  getArenaUrl,
  withArenaModel,
};
