// src/adapter-factory.js — Factory for model adapters
'use strict';

const { ARENA_MODELS, isArenaModel, getArenaUrl } = require('./arena-models');

const SUPPORTED_MODELS = [
  'deepseek',
  'gemini',
  'arena',
  ...Object.keys(ARENA_MODELS),
];

/**
 * Get an adapter instance for the specified model.
 *
 * @param {string} modelName - Name or alias of the model
 * @param {Object} page      - Playwright page object
 * @param {Object} config    - Configuration object
 * @returns {BaseAdapter}
 */
function getAdapter(modelName, page, config) {
  const name = (modelName || 'deepseek').toLowerCase().trim();

  // Arena Direct presets (chatgpt, claude, qwen, …) share the Arena adapter
  if (isArenaModel(name)) {
    if (config) config.ARENA_URL = getArenaUrl(name);
    const ArenaAdapter = require('./adapters/arena-adapter');
    return new ArenaAdapter(page, config);
  }

  switch (name) {
    case 'deepseek':
    case 'deepseek-r1':
    case 'r1': {
      const DeepSeekAdapter = require('./adapters/deepseek-adapter');
      return new DeepSeekAdapter(page, config);
    }
    case 'gpt':
    case 'openai': {
      throw new Error(
        'Direct ChatGPT adapter is currently disabled.\n' +
        'Use ChatGPT via Arena instead:\n' +
        '  /model chatgpt\n' +
        '  forge-agent --model=chatgpt "your task"'
      );
    }
    case 'gemini':
    case 'google':
    case 'bard': {
      const GeminiAdapter = require('./adapters/gemini-adapter');
      return new GeminiAdapter(page, config);
    }
    default:
      throw new Error(
        `Unknown model: "${modelName}"\n` +
        `Supported models: ${SUPPORTED_MODELS.join(', ')}\n` +
        `Usage: forge-agent --model=gemini "your task"`
      );
  }
}

/**
 * Get the homepage URL for a model.
 */
function getModelUrl(modelName) {
  const name = (modelName || 'deepseek').toLowerCase();
  if (isArenaModel(name)) return getArenaUrl(name);
  const urls = {
    deepseek: 'https://chat.deepseek.com',
    gemini  : 'https://gemini.google.com/app',
  };
  return urls[name] || urls.deepseek;
}

/**
 * Get the human-readable display name for a model.
 */
function getModelDisplayName(modelName) {
  const name = (modelName || '').toLowerCase();
  const arenaInfo = ARENA_MODELS[name];
  if (arenaInfo) return arenaInfo.label;
  const names = {
    deepseek: 'DeepSeek',
    gemini  : 'Gemini',
    arena   : 'Arena',
  };
  return names[name] || modelName;
}

/**
 * Provider used for chat-history endpoints / adapter selection.
 * All Arena Direct presets report as 'arena'.
 */
function getProvider(modelName) {
  return isArenaModel(modelName) ? 'arena' : String(modelName || 'deepseek').toLowerCase();
}

module.exports = {
  getAdapter,
  getModelUrl,
  getModelDisplayName,
  getProvider,
  isArenaModel,
  getArenaUrl,
  ARENA_MODELS,
  SUPPORTED_MODELS
};
