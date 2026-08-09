// quill.js — Quill rich-text editor integration (spec §3.2.1, FR-54–FR-68).
// Loaded via CDN <script> in index.html (no build step); this module
// assumes `window.Quill` is present when its mounting functions are
// actually called (i.e. only when a Quill note is opened).

// A fresh, valid, empty Quill Delta — one empty line.
export function createEmptyDeltaJson() {
  return JSON.stringify({ ops: [{ insert: '\n' }] });
}

function safeParseDelta(deltaJson) {
  try {
    const parsed = JSON.parse(deltaJson || '');
    if (parsed && Array.isArray(parsed.ops)) return parsed;
  } catch { /* fall through */ }
  return { ops: [{ insert: '\n' }] };
}

// FR-59: Quill's built-in syntax module, wired to the highlight.js
// instance already loaded for Markdown code blocks — one highlighter,
// shared by both editor types.
function syntaxModuleConfig() {
  if (!window.hljs) return undefined;
  return { highlight: (text) => window.hljs.highlightAuto(text).value };
}

const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  ['blockquote', 'code-block'],
  [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
  [{ indent: '-1' }, { indent: '+1' }, { align: [] }],
  ['link', 'image'],
  ['clean'],
];

// Mounts a live, editable Quill instance into `container` (a DOM node).
// Caller owns the instance's lifecycle — reuse it across note switches
// rather than re-mounting, and call setDelta() to load different content.
export function mountEditor(container) {
  const syntax = syntaxModuleConfig();
  return new window.Quill(container, {
    theme: 'snow',
    modules: {
      toolbar: TOOLBAR_OPTIONS,
      ...(syntax ? { syntax } : {}),
    },
    placeholder: 'Start writing…',
  });
}

// Loads Delta content into an existing Quill instance WITHOUT firing a
// user-facing text-change save (source: 'silent') — otherwise merely
// opening a note would immediately re-save it and bump updatedAt.
export function setDelta(quill, deltaJson) {
  quill.setContents(safeParseDelta(deltaJson), 'silent');
}

export function getDeltaJson(quill) {
  return JSON.stringify(quill.getContents());
}

// FR-60: plain-text extraction for the search index. Delta ops are either
// a string insert (text) or an object insert (embeds like images) — only
// the former contributes searchable text.
export function extractPlainText(deltaJson) {
  const delta = safeParseDelta(deltaJson);
  return delta.ops
    .filter((op) => typeof op.insert === 'string')
    .map((op) => op.insert)
    .join('');
}

// FR-61/FR-64: render a Delta to sanitized, syntax-highlighted HTML using
// a temporary, read-only, headless Quill instance — reuses Quill's own
// renderer instead of hand-rolling a second one, so skim view and the
// GitHub HTML snapshot both stay visually identical to the live editor.
export function renderDeltaToHtml(deltaJson) {
  if (!window.Quill) return '';
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);
  try {
    const syntax = syntaxModuleConfig();
    const quill = new window.Quill(container, {
      readOnly: true,
      modules: { toolbar: false, ...(syntax ? { syntax } : {}) },
    });
    quill.setContents(safeParseDelta(deltaJson), 'silent');
    let html = quill.root.innerHTML;
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
    return html;
  } finally {
    container.remove();
  }
}

// FR-62: best-effort Delta -> Markdown conversion, used ONLY at Markdown
// ZIP export time. Local storage and GitHub sync never convert Quill
// notes to Markdown (FR-63) — this is a one-way, export-only path, and
// intentionally covers the common formats rather than every possible
// Quill attribute; round-tripping back through this is not supported.
export function deltaToMarkdown(deltaJson) {
  const delta = safeParseDelta(deltaJson);

  // Quill attaches block-level formatting (headers, lists, quotes, code
  // blocks) to the trailing '\n' of the line it terminates, so we build
  // up an inline-formatted buffer and only "close" a line — applying its
  // block attributes — when we hit that newline.
  const lines = [];
  let buffer = '';

  delta.ops.forEach((op) => {
    if (typeof op.insert !== 'string') {
      if (op.insert && op.insert.image) buffer += `![](${op.insert.image})`;
      return;
    }
    const attrs = op.attributes || {};
    const parts = op.insert.split('\n');
    parts.forEach((part, i) => {
      let text = part;
      if (attrs.code) text = '`' + text + '`';
      if (attrs.bold) text = '**' + text + '**';
      if (attrs.italic) text = '_' + text + '_';
      if (attrs.strike) text = '~~' + text + '~~';
      if (attrs.link) text = `[${text}](${attrs.link})`;
      buffer += text;
      if (i < parts.length - 1) {
        lines.push({ text: buffer, blockAttrs: attrs });
        buffer = '';
      }
    });
  });
  if (buffer) lines.push({ text: buffer, blockAttrs: {} });

  let md = '';
  let orderedCounter = 0;
  lines.forEach((line) => {
    const a = line.blockAttrs;
    let out = line.text;
    if (a.header) { out = '#'.repeat(a.header) + ' ' + out; orderedCounter = 0; }
    else if (a.blockquote) { out = '> ' + out; orderedCounter = 0; }
    else if (a['code-block']) { out = '    ' + out; orderedCounter = 0; }
    else if (a.list === 'ordered') { orderedCounter += 1; out = `${orderedCounter}. ${out}`; }
    else if (a.list === 'bullet') { out = `- ${out}`; orderedCounter = 0; }
    else if (a.list === 'checked') { out = `- [x] ${out}`; orderedCounter = 0; }
    else if (a.list === 'unchecked') { out = `- [ ] ${out}`; orderedCounter = 0; }
    else { orderedCounter = 0; }
    md += out + '\n';
  });
  return md.trim() + '\n';
}
