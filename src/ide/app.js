// src/ide/app.js — Frontend controller for Forge Agent IDE
'use strict';

// ── State ───────────────────────────────────────────────────────────────────
const state = {
  currentDir: '',
  workspaceName: '',
  activeFilePath: null,
  openTabs: [], // Array of { path, name, content, originalContent, isDirty, extension }
  browseCurrentDir: '',
  browseSelectedDir: '',
  eventSource: null,
  agentRunning: false,
  activeChatId: null,
};

// ── DOM References ──────────────────────────────────────────────────────────
const dom = {
  appWindow: document.getElementById('appWindow'),
  workspaceRootName: document.getElementById('workspaceRootName'),
  fileTreeContainer: document.getElementById('fileTreeContainer'),
  tabsBar: document.getElementById('tabsBar'),
  editorContainer: document.getElementById('editorContainer'),
  editorEmpty: document.getElementById('editorEmpty'),
  editorGutter: document.getElementById('editorGutter'),
  editorHighlight: document.getElementById('editorHighlight'),
  editorCodeDisplay: document.getElementById('editorCodeDisplay'),
  editorTextarea: document.getElementById('editorTextarea'),
  statusFilePath: document.getElementById('statusFilePath'),
  statusCursor: document.getElementById('statusCursor'),
  statusLanguage: document.getElementById('statusLanguage'),
  statusEol: document.getElementById('statusEol'),
  btnSaveFile: document.getElementById('btnSaveFile'),
  btnRefreshTree: document.getElementById('btnRefreshTree'),
  btnOpenFolder: document.getElementById('btnOpenFolder'),
  btnNewFile: document.getElementById('btnNewFile'),
  btnNewFolder: document.getElementById('btnNewFolder'),
  btnCollapseSidebar: document.getElementById('btnCollapseSidebar'),
  sidebarLeft: document.getElementById('sidebarLeft'),
  sidebarRight: document.getElementById('sidebarRight'),
  btnToggleRightSidebar: document.getElementById('btnToggleRightSidebar'),
  btnFloatingAgent: document.getElementById('btnFloatingAgent'),
  agentWorkingDirPath: document.getElementById('agentFolderPath'),
  btnAgentChangeFolder: document.getElementById('btnAgentChangeFolder'),
  agentModelBadge: document.getElementById('agentModelBadge'),
  agentPromptInput: document.getElementById('agentPromptInput'),
  btnSendTask: document.getElementById('btnSendTask'),
  btnStopAgent: document.getElementById('btnStopAgent'),
  btnNewChat: document.getElementById('btnNewChat'),
  chatMessages: document.getElementById('chatMessages'),
  agentLiveActivity: document.getElementById('agentLiveActivity'),
  activityTitle: document.getElementById('activityTitle'),
  activityDetails: document.getElementById('activityDetails'),
  tabBtnChat: document.getElementById('tabBtnChat'),
  tabBtnTerminal: document.getElementById('tabBtnTerminal'),
  agentChatView: document.getElementById('agentChatView'),
  agentTerminalView: document.getElementById('agentTerminalView'),
  terminalOutput: document.getElementById('terminalOutput'),
  terminalInput: document.getElementById('terminalInput'),
  terminalWorkingDir: document.getElementById('terminalWorkingDir'),
  btnRunTerminalCmd: document.getElementById('btnRunTerminalCmd'),
  btnToggleTerminal: document.getElementById('btnToggleTerminal'),
  folderPickerModal: document.getElementById('folderPickerModal'),
  btnCloseFolderPicker: document.getElementById('btnCloseFolderPicker'),
  btnCancelFolderPicker: document.getElementById('btnCancelFolderPicker'),
  btnConfirmSelectFolder: document.getElementById('btnConfirmSelectFolder'),
  inputManualFolderPath: document.getElementById('inputManualFolderPath'),
  btnNavToInputPath: document.getElementById('btnNavToInputPath'),
  folderNavBreadcrumbs: document.getElementById('folderNavBreadcrumbs'),
  folderBrowserList: document.getElementById('folderBrowserList'),
  spotlightModal: document.getElementById('spotlightModal'),
  spotlightTrigger: document.getElementById('spotlightTrigger'),
  spotlightInput: document.getElementById('spotlightInput'),
  spotlightResults: document.getElementById('spotlightResults'),
  treeContextMenu: document.getElementById('treeContextMenu'),
  ctxNewFile: document.getElementById('ctxNewFile'),
  ctxNewFolder: document.getElementById('ctxNewFolder'),
  ctxRename: document.getElementById('ctxRename'),
  ctxDelete: document.getElementById('ctxDelete'),
  titlebarStatusBadge: document.getElementById('titlebarStatusBadge'),
  statusPulseDot: document.getElementById('statusPulseDot'),
  titlebarStatusText: document.getElementById('titlebarStatusText'),
  agentThinkingCard: document.getElementById('agentThinkingCard'),
  thinkingHeader: document.getElementById('thinkingHeader'),
  thinkingTitle: document.getElementById('thinkingTitle'),
  thinkingBody: document.getElementById('thinkingBody'),
  thinkingSpinner: document.getElementById('thinkingSpinner'),
  thinkingToggleIcon: document.getElementById('thinkingToggleIcon'),
  thinkingReadCount: document.getElementById('thinkingReadCount'),
  thinkingSearchCount: document.getElementById('thinkingSearchCount'),
  toastContainer: document.getElementById('toastContainer'),
  permissionModal: document.getElementById('permissionModal'),
  permissionCard: document.getElementById('permissionCard'),
  permLabel: document.getElementById('permLabel'),
  permDetail: document.getElementById('permDetail'),
  permOptionsList: document.getElementById('permOptionsList'),
};

let contextTargetNode = null;

// ── SVG Icon Templates (ZERO EMOJIS) ────────────────────────────────────────
const ICONS = {
  folder: '<svg class="svg-icon tree-icon tree-icon-folder" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  folderOpen: '<svg class="svg-icon tree-icon tree-icon-folder" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>',
  chevron: '<svg class="svg-icon tree-chevron" viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>',
  js: '<svg class="svg-icon tree-icon tree-icon-js" viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="3" fill="#ffd166"/><path fill="#151624" d="M8 17v-4h2v4a2 2 0 01-2 2H6v-2h2zm6 1.8c-1.8 0-3-1-3-2.6h2c0 .8.6 1.1 1.2 1.1.7 0 1.1-.4 1.1-.9 0-.6-.5-.8-1.5-1.1-1.6-.4-2.5-1.1-2.5-2.3 0-1.5 1.2-2.5 2.8-2.5 1.5 0 2.6.8 2.8 2.2h-2c-.1-.6-.4-.9-.9-.9s-.8.3-.8.7c0 .5.4.7 1.3 1 1.7.4 2.7 1.1 2.7 2.4 0 1.6-1.3 2.9-3.2 2.9z"/></svg>',
  html: '<svg class="svg-icon tree-icon tree-icon-html" viewBox="0 0 24 24" width="14" height="14"><path fill="#ff7043" d="M4 2h16l-1.5 16.5L12 22l-6.5-3.5L4 2zm13.2 5.5H6.8l.3 3.5h9.8l-.5 5.5-4.4 1.2-4.4-1.2-.3-2.8H5.2l.4 4.5 6.4 1.8 6.4-1.8.8-10.7z"/></svg>',
  css: '<svg class="svg-icon tree-icon tree-icon-css" viewBox="0 0 24 24" width="14" height="14"><path fill="#29b6f6" d="M4 2h16l-1.5 16.5L12 22l-6.5-3.5L4 2zm13.2 5.5H6.8l.3 3.5h9.8l-.5 5.5-4.4 1.2-4.4-1.2-.3-2.8H5.2l.4 4.5 6.4 1.8 6.4-1.8.8-10.7z"/></svg>',
  json: '<svg class="svg-icon tree-icon tree-icon-json" viewBox="0 0 24 24" width="14" height="14"><path fill="#ffa726" d="M5 3h2v2H5v5a2 2 0 01-2 2 2 2 0 012 2v5h2v2H5a2 2 0 01-2-2v-4a2 2 0 00-2-2 2 2 0 002-2V5a2 2 0 012-2zm14 0a2 2 0 012 2v4a2 2 0 002 2 2 2 0 00-2 2v4a2 2 0 01-2 2h-2v-2h2v-5a2 2 0 012-2 2 2 0 01-2-2V5h-2V3h2z"/></svg>',
  doc: '<svg class="svg-icon tree-icon tree-icon-doc" viewBox="0 0 24 24" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
  tool: '<svg class="svg-icon" viewBox="0 0 24 24" width="13" height="13"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
};

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx'].includes(ext)) return ICONS.js;
  if (['html', 'htm'].includes(ext)) return ICONS.html;
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return ICONS.css;
  if (['json'].includes(ext)) return ICONS.json;
  return ICONS.doc;
}

// ── Notifications ───────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

