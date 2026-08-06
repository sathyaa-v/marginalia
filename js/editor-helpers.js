// editor-helpers.js — behavior-only improvements to the existing plain
// textarea editor (FR-09/FR-12). Nothing here touches the UI; every
// function operates on the textarea already in the DOM and dispatches a
// synthetic 'input' event afterward so the existing autosave/preview
// listener in app.js picks up the change exactly like a normal keystroke.

function fireInput(textarea) {
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------------
// Tab / Shift+Tab — indent or outdent the selected line(s) by two spaces,
// instead of the default browser behavior of moving focus off the field.
// ---------------------------------------------------------------------
export function handleTab(textarea, shiftKey) {
  const INDENT = '  ';
  const { selectionStart, selectionEnd, value } = textarea;
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selectionEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  let newLines;
  let startDelta = 0;
  let endDelta = 0;

  if (!shiftKey) {
    newLines = lines.map((l) => INDENT + l);
    startDelta = INDENT.length;
    endDelta = INDENT.length * lines.length;
  } else {
    newLines = lines.map((l) => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^[\t ]/, '')));
    const removedFromFirst = lines[0].length - newLines[0].length;
    const removedTotal = lines.reduce((sum, l, i) => sum + (l.length - newLines[i].length), 0);
    startDelta = -removedFromFirst;
    endDelta = -removedTotal;
  }

  const newBlock = newLines.join('\n');
  textarea.setRangeText(newBlock, lineStart, lineEnd, 'select');
  textarea.selectionStart = Math.max(lineStart, selectionStart + startDelta);
  textarea.selectionEnd = Math.max(textarea.selectionStart, selectionEnd + endDelta);
  fireInput(textarea);
}

// ---------------------------------------------------------------------
// Enter inside a list — continues the marker on the next line, or (on an
// empty item) removes it and exits the list, the way most markdown
// editors behave. Only handles a plain cursor (no active selection).
// ---------------------------------------------------------------------
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?/;

export function handleEnterList(textarea) {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart !== selectionEnd) return false;

  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const line = value.slice(lineStart, selectionStart);
  const match = line.match(LIST_RE);
  if (!match) return false;

  const [full, indent, marker, checkbox] = match;
  const restOfLine = line.slice(full.length);

  if (restOfLine.trim() === '') {
    // Empty list item: pressing Enter again clears the marker and exits.
    textarea.setRangeText('', lineStart, selectionStart, 'end');
    fireInput(textarea);
    return true;
  }

  let nextMarker = marker;
  if (/^\d+\.$/.test(marker)) {
    nextMarker = String(parseInt(marker, 10) + 1) + '.';
  }
  const insertion = '\n' + indent + nextMarker + ' ' + (checkbox ? '[ ] ' : '');
  textarea.setRangeText(insertion, selectionStart, selectionStart, 'end');
  fireInput(textarea);
  return true;
}

// ---------------------------------------------------------------------
// Formatting shortcuts — wrap (or unwrap, if already wrapped) the
// current selection with the given markers. Works with no selection too
// (drops the cursor between the markers, ready to type).
// ---------------------------------------------------------------------
export function toggleWrap(textarea, before, after = before) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const beforeChars = value.slice(Math.max(0, selectionStart - before.length), selectionStart);
  const afterChars = value.slice(selectionEnd, selectionEnd + after.length);

  if (beforeChars === before && afterChars === after) {
    textarea.setRangeText(selected, selectionStart - before.length, selectionEnd + after.length, 'end');
    textarea.selectionStart = selectionStart - before.length;
    textarea.selectionEnd = textarea.selectionStart + selected.length;
  } else {
    textarea.setRangeText(before + selected + after, selectionStart, selectionEnd, 'end');
    if (selected.length === 0) {
      textarea.selectionStart = textarea.selectionEnd = selectionStart + before.length;
    } else {
      textarea.selectionStart = selectionStart + before.length;
      textarea.selectionEnd = textarea.selectionStart + selected.length;
    }
  }
  fireInput(textarea);
}

export function insertLink(textarea, url) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const label = selected || 'link text';
  const markdown = `[${label}](${url || ''})`;
  textarea.setRangeText(markdown, selectionStart, selectionEnd, 'end');
  if (!url) {
    const urlPos = selectionStart + label.length + 3; // just after "[label]("
    textarea.selectionStart = textarea.selectionEnd = urlPos;
  }
  fireInput(textarea);
}

export function insertCodeBlock(textarea, lang = '') {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const block = '```' + lang + '\n' + selected + '\n```';
  textarea.setRangeText(block, selectionStart, selectionEnd, 'end');
  if (!selected) {
    textarea.selectionStart = textarea.selectionEnd = selectionStart + 3 + lang.length + 1;
  }
  fireInput(textarea);
}

// ---------------------------------------------------------------------
// Smart paste — pasting a URL over a text selection wraps the selection
// as a markdown link instead of replacing it with the raw URL.
// ---------------------------------------------------------------------
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

export function handleSmartPaste(textarea, clipboardEvent) {
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart === selectionEnd) return false;
  const pasted = (clipboardEvent.clipboardData || window.clipboardData)?.getData('text');
  if (!pasted || !URL_RE.test(pasted.trim())) return false;

  clipboardEvent.preventDefault();
  const selected = value.slice(selectionStart, selectionEnd);
  const markdown = `[${selected}](${pasted.trim()})`;
  textarea.setRangeText(markdown, selectionStart, selectionEnd, 'end');
  fireInput(textarea);
  return true;
}

// ---------------------------------------------------------------------
// Auto-pairing — typing an opening bracket/quote while text is selected
// wraps the selection instead of replacing it. (No-op with an empty
// selection, so normal typing is untouched.)
// ---------------------------------------------------------------------
const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };

export function handleAutoPair(textarea, keydownEvent) {
  const closing = PAIRS[keydownEvent.key];
  if (!closing) return false;
  const { selectionStart, selectionEnd, value } = textarea;
  if (selectionStart === selectionEnd) return false;

  keydownEvent.preventDefault();
  const selected = value.slice(selectionStart, selectionEnd);
  textarea.setRangeText(keydownEvent.key + selected + closing, selectionStart, selectionEnd, 'end');
  textarea.selectionStart = selectionStart + 1;
  textarea.selectionEnd = selectionEnd + 1;
  fireInput(textarea);
  return true;
}

// ---------------------------------------------------------------------
// Word count / reading time — for the existing meta row, no new UI.
// ---------------------------------------------------------------------
export function wordStats(content) {
  const words = ((content || '').trim().match(/\S+/g) || []).length;
  const minutes = words === 0 ? 0 : Math.max(1, Math.round(words / 200));
  return { words, minutes };
}
