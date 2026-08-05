// search.js — lightweight in-house search (FR-19: swap for MiniSearch past ~2k notes).
// Good enough for NFR-01 (<100ms over 2,000 notes) via a simple scored substring match.

export function searchNotes(notes, query) {
  const q = query.trim().toLowerCase();
  if (!q) return notes.map((n) => ({ note: n, snippet: null }));

  const terms = q.split(/\s+/).filter(Boolean);
  const results = [];

  for (const note of notes) {
    const title = (note.title || '').toLowerCase();
    const content = (note.content || '').toLowerCase();
    let score = 0;
    let matched = true;

    for (const term of terms) {
      const inTitle = title.includes(term);
      const inContent = content.includes(term);
      if (!inTitle && !inContent) {
        matched = false;
        break;
      }
      if (inTitle) score += 3;
      if (inContent) score += 1;
    }

    if (matched) {
      results.push({ note, snippet: buildSnippet(note.content, terms), score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function buildSnippet(content, terms) {
  if (!content) return '';
  const lower = content.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    idx = lower.indexOf(term);
    if (idx !== -1) break;
  }
  if (idx === -1) idx = 0;
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + 100);
  let snippet = content.slice(start, end).replace(/\n+/g, ' ');
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet += '…';
  return highlight(snippet, terms);
}

function highlight(text, terms) {
  let out = escapeHtml(text);
  for (const term of terms) {
    const re = new RegExp('(' + escapeRegExp(term) + ')', 'ig');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
