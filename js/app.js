import { db, uuid, nowISO } from './db.js';
import { searchNotes } from './search.js';
import { GitHubSync, noteToMarkdown, folderDisplayPath, reconstructFromMarkdownFiles } from './github.js';
import { ShareSession } from './webrtc.js';
import {
  createEmptyDeltaJson,
  mountEditor as mountQuillEditor,
  setDelta as setQuillDelta,
  getDeltaJson as getQuillDeltaJson,
  extractPlainText as extractQuillPlainText,
  renderDeltaToHtml,
  deltaToMarkdown,
} from './quill.js';
import {
  handleTab,
  handleEnterList,
  toggleWrap,
  insertLink,
  insertCodeBlock,
  handleSmartPaste,
  handleAutoPair,
  insertLinePrefix,
  insertAtCursor,
  insertImage,
  insertTable,
  wordStats,
} from './editor-helpers.js';

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  notes: [],
  folders: [],
  view: 'all',        // all | pinned | archived | folder:<id> | tag:<tag>
  selectedNoteId: null,
  query: '',
  previewOn: false,
  skimMode: false,   // desktop toggle: note list shows full rendered previews instead of snippets
  theme: localStorage.getItem('theme') || 'system',
  palette: localStorage.getItem('palette') || 'default',
  fontSize: localStorage.getItem('fontSize') || 'medium',
  fontFamily: localStorage.getItem('fontFamily') || 'plex',
  density: localStorage.getItem('density') || 'comfortable',
  mobileTab: 'list',
};

let saveTimer = null;
let shareSession = null; // active ShareSession, host or joiner (spec §3.9)

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
async function boot() {
  applyTheme();
  applyPalette();
  applyFontSize();
  applyFontFamily();
  applyDensity();
  await requestPersistence();
  state.notes = await db.getAll('notes');
  state.folders = await db.getAll('folders');
  wireGlobalEvents();
  renderAll();
  registerServiceWorker();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
  maybeShowExportReminder();
  checkGitHubSyncStatus();
}

async function requestPersistence() {
  // NFR-08: ask the browser not to evict our IndexedDB data under storage pressure.
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch { /* non-fatal */ }
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ---------------------------------------------------------------------
// Derived data helpers
// ---------------------------------------------------------------------
function activeNotes() {
  return state.notes.filter((n) => !n.deleted);
}

// FR-60: quill notes store a Delta JSON string as `content` — search
// against its extracted plain text, not the raw JSON.
function getSearchableText(note) {
  return note.editorType === 'quill' ? extractQuillPlainText(note.content) : note.content;
}

function visibleNotes() {
  let list = activeNotes();

  if (state.view === 'pinned') list = list.filter((n) => n.pinned && !n.archived);
  else if (state.view === 'archived') list = list.filter((n) => n.archived);
  else if (state.view.startsWith('folder:')) {
    const id = state.view.slice(7);
    list = list.filter((n) => n.folderId === id && !n.archived);
  } else if (state.view.startsWith('tag:')) {
    const tag = state.view.slice(4);
    list = list.filter((n) => (n.tags || []).includes(tag) && !n.archived);
  } else {
    list = list.filter((n) => !n.archived);
  }

  let results;
  if (state.query.trim()) {
    results = searchNotes(list, state.query, getSearchableText);
  } else {
    results = list
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map((n) => ({ note: n, snippet: null }));
  }

  // Pinned float to top (except within the "archived" view).
  if (state.view !== 'archived') {
    results.sort((a, b) => (b.note.pinned === a.note.pinned ? 0 : b.note.pinned ? 1 : -1));
  }
  return results;
}

function allTags() {
  const set = new Set();
  activeNotes().forEach((n) => (n.tags || []).forEach((t) => set.add(t)));
  return [...set].sort();
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function renderAll() {
  renderCounts();
  renderFolderTree();
  renderTagCloud();
  renderNoteList();
  renderEditor();
}

function renderCounts() {
  const active = activeNotes();
  document.getElementById('count-all').textContent = active.filter((n) => !n.archived).length;
  document.getElementById('count-pinned').textContent = active.filter((n) => n.pinned && !n.archived).length;
  document.getElementById('count-archived').textContent = active.filter((n) => n.archived).length;

  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === state.view);
  });
}

function renderFolderTree() {
  const root = document.getElementById('folder-tree');
  root.innerHTML = '';
  const byParent = {};
  state.folders.forEach((f) => {
    (byParent[f.parentId || 'root'] ||= []).push(f);
  });

  function renderLevel(parentKey, depth) {
    const items = (byParent[parentKey] || []).sort((a, b) => a.name.localeCompare(b.name));
    items.forEach((folder) => {
      const row = document.createElement('div');
      row.className = 'folder-row';
      row.style.paddingLeft = depth * 12 + 'px';

      const btn = document.createElement('button');
      btn.className = 'nav-item' + (state.view === 'folder:' + folder.id ? ' active' : '');
      const count = activeNotes().filter((n) => n.folderId === folder.id && !n.archived).length;
      btn.innerHTML = `<span>${escapeHtml(folder.name)}</span><span class="nav-item__count">${count}</span>`;
      btn.addEventListener('click', () => setView('folder:' + folder.id));
      btn.addEventListener('dblclick', () => renameFolder(folder.id));

      row.appendChild(btn);
      root.appendChild(row);
      renderLevel(folder.id, depth + 1);
    });
  }
  renderLevel('root', 0);

  if (state.folders.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'field-hint';
    hint.style.padding = '0 8px';
    hint.textContent = 'No folders yet.';
    root.appendChild(hint);
  }
}

function renderTagCloud() {
  const root = document.getElementById('tag-cloud');
  const tags = allTags();
  root.innerHTML = '';
  if (tags.length === 0) {
    root.innerHTML = '<div class="field-hint" style="padding:0 8px;">No tags yet.</div>';
    return;
  }
  tags.forEach((tag) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill' + (state.view === 'tag:' + tag ? ' active' : '');
    pill.textContent = '#' + tag;
    pill.addEventListener('click', () => setView('tag:' + tag));
    root.appendChild(pill);
  });
}

function renderNoteList() {
  const results = visibleNotes();
  const label = viewLabel();
  document.getElementById('list-title').textContent = label;
  const skimTitleEl = document.getElementById('skim-list-title');
  if (skimTitleEl) skimTitleEl.textContent = label;

  renderNoteCardsInto('note-list', results, state.skimMode);
  // The dedicated mobile skim tab is only rendered while it's actually
  // visible — full-markdown rendering every note on every list refresh
  // (e.g. on each debounced autosave) isn't worth paying for when hidden.
  if (state.mobileTab === 'skim') renderNoteCardsInto('skim-list', results, true);
}