// ── Workspace & File Tree ───────────────────────────────────────────────────
async function loadWorkspace() {
  try {
    // Try server-side persistence first
    let savedDir = null;
    try {
      const persistRes = await fetch('/api/persist');
      if (persistRes.ok) {
        const persistData = await persistRes.json();
        if (persistData.workspace) savedDir = persistData.workspace;
      }
    } catch (e) {}

    // Fallback to localStorage
    if (!savedDir) savedDir = localStorage.getItem('forge-workspace');

    if (savedDir) {
      const postRes = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: savedDir }),
      });
      if (postRes.ok) {
        const data = await postRes.json();
        state.currentDir = data.dir;
        state.workspaceName = data.name;
        dom.workspaceRootName.textContent = data.name;
        dom.agentWorkingDirPath.textContent = data.dir;
        dom.terminalWorkingDir.textContent = data.dir;
        if (data.model) dom.agentModelBadge.textContent = data.model;
        renderFileTree(data.tree);
        return;
      }
      localStorage.removeItem('forge-workspace');
    }

    const res = await fetch('/api/workspace');
    if (!res.ok) throw new Error('Failed to load workspace');
    const data = await res.json();
    state.currentDir = data.dir;
    state.workspaceName = data.name;

    dom.workspaceRootName.textContent = data.name;
    dom.agentWorkingDirPath.textContent = data.dir;
    dom.terminalWorkingDir.textContent = data.dir;
    if (data.model) dom.agentModelBadge.textContent = data.model;

    renderFileTree(data.tree);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderFileTree(treeNode) {
  dom.fileTreeContainer.innerHTML = '';
  if (!treeNode || !treeNode.children || treeNode.children.length === 0) {
    dom.fileTreeContainer.innerHTML = '<div class="tree-loading">Empty folder</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const child of treeNode.children) {
    fragment.appendChild(createTreeNodeElement(child, 0));
  }
  dom.fileTreeContainer.appendChild(fragment);
}

function createTreeNodeElement(node, depth = 0) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-item-wrapper';

  const row = document.createElement('div');
  row.className = 'tree-node';
  row.style.paddingLeft = `${12 + depth * 14}px`;
  row.dataset.path = node.path;
  row.dataset.isDir = node.isDirectory ? 'true' : 'false';

  if (node.isDirectory) {
    row.innerHTML = `
      <span class="tree-chevron">${ICONS.chevron}</span>
      ${ICONS.folder}
      <span class="tree-label">${escapeHtml(node.name)}</span>
    `;

    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        childrenContainer.appendChild(createTreeNodeElement(child, depth + 1));
      }
    }

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = row.classList.toggle('is-expanded');
      const folderIcon = row.querySelector('.tree-icon-folder');
      if (folderIcon) {
        folderIcon.outerHTML = isExpanded ? ICONS.folderOpen : ICONS.folder;
      }
    });

    wrapper.appendChild(row);
    wrapper.appendChild(childrenContainer);
  } else {
    row.innerHTML = `
      <span class="tree-chevron" style="visibility: hidden;">${ICONS.chevron}</span>
      ${getFileIcon(node.name)}
      <span class="tree-label">${escapeHtml(node.name)}</span>
    `;

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      openFile(node.path);
    });

    wrapper.appendChild(row);
  }

  // Right click context menu
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextTargetNode = { path: node.path, isDir: node.isDirectory };
    showContextMenu(e.clientX, e.clientY);
  });

  return wrapper;
}

// ── File Tabs & Editor ──────────────────────────────────────────────────────
async function openFile(filePath) {
  // Highlight in file tree
  document.querySelectorAll('.tree-node').forEach(el => {
    el.classList.toggle('is-active', el.dataset.path === filePath);
  });

  // Check if tab already open
  let tab = state.openTabs.find(t => t.path === filePath);
  if (!tab) {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to read file');
      }
      const data = await res.json();
      tab = {
        path: filePath,
        name: data.name,
        content: data.content,
        originalContent: data.content,
        isDirty: false,
        extension: data.extension,
      };
      state.openTabs.push(tab);
    } catch (err) {
      showToast(err.message, 'error');
      return;
    }
  }

  state.activeFilePath = filePath;
  renderTabs();
  displayActiveFile();
}

function renderTabs() {
  dom.tabsBar.innerHTML = '';
  for (const tab of state.openTabs) {
    const tabEl = document.createElement('div');
    tabEl.className = `editor-tab ${tab.path === state.activeFilePath ? 'is-active' : ''}`;
    tabEl.innerHTML = `
      ${getFileIcon(tab.name)}
      <span class="tab-title">${escapeHtml(tab.name)}</span>
      ${tab.isDirty ? '<span class="tab-dirty-indicator"></span>' : ''}
      <button class="tab-close-btn" title="Close">
        <svg class="svg-icon" viewBox="0 0 24 24" width="11" height="11">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;

    tabEl.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close-btn')) {
        closeTab(tab.path);
      } else {
        state.activeFilePath = tab.path;
        renderTabs();
        displayActiveFile();
      }
    });

    dom.tabsBar.appendChild(tabEl);
  }
}

function closeTab(filePath) {
  const index = state.openTabs.findIndex(t => t.path === filePath);
  if (index === -1) return;

  state.openTabs.splice(index, 1);
  if (state.activeFilePath === filePath) {
    state.activeFilePath = state.openTabs.length > 0 ? state.openTabs[Math.max(0, index - 1)].path : null;
  }
  renderTabs();
  displayActiveFile();
}

function displayActiveFile() {
  const tab = state.openTabs.find(t => t.path === state.activeFilePath);
  if (!tab) {
    dom.editorContainer.style.display = 'none';
    dom.editorEmpty.style.display = 'flex';
    dom.statusFilePath.textContent = 'no file open';
    dom.statusLanguage.textContent = 'Plain Text';
    return;
  }

  dom.editorContainer.style.display = 'flex';
  dom.editorEmpty.style.display = 'none';

  dom.editorTextarea.value = tab.content;
  updateSyntaxHighlight(tab.content, tab.extension);
  updateGutter(tab.content);

  const rel = tab.path.replace(state.currentDir, '').replace(/^[\\\/]/, '');
  dom.statusFilePath.textContent = rel || tab.name;
  dom.statusLanguage.textContent = getLanguageName(tab.extension);
  updateCursorInfo();
}

// ── Code Editor & Syntax Highlighting ───────────────────────────────────────
function updateGutter(text) {
  const lines = text.split('\n');
  const count = Math.max(lines.length, 1);
  let html = '';
  for (let i = 1; i <= count; i++) {
    html += `<div class="gutter-line" data-line="${i}">${i}</div>`;
  }
  dom.editorGutter.innerHTML = html;
}

function updateSyntaxHighlight(code, ext) {
  dom.editorCodeDisplay.innerHTML = highlightCode(code, ext);
}

function highlightCode(code, ext) {
  if (!code) return '';
  // Robust single-pass tokenizer matching screenshot palette
  const tokenRegex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:function|var|let|const|if|else|return|class|extends|new|this|async|await|try|catch|throw|import|export|from|default|while|for|switch|case|break|true|false|null|undefined)\b)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\())|([{}()\[\],;])|([<>!=+\-*\/%&|^~?:]+)/g;

  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      result += escapeHtml(code.slice(lastIndex, match.index));
    }
    lastIndex = tokenRegex.lastIndex;

    if (match[1]) {
      result += `<span class="hl-comment">${escapeHtml(match[1])}</span>`;
    } else if (match[2]) {
      result += `<span class="hl-string">${escapeHtml(match[2])}</span>`;
    } else if (match[3]) {
      result += `<span class="hl-keyword">${escapeHtml(match[3])}</span>`;
    } else if (match[4]) {
      result += `<span class="hl-number">${escapeHtml(match[4])}</span>`;
    } else if (match[5]) {
      result += `<span class="hl-function">${escapeHtml(match[5])}</span>`;
    } else if (match[6]) {
      result += `<span class="hl-punctuation">${escapeHtml(match[6])}</span>`;
    } else if (match[7]) {
      result += `<span class="hl-operator">${escapeHtml(match[7])}</span>`;
    }
  }

  if (lastIndex < code.length) {
    result += escapeHtml(code.slice(lastIndex));
  }

  return result;
}

function updateCursorInfo() {
  const text = dom.editorTextarea.value;
  const selStart = dom.editorTextarea.selectionStart;
  const lines = text.slice(0, selStart).split('\n');
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  dom.statusCursor.textContent = `${line}:${col}`;

  document.querySelectorAll('.gutter-line').forEach(el => {
    el.classList.toggle('is-current', el.dataset.line === String(line));
  });
}

// Editor Event Listeners
dom.editorTextarea.addEventListener('input', () => {
  const tab = state.openTabs.find(t => t.path === state.activeFilePath);
  if (!tab) return;

  const val = dom.editorTextarea.value;
  tab.content = val;
  tab.isDirty = (tab.content !== tab.originalContent);

  updateSyntaxHighlight(val, tab.extension);
  updateGutter(val);
  renderTabs();
});

dom.editorTextarea.addEventListener('scroll', () => {
  dom.editorHighlight.scrollTop = dom.editorTextarea.scrollTop;
  dom.editorHighlight.scrollLeft = dom.editorTextarea.scrollLeft;
  dom.editorGutter.scrollTop = dom.editorTextarea.scrollTop;
});

dom.editorTextarea.addEventListener('keyup', updateCursorInfo);
dom.editorTextarea.addEventListener('click', updateCursorInfo);

// Tab key indentation
dom.editorTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = dom.editorTextarea.selectionStart;
    const end = dom.editorTextarea.selectionEnd;
    dom.editorTextarea.value = dom.editorTextarea.value.substring(0, start) + '  ' + dom.editorTextarea.value.substring(end);
    dom.editorTextarea.selectionStart = dom.editorTextarea.selectionEnd = start + 2;
    dom.editorTextarea.dispatchEvent(new Event('input'));
  }
});

// Save file
async function saveActiveFile() {
  const tab = state.openTabs.find(t => t.path === state.activeFilePath);
  if (!tab) return;

  try {
    const res = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tab.path, content: tab.content }),
    });
    if (!res.ok) throw new Error('Failed to save file');

    tab.originalContent = tab.content;
    tab.isDirty = false;
    renderTabs();
    showToast(`Saved ${tab.name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

dom.btnSaveFile.addEventListener('click', saveActiveFile);

// Empty state buttons - make them real
document.getElementById('emptyBtnSpotlight').addEventListener('click', openSpotlight);
document.getElementById('emptyBtnSave').addEventListener('click', saveActiveFile);
document.getElementById('emptyBtnOpenFolder').addEventListener('click', () => {
  document.getElementById('folderPickerModal').style.display = 'flex';
});
document.getElementById('emptyBtnSettings').addEventListener('click', () => {
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.style.display = 'flex';
});

// Keyboard shortcuts (Ctrl+S, Ctrl+P)
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveActiveFile();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openSpotlight();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    document.getElementById('folderPickerModal').style.display = 'flex';
  } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.style.display = 'flex';
  } else if ((e.ctrlKey || e.metaKey) && e.key === '`') {
    e.preventDefault();
    if (dom.tabBtnTerminal) dom.tabBtnTerminal.click();
  }
});

