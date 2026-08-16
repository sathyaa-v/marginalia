// wikilinks.js — [[Note Title]] parsing and a bidirectional link index.
//
// Syntax: [[Note Title]] or [[Note Title|Display text]]. Works the same
// way in both editors because it's parsed from the *plain text* each
// note resolves to (see getSearchableText in app.js), not from
// editor-specific markup — so Quill notes and Markdown notes link to
// each other identically, with no per-editor special-casing.

const WIKI_LINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+))?\]\]/g;

/** Extract the raw titles referenced via [[...]] in a block of text. */
export function parseWikiLinkTitles(text) {
  if (!text) return [];
  const titles = [];
  let m;
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(text)) !== null) {
    const title = m[1].trim();
    if (title) titles.push(title);
  }
  return titles;
}

/**
 * Build a bidirectional link index across all (non-deleted) notes.
 *
 * @param {Array} notes - active notes (id, title, content, editorType)
 * @param {(note) => string} getSearchableText - resolves a note to plain text
 * @returns {{
 *   forwardLinks: Map<string, Array<{title:string, targetId:string|null}>>,
 *   backlinks: Map<string, Set<string>>,
 *   titleToId: Map<string, string>,
 * }}
 */
export function buildLinkIndex(notes, getSearchableText) {
  const titleToId = new Map();
  // First pass: index titles so [[Title]] resolves regardless of note order.
  // On duplicate titles, prefer the most recently updated note (closer to
  // "the one you probably meant").
  for (const note of notes) {
    const key = (note.title || '').trim().toLowerCase();
    if (!key) continue;
    const existing = titleToId.get(key);
    if (!existing || (note.updatedAt || '') > (existing.updatedAt || '')) {
      titleToId.set(key, { id: note.id, updatedAt: note.updatedAt });
    }
  }
  const resolvedTitleToId = new Map();
  for (const [key, val] of titleToId) resolvedTitleToId.set(key, val.id);

  const forwardLinks = new Map();
  const backlinks = new Map();
  for (const note of notes) backlinks.set(note.id, new Set());

  for (const note of notes) {
    const text = getSearchableText(note) || '';
    const rawTitles = parseWikiLinkTitles(text);
    if (rawTitles.length === 0) continue;

    const seen = new Set();
    const outgoing = [];
    const selfKey = (note.title || '').trim().toLowerCase();
    for (const title of rawTitles) {
      const key = title.toLowerCase();
      if (seen.has(key) || key === selfKey) continue; // de-dupe + skip self-links
      seen.add(key);
      const targetId = resolvedTitleToId.get(key) || null;
      outgoing.push({ title, targetId });
      if (targetId && targetId !== note.id) {
        backlinks.get(targetId)?.add(note.id);
      }
    }
    if (outgoing.length > 0) forwardLinks.set(note.id, outgoing);
  }

  return { forwardLinks, backlinks, titleToId: resolvedTitleToId };
}