function renderNoteCardsInto(containerId, results, skim) {
  const root = document.getElementById(containerId);
  if (!root) return;
  root.innerHTML = '';

  if (results.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__title">Nothing here yet</div>
        <div class="empty-state__hint">${state.query ? 'No notes match your search.' : 'Create a note to get started.'}</div>
      </div>`;
    return;
  }

  results.forEach(({ note, snippet }) => {
    const card = document.createElement('div');
    card.className = 'note-card' + (skim ? ' note-card--skim' : '') + (note.id === state.selectedNoteId ? ' selected' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    const folder = state.folders.find((f) => f.id === note.folderId);
    const tabLabel = folder ? escapeHtml(folder.name) : 'unfiled';
    const titleHtml = `${note.pinned ? '<span class="note-card__pin">📌</span>' : ''}${escapeHtml(note.title || 'Untitled')}`;
    const tagsHtml = (note.tags || []).slice(0, 6).map((t) => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('');

    if (skim) {
      let cleanHtml;
      if (note.editorType === 'quill') {
        // Quill's syntax module bakes hljs highlighting directly into the
        // rendered HTML, so no separate highlightElement pass is needed here.
        cleanHtml = renderDeltaToHtml(note.content);
      } else {
        const rawHtml = window.marked ? window.marked.parse(note.content || '') : escapeHtml(note.content || '');
        cleanHtml = window.DOMPurify ? window.DOMPurify.sanitize(rawHtml) : rawHtml;
      }
      card.innerHTML = `
        <div class="note-card__tab">${tabLabel} · ${relativeTime(note.updatedAt)}</div>
        <div class="note-card__title">${titleHtml}</div>
        <div class="note-card__full-preview">${cleanHtml}</div>
        <div class="note-card__meta">${tagsHtml}</div>
      `;
      if (note.editorType !== 'quill' && window.hljs) {
        card.querySelectorAll('pre code').forEach((block) => window.hljs.highlightElement(block));
      }
    } else {
      const fallbackText = note.editorType === 'quill' ? extractQuillPlainText(note.content) : (note.content || '');
      card.innerHTML = `
        <div class="note-card__tab">${tabLabel} · ${relativeTime(note.updatedAt)}</div>
        <div class="note-card__title">${titleHtml}</div>
        <div class="note-card__snippet">${snippet || escapeHtml(fallbackText.slice(0, 140))}</div>
        <div class="note-card__meta">${tagsHtml}</div>
      `;
    }

    card.addEventListener('click', () => selectNote(note.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') selectNote(note.id); });
    root.appendChild(card);
  });
}

function viewLabel() {
  if (state.view === 'all') return 'All notes';
  if (state.view === 'pinned') return 'Pinned';
  if (state.view === 'archived') return 'Archived';
  if (state.view.startsWith('folder:')) {
    const f = state.folders.find((x) => x.id === state.view.slice(7));
    return f ? f.name : 'Folder';
  }
  if (state.view.startsWith('tag:')) return '#' + state.view.slice(4);
  return 'Notes';
}

// Lazily-mounted, reused Quill instance (FR-58) — mounting once and
// swapping content via setDelta() avoids re-creating the toolbar/editor
// (and its DOM listeners) every time a different Quill note is opened.
let quillInstance = null;

function ensureQuillEditor() {
  if (quillInstance) return quillInstance;
  quillInstance = mountQuillEditor(document.getElementById('quill-editor'));
  quillInstance.on('text-change', (delta, oldDelta, source) => {
    // Loading a note calls setDelta(..., 'silent') specifically so this
    // handler only fires for actual user edits — otherwise just opening
    // a Quill note would immediately re-save it and bump updatedAt.
    if (source !== 'user') return;
    const note = state.notes.find((n) => n.id === state.selectedNoteId);
    if (!note || (note.editorType || 'markdown') !== 'quill') return;
    updateSelectedNote({ content: getQuillDeltaJson(quillInstance) });
    updateMetaRow(note);
  });
  return quillInstance;
}

function renderEditor() {
  const note = state.notes.find((n) => n.id === state.selectedNoteId);
  const empty = document.getElementById('editor-empty');
  const content = document.getElementById('editor-content');

  if (!note) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'flex';

  // Notes created before dual-editor mode shipped have no editorType —
  // treat those as Markdown (that's genuinely what their content is).
  // Defensive check: if a note's content is clearly a Quill Delta (has
  // an .ops array) but editorType somehow isn't 'quill' — e.g. an older
  // note synced before this field existed, or any sync path that might
  // drop it — treat it as Quill and repair the record so this doesn't
  // recur on future renders.
  let isQuill = note.editorType === 'quill';
  if (!isQuill && looksLikeDeltaJson(note.content)) {
    isQuill = true;
    note.editorType = 'quill';
    db.put('notes', note);
  }

  document.getElementById('note-title').value = note.title || '';
  updateMetaRow(note);

  document.getElementById('btn-pin').classList.toggle('active', !!note.pinned);
  document.getElementById('btn-archive').classList.toggle('active', !!note.archived);

  renderTagRow(note);

  const textarea = document.getElementById('note-content');
  const quillContainer = document.getElementById('quill-editor');
  const contentArea = document.getElementById('content-area');
  const previewEl = document.getElementById('note-preview');
  const previewBtn = document.getElementById('btn-preview');
  const syntaxBtn = document.getElementById('btn-syntax-help');

  if (isQuill) {
    // Quill IS the rendered view — no separate Markdown-preview toggle
    // or syntax-insert panel makes sense here (Quill has its own toolbar).
    contentArea.style.display = 'none';
    previewBtn.style.display = 'none';
    syntaxBtn.style.display = 'none';
    quillContainer.style.display = 'flex';

    const quill = ensureQuillEditor();
    setQuillDelta(quill, note.content);
  } else {
    quillContainer.style.display = 'none';
    if (quillInstance) quillInstance.root.blur();
    contentArea.style.display = 'grid';
    previewBtn.style.display = '';
    syntaxBtn.style.display = '';
    textarea.style.display = 'block';
    textarea.value = note.content || '';

    previewBtn.classList.toggle('active', state.previewOn);
    renderPreview(note);
    document.getElementById('content-area').classList.toggle('split', state.previewOn);
    previewEl.style.display = state.previewOn ? 'block' : 'none';
  }
}

// Defensive detection for the self-healing check above — a Quill Delta is
// always `{ ops: [...] }`; nothing a real Markdown note would contain
// parses to that shape.
function looksLikeDeltaJson(content) {
  if (!content || content[0] !== '{') return false;
  try {
    const parsed = JSON.parse(content);
    return !!parsed && Array.isArray(parsed.ops);
  } catch {
    return false;
  }
}

function renderTagRow(note) {
  const row = document.getElementById('tag-row');
  const input = document.getElementById('tag-input');
  row.querySelectorAll('.tag-pill').forEach((el) => el.remove());
  (note.tags || []).forEach((tag) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `#${escapeHtml(tag)} <button class="tag-pill__remove" aria-label="Remove tag ${escapeHtml(tag)}">×</button>`;
    pill.querySelector('button').addEventListener('click', () => removeTag(note.id, tag));
    row.insertBefore(pill, input);
  });
}

function updateMetaRow(note) {
  const isQuill = (note.editorType || 'markdown') === 'quill';
  const textForStats = isQuill ? extractQuillPlainText(note.content) : note.content;
  const stats = wordStats(textForStats);
  const parts = [
    `created ${formatDate(note.createdAt)}`,
    `updated ${formatDate(note.updatedAt)}`,
  ];
  if (note.githubSha) parts.push('synced');
  if (stats.words > 0) parts.push(`${stats.words} word${stats.words === 1 ? '' : 's'}`, `${stats.minutes} min read`);
  document.getElementById('note-meta').textContent = parts.join(' · ');
}

function renderPreview(note) {
  const el = document.getElementById('note-preview');
  if (!state.previewOn) return;
  if (window.marked) {
    const rawHtml = window.marked.parse(note.content || '');
    // Sanitize before inserting — note content can come from typing,
    // JSON import, or a pulled GitHub repo, none of which are trusted.
    const cleanHtml = window.DOMPurify ? window.DOMPurify.sanitize(rawHtml) : rawHtml;
    el.innerHTML = cleanHtml;
    if (window.hljs) {
      el.querySelectorAll('pre code').forEach((block) => window.hljs.highlightElement(block));
    }
    renderTableOfContents(el);
  } else {
    el.textContent = note.content || '';
  }
}

// Auto-generated TOC for long notes (3+ headings) — collapsible, click to
// smooth-scroll to that section within the preview.
function renderTableOfContents(previewEl) {
  const headings = previewEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length < 3) return;

  const seen = new Set();
  const items = [];
  headings.forEach((h) => {
    const base = slugifyHeading(h.textContent) || 'section';
    let slug = base;
    let i = 2;
    while (seen.has(slug)) slug = `${base}-${i++}`;
    seen.add(slug);
    h.id = slug;
    items.push({ level: parseInt(h.tagName[1], 10), text: h.textContent, id: slug });
  });

  const minLevel = Math.min(...items.map((it) => it.level));
  const toc = document.createElement('details');
  toc.className = 'toc';
  toc.open = true;
  toc.innerHTML = `
    <summary class="toc__summary">Contents</summary>
    <nav class="toc__list">
      ${items.map((it) => `<a class="toc__item toc__item--l${Math.min(5, it.level - minLevel)}" href="#${it.id}">${escapeHtml(it.text)}</a>`).join('')}
    </nav>
  `;
  toc.querySelectorAll('.toc__item').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = previewEl.querySelector('#' + CSS.escape(a.getAttribute('href').slice(1)));
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  previewEl.insertBefore(toc, previewEl.firstChild);
}