// ── Folder Picker & Workspace Switcher ──────────────────────────────────────
async function openFolderPicker(startDir = null) {
  dom.folderPickerModal.style.display = 'flex';
  await browseDirectory(startDir || state.currentDir || 'drives');
}

function closeFolderPicker() {
  dom.folderPickerModal.style.display = 'none';
}

async function browseDirectory(dir) {
  try {
    const url = dir ? `/api/browse?dir=${encodeURIComponent(dir)}` : '/api/browse';
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to browse folder');
    const data = await res.json();

    state.browseCurrentDir = data.current;
    state.browseSelectedDir = data.current !== 'drives' ? data.current : '';
    dom.inputManualFolderPath.value = state.browseSelectedDir;

    renderBreadcrumbs(data.current, data.parent);
    renderBrowserList(data.items, data.parent);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderBreadcrumbs(current, parent) {
  dom.folderNavBreadcrumbs.innerHTML = '';
  if (current === 'drives') {
    dom.folderNavBreadcrumbs.innerHTML = '<span>This PC (Drives)</span>';
    return;
  }

  const drivesBtn = document.createElement('span');
  drivesBtn.className = 'crumb-item';
  drivesBtn.textContent = 'This PC';
  drivesBtn.onclick = () => browseDirectory('drives');
  dom.folderNavBreadcrumbs.appendChild(drivesBtn);

  const parts = current.split(/[\\\/]/).filter(Boolean);
  let accumulated = '';

  for (let i = 0; i < parts.length; i++) {
    dom.folderNavBreadcrumbs.appendChild(document.createTextNode(' / '));
    const part = parts[i];
    accumulated += (i === 0 && current.includes(':')) ? (part + '\\') : (part + '\\');
    const target = accumulated;

    const span = document.createElement('span');
    span.className = 'crumb-item';
    span.textContent = part;
    span.onclick = () => browseDirectory(target);
    dom.folderNavBreadcrumbs.appendChild(span);
  }
}

function renderBrowserList(items, parent) {
  dom.folderBrowserList.innerHTML = '';

  if (parent) {
    const upItem = document.createElement('div');
    upItem.className = 'folder-browser-item';
    upItem.innerHTML = `${ICONS.folder} <span>.. (Parent Folder)</span>`;
    upItem.onclick = () => browseDirectory(parent);
    dom.folderBrowserList.appendChild(upItem);
  }

  if (!items || items.length === 0) {
    dom.folderBrowserList.innerHTML += '<div style="padding: 10px; color: var(--text-muted); font-size: 12px;">No subdirectories found</div>';
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'folder-browser-item';
    row.innerHTML = `${ICONS.folder} <span>${escapeHtml(item.name)}</span>`;

    row.onclick = () => {
      document.querySelectorAll('.folder-browser-item').forEach(el => el.classList.remove('is-selected'));
      row.classList.add('is-selected');
      state.browseSelectedDir = item.path;
      dom.inputManualFolderPath.value = item.path;
    };

    row.ondblclick = () => {
      browseDirectory(item.path);
    };

    dom.folderBrowserList.appendChild(row);
  }
}

async function confirmSelectFolder() {
  const chosenPath = dom.inputManualFolderPath.value.trim() || state.browseSelectedDir;
  if (!chosenPath) {
    showToast('Please select a folder', 'error');
    return;
  }

  try {
    const res = await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: chosenPath }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to switch folder');
    }

    const data = await res.json();
    state.currentDir = data.dir;
    state.workspaceName = data.name;
    state.openTabs = [];
    state.activeFilePath = null;

    localStorage.setItem('forge-workspace', data.dir);
    fetch('/api/persist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: data.dir }) }).catch(() => {});

    dom.workspaceRootName.textContent = data.name;
    dom.agentWorkingDirPath.textContent = data.dir;
    dom.terminalWorkingDir.textContent = data.dir;
    renderTabs();
    displayActiveFile();
    renderFileTree(data.tree);

    closeFolderPicker();
    showToast(`Switched workspace to: ${data.name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

dom.btnOpenFolder.addEventListener('click', () => openFolderPicker());
dom.btnAgentChangeFolder.addEventListener('click', () => openFolderPicker());
dom.btnCloseFolderPicker.addEventListener('click', closeFolderPicker);
dom.btnCancelFolderPicker.addEventListener('click', closeFolderPicker);
dom.btnConfirmSelectFolder.addEventListener('click', confirmSelectFolder);
dom.btnNavToInputPath.addEventListener('click', () => {
  const val = dom.inputManualFolderPath.value.trim();
  if (val) browseDirectory(val);
});

// ── Spotlight Search (Ctrl+P) ───────────────────────────────────────────────
function openSpotlight() {
  dom.spotlightModal.style.display = 'flex';
  dom.spotlightInput.value = '';
  dom.spotlightResults.innerHTML = '';
  dom.spotlightInput.focus();
}

function closeSpotlight() {
  dom.spotlightModal.style.display = 'none';
}

dom.spotlightTrigger.addEventListener('click', openSpotlight);
dom.spotlightModal.addEventListener('click', (e) => {
  if (e.target === dom.spotlightModal) closeSpotlight();
});

let searchDebounce = null;
dom.spotlightInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = dom.spotlightInput.value.trim();
  if (!q) {
    dom.spotlightResults.innerHTML = '';
    return;
  }
  searchDebounce = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const results = await res.json();
      renderSpotlightResults(results);
    } catch (e) {}
  }, 180);
});

dom.spotlightInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSpotlight();
});

function renderSpotlightResults(results) {
  dom.spotlightResults.innerHTML = '';
  if (!results || results.length === 0) {
    dom.spotlightResults.innerHTML = '<div style="padding: 12px 16px; color: var(--text-muted); font-size: 12px;">No matching files</div>';
    return;
  }

  for (const item of results) {
    const row = document.createElement('div');
    row.className = 'spotlight-item';
    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        ${item.isDirectory ? ICONS.folder : getFileIcon(item.name)}
        <span class="spotlight-item-name">${escapeHtml(item.name)}</span>
      </div>
      <span class="spotlight-item-path">${escapeHtml(item.relativePath)}</span>
    `;

    row.onclick = () => {
      closeSpotlight();
      if (!item.isDirectory) {
        openFile(item.path);
      }
    };

    dom.spotlightResults.appendChild(row);
  }
}

// ── Context Menu (New File, New Folder, Rename, Delete) ─────────────────────
function showContextMenu(x, y) {
  dom.treeContextMenu.style.display = 'block';
  dom.treeContextMenu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
  dom.treeContextMenu.style.top = `${Math.min(y, window.innerHeight - 180)}px`;
}

window.addEventListener('click', () => {
  dom.treeContextMenu.style.display = 'none';
});

dom.ctxNewFile.addEventListener('click', async () => {
  const base = contextTargetNode?.isDir ? contextTargetNode.path : (contextTargetNode?.path ? getParentDir(contextTargetNode.path) : state.currentDir);
  const name = prompt('Enter new file name:');
  if (!name) return;
  const newPath = `${base}/${name}`.replace(/[\/\\]+/g, '/');
  try {
    await fetch('/api/file/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', path: newPath }),
    });
    await loadWorkspace();
    openFile(newPath);
    showToast(`Created file: ${name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

dom.ctxNewFolder.addEventListener('click', async () => {
  const base = contextTargetNode?.isDir ? contextTargetNode.path : (contextTargetNode?.path ? getParentDir(contextTargetNode.path) : state.currentDir);
  const name = prompt('Enter new folder name:');
  if (!name) return;
  const newPath = `${base}/${name}`.replace(/[\/\\]+/g, '/');
  try {
    await fetch('/api/file/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dir', path: newPath }),
    });
    await loadWorkspace();
    showToast(`Created folder: ${name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

dom.ctxRename.addEventListener('click', async () => {
  if (!contextTargetNode) return;
  const oldPath = contextTargetNode.path;
  const oldName = oldPath.split(/[\\\/]/).pop();
  const newName = prompt('Enter new name:', oldName);
  if (!newName || newName === oldName) return;

  const parent = getParentDir(oldPath);
  const newPath = `${parent}/${newName}`.replace(/[\/\\]+/g, '/');
  try {
    await fetch('/api/file/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
    });
    await loadWorkspace();
    showToast(`Renamed to: ${newName}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

dom.ctxDelete.addEventListener('click', async () => {
  if (!contextTargetNode) return;
  const path = contextTargetNode.path;
  const name = path.split(/[\\\/]/).pop();
  if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

  try {
    await fetch('/api/file/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    closeTab(path);
    await loadWorkspace();
    showToast(`Deleted: ${name}`, 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

dom.btnNewFile.addEventListener('click', () => dom.ctxNewFile.click());
dom.btnNewFolder.addEventListener('click', () => dom.ctxNewFolder.click());
dom.btnRefreshTree.addEventListener('click', () => loadWorkspace());

function getParentDir(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/') || state.currentDir;
}

// ── Forge Agent AI Assistant ────────────────────────────────────────────────
async function sendAgentTask() {
  const task = dom.agentPromptInput.value.trim();
  if (!task || state.agentRunning) return;

  dom.agentPromptInput.value = '';
  appendChatMessage('user', task);

  state.agentRunning = true;
  updateAgentRunningUI(true);

  const chatId = getActiveChatId();
  const chats = loadAllChats();
  const chat = chatId ? chats[chatId] : null;
  const history = (chat && chat.messages) ? chat.messages.map(m => ({
    role: m.role,
    text: (m.text || '').replace(/TASK_COMPLETE/g, '').trim(),
  })).filter(m => m.text) : [];

  try {
    const res = await fetch('/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, history }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start agent task');
    }
  } catch (err) {
    showToast(err.message, 'error');
    state.agentRunning = false;
    updateAgentRunningUI(false);
  }
}

async function stopAgentTask() {
  try {
    await fetch('/api/agent/stop', { method: 'POST' });
    showToast('Stopping task...', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function startNewChat() {
  try {
    await fetch('/api/agent/new-chat', { method: 'POST' });
  } catch (err) {}
  createNewChat();
  showToast('New chat started', 'info');
}

dom.btnSendTask.addEventListener('click', sendAgentTask);
dom.btnStopAgent.addEventListener('click', stopAgentTask);
dom.btnNewChat.addEventListener('click', startNewChat);

dom.agentPromptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAgentTask();
  }
});

function updateAgentRunningUI(isRunning) {
  dom.btnSendTask.style.display = isRunning ? 'none' : 'inline-flex';
  dom.btnStopAgent.style.display = isRunning ? 'inline-flex' : 'none';
  dom.agentLiveActivity.style.display = isRunning ? 'block' : 'none';
  if (dom.statusPulseDot && dom.titlebarStatusText) {
    dom.statusPulseDot.classList.toggle('is-busy', isRunning);
    dom.titlebarStatusText.textContent = isRunning ? 'Working' : 'Ready';
  }
}

function appendChatMessage(role, text, skipSave) {
  if (typeof text === 'string') {
    text = text.replace(/TASK_COMPLETE/g, '').trim();
  }
  if (!text) return;

  // Save to persistence (unless loading history)
  if (!skipSave) saveMessageToActiveChat(role, text);

  if (role === 'assistant') {
    let parsedJson = null;
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        parsedJson = JSON.parse(trimmed);
      }
    } catch (err) {}

    if (parsedJson && (parsedJson.content || parsedJson.title)) {
      appendInfoMessage(parsedJson.title, parsedJson.content);
      return;
    }
  }

  const card = document.createElement('div');
  card.className = `chat-msg msg-${role}`;
  const contentHtml = role === 'assistant'
    ? `<div class="msg-bubble markdown-body">${renderMarkdown(text)}</div>`
    : `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  card.innerHTML = `
    ${contentHtml}
    <div class="msg-meta">${role === 'assistant' ? 'Assistant · ' : ''}${new Date().toLocaleTimeString()}</div>
  `;
  dom.chatMessages.appendChild(card);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function appendInfoMessage(title, content) {
  const card = document.createElement('div');
  card.className = 'chat-msg msg-assistant';
  card.innerHTML = `
    <div class="msg-bubble info-card-bubble">
      ${title ? `<div class="info-card-title"><svg class="svg-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg><span>${escapeHtml(title)}</span></div>` : ''}
      <div class="markdown-body">${renderMarkdown(content)}</div>
    </div>
    <div class="msg-meta">Assistant · ${new Date().toLocaleTimeString()}</div>
  `;
  dom.chatMessages.appendChild(card);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function appendToolCallCard(name, args) {
  const card = document.createElement('div');
  card.className = 'tool-call-card';
  card.innerHTML = `
    <div class="tool-call-header">
      ${ICONS.tool}
      <span>${escapeHtml(name)}</span>
    </div>
    <div class="tool-call-body">${escapeHtml(JSON.stringify(args, null, 2))}</div>
  `;
  dom.chatMessages.appendChild(card);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// ── Permission Modal Handling ───────────────────────────────────────────────
let pendingPermissionOptions = [];
let selectedPermissionIndex = 0;

function showPermissionDialog(data) {
  const { label, detail, options } = data;
  dom.permLabel.textContent = `Permission requested: ${label || 'write files'}`;
  dom.permDetail.textContent = detail || '';

  pendingPermissionOptions = options || [
    { key: 'once',    label: 'Allow Once' },
    { key: 'session', label: 'Allow for this Session' },
    { key: 'saved',   label: 'Allow for this Project (always)' },
    { key: 'deny',    label: 'Deny' },
    { key: 'stop',    label: 'Deny and Stop Task' },
  ];
  selectedPermissionIndex = 0;

  renderPermissionOptions();
  dom.permissionModal.style.display = 'flex';
  dom.permissionCard.focus();
}

function renderPermissionOptions() {
  dom.permOptionsList.innerHTML = '';
  pendingPermissionOptions.forEach((opt, idx) => {
    const item = document.createElement('div');
    const isSel = idx === selectedPermissionIndex;
    const isDanger = opt.key === 'deny' || opt.key === 'stop';
    item.className = `perm-option-item ${isSel ? 'is-selected' : ''} ${isDanger ? 'is-danger' : ''}`;
    item.innerHTML = `
      <span class="perm-arrow">❯</span>
      <span class="perm-option-label">${escapeHtml(opt.label)}</span>
    `;
    item.addEventListener('mouseenter', () => {
      selectedPermissionIndex = idx;
      updatePermissionSelection();
    });
    item.addEventListener('click', () => {
      confirmPermission(opt.key);
    });
    dom.permOptionsList.appendChild(item);
  });
}

function updatePermissionSelection() {
  const items = dom.permOptionsList.querySelectorAll('.perm-option-item');
  items.forEach((item, idx) => {
    item.classList.toggle('is-selected', idx === selectedPermissionIndex);
  });
}

async function confirmPermission(key) {
  dom.permissionModal.style.display = 'none';
  try {
    await fetch('/api/permission/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: key }),
    });
  } catch (err) {
    console.error('Failed to send permission decision:', err);
  }
}

// Arrow key navigation + Enter confirmation for permission dialog
dom.permissionCard.addEventListener('keydown', (e) => {
  if (dom.permissionModal.style.display !== 'flex') return;

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedPermissionIndex = (selectedPermissionIndex - 1 + pendingPermissionOptions.length) % pendingPermissionOptions.length;
    updatePermissionSelection();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedPermissionIndex = (selectedPermissionIndex + 1) % pendingPermissionOptions.length;
    updatePermissionSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const opt = pendingPermissionOptions[selectedPermissionIndex];
    if (opt) confirmPermission(opt.key);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    confirmPermission('deny');
  }
});

// ── SSE Live Agent Events ───────────────────────────────────────────────────
function setupEventSource() {
  state.eventSource = new EventSource('/api/agent/events');

  state.eventSource.addEventListener('agent_start', (e) => {
    state.agentRunning = true;
    updateAgentRunningUI(true);
    dom.activityTitle.textContent = 'Agent running task...';
  });

  state.eventSource.addEventListener('agent_tool_call', (e) => {
    const data = JSON.parse(e.data);
    dom.activityTitle.textContent = `Executing: ${data.name}`;
    if (data.name === 'show_info') {
      const title = data.args?.title || null;
      const content = data.args?.content || (typeof data.args === 'string' ? data.args : JSON.stringify(data.args));
      appendInfoMessage(title, content);
    } else {
      appendToolCallCard(data.name, data.args);
    }
  });

  state.eventSource.addEventListener('permission_request', (e) => {
    const data = JSON.parse(e.data);
    showPermissionDialog(data);
  });

  state.eventSource.addEventListener('permission_resolved', () => {
    dom.permissionModal.style.display = 'none';
  });

  state.eventSource.addEventListener('agent_start', (e) => {
    state.agentRunning = true;
    updateAgentRunningUI(true);
    if (dom.agentThinkingCard) {
      dom.agentThinkingCard.style.display = 'none';
      dom.agentThinkingCard.classList.remove('is-collapsed');
      if (dom.thinkingBody) dom.thinkingBody.textContent = '';
      if (dom.thinkingTitle) dom.thinkingTitle.textContent = 'Размышление';
      if (dom.thinkingSpinner) dom.thinkingSpinner.style.display = 'inline-block';
      if (dom.thinkingReadCount) dom.thinkingReadCount.textContent = '0';
      if (dom.thinkingSearchCount) dom.thinkingSearchCount.textContent = '0';
    }
  });

  state.eventSource.addEventListener('agent_thinking', (e) => {
    const data = JSON.parse(e.data);
    const secs = Math.round((data.elapsedMs || 0) / 1000);
    if (!data.elapsedMs) {
      dom.activityTitle.textContent = 'Подключение к сессии Forge...';
    } else {
      dom.activityTitle.textContent = `Forge рассуждение (${secs}s)...`;
    }

    if (data.readCount !== undefined && dom.thinkingReadCount) dom.thinkingReadCount.textContent = data.readCount;
    if (data.searchCount !== undefined && dom.thinkingSearchCount) dom.thinkingSearchCount.textContent = data.searchCount;

    // Stream live thoughts if available
    if (data.thinkingText) {
      if (dom.agentThinkingCard) {
        dom.agentThinkingCard.style.display = 'block';
        if (dom.thinkingSpinner) dom.thinkingSpinner.style.display = 'inline-block';
        if (dom.thinkingTitle) dom.thinkingTitle.textContent = `Размышление (${secs}s)`;
        if (dom.thinkingBody) {
          dom.thinkingBody.textContent = data.thinkingText;
          dom.thinkingBody.scrollTop = dom.thinkingBody.scrollHeight;
        }
      }
    }
  });

  state.eventSource.addEventListener('agent_message', (e) => {
    const data = JSON.parse(e.data);
    // When real answer arrives, mark thinking card as complete and collapse
    if (dom.agentThinkingCard && dom.agentThinkingCard.style.display !== 'none') {
      if (dom.thinkingSpinner) dom.thinkingSpinner.style.display = 'none';
      if (dom.thinkingTitle) {
        dom.thinkingTitle.textContent = dom.thinkingTitle.textContent.replace('Размышление', 'Размышление завершено');
      }
      dom.agentThinkingCard.classList.add('is-collapsed');
    }
    appendChatMessage('assistant', data.text);
  });

  state.eventSource.addEventListener('agent_done', (e) => {
    state.agentRunning = false;
    updateAgentRunningUI(false);
    const data = JSON.parse(e.data);

    // Finalize thinking card
    if (dom.agentThinkingCard && dom.agentThinkingCard.style.display !== 'none') {
      if (dom.thinkingSpinner) dom.thinkingSpinner.style.display = 'none';
      if (dom.thinkingTitle) {
        dom.thinkingTitle.textContent = dom.thinkingTitle.textContent.replace('Размышление', 'Размышление завершено');
      }
      dom.agentThinkingCard.classList.add('is-collapsed');
    }

    let summary = (data.summary || '').replace(/TASK_COMPLETE/g, '').trim();

    // Prevent duplicate bubble if agent_message already outputted this answer
    const lastMsg = dom.chatMessages.querySelector('.chat-msg.msg-assistant:last-child');
    const alreadyShown = lastMsg && summary && lastMsg.textContent.includes(summary.slice(0, 40));

    if (summary && !alreadyShown) {
      appendChatMessage('assistant', summary);
    }

    showToast('Task finished', 'success');
    loadWorkspace();
  });

  state.eventSource.addEventListener('agent_error', (e) => {
    state.agentRunning = false;
    updateAgentRunningUI(false);
    const data = JSON.parse(e.data);
    showToast(`Error: ${data.error}`, 'error');
  });

  state.eventSource.addEventListener('tree_changed', () => {
    loadWorkspace();
  });

  state.eventSource.addEventListener('file_saved', (e) => {
    const data = JSON.parse(e.data);
    const openTab = state.openTabs.find(t => t.path === data.path);
    if (openTab && openTab.path !== state.activeFilePath) {
      // Reload updated content in open tab
      fetch(`/api/file?path=${encodeURIComponent(data.path)}`)
        .then(r => r.json())
        .then(f => {
          openTab.content = f.content;
          openTab.originalContent = f.content;
          openTab.isDirty = false;
          renderTabs();
        }).catch(() => {});
    }
  });
}

// ── Integrated Terminal ─────────────────────────────────────────────────────
async function runTerminalCommand() {
  const cmd = dom.terminalInput.value.trim();
  if (!cmd) return;

  dom.terminalInput.value = '';
  appendTerminalLine(`$ ${cmd}`, 'cmd');

  try {
    const res = await fetch('/api/terminal/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    });
    const data = await res.json();
    if (data.stdout) appendTerminalLine(data.stdout, 'stdout');
    if (data.stderr) appendTerminalLine(data.stderr, 'stderr');
    loadWorkspace();
  } catch (err) {
    appendTerminalLine(`Error: ${err.message}`, 'stderr');
  }
}

function appendTerminalLine(text, type = 'stdout') {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  dom.terminalOutput.appendChild(line);
  dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
}

dom.btnRunTerminalCmd.addEventListener('click', runTerminalCommand);
dom.terminalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runTerminalCommand();
});

// Terminal Tabs Switcher
dom.tabBtnChat.addEventListener('click', () => {
  dom.tabBtnChat.classList.add('active');
  dom.tabBtnTerminal.classList.remove('active');
  dom.agentChatView.style.display = 'flex';
  dom.agentTerminalView.style.display = 'none';
});

dom.tabBtnTerminal.addEventListener('click', () => {
  dom.tabBtnTerminal.classList.add('active');
  dom.tabBtnChat.classList.remove('active');
  dom.agentTerminalView.style.display = 'flex';
  dom.agentChatView.style.display = 'none';
});

dom.btnToggleTerminal.addEventListener('click', () => {
  dom.sidebarRight.classList.remove('is-collapsed');
  dom.tabBtnTerminal.click();
});

// ── Sidebar & Window Toggles ────────────────────────────────────────────────
dom.btnCollapseSidebar.addEventListener('click', () => {
  dom.sidebarLeft.classList.toggle('is-collapsed');
});

function setRightSidebarCollapsed(isCollapsed) {
  dom.sidebarRight.classList.toggle('is-collapsed', isCollapsed);
  dom.appWindow.classList.toggle('sidebar-right-collapsed', isCollapsed);
}

dom.btnToggleRightSidebar.addEventListener('click', () => {
  setRightSidebarCollapsed(true);
});

dom.btnFloatingAgent.addEventListener('click', () => {
  const isCollapsed = dom.sidebarRight.classList.contains('is-collapsed');
  setRightSidebarCollapsed(!isCollapsed);
});

// Real-Time Thinking Card Collapse/Expand Toggle
if (dom.thinkingHeader) {
  dom.thinkingHeader.addEventListener('click', () => {
    if (dom.agentThinkingCard) {
      dom.agentThinkingCard.classList.toggle('is-collapsed');
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderMarkdown(text) {
  if (!text) return '';
  let s = String(text);

  // Fenced code blocks ```lang\n...```
  s = s.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
  });

  // Inline code `code`
  s = s.replace(/`([^`\n]+)`/g, (match, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  // Bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic *text*
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Split lines to parse bullet lists
  const lines = s.split('\n');
  const resultLines = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        resultLines.push('<ul>');
        inList = true;
      }
      resultLines.push(`<li>${bulletMatch[2]}</li>`);
    } else {
      if (inList) {
        resultLines.push('</ul>');
        inList = false;
      }
      if (line.trim() === '') {
        resultLines.push('<div style="height: 6px;"></div>');
      } else if (!line.startsWith('<pre>') && !line.startsWith('</pre>') && !line.startsWith('<code>')) {
        resultLines.push(`<p>${line}</p>`);
      } else {
        resultLines.push(line);
      }
    }
  }
  if (inList) {
    resultLines.push('</ul>');
  }

  return resultLines.join('\n');
}

function getLanguageName(ext) {
  const map = {
    js: 'JavaScript',
    jsx: 'JavaScript React',
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    py: 'Python',
    md: 'Markdown',
    txt: 'Plain Text',
  };
  return map[ext?.toLowerCase()] || 'Plain Text';
}

// ── Init ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadWorkspace();
  setupEventSource();
  initTutorial();
  initWelcomeScreen();
  initMusicPlayer();
  initSettings();

  // Initialize chat: restore active chat or create new one
  let savedChatId = localStorage.getItem('forge-active-chat');
  let chats = loadAllChats();

  // Always try loading from server first (server is source of truth)
  try {
    const persistRes = await fetch('/api/persist');
    if (persistRes.ok) {
      const persistData = await persistRes.json();
      if (persistData.chats && Object.keys(persistData.chats).length > 0) {
        chats = persistData.chats;
        localStorage.setItem(getChatsStoreKey(), JSON.stringify(chats));
      }
      if (persistData.activeChatId) {
        savedChatId = persistData.activeChatId;
        localStorage.setItem('forge-active-chat', savedChatId);
      }
    }
  } catch (e) {}

  if (savedChatId && chats[savedChatId]) {
    setActiveChatId(savedChatId);
  } else if (Object.keys(chats).length > 0) {
    const firstId = Object.keys(chats)[0];
    setActiveChatId(firstId);
  } else {
    createNewChat();
  }
  renderChatHistory();
  renderChatMessages();

  // Settings button in titlebar and activity bar
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsBtnActivity = document.getElementById('settingsBtnActivity');
  const openSettings = () => {
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.style.display = 'flex';
  };
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (settingsBtnActivity) settingsBtnActivity.addEventListener('click', openSettings);

  // MCP button
  const btnMCP = document.getElementById('btnMCP');
  if (btnMCP) {
    btnMCP.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/mcp/status');
        const data = await res.json();
        const lines = ['MCP Servers:\n'];
        if (data.servers && data.servers.length > 0) {
          for (const srv of data.servers) {
            lines.push('  ' + srv.name + ': ' + srv.command + ' ' + (srv.args || []).join(' '));
          }
        } else {
          lines.push('  No servers configured.');
          lines.push('\nAdd to ~/.forge-ide/config.json:');
          lines.push('  "MCP_SERVERS": [{"name": "my-server", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"]}]');
        }
        if (data.tools && data.tools.length > 0) {
          lines.push('\nLoaded tools (' + data.tools.length + '):');
          data.tools.forEach(t => lines.push('  - ' + t));
        }
        // Create MCP overlay
        let mcpOverlay = document.getElementById('mcpOverlay');
        if (!mcpOverlay) {
          mcpOverlay = document.createElement('div');
          mcpOverlay.id = 'mcpOverlay';
          mcpOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
          mcpOverlay.innerHTML = '<div style="background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow:auto;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h3 style="margin:0;font-size:16px;color:#f97316;">MCP Servers</h3><button onclick="document.getElementById(\'mcpOverlay\').style.display=\'none\'" style="background:transparent;border:none;color:#888;cursor:pointer;font-size:18px;">&times;</button></div><div id="mcpContent" style="font-family:monospace;font-size:13px;line-height:1.8;color:#e5e5e5;white-space:pre-wrap;"></div><div style="margin-top:16px;text-align:right;"><button onclick="document.getElementById(\'mcpOverlay\').style.display=\'none\'" style="background:#f97316;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Close</button></div></div>';
          document.body.appendChild(mcpOverlay);
          mcpOverlay.addEventListener('click', (e) => { if (e.target === mcpOverlay) mcpOverlay.style.display = 'none'; });
        }
        document.getElementById('mcpContent').textContent = lines.join('\n');
        mcpOverlay.style.display = 'flex';
      } catch (e) {
        console.error('MCP status error:', e);
      }
    });
  }

  // Toggle chat history
  const toggleHistoryBtn = document.getElementById('btnToggleChatHistory');
  const historyPanel = document.getElementById('chatHistoryPanel');
  if (toggleHistoryBtn && historyPanel) {
    toggleHistoryBtn.addEventListener('click', () => {
      const isVisible = historyPanel.style.display !== 'none';
      historyPanel.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) renderChatHistory();
    });
  }

  // Close chat history
  const closeHistoryBtn = document.getElementById('btnCloseChatHistory');
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', () => {
      if (historyPanel) historyPanel.style.display = 'none';
    });
  }

  // New chat from history panel
  const newFromHistory = document.getElementById('btnNewChatFromHistory');
  if (newFromHistory) {
    newFromHistory.addEventListener('click', () => {
      createNewChat();
    });
  }

  // ── Activity bar icons ──────────────────────────────────────────────────
  const actExplorer = document.getElementById('btnActivityExplorer');
  const actSearch = document.getElementById('btnActivitySearch');
  const actSC = document.getElementById('btnActivitySourceControl');
  const sidebar = document.querySelector('.sidebar');

  function setActiveActivity(id) {
    document.querySelectorAll('.activity-icon').forEach(el => el.classList.remove('is-active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('is-active');
  }

  if (actExplorer) {
    actExplorer.addEventListener('click', () => {
      setActiveActivity('btnActivityExplorer');
      if (sidebar) sidebar.style.display = 'flex';
    });
  }
  if (actSearch) {
    actSearch.addEventListener('click', () => {
      setActiveActivity('btnActivitySearch');
      openSpotlight();
    });
  }
  if (actSC) {
    actSC.addEventListener('click', () => {
      setActiveActivity('btnActivitySourceControl');
      showToast('Source Control — coming soon', 'info');
    });
  }

  // ── Menu buttons (File, Edit, View) ────────────────────────────────────
  document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const label = btn.textContent.trim();
      if (label === 'File') {
        document.getElementById('folderPickerModal').style.display = 'flex';
      } else if (label === 'Edit') {
        showToast('Edit menu — use keyboard shortcuts', 'info');
      } else if (label === 'View') {
        const ch = document.getElementById('chatHistoryPanel');
        if (ch) ch.style.display = ch.style.display === 'none' ? 'flex' : 'none';
      }
    });
  });

  // ── Status bar buttons ──────────────────────────────────────────────────
  const btnSync = document.getElementById('btnSync');
  if (btnSync) {
    btnSync.addEventListener('click', () => {
      showToast('Synced workspace', 'success');
      loadWorkspace();
    });
  }

  const btnUser = document.getElementById('btnUser');
  if (btnUser) {
    btnUser.addEventListener('click', () => {
      openSettings();
    });
  }

  // ── Folder picker open button in titlebar ───────────────────────────────
  const btnOpenFolder = document.getElementById('btnOpenFolder');
  if (btnOpenFolder) {
    btnOpenFolder.addEventListener('click', () => {
      document.getElementById('folderPickerModal').style.display = 'flex';
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CHAT PERSISTENCE — multi-chat system
// ══════════════════════════════════════════════════════════════════════════════
function getChatsStoreKey() {
  return 'forge-chats';
}

function loadAllChats() {
  try {
    return JSON.parse(localStorage.getItem(getChatsStoreKey()) || '{}');
  } catch { return {}; }
}

function saveAllChats(chats) {
  localStorage.setItem(getChatsStoreKey(), JSON.stringify(chats));
  fetch('/api/persist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chats, activeChatId: state.activeChatId }) }).catch(() => {});
}

function getActiveChatId() {
  return state.activeChatId || null;
}

function setActiveChatId(id) {
  state.activeChatId = id;
  localStorage.setItem('forge-active-chat', id);
  fetch('/api/persist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeChatId: id }) }).catch(() => {});
}

function createNewChat() {
  const chats = loadAllChats();
  const id = 'chat-' + Date.now();
  chats[id] = {
    id,
    title: 'New Chat',
    messages: [],
    created: Date.now(),
    updated: Date.now(),
  };
  saveAllChats(chats);
  setActiveChatId(id);
  renderChatHistory();
  renderChatMessages();
  return id;
}

function deleteChat(id) {
  const chats = loadAllChats();
  delete chats[id];
  saveAllChats(chats);

  if (getActiveChatId() === id) {
    const keys = Object.keys(chats);
    if (keys.length > 0) {
      setActiveChatId(keys[keys.length - 1]);
    } else {
      createNewChat();
    }
  }
  renderChatHistory();
  renderChatMessages();
}

function switchToChat(id) {
  setActiveChatId(id);
  renderChatHistory();
  renderChatMessages();
  const historyPanel = document.getElementById('chatHistoryPanel');
  if (historyPanel) historyPanel.style.display = 'none';
  const chatView = document.getElementById('agentChatView');
  if (chatView) chatView.style.display = 'flex';
}

function saveMessageToActiveChat(role, text) {
  const id = getActiveChatId();
  if (!id) return;
  const chats = loadAllChats();
  if (!chats[id]) return;

  // Strip TASK_COMPLETE before saving
  const cleanText = (text || '').replace(/TASK_COMPLETE/g, '').trim();
  if (!cleanText) return;

  chats[id].messages.push({ role, text: cleanText, time: Date.now() });
  chats[id].updated = Date.now();

  // Auto-title from first user message
  if (role === 'user' && chats[id].title === 'New Chat') {
    chats[id].title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
  }

  // Keep max 200 messages
  if (chats[id].messages.length > 200) {
    chats[id].messages = chats[id].messages.slice(-200);
  }

  saveAllChats(chats);
}

let _chatHistoryGeneration = 0;

function renderChatHistory() {
  const list = document.getElementById('chatHistoryList');
  if (!list) return;

  const gen = ++_chatHistoryGeneration;

  const chats = loadAllChats();
  const sorted = Object.values(chats).sort((a, b) => b.updated - a.updated);
  const activeId = getActiveChatId();

  list.innerHTML = '';

  if (sorted.length > 0) {
    const section = document.createElement('div');
    section.className = 'chat-history-section-title';
    section.textContent = 'Forge Chats';
    section.style.cssText = 'font-size:10px;color:#666;padding:4px 10px;text-transform:uppercase;letter-spacing:0.5px;';
    list.appendChild(section);
  }

  sorted.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chat-history-item' + (chat.id === activeId ? ' is-active' : '');
    const time = new Date(chat.updated);
    const timeStr = time.toLocaleDateString() + ' ' + time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="chat-history-item-icon">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
      </div>
      <div class="chat-history-item-info">
        <div class="chat-history-item-title">${escapeHtml(chat.title)}</div>
        <div class="chat-history-item-time">${timeStr}</div>
      </div>
      <button class="chat-history-item-delete" data-chat-id="${chat.id}" title="Delete">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M6 18L18 6"/></svg>
      </button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.chat-history-item-delete')) return;
      switchToChat(chat.id);
    });

    const delBtn = item.querySelector('.chat-history-item-delete');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(chat.id);
    });

    list.appendChild(item);
  });

  loadDeepSeekChats(list, gen);
  loadGeminiChats(list, gen);
}