function slugifyHeading(text) {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------
function setView(view) {
  state.view = view;
  renderAll();
}

async function selectNote(id) {
  state.selectedNoteId = id;
  state.mobileTab = 'editor';
  applyMobileTab();
  renderAll();
}

async function createNote(editorType = 'quill') {
  const folderId = state.view.startsWith('folder:') ? state.view.slice(7) : null;
  const note = {
    id: uuid(),
    title: '',
    editorType,
    content: editorType === 'quill' ? createEmptyDeltaJson() : '',
    folderId,
    tags: state.view.startsWith('tag:') ? [state.view.slice(4)] : [],
    pinned: false,
    archived: false,
    deleted: false,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  state.notes.unshift(note);
  await db.put('notes', note);
  state.selectedNoteId = note.id;
  state.mobileTab = 'editor';
  applyMobileTab();
  renderAll();
  requestAnimationFrame(() => document.getElementById('note-title').focus());
}

function scheduleSave(note) {
  clearTimeout(saveTimer);
  const label = document.getElementById('autosave-label');
  label.textContent = 'Saving…';
  saveTimer = setTimeout(async () => {
    note.updatedAt = nowISO();
    await db.put('notes', note);
    label.textContent = 'Saved';
    renderNoteList();
    setTimeout(() => { if (label.textContent === 'Saved') label.textContent = ''; }, 1500);
  }, 500);
}

function updateSelectedNote(patch) {
  const note = state.notes.find((n) => n.id === state.selectedNoteId);
  if (!note) return;
  Object.assign(note, patch);
  scheduleSave(note);
}

async function togglePin() {
  const note = state.notes.find((n) => n.id === state.selectedNoteId);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updatedAt = nowISO();
  await db.put('notes', note);
  renderAll();
}

async function toggleArchive() {
  const note = state.notes.find((n) => n.id === state.selectedNoteId);
  if (!note) return;
  note.archived = !note.archived;
  note.updatedAt = nowISO();
  await db.put('notes', note);
  toast(note.archived ? 'Note archived' : 'Note restored');
  renderAll();
}

async function deleteNote() {
  const note = state.notes.find((n) => n.id === state.selectedNoteId);
  if (!note) return;
  if (!confirm('Delete this note? This can\'t be undone from the app.')) return;
  note.deleted = true;
  note.updatedAt = nowISO();
  await db.put('notes', note);
  state.selectedNoteId = null;
  toast('Note deleted');
  renderAll();
}

function addTag(noteId, tag) {
  tag = tag.trim().toLowerCase();
  if (!tag) return;
  const note = state.notes.find((n) => n.id === noteId);
  if (!note.tags) note.tags = [];
  if (!note.tags.includes(tag)) note.tags.push(tag);
  scheduleSave(note);
  renderAll();
}

function removeTag(noteId, tag) {
  const note = state.notes.find((n) => n.id === noteId);
  note.tags = (note.tags || []).filter((t) => t !== tag);
  scheduleSave(note);
  renderAll();
}

async function addFolder() {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;
  const folder = { id: uuid(), name: name.trim(), parentId: null, createdAt: nowISO(), updatedAt: nowISO() };
  state.folders.push(folder);
  await db.put('folders', folder);
  renderAll();
}

async function renameFolder(id) {
  const folder = state.folders.find((f) => f.id === id);
  const name = prompt('Rename folder:', folder.name);
  if (!name || !name.trim()) return;
  folder.name = name.trim();
  folder.updatedAt = nowISO();
  await db.put('folders', folder);
  renderAll();
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------
let searchDebounce = null;
function onSearchInput(e) {
  clearTimeout(searchDebounce);
  const val = e.target.value;
  searchDebounce = setTimeout(() => {
    state.query = val;
    renderNoteList();
  }, 150);
}

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
const PALETTES = [
  { id: 'default', label: 'Ledger', accent: '#96691c', accent2: '#3f6659', tag: '#a2543c' },
  { id: 'slate', label: 'Slate', accent: '#3d5a80', accent2: '#6b7f95', tag: '#7d6b91' },
  { id: 'forest', label: 'Forest', accent: '#56773f', accent2: '#3f6b5e', tag: '#8a6a3d' },
  { id: 'rosewood', label: 'Rosewood', accent: '#9c4a4a', accent2: '#6f5a68', tag: '#b1663f' },
  { id: 'ink', label: 'Ink & Paper', accent: '#111111', accent2: '#555555', tag: '#333333' },
];

const FONT_SIZES = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
  { id: 'xlarge', label: 'X-Large' },
];

function applyTheme() {
  let resolved = state.theme;
  if (resolved === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.body.setAttribute('data-theme', resolved);
  updateThemeLabel();
}

function applyPalette() {
  document.body.setAttribute('data-palette', state.palette);
  updateThemeLabel();
}

function applyFontSize() {
  document.body.setAttribute('data-font-size', state.fontSize);
  updateThemeLabel();
}

const FONT_FAMILIES = [
  { id: 'plex', label: 'IBM Plex Sans', body: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif", display: "'Fraunces', Georgia, serif" },
  { id: 'system', label: 'System Sans', body: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', display: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'serif', label: 'Georgia Serif', body: 'Georgia, "Times New Roman", serif', display: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'IBM Plex Mono', body: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace", display: "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace" },
];
function applyFontFamily() {
  const font = FONT_FAMILIES.find((f) => f.id === state.fontFamily) || FONT_FAMILIES[0];
  document.body.setAttribute('data-font-family', font.id);
  document.body.style.setProperty('--font-body', font.body);
  document.body.style.setProperty('--font-display', font.display);
}
function applyDensity() {
  document.body.setAttribute('data-density', state.density);
}

function updateThemeLabel() {
  const modeLabel = { system: 'System', light: 'Light', dark: 'Dark' }[state.theme];
  const paletteLabel = (PALETTES.find((p) => p.id === state.palette) || PALETTES[0]).label;
  const el = document.getElementById('theme-label');
  if (el) el.textContent = `${paletteLabel} · ${modeLabel}`;
}

function openThemeModal() {
  renderModal(`
    <div class="modal__header">
      <span class="modal__title">Theme</span>
      <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal__body">
      <div class="field-hint" style="margin-bottom:8px;">Appearance</div>
      <div class="mode-toggle" style="margin-bottom:20px;">
        <label><input type="radio" name="theme-mode" value="system" ${state.theme === 'system' ? 'checked' : ''}/> System</label>
        <label><input type="radio" name="theme-mode" value="light" ${state.theme === 'light' ? 'checked' : ''}/> Light</label>
        <label><input type="radio" name="theme-mode" value="dark" ${state.theme === 'dark' ? 'checked' : ''}/> Dark</label>
      </div>
      <div class="field-hint" style="margin-bottom:8px;">Text size</div>
      <div class="mode-toggle" style="margin-bottom:20px;">
        ${FONT_SIZES.map((f) => `<label><input type="radio" name="font-size" value="${f.id}" ${state.fontSize === f.id ? 'checked' : ''}/> ${escapeHtml(f.label)}</label>`).join('')}
      </div>
      <div class="field-hint" style="margin-bottom:8px;">Overall font</div>
      <div class="mode-toggle" style="margin-bottom:20px;">
        ${FONT_FAMILIES.map((f) => `<label><input type="radio" name="font-family" value="${f.id}" ${state.fontFamily === f.id ? 'checked' : ''}/> ${escapeHtml(f.label)}</label>`).join('')}
      </div>
      <div class="field-hint" style="margin-bottom:8px;">Interface density</div>
      <div class="mode-toggle" style="margin-bottom:20px;">
        <label><input type="radio" name="density" value="comfortable" ${state.density === 'comfortable' ? 'checked' : ''}/> Comfortable</label>
        <label><input type="radio" name="density" value="compact" ${state.density === 'compact' ? 'checked' : ''}/> Compact</label>
      </div>
      <div class="field-hint" style="margin-bottom:8px;">Palette</div>
      <div class="palette-grid">
        ${PALETTES.map((p) => `
          <button class="palette-swatch${state.palette === p.id ? ' active' : ''}" data-palette="${p.id}" type="button">
            <span class="palette-swatch__dots">
              <span style="background:${p.accent}"></span><span style="background:${p.accent2}"></span><span style="background:${p.tag}"></span>
            </span>
            <span class="palette-swatch__label">${escapeHtml(p.label)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `);

  document.getElementById('modal-close').addEventListener('click', closeModal);

  document.querySelectorAll('input[name="theme-mode"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      state.theme = e.target.value;
      localStorage.setItem('theme', state.theme);
      applyTheme();
    });
  });

  document.querySelectorAll('input[name="font-size"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      state.fontSize = e.target.value;
      localStorage.setItem('fontSize', state.fontSize);
      applyFontSize();
    });
  });

  document.querySelectorAll('input[name="font-family"]').forEach((r) => {
    r.addEventListener('change', (e) => { state.fontFamily = e.target.value; localStorage.setItem('fontFamily', state.fontFamily); applyFontFamily(); });
  });
  document.querySelectorAll('input[name="density"]').forEach((r) => {
    r.addEventListener('change', (e) => { state.density = e.target.value; localStorage.setItem('density', state.density); applyDensity(); });
  });

  document.querySelectorAll('.palette-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.palette = btn.dataset.palette;
      localStorage.setItem('palette', state.palette);
      applyPalette();
      document.querySelectorAll('.palette-swatch').forEach((b) => b.classList.toggle('active', b.dataset.palette === state.palette));
    });
  });
}

// ---------------------------------------------------------------------
// Online status
// ---------------------------------------------------------------------
function updateOnlineStatus() {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  if (navigator.onLine) {
    dot.className = 'status-dot online';
    label.textContent = 'Online';
  } else {
    dot.className = 'status-dot offline';
    label.textContent = 'Offline — working locally';
  }
}

// ---------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------
function exportJSON() {
  const payload = {
    exportedAt: nowISO(),
    notes: state.notes.filter((n) => !n.deleted),
    folders: state.folders,
  };
  downloadFile(`notes-export-${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  db.setMeta('lastExportAt', nowISO());
  toast('Exported notes as JSON');
}

function exportSingleNote() {
  const note = state.notes.find((n) => n.id === state.selectedNoteId);
  if (!note) return;
  const exportNote = note.editorType === 'quill' ? { ...note, content: deltaToMarkdown(note.content) } : note;
  downloadFile(`${sanitizeFileName(note.title || 'untitled')}.md`, noteToMarkdown(exportNote, state.folders), 'text/markdown');
}

function downloadFile(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function importJSONFile(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const notes = payload.notes || [];
    const folders = payload.folders || [];
    await db.bulkPut('folders', folders);
    await db.bulkPut('notes', notes);
    state.notes = await db.getAll('notes');
    state.folders = await db.getAll('folders');
    renderAll();
    toast(`Imported ${notes.length} note(s)`);
  } catch (err) {
    toast('Import failed: ' + err.message, true);
  }
}

function sanitizeFileName(name) {
  return (name || 'untitled').replace(/[/\\:*?"<>|]/g, '-').trim() || 'untitled';
}

function folderZipPath(folders, folderId) {
  const parts = [];
  let current = folderId ? folders.find((f) => f.id === folderId) : null;
  while (current) {
    parts.unshift(sanitizeFileName(current.name));
    current = current.parentId ? folders.find((f) => f.id === current.parentId) : null;
  }
  return parts.join('/');
}

async function exportMarkdownZip() {
  if (!window.JSZip) { toast('ZIP library failed to load — check your connection and try again.', true); return; }
  const zip = new window.JSZip();
  const notes = activeNotes();
  const usedPaths = new Set();

  notes.forEach((note) => {
    const dir = folderZipPath(state.folders, note.folderId);
    const base = sanitizeFileName(note.title || 'untitled');
    let filename = `${base}.md`;
    let fullPath = dir ? `${dir}/${filename}` : filename;
    let i = 2;
    while (usedPaths.has(fullPath)) {
      filename = `${base}-${i++}.md`;
      fullPath = dir ? `${dir}/${filename}` : filename;
    }
    usedPaths.add(fullPath);
    const exportNote = note.editorType === 'quill' ? { ...note, content: deltaToMarkdown(note.content) } : note;
    zip.file(fullPath, noteToMarkdown(exportNote, state.folders));
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadFile(`notes-export-${dateStamp()}.zip`, blob);
  db.setMeta('lastExportAt', nowISO());
  toast(`Exported ${notes.length} note(s) as Markdown ZIP`);
}

async function importMarkdownZip(file) {
  if (!window.JSZip) { toast('ZIP library failed to load — check your connection and try again.', true); return; }
  try {
    const zip = await window.JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.md'));
    const fileInputs = [];
    for (const entry of entries) {
      const raw = await entry.async('string');
      const parts = entry.name.split('/').filter(Boolean);
      const filename = parts.pop();
      fileInputs.push({ relDir: parts, filename, raw });
    }

    // Additive import (like JSON import), not a reset — only the GitHub
    // "Pull & reset" flow replaces local data wholesale.
    const { notes: importedNotes, folders: importedFolders } = reconstructFromMarkdownFiles(fileInputs);
    await db.bulkPut('folders', importedFolders);
    const toSave = importedNotes.map((n) => ({
      id: uuid(),
      title: n.title,
      editorType: n.editorType || 'markdown',
      content: n.content,
      folderId: n.folderId,
      tags: n.tags,
      pinned: n.pinned,
      archived: false,
      deleted: false,
      createdAt: n.createdAt || nowISO(),
      updatedAt: n.updatedAt || nowISO(),
    }));
    await db.bulkPut('notes', toSave);
    state.notes = await db.getAll('notes');
    state.folders = await db.getAll('folders');
    renderAll();
    toast(`Imported ${toSave.length} note(s) into ${importedFolders.length} folder(s)`);
  } catch (err) {
    toast('ZIP import failed: ' + err.message, true);
  }
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function maybeShowExportReminder() {
  // NFR-08: nudge export/sync once note count or time-since-export crosses a threshold.
  const lastExport = await db.getMeta('lastExportAt');
  const count = activeNotes().length;
  const daysSince = lastExport ? (Date.now() - new Date(lastExport)) / 86400000 : Infinity;
  if (count >= 25 && daysSince > 7) {
    toast('It\'s been a while — consider exporting a backup or syncing to GitHub.');
  }
}

// ---------------------------------------------------------------------
// GitHub push/pull — shared logic used by both the modal and the
// homepage sync banner, so there's one code path either way.
// ---------------------------------------------------------------------
function getSavedGitHubConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('githubConfig') || '{}');
    return cfg.token && cfg.owner && cfg.repo ? cfg : null;
  } catch {
    return null;
  }
}

// A sync "baseline" records what local and remote looked like the last
// time this browser actually synced with this specific repo — scoped by
// owner/repo/basePath so switching to a different repo doesn't carry a
// stale baseline over. Without this, the only thing to compare on load
// would be each note's own `updated:` time against the *commit* time
// that saved it — two different clocks that are structurally never
// equal, which made the banner claim GitHub was newer right after a
// clean pull.
function getSyncMeta(cfg) {
  try {
    const meta = JSON.parse(localStorage.getItem('githubSyncMeta') || '{}');
    if (meta.owner === cfg.owner && meta.repo === cfg.repo && meta.basePath === cfg.basePath) return meta;
  } catch { /* fall through to empty baseline */ }
  return {};
}

function setSyncMeta(cfg, partial) {
  localStorage.setItem('githubSyncMeta', JSON.stringify({
    owner: cfg.owner,
    repo: cfg.repo,
    basePath: cfg.basePath,
    ...partial,
  }));
}

async function pushToGitHub(cfg) {
  try {
    const sync = new GitHubSync(cfg);
    const notes = activeNotes();
    // Every path (both the note file itself AND, for Quill notes, its
    // notes-html/*.html snapshot) this client has ever seen for this
    // repo — including for notes since soft-deleted — so the push can
    // also delete stale files instead of only ever adding/updating.
    const allKnownNotes = await db.getAll('notes');
    const previousPaths = new Set();
    allKnownNotes.forEach((n) => {
      if (n.githubPath) previousPaths.add(n.githubPath);
      if (n.githubHtmlPath) previousPaths.add(n.githubHtmlPath);
    });

    const result = await sync.saveNotes(notes, state.folders, {
      previousPaths,
      renderQuillHtml: (note) => renderDeltaToHtml(note.content),
    });
    await db.bulkPut('notes', notes);

    const deletedNotes = allKnownNotes.filter((n) => n.deleted && n.githubPath && !notes.some((x) => x.id === n.id));
    for (const dn of deletedNotes) await db.delete('notes', dn.id);
    state.notes = await db.getAll('notes');
    renderAll();

    setSyncMeta(cfg, { lastSyncedAt: nowISO(), lastSyncedRemoteAt: result.commitDate });

    const htmlNote = result.htmlSnapshotsWritten ? `, wrote ${result.htmlSnapshotsWritten} HTML snapshot(s)` : '';
    return {
      ok: true,
      message: `Pushed ${result.notesUpdated} note(s)${result.notesDeleted ? `, removed ${result.notesDeleted} stale file(s)` : ''}${htmlNote}.`,
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function pullAndResetFromGitHub(cfg) {
  try {
    const sync = new GitHubSync(cfg);
    const { notes: remoteNotes, folders: remoteFolders } = await sync.pullNotes();
    const toSave = remoteNotes.map((rn) => ({
      id: uuid(),
      title: rn.title,
      editorType: rn.editorType || 'markdown',
      content: rn.content,
      folderId: rn.folderId,
      tags: rn.tags,
      pinned: rn.pinned,
      archived: false,
      deleted: false,
      createdAt: rn.createdAt || nowISO(),
      updatedAt: rn.updatedAt || nowISO(),
      githubPath: rn.githubPath,
      githubSha: rn.githubSha,
    }));

    // Full reset, not a merge/append — notes AND folders are replaced
    // wholesale by what's in the repo, so repeated pulls are idempotent
    // and folder assignment survives the round trip.
    await db.clear('notes');
    await db.clear('folders');
    await db.bulkPut('folders', remoteFolders);
    await db.bulkPut('notes', toSave);
    state.notes = await db.getAll('notes');
    state.folders = await db.getAll('folders');
    state.selectedNoteId = null;
    renderAll();

    let remoteAt = null;
    try { remoteAt = await sync.getLatestRemoteChangeTime(); } catch { /* non-fatal, fall back below */ }
    setSyncMeta(cfg, { lastSyncedAt: nowISO(), lastSyncedRemoteAt: remoteAt || nowISO() });

    return {
      ok: true,
      message: `Pulled ${toSave.length} note(s) into ${remoteFolders.length} folder(s). Local notes and folders were reset to match the repo.`,
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function localLatestUpdatedAt() {
  const list = activeNotes();
  if (list.length === 0) return null;
  return list.reduce((max, n) => (new Date(n.updatedAt) > new Date(max) ? n.updatedAt : max), list[0].updatedAt);
}

// ---------------------------------------------------------------------
// Homepage sync-status banner — checked once, automatically, on load.
// ---------------------------------------------------------------------
async function checkGitHubSyncStatus() {
  const cfg = getSavedGitHubConfig();
  if (!cfg) return; // no PAT configured yet — nothing to check
  try {
    const sync = new GitHubSync(cfg);
    const remoteLatest = await sync.getLatestRemoteChangeTime();
    const localLatest = localLatestUpdatedAt();
    const meta = getSyncMeta(cfg);
    showSyncBannerIfNeeded(localLatest, remoteLatest, meta);
  } catch {
    // Silent — a bad token, offline state, or rate limit shouldn't block
    // the homepage. The GitHub sync modal will surface real errors when
    // the person actually tries to use it.
  }
}

function showSyncBannerIfNeeded(localLatest, remoteLatest, meta) {
  const banner = document.getElementById('sync-banner');
  const text = document.getElementById('sync-banner-text');
  const TOLERANCE_MS = 3000; // avoid false positives from clock/rounding noise

  const localMs = localLatest ? new Date(localLatest).getTime() : 0;
  const remoteMs = remoteLatest ? new Date(remoteLatest).getTime() : 0;

  // No baseline yet for this repo (never synced from this browser) — fall
  // back to a coarse direct comparison, since there's nothing better to
  // compare against.
  if (!meta.lastSyncedAt && !meta.lastSyncedRemoteAt) {
    if (!localLatest && !remoteLatest) { banner.style.display = 'none'; return; }
    if (Math.abs(localMs - remoteMs) <= TOLERANCE_MS) { banner.style.display = 'none'; return; }

    let message, suggested;
    if (!remoteLatest) { message = 'These notes haven\u2019t been pushed to GitHub yet.'; suggested = 'push'; }
    else if (!localLatest) { message = 'GitHub has notes that aren\u2019t on this device.'; suggested = 'pull'; }
    else if (localMs > remoteMs) { message = `Local notes are newer than GitHub (updated ${relativeTime(localLatest)}).`; suggested = 'push'; }
    else { message = `GitHub has newer changes than this device (updated ${relativeTime(remoteLatest)}).`; suggested = 'pull'; }

    text.textContent = message;
    banner.style.display = 'flex';
    document.getElementById('sync-banner-push').classList.toggle('btn-primary', suggested === 'push');
    document.getElementById('sync-banner-pull').classList.toggle('btn-primary', suggested === 'pull');
    return;
  }

  // Normal case: compare each side against its own baseline from the last
  // sync, not against each other. "Did GitHub change since I last synced"
  // and "did I edit locally since I last synced" are independent
  // questions, each with its own clock.
  const lastSyncedAtMs = meta.lastSyncedAt ? new Date(meta.lastSyncedAt).getTime() : 0;
  const lastSyncedRemoteMs = meta.lastSyncedRemoteAt ? new Date(meta.lastSyncedRemoteAt).getTime() : 0;

  const remoteChanged = remoteLatest && (remoteMs - lastSyncedRemoteMs > TOLERANCE_MS);
  const localChanged = localLatest && (localMs - lastSyncedAtMs > TOLERANCE_MS);

  if (!remoteChanged && !localChanged) {
    banner.style.display = 'none';
    return;
  }

  let message, suggested;
  if (localChanged && remoteChanged) {
    message = 'Both this device and GitHub have changed since your last sync.';
    suggested = null;
  } else if (localChanged) {
    message = `Local notes have changed since your last sync (updated ${relativeTime(localLatest)}).`;
    suggested = 'push';
  } else {
    message = `GitHub has changed since your last sync (updated ${relativeTime(remoteLatest)}).`;
    suggested = 'pull';
  }

  text.textContent = message;
  banner.style.display = 'flex';
  document.getElementById('sync-banner-push').classList.toggle('btn-primary', suggested === 'push');
  document.getElementById('sync-banner-pull').classList.toggle('btn-primary', suggested === 'pull');
}

function hideSyncBanner() {
  document.getElementById('sync-banner').style.display = 'none';
}

let syncBusy = false;

function setSyncBusy(busy, operation = '') {
  syncBusy = busy;
  const buttons = [document.getElementById('sync-banner-push'), document.getElementById('sync-banner-pull'), document.getElementById('gh-save'), document.getElementById('gh-pull')].filter(Boolean);
  buttons.forEach((button) => {
    button.disabled = busy;
    button.classList.toggle('is-syncing', busy);
    if (busy) {
      button.dataset.syncLabel ||= button.textContent;
      button.innerHTML = `<span class="sync-spinner" aria-hidden="true"></span>${operation || 'Syncing…'}`;
    } else if (button.dataset.syncLabel) {
      button.textContent = button.dataset.syncLabel;
      delete button.dataset.syncLabel;
    }
  });
}

function wireSyncBanner() {
  document.getElementById('sync-banner-push').addEventListener('click', async () => {
    const cfg = getSavedGitHubConfig();
    if (!cfg || syncBusy) return;
    setSyncBusy(true, 'Pushing…');
    try { const result = await pushToGitHub(cfg); toast(result.message, !result.ok); if (result.ok) hideSyncBanner(); }
    finally { setSyncBusy(false); }
  });
  document.getElementById('sync-banner-pull').addEventListener('click', async () => {
    const cfg = getSavedGitHubConfig();
    if (!cfg || syncBusy) return;
    if (!confirm('This replaces all local notes with what’s in GitHub. Continue?')) return;
    setSyncBusy(true, 'Pulling…');
    try { const result = await pullAndResetFromGitHub(cfg); toast(result.message, !result.ok); if (result.ok) hideSyncBanner(); }
    finally { setSyncBusy(false); }
  });
  document.getElementById('sync-banner-dismiss').addEventListener('click', () => { if (!syncBusy) hideSyncBanner(); });
}

// ---------------------------------------------------------------------
// Markdown syntax reference — click an item to insert it at the cursor.
// ---------------------------------------------------------------------
const SYNTAX_GROUPS = [
  {
    group: 'Headings',
    items: [
      { action: 'h1', label: 'Heading 1', example: '# Heading' },
      { action: 'h2', label: 'Heading 2', example: '## Heading' },
      { action: 'h3', label: 'Heading 3', example: '### Heading' },
    ],
  },
  {
    group: 'Emphasis',
    items: [
      { action: 'bold', label: 'Bold', example: '**bold**' },
      { action: 'italic', label: 'Italic', example: '_italic_' },
      { action: 'strike', label: 'Strikethrough', example: '~~strike~~' },
      { action: 'code', label: 'Inline code', example: '`code`' },
    ],
  },
  {
    group: 'Lists',
    items: [
      { action: 'ul', label: 'Bullet list', example: '- item' },
      { action: 'ol', label: 'Numbered list', example: '1. item' },
      { action: 'task', label: 'Task list', example: '- [ ] item' },
    ],
  },
  {
    group: 'Blocks',
    items: [
      { action: 'quote', label: 'Blockquote', example: '> quote' },
      { action: 'codeblock', label: 'Code block', example: '```\ncode\n```' },
      { action: 'hr', label: 'Divider', example: '---' },
    ],
  },
  {
    group: 'Links & media',
    items: [
      { action: 'link', label: 'Link', example: '[text](url)' },
      { action: 'image', label: 'Image', example: '![alt](url)' },
    ],
  },
  {
    group: 'Tables',
    items: [
      { action: 'table', label: 'Table', example: '| A | B |' },
    ],
  },
];

let savedEditorSelection = null;

function openSyntaxModal() {
  const textarea = document.getElementById('note-content');
  savedEditorSelection = { start: textarea.selectionStart, end: textarea.selectionEnd };

  const groupsHtml = SYNTAX_GROUPS.map((g) => `
    <div class="syntax-group">
      <div class="syntax-group__label">${escapeHtml(g.group)}</div>
      ${g.items.map((it) => `
        <button class="syntax-item" data-action="${it.action}" type="button">
          <span class="syntax-item__label">${escapeHtml(it.label)}</span>
          <code class="syntax-item__example">${escapeHtml(it.example)}</code>
        </button>
      `).join('')}
    </div>
  `).join('');

  renderModal(`
    <div class="modal__header">
      <span class="modal__title">Markdown syntax</span>
      <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal__body">
      <div class="field-hint" style="margin-bottom:12px;">Tap any item to insert it at your cursor.</div>
      ${groupsHtml}
    </div>
  `);

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.querySelectorAll('.syntax-item').forEach((el) => {
    el.addEventListener('click', () => applySyntaxAction(el.dataset.action));
  });
}

function applySyntaxAction(action) {
  const ta = document.getElementById('note-content');
  ta.focus();
  if (savedEditorSelection) {
    ta.setSelectionRange(savedEditorSelection.start, savedEditorSelection.end);
  }

  switch (action) {
    case 'h1': insertLinePrefix(ta, '# '); break;
    case 'h2': insertLinePrefix(ta, '## '); break;
    case 'h3': insertLinePrefix(ta, '### '); break;
    case 'bold': toggleWrap(ta, '**'); break;
    case 'italic': toggleWrap(ta, '_'); break;
    case 'strike': toggleWrap(ta, '~~'); break;
    case 'code': toggleWrap(ta, '`'); break;
    case 'codeblock': insertCodeBlock(ta); break;
    case 'quote': insertLinePrefix(ta, '> '); break;
    case 'ul': insertLinePrefix(ta, '- '); break;
    case 'ol': insertLinePrefix(ta, '1. '); break;
    case 'task': insertLinePrefix(ta, '- [ ] '); break;
    case 'link': insertLink(ta); break;
    case 'image': insertImage(ta); break;
    case 'table': insertTable(ta); break;
    case 'hr': insertAtCursor(ta, '\n\n---\n\n'); break;
  }
  closeModal();
  ta.focus();
}

// ---------------------------------------------------------------------
// GitHub sync modal
// ---------------------------------------------------------------------
function openGitHubModal() {
  const saved = JSON.parse(localStorage.getItem('githubConfig') || '{}');
  renderModal(`
    <div class="modal__header">
      <span class="modal__title">GitHub sync</span>
      <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal__body">
      <div class="field-hint" style="margin-bottom:14px;">
        Uses a Fine-grained Personal Access Token scoped to one repository
        (Contents: Read &amp; Write, Metadata: Read). The token is stored only
        in this browser and sent only to api.github.com.
      </div>
      <div class="honesty-note">
        <strong>Push</strong> mirrors this device's notes into the repo —
        it also deletes files there that no longer match a local note.
        <strong>Pull</strong> replaces your local notes with whatever's in
        the repo; it will ask you to confirm since it discards anything
        local that hasn't been pushed yet.
      </div>
      <div class="field">
        <label for="gh-token">Personal Access Token</label>
        <input type="password" id="gh-token" value="${escapeHtml(saved.token || '')}" placeholder="github_pat_…" />
      </div>
      <div class="field">
        <label for="gh-owner">Repository owner</label>
        <input type="text" id="gh-owner" value="${escapeHtml(saved.owner || '')}" placeholder="your-username" />
      </div>
      <div class="field">
        <label for="gh-repo">Repository name</label>
        <input type="text" id="gh-repo" value="${escapeHtml(saved.repo || '')}" placeholder="my-notes" />
      </div>
      <div class="field">
        <label for="gh-path">Notes path</label>
        <input type="text" id="gh-path" value="${escapeHtml(saved.basePath || 'notes')}" placeholder="notes" />
      </div>
      <div class="github-repo-link" id="gh-repo-link">
        ${saved.token && saved.owner && saved.repo
          ? `<a href="https://github.com/${encodeURIComponent(saved.owner)}/${encodeURIComponent(saved.repo)}" target="_blank" rel="noopener noreferrer">Open repository on GitHub ↗</a>`
          : `<a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noopener noreferrer">How to create or configure a GitHub token ↗</a>`}
      </div>
      <div id="gh-status" class="sync-status-line"></div>
    </div>
    <div class="modal__footer">
      <button class="btn" id="gh-test">Test connection</button>
      <button class="btn btn-danger" id="gh-pull">Pull &amp; reset local notes</button>
      <button class="btn btn-primary" id="gh-save">Push (overwrite repo)</button>
    </div>
  `);

  document.getElementById('modal-close').addEventListener('click', closeModal);

  function config() {
    return {
      token: document.getElementById('gh-token').value.trim(),
      owner: document.getElementById('gh-owner').value.trim(),
      repo: document.getElementById('gh-repo').value.trim(),
      basePath: document.getElementById('gh-path').value.trim() || 'notes',
    };
  }
  function persistConfig(cfg) {
    localStorage.setItem('githubConfig', JSON.stringify(cfg));
  }
  function setStatus(msg, kind) {
    const el = document.getElementById('gh-status');
    el.textContent = msg;
    el.className = 'sync-status-line visible' + (kind ? ' ' + kind : '');
  }

  function refreshRepoLink(cfg) {
    const el = document.getElementById('gh-repo-link');
    if (!el) return;
    el.innerHTML = cfg.token && cfg.owner && cfg.repo
      ? `<a href="https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}" target="_blank" rel="noopener noreferrer">Open repository on GitHub ↗</a>`
      : `<a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noopener noreferrer">How to create or configure a GitHub token ↗</a>`;
  }

  document.getElementById('gh-test').addEventListener('click', async () => {
    const cfg = config();
    persistConfig(cfg);
    refreshRepoLink(cfg);
    setStatus('Testing connection…');
    try {
      const sync = new GitHubSync(cfg);
      await sync.testConnection();
      setStatus('Connected successfully.', 'success');
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  document.getElementById('gh-save').addEventListener('click', async () => {
    const cfg = config();
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      setStatus('Token, owner, and repo are required.', 'error');
      return;
    }
    persistConfig(cfg);
    refreshRepoLink(cfg);
    setSyncBusy(true, 'Pushing…');
    setStatus('Pushing to GitHub…');
    try {
      const result = await pushToGitHub(cfg);
      setStatus(result.message, result.ok ? 'success' : 'error');
      if (result.ok) { toast('Pushed to GitHub'); hideSyncBanner(); }
    } finally { setSyncBusy(false); }
  });

  let pullConfirmed = false;
  const pullBtn = document.getElementById('gh-pull');
  pullBtn.addEventListener('click', async () => {
    const cfg = config();
    if (!cfg.token || !cfg.owner || !cfg.repo) {
      setStatus('Token, owner, and repo are required.', 'error');
      return;
    }
    persistConfig(cfg);

    if (!pullConfirmed) {
      pullConfirmed = true;
      pullBtn.textContent = 'Confirm: replace local notes';
      setStatus('This replaces ALL local notes with what\u2019s in the repo. Anything local you haven\u2019t pushed will be lost. Click again to confirm.', 'error');
      return;
    }

    setSyncBusy(true, 'Pulling…');
    setStatus('Pulling from GitHub…');
    try {
      const result = await pullAndResetFromGitHub(cfg);
      setStatus(result.message, result.ok ? 'success' : 'error');
      if (result.ok) { toast('Local notes reset from GitHub'); hideSyncBanner(); }
    } finally {
      setSyncBusy(false);
      pullConfirmed = false;
      pullBtn.textContent = 'Pull & reset local notes';
    }
  });
}

// ---------------------------------------------------------------------
// Share on Wi-Fi (Phase 3, spec §3.9 / §6.3)
// ---------------------------------------------------------------------
function closeShareSession() {
  shareSession?.close();
  shareSession = null;
  setPeerStatus(false);
}

function setPeerStatus(connected, label) {
  const row = document.getElementById('peer-status-row');
  const dot = document.getElementById('peer-status-dot');
  const text = document.getElementById('peer-status-label');
  if (!connected && !label) {
    row.style.display = 'none';
    return;
  }
  row.style.display = 'flex';
  dot.className = 'status-dot' + (connected ? ' online' : '');
  text.textContent = label || (connected ? '1 peer connected' : 'No peer');
}

function openShareModal() {
  let tab = 'host';   // 'host' | 'join'
  let easyMode = true; // PeerJS vs manual SDP

  render();

  function render() {
    renderModal(`
      <div class="modal__header">
        <span class="modal__title">Share on Wi-Fi</span>
        <button class="icon-btn" id="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="modal__body">
        <div class="share-tabs">
          <button data-tab="host" class="${tab === 'host' ? 'active' : ''}">Host</button>
          <button data-tab="join" class="${tab === 'join' ? 'active' : ''}">Join</button>
        </div>
        <div class="mode-toggle">
          <label><input type="radio" name="share-mode" value="easy" ${easyMode ? 'checked' : ''}/> Easy (PeerJS)</label>
          <label><input type="radio" name="share-mode" value="manual" ${!easyMode ? 'checked' : ''}/> Offline (manual)</label>
        </div>
        <div class="honesty-note">
          ${easyMode
            ? 'Note content stays between the two devices. A short connection handshake is relayed through PeerJS\u2019s free signaling service to help the devices find each other.'
            : 'Fully offline: nothing touches any third-party server, ever. You\u2019ll copy a short code between devices by hand, which is clunkier — that\u2019s the tradeoff.'}
        </div>
        <div id="share-body"></div>
      </div>
      <div class="modal__footer">
        <button class="btn" id="share-close">Close</button>
      </div>
    `);

    document.getElementById('modal-close').addEventListener('click', () => { closeShareSession(); closeModal(); });
    document.getElementById('share-close').addEventListener('click', () => { closeShareSession(); closeModal(); });

    document.querySelectorAll('.share-tabs button').forEach((b) => {
      b.addEventListener('click', () => { closeShareSession(); tab = b.dataset.tab; render(); });
    });
    document.querySelectorAll('input[name="share-mode"]').forEach((r) => {
      r.addEventListener('change', (e) => { closeShareSession(); easyMode = e.target.value === 'easy'; render(); });
    });

    if (tab === 'host') renderHostBody(); else renderJoinBody();
  }

  function body() { return document.getElementById('share-body'); }

  function renderHostBody() {
    if (easyMode) {
      body().innerHTML = `
        <button class="btn btn-primary" id="start-host">Start session</button>
        <div id="host-status" style="margin-top:12px;"></div>
      `;
      document.getElementById('start-host').addEventListener('click', async () => {
        const status = document.getElementById('host-status');
        status.textContent = 'Starting…';
        shareSession = new ShareSession({ mode: 'peerjs' });
        shareSession.onPeerConnected = () => {
          setPeerStatus(true);
          shareSession.sendSnapshot(activeNotes(), state.folders);
          status.innerHTML += `<div class="peer-badge">● peer connected — snapshot sent</div>`;
        };
        shareSession.onPeerDisconnected = () => setPeerStatus(false);
        try {
          const code = await shareSession.host();
          status.innerHTML = `
            <div class="field-hint" style="margin-bottom:6px;">Enter this code on the other device:</div>
            <div class="code-display">${escapeHtml(code)}</div>
            <div class="field-hint">Waiting for a peer to connect…</div>
          `;
        } catch (err) {
          status.innerHTML = `<div class="sync-status-line visible error">${escapeHtml(err.message)}</div>`;
        }
      });
    } else {
      body().innerHTML = `
        <button class="btn btn-primary" id="start-host-manual">Create offline session</button>
        <div id="host-manual-status" style="margin-top:12px;"></div>
      `;
      document.getElementById('start-host-manual').addEventListener('click', async () => {
        const status = document.getElementById('host-manual-status');
        status.textContent = 'Generating connection code…';
        shareSession = new ShareSession({ mode: 'manual' });
        shareSession.onPeerConnected = () => {
          setPeerStatus(true);
          shareSession.sendSnapshotManual
            ? shareSession.sendSnapshotManual(activeNotes(), state.folders)
            : shareSession.sendSnapshot(activeNotes(), state.folders);
        };
        shareSession.onPeerDisconnected = () => setPeerStatus(false);
        const offer = await shareSession.hostManual();
        status.innerHTML = `
          <div class="field-hint" style="margin-bottom:6px;">1. Send this code to the other device (copy or QR):</div>
          <textarea class="sdp-box" readonly>${escapeHtml(offer)}</textarea>
          <div class="field-hint" style="margin:10px 0 6px;">2. Paste the code it gives you back:</div>
          <textarea class="sdp-box" id="manual-answer" placeholder="Paste the joiner's code here"></textarea>
          <button class="btn btn-primary" id="complete-host" style="margin-top:8px;">Complete connection</button>
          <div id="manual-host-result" style="margin-top:10px;"></div>
        `;
        document.getElementById('complete-host').addEventListener('click', async () => {
          const val = document.getElementById('manual-answer').value.trim();
          const result = document.getElementById('manual-host-result');
          try {
            await shareSession.completeManualHost(val);
            result.innerHTML = '<div class="sync-status-line visible success">Connecting…</div>';
          } catch (err) {
            result.innerHTML = `<div class="sync-status-line visible error">${escapeHtml(err.message)}</div>`;
          }
        });
      });
    }
  }

  function renderJoinBody() {
    if (easyMode) {
      body().innerHTML = `
        <div class="field">
          <label for="join-code">Session code</label>
          <input type="text" id="join-code" placeholder="Paste the host's code" />
        </div>
        <button class="btn btn-primary" id="join-btn">Connect</button>
        <div id="join-status" style="margin-top:12px;"></div>
        <div id="shared-view"></div>
      `;
      document.getElementById('join-btn').addEventListener('click', async () => {
        const code = document.getElementById('join-code').value.trim();
        const status = document.getElementById('join-status');
        if (!code) { status.innerHTML = '<div class="sync-status-line visible error">Enter a code first.</div>'; return; }
        status.textContent = 'Connecting…';
        shareSession = new ShareSession({ mode: 'peerjs' });
        shareSession.onPeerConnected = () => { setPeerStatus(true); status.innerHTML = '<div class="sync-status-line visible success">Connected — waiting for notes…</div>'; };
        shareSession.onPeerDisconnected = () => setPeerStatus(false);
        shareSession.onSnapshotReceived = (data) => renderSharedSnapshot(data);
        try {
          await shareSession.join(code);
        } catch (err) {
          status.innerHTML = `<div class="sync-status-line visible error">${escapeHtml(err.message)}</div>`;
        }
      });
    } else {
      body().innerHTML = `
        <div class="field-hint" style="margin-bottom:6px;">1. Paste the code from the host:</div>
        <textarea class="sdp-box" id="manual-offer" placeholder="Paste the host's code here"></textarea>
        <button class="btn btn-primary" id="join-manual-btn" style="margin-top:8px;">Generate reply code</button>
        <div id="join-manual-status" style="margin-top:10px;"></div>
        <div id="shared-view"></div>
      `;
      document.getElementById('join-manual-btn').addEventListener('click', async () => {
        const val = document.getElementById('manual-offer').value.trim();
        const status = document.getElementById('join-manual-status');
        shareSession = new ShareSession({ mode: 'manual' });
        shareSession.onPeerConnected = () => setPeerStatus(true);
        shareSession.onPeerDisconnected = () => setPeerStatus(false);
        shareSession.onSnapshotReceived = (data) => renderSharedSnapshot(data);
        try {
          const answer = await shareSession.joinManual(val);
          status.innerHTML = `
            <div class="field-hint" style="margin-bottom:6px;">2. Send this reply code back to the host:</div>
            <textarea class="sdp-box" readonly>${escapeHtml(answer)}</textarea>
          `;
        } catch (err) {
          status.innerHTML = `<div class="sync-status-line visible error">${escapeHtml(err.message)}</div>`;
        }
      });
    }
  }

  function renderSharedSnapshot(data) {
    // Read-only viewing, but the user can explicitly copy an individual
    // note into their own local library — a one-time import, not live
    // sync back to the host (collaborative write-mode stays out of scope).
    const view = document.getElementById('shared-view');
    if (!view) return;
    const notes = data.notes || [];
    view.innerHTML = `
      <div class="shared-banner">Viewing a shared session — read-only · received ${notes.length} note(s)</div>
      <div class="shared-note-list">
        ${notes.map((n, i) => `<div class="shared-note-item" data-i="${i}"><div class="title">${escapeHtml(n.title || 'Untitled')}</div></div>`).join('') || '<div class="field-hint">No notes to show.</div>'}
      </div>
      <div class="shared-note-detail" id="shared-note-detail" style="display:none;"></div>
    `;
    view.querySelectorAll('.shared-note-item').forEach((el) => {
      el.addEventListener('click', () => {
        const n = notes[Number(el.dataset.i)];
        const detail = document.getElementById('shared-note-detail');
        detail.style.display = 'block';
        detail.innerHTML = `
          <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
            <button class="btn btn-primary" id="import-shared-note">Import to my notes</button>
          </div>
          <div id="shared-note-body" style="white-space:pre-wrap;">${escapeHtml(n.content || '')}</div>
        `;
        document.getElementById('import-shared-note').addEventListener('click', async () => {
          await importSharedNote(n);
        });
      });
    });
  }

  async function importSharedNote(n) {
    const note = {
      id: uuid(),
      title: n.title || 'Untitled',
      content: n.content || '',
      folderId: null,
      tags: [...(n.tags || []), 'shared'],
      pinned: false,
      archived: false,
      deleted: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    state.notes.unshift(note);
    await db.put('notes', note);
    renderAll();
    toast(`Imported "${note.title}" to your notes`);
  }
}

// ---------------------------------------------------------------------
// Modal / toast helpers
// ---------------------------------------------------------------------
function renderModal(innerHtml) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-overlay" id="modal-overlay"><div class="modal">${innerHtml}</div></div>`;
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  if (shareSession) closeShareSession();
}

function toast(msg, isError) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  if (isError) el.style.background = 'var(--danger)';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------
// Mobile tab switching
// ---------------------------------------------------------------------
function applyMobileTab() {
  document.getElementById('pane-sidebar').classList.toggle('mobile-visible', state.mobileTab === 'sidebar');
  document.getElementById('pane-list').classList.toggle('mobile-visible', state.mobileTab === 'list');
  document.getElementById('pane-editor').classList.toggle('mobile-visible', state.mobileTab === 'editor');
  document.getElementById('pane-skim').classList.toggle('mobile-visible', state.mobileTab === 'skim');
  document.querySelectorAll('.mobile-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === state.mobileTab);
  });
  if (state.mobileTab === 'skim') renderNoteList(); // skim-list render is gated on being visible
}

// ---------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------
function wireGlobalEvents() {
  document.querySelectorAll('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', () => setView(el.dataset.view));
  });

  document.getElementById('btn-add-folder').addEventListener('click', addFolder);
  document.getElementById('btn-new-note').addEventListener('click', () => createNote());
  document.getElementById('btn-new-note-caret').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('new-note-menu');
    menu.hidden = !menu.hidden;
  });
  document.querySelectorAll('#new-note-menu button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('new-note-menu').hidden = true;
      createNote(btn.dataset.editorType);
    });
  });
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('new-note-menu');
    if (!menu.hidden && !e.target.closest('.new-note-group')) menu.hidden = true;
  });
  document.getElementById('btn-skim-toggle').addEventListener('click', () => {
    state.skimMode = !state.skimMode;
    document.getElementById('btn-skim-toggle').classList.toggle('active', state.skimMode);
    renderNoteList();
  });
  document.getElementById('search-input').addEventListener('input', onSearchInput);

  document.getElementById('note-title').addEventListener('input', (e) => updateSelectedNote({ title: e.target.value }));
  document.getElementById('note-content').addEventListener('input', (e) => {
    updateSelectedNote({ content: e.target.value });
    const note = state.notes.find((n) => n.id === state.selectedNoteId);
    if (note) {
      updateMetaRow(note);
      if (state.previewOn) renderPreview(note);
    }
  });

  document.getElementById('note-content').addEventListener('keydown', (e) => {
    const ta = e.target;
    if (e.key === 'Tab') {
      e.preventDefault();
      handleTab(ta, e.shiftKey);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (handleEnterList(ta)) { e.preventDefault(); return; }
    }
    if (!e.metaKey && !e.ctrlKey) {
      handleAutoPair(ta, e); // no-op (and no preventDefault) unless text is selected
    }
  });

  document.getElementById('note-content').addEventListener('paste', (e) => {
    handleSmartPaste(e.target, e); // no-op unless pasting a URL over a selection
  });

  document.getElementById('tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(state.selectedNoteId, e.target.value);
      e.target.value = '';
    }
  });

  document.getElementById('btn-pin').addEventListener('click', togglePin);
  document.getElementById('btn-archive').addEventListener('click', toggleArchive);
  document.getElementById('btn-delete').addEventListener('click', deleteNote);
  document.getElementById('btn-export-single').addEventListener('click', exportSingleNote);
  document.getElementById('btn-preview').addEventListener('click', () => {
    state.previewOn = !state.previewOn;
    renderEditor();
  });
  document.getElementById('btn-syntax-help').addEventListener('click', openSyntaxModal);

  document.getElementById('btn-theme').addEventListener('click', openThemeModal);
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSONFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-export-zip').addEventListener('click', exportMarkdownZip);
  document.getElementById('btn-import-zip').addEventListener('click', () => document.getElementById('import-zip-file').click());
  document.getElementById('import-zip-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importMarkdownZip(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-github').addEventListener('click', openGitHubModal);
  document.getElementById('btn-share').addEventListener('click', openShareModal);
  window.addEventListener('beforeunload', () => { if (shareSession) shareSession.close(); });
  wireSyncBanner();

  document.querySelectorAll('.mobile-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mobileTab = btn.dataset.tab;
      applyMobileTab();
    });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme();
  });

  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    const inEditor = document.activeElement && document.activeElement.id === 'note-content';

    if (inEditor && meta) {
      const key = e.key.toLowerCase();
      if (key === 'b') { e.preventDefault(); toggleWrap(document.activeElement, '**'); return; }
      if (key === 'i') { e.preventDefault(); toggleWrap(document.activeElement, '_'); return; }
      if (key === 'e') { e.preventDefault(); toggleWrap(document.activeElement, '`'); return; }
      if (key === 'k') { e.preventDefault(); insertLink(document.activeElement); return; }
      if (key === 'c' && e.shiftKey) { e.preventDefault(); insertCodeBlock(document.activeElement); return; }
    }

    if (meta && e.key === 'k') {
      e.preventDefault();
      document.getElementById('search-input').focus();
      return;
    }
    if (meta && e.key === 'n') {
      e.preventDefault();
      createNote();
    }
  });
}

// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.round(hours / 24);
  if (days < 7) return days + 'd ago';
  return formatDate(iso);
}

boot();