async function loadDeepSeekChats(list, gen) {
  try {
    const res = await fetch('/api/deepseek/chats');
    if (!res.ok || gen !== _chatHistoryGeneration) return;
    const data = await res.json();
    const dsChats = data.chats || [];
    if (dsChats.length === 0 || gen !== _chatHistoryGeneration) return;

    const section = document.createElement('div');
    section.className = 'chat-history-section-title';
    section.textContent = 'DeepSeek Chats';
    section.style.cssText = 'font-size:10px;color:#666;padding:4px 10px;margin-top:8px;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #222;padding-top:8px;';
    list.appendChild(section);

    dsChats.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'chat-history-item';
      item.innerHTML = `
        <div class="chat-history-item-icon" style="color:#4d6bfe;">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg>
        </div>
        <div class="chat-history-item-info">
          <div class="chat-history-item-title">${escapeHtml(chat.title)}</div>
          <div class="chat-history-item-time" style="color:#4d6bfe;">DeepSeek</div>
        </div>
      `;

      item.addEventListener('click', () => openDeepSeekChat(chat.url));
      list.appendChild(item);
    });
  } catch (err) {
    console.warn('[Forge] Failed to load DeepSeek chats:', err.message);
  }
}

async function openDeepSeekChat(chatUrl) {
  showToast('Opening DeepSeek chat...', 'info');
  dom.chatMessages.innerHTML = '<div style="text-align:center;padding:20px;color:#666;">Loading DeepSeek chat...</div>';
  const historyPanel = document.getElementById('chatHistoryPanel');
  if (historyPanel) historyPanel.style.display = 'none';

  try {
    const res = await fetch('/api/deepseek/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: chatUrl }),
    });
    const data = await res.json();
    if (!data.success) throw new Error('Failed to navigate');

    await new Promise(r => setTimeout(r, 1000));

    const msgRes = await fetch('/api/deepseek/messages');
    const msgData = await msgRes.json();
    const messages = msgData.messages || [];

    dom.chatMessages.innerHTML = '';
    if (messages.length === 0) {
      dom.chatMessages.innerHTML = '<div style="text-align:center;padding:20px;color:#666;">No messages found in this chat.</div>';
      return;
    }

    messages.forEach(msg => {
      const card = document.createElement('div');
      card.className = `chat-msg msg-${msg.role}`;
      const contentHtml = msg.role === 'assistant'
        ? `<div class="msg-bubble markdown-body">${renderMarkdown(msg.text)}</div>`
        : `<div class="msg-bubble">${escapeHtml(msg.text)}</div>`;
      card.innerHTML = `
        ${contentHtml}
        <div class="msg-meta">${msg.role === 'assistant' ? 'DeepSeek · ' : 'You · '}${new Date().toLocaleTimeString()}</div>
      `;
      dom.chatMessages.appendChild(card);
    });
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  } catch (err) {
    dom.chatMessages.innerHTML = `<div style="text-align:center;padding:20px;color:#f44;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadGeminiChats(list, gen) {
  try {
    const res = await fetch('/api/gemini/chats');
    if (!res.ok || gen !== _chatHistoryGeneration) return;
    const data = await res.json();
    const gmChats = data.chats || [];
    if (gmChats.length === 0 || gen !== _chatHistoryGeneration) return;

    const section = document.createElement('div');
    section.className = 'chat-history-section-title';
    section.textContent = 'Gemini Chats';
    section.style.cssText = 'font-size:10px;color:#666;padding:4px 10px;margin-top:8px;text-transform:uppercase;letter-spacing:0.5px;border-top:1px solid #222;padding-top:8px;';
    list.appendChild(section);

    gmChats.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'chat-history-item';
      item.innerHTML = `
        <div class="chat-history-item-icon" style="color:#1a73e8;">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </div>
        <div class="chat-history-item-info">
          <div class="chat-history-item-title">${escapeHtml(chat.title)}</div>
          <div class="chat-history-item-time" style="color:#1a73e8;">Gemini</div>
        </div>
      `;

      item.addEventListener('click', () => openGeminiChat(chat.url));
      list.appendChild(item);
    });
  } catch (err) {
    console.warn('[Forge] Failed to load Gemini chats:', err.message);
  }
}

async function openGeminiChat(chatUrl) {
  showToast('Opening Gemini chat...', 'info');
  dom.chatMessages.innerHTML = '<div style="text-align:center;padding:20px;color:#666;">Loading Gemini chat...</div>';
  const historyPanel = document.getElementById('chatHistoryPanel');
  if (historyPanel) historyPanel.style.display = 'none';

  try {
    const res = await fetch('/api/gemini/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: chatUrl }),
    });
    const data = await res.json();
    if (!data.success) throw new Error('Failed to navigate');

    await new Promise(r => setTimeout(r, 1000));

    const msgRes = await fetch('/api/gemini/messages');
    const msgData = await msgRes.json();
    const messages = msgData.messages || [];

    dom.chatMessages.innerHTML = '';
    if (messages.length === 0) {
      dom.chatMessages.innerHTML = '<div style="text-align:center;padding:20px;color:#666;">No messages found in this chat.</div>';
      return;
    }

    messages.forEach(msg => {
      const card = document.createElement('div');
      card.className = `chat-msg msg-${msg.role}`;
      const contentHtml = msg.role === 'assistant'
        ? `<div class="msg-bubble markdown-body">${renderMarkdown(msg.text)}</div>`
        : `<div class="msg-bubble">${escapeHtml(msg.text)}</div>`;
      card.innerHTML = `
        ${contentHtml}
        <div class="msg-meta">${msg.role === 'assistant' ? 'Gemini · ' : 'You · '}${new Date().toLocaleTimeString()}</div>
      `;
      dom.chatMessages.appendChild(card);
    });
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  } catch (err) {
    dom.chatMessages.innerHTML = `<div style="text-align:center;padding:20px;color:#f44;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderChatMessages() {
  const id = getActiveChatId();
  if (!id) return;
  const chats = loadAllChats();
  const chat = chats[id];
  if (!chat) return;

  dom.chatMessages.innerHTML = '';

  if (chat.messages.length === 0) {
    return;
  }

  chat.messages.forEach(msg => {
    const cleanText = (msg.text || '').replace(/TASK_COMPLETE/g, '').trim();
    if (!cleanText) return;
    const card = document.createElement('div');
    card.className = `chat-msg msg-${msg.role}`;
    const contentHtml = msg.role === 'assistant'
      ? `<div class="msg-bubble markdown-body">${renderMarkdown(cleanText)}</div>`
      : `<div class="msg-bubble">${escapeHtml(cleanText)}</div>`;
    card.innerHTML = `
      ${contentHtml}
      <div class="msg-meta">${msg.role === 'assistant' ? 'Assistant · ' : ''}${new Date(msg.time).toLocaleTimeString()}</div>
    `;
    dom.chatMessages.appendChild(card);
  });

  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// ══════════════════════════════════════════════════════════════════════════════
// TUTORIAL — shown on first launch
// ══════════════════════════════════════════════════════════════════════════════
function initTutorial() {
  const overlay = document.getElementById('tutorialOverlay');
  const nextBtn = document.getElementById('tutorialNextBtn');
  const skipBtn = document.getElementById('tutorialSkipBtn');
  const dots = document.querySelectorAll('#tutorialDots .tutorial-dot');
  const steps = document.querySelectorAll('.tutorial-step');

  if (!overlay) return;

  // Check if browser setup tutorial was already completed
  const browserSetup = localStorage.getItem('forge-browser-setup');
  if (browserSetup) {
    overlay.style.display = 'none';
    return;
  }

  overlay.style.display = 'flex';
  let current = 0;

  function showStep(idx) {
    steps.forEach((s, i) => s.classList.toggle('is-active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    nextBtn.textContent = idx === steps.length - 1 ? 'Get Started' : 'Next';
    current = idx;
  }

  nextBtn.addEventListener('click', () => {
    if (current < steps.length - 1) {
      showStep(current + 1);
    } else {
      closeTutorial();
    }
  });

  skipBtn.addEventListener('click', closeTutorial);

  function closeTutorial() {
    localStorage.setItem('forge-browser-setup', '1');
    localStorage.setItem('astra-tutorial-seen', '1');
    fetch('/api/browser-auth', { method: 'POST' }).catch(() => {});
    overlay.style.animation = 'welcomeFadeIn 0.25s ease reverse';
    setTimeout(() => { overlay.style.display = 'none'; }, 230);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// WELCOME SCREEN
// ══════════════════════════════════════════════════════════════════════════════
function initWelcomeScreen() {
  const overlay = document.getElementById('welcomeOverlay');
  const closeBtn = document.getElementById('welcomeCloseBtn');
  const enterBtn = document.getElementById('welcomeEnter');
  const openFolderBtn = document.getElementById('welcomeOpenFolder');
  const settingsBtn = document.getElementById('welcomeSettings');
  const starsContainer = document.getElementById('welcomeStars');

  if (!overlay) return;

  // Generate star particles
  if (starsContainer) {
    const colors = ['#fdba74', '#38bdf8', '#fb923c', '#fed7aa'];
    for (let i = 0; i < 24; i++) {
      const star = document.createElement('div');
      star.className = 'welcome-star';
      star.style.top = `${(i * 37) % 100}%`;
      star.style.left = `${(i * 49) % 100}%`;
      const size = (i % 3) + 2;
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.background = colors[i % colors.length];
      star.style.boxShadow = `0 0 8px ${colors[i % colors.length]}`;
      star.style.animationDuration = `${2 + (i % 3)}s`;
      star.style.animationDelay = `${(i % 5) * 0.4}s`;
      starsContainer.appendChild(star);
    }
  }

  const hideWelcome = () => {
    overlay.style.animation = 'welcomeFadeIn 0.3s ease reverse';
    setTimeout(() => { overlay.style.display = 'none'; }, 280);
  };

  closeBtn.addEventListener('click', hideWelcome);
  enterBtn.addEventListener('click', hideWelcome);
  openFolderBtn.addEventListener('click', () => {
    hideWelcome();
    document.getElementById('btnOpenFolder')?.click();
  });
  settingsBtn.addEventListener('click', () => {
    hideWelcome();
    document.getElementById('settingsOverlay').style.display = 'flex';
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// MUSIC PLAYER — uses astramusic.wav
// ══════════════════════════════════════════════════════════════════════════════
let musicAudio = null;
let musicPlaying = false;

function initMusicPlayer() {
  const btn = document.getElementById('musicToggleBtn');
  const text = document.getElementById('musicToggleText');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (musicPlaying) {
      stopMusic();
      btn.classList.remove('is-playing');
      if (text) text.textContent = 'Music';
    } else {
      startMusic();
      btn.classList.add('is-playing');
      if (text) text.textContent = 'Playing';
    }
  });
}

function startMusic() {
  if (!musicAudio) {
    musicAudio = new Audio('/astramusic.wav');
    musicAudio.loop = true;
    musicAudio.volume = 0.3;
  }
  musicAudio.play().catch(() => {});
  musicPlaying = true;
}

function stopMusic() {
  if (musicAudio) {
    musicAudio.pause();
    musicAudio.currentTime = 0;
  }
  musicPlaying = false;
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════════════════════════════════════════════
function initSettings() {
  const overlay = document.getElementById('settingsOverlay');
  const closeBtn = document.getElementById('settingsCloseBtn');
  const cancelBtn = document.getElementById('settingsCancelBtn');
  const saveBtn = document.getElementById('settingsSaveBtn');
  const modelSelect = document.getElementById('settingsModel');
  const tabs = document.querySelectorAll('.settings-tab');
  const tabContents = document.querySelectorAll('.settings-tab-content');

  if (!overlay) return;

  const hideSettings = () => { overlay.style.display = 'none'; };
  closeBtn.addEventListener('click', hideSettings);
  cancelBtn.addEventListener('click', hideSettings);

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('is-active'));
      tab.classList.add('active');
      const target = document.getElementById('settingsTab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1));
      if (target) target.classList.add('is-active');
    });
  });

  // Load current model
  fetch('/api/workspace').then(r => r.json()).then(data => {
    if (modelSelect && data.model) modelSelect.value = data.model;
  }).catch(() => {});

  // Load saved settings from localStorage
  const saved = loadSettings();
  applySettings(saved);

  // Font size slider
  const fontSizeSlider = document.getElementById('settingsFontSize');
  const fontSizeValue = document.getElementById('fontSizeValue');
  if (fontSizeSlider) {
    fontSizeSlider.value = saved.fontSize || 14;
    if (fontSizeValue) fontSizeValue.textContent = saved.fontSize || 14;
    fontSizeSlider.addEventListener('input', () => {
      if (fontSizeValue) fontSizeValue.textContent = fontSizeSlider.value;
    });
  }

  // Tab size
  const tabSizeSelect = document.getElementById('settingsTabSize');
  if (tabSizeSelect) tabSizeSelect.value = saved.tabSize || '4';

  // Shell
  const shellSelect = document.getElementById('settingsShell');
  if (shellSelect) shellSelect.value = saved.shell || 'powershell';

  // Toggles
  setupToggle('settingsWordWrap', saved.wordWrap);
  setupToggle('settingsMinimap', saved.minimap !== false);
  setupToggle('settingsDangerPrompt', saved.dangerPrompt !== false);
  setupToggle('settingsMusicToggle', saved.music);
  setupToggle('settingsWelcomeToggle', saved.welcome !== false);
  setupToggle('settingsTutorialToggle', saved.tutorial !== false);
  setupToggle('settingsShowThinking', saved.showThinking !== false);

  // Music toggle sync
  const musicToggleBtn = document.getElementById('musicToggleBtn');
  if (musicToggleBtn) {
    const musicBtnText = document.getElementById('musicToggleText');
    musicToggleBtn.addEventListener('click', () => {
      const settingsMusic = document.getElementById('settingsMusicToggle');
      if (settingsMusic) settingsMusic.classList.toggle('is-on', musicPlaying);
    });
  }

  saveBtn.addEventListener('click', async () => {
    const newModel = modelSelect?.value;
    const settings = {
      model: newModel,
      fontSize: parseInt(fontSizeSlider?.value || '14'),
      tabSize: tabSizeSelect?.value || '4',
      shell: shellSelect?.value || 'powershell',
      wordWrap: document.getElementById('settingsWordWrap')?.classList.contains('is-on'),
      minimap: document.getElementById('settingsMinimap')?.classList.contains('is-on'),
      dangerPrompt: document.getElementById('settingsDangerPrompt')?.classList.contains('is-on'),
      music: document.getElementById('settingsMusicToggle')?.classList.contains('is-on'),
      welcome: document.getElementById('settingsWelcomeToggle')?.classList.contains('is-on'),
      tutorial: document.getElementById('settingsTutorialToggle')?.classList.contains('is-on'),
      showThinking: document.getElementById('settingsShowThinking')?.classList.contains('is-on'),
    };

    saveSettings(settings);
    applySettings(settings);

    if (newModel) {
      try {
        await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: `/model ${newModel}` }),
        });
      } catch (e) {}
    }

    hideSettings();
    showToast('Settings saved', 'success');
  });

  window.showSettingsModal = () => { overlay.style.display = 'flex'; };
}

function setupToggle(id, isOn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isOn) el.classList.add('is-on');
  else el.classList.remove('is-on');
  el.addEventListener('click', () => el.classList.toggle('is-on'));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('forge-settings') || '{}');
  } catch { return {}; }
}

function saveSettings(settings) {
  localStorage.setItem('forge-settings', JSON.stringify(settings));
}

function applySettings(s) {
  const editor = document.getElementById('editorTextarea');
  if (editor && s.fontSize) editor.style.fontSize = s.fontSize + 'px';
  const highlight = document.getElementById('editorHighlight');
  if (highlight && s.fontSize) highlight.style.fontSize = s.fontSize + 'px';
}
