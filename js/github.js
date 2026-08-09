// github.js — GitHub persistence adapter (spec §6.2).
// Uses the Git Data API (blob -> tree -> commit -> ref) so a multi-note
// save is ONE atomic commit rather than one Contents-API request per file.

import { uuid, nowISO } from './db.js';

const API = 'https://api.github.com';

function slugify(title) {
  return (title || 'untitled')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'untitled';
}

function folderPath(folders, folderId) {
  const parts = [];
  let current = folderId ? folders.find((f) => f.id === folderId) : null;
  while (current) {
    parts.unshift(slugify(current.name));
    current = current.parentId ? folders.find((f) => f.id === current.parentId) : null;
  }
  return parts.join('/');
}

// Human-readable version (original names, not slugged) — stored in
// front-matter so a pull can rebuild the exact folder name/hierarchy
// instead of guessing it back from a lossy slug in the directory path.
export function folderDisplayPath(folders, folderId) {
  const parts = [];
  let current = folderId ? folders.find((f) => f.id === folderId) : null;
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? folders.find((f) => f.id === current.parentId) : null;
  }
  return parts.join('/');
}

export function noteToMarkdown(note, folders) {
  const fm = [
    '---',
    `title: ${JSON.stringify(note.title || 'Untitled')}`,
    `folder: ${JSON.stringify(folderDisplayPath(folders, note.folderId))}`,
    `tags: [${(note.tags || []).map((t) => JSON.stringify(t)).join(', ')}]`,
    `pinned: ${!!note.pinned}`,
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    '---',
    '',
  ].join('\n');
  return fm + (note.content || '');
}

function parseMarkdown(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const [, fmBlock, content] = match;
  const meta = {};
  fmBlock.split('\n').forEach((line) => {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) return;
    const [, key, rawVal] = m;
    if (key === 'tags') {
      try {
        meta.tags = JSON.parse(rawVal.replace(/'/g, '"'));
      } catch {
        meta.tags = [];
      }
    } else if (key === 'pinned') {
      meta.pinned = rawVal === 'true';
    } else if (key === 'title') {
      try {
        meta.title = JSON.parse(rawVal);
      } catch {
        meta.title = rawVal;
      }
    } else if (key === 'folder') {
      try {
        meta.folder = JSON.parse(rawVal);
      } catch {
        meta.folder = rawVal;
      }
    } else {
      meta[key] = rawVal;
    }
  });
  return { meta, content: content.replace(/^\n/, '') };
}

/**
 * Shared reconstruction logic used by BOTH GitHub pull and the local ZIP
 * import (spec §3.7/§6.2) — one code path, so the two stay in sync
 * automatically instead of risking drift between two hand-rolled folder
 * rebuilders. Folder identity comes from each note's `folder:`
 * front-matter/metadata field (human-readable, exact names) when
 * present; otherwise it falls back to the physical directory the file
 * was found in (for files added by hand, with no such field).
 *
 * @param {Array<{relDir: string[], filename: string, raw: string, sourcePath?: string, sourceSha?: string, kind?: 'markdown'|'quill'}>} files
 * @returns {{notes: object[], folders: object[]}}
 */
export function reconstructFromMarkdownFiles(files) {
  const foldersByPath = new Map();
  const ensureFolder = (segments) => {
    if (!segments || segments.length === 0) return null;
    const key = segments.join('/');
    if (foldersByPath.has(key)) return foldersByPath.get(key).id;
    const parentId = segments.length > 1 ? ensureFolder(segments.slice(0, -1)) : null;
    const folder = { id: uuid(), name: segments[segments.length - 1], parentId, createdAt: nowISO(), updatedAt: nowISO() };
    foldersByPath.set(key, folder);
    return folder.id;
  };

  const notes = [];
  for (const file of files) {
    let meta, content, editorType;

    if (file.kind === 'quill') {
      // .quill.json is a plain JSON object (not front-matter+markdown):
      // { title, folder, tags, pinned, created, updated, editorType, delta }.
      // The Delta is re-serialized as-is into `content` (FR-63: never
      // converted to Markdown for sync/local storage).
      let parsed;
      try {
        parsed = JSON.parse(file.raw);
      } catch {
        parsed = {};
      }
      meta = {
        title: parsed.title,
        folder: parsed.folder,
        tags: parsed.tags,
        pinned: parsed.pinned,
        created: parsed.created,
        updated: parsed.updated,
      };
      content = JSON.stringify(parsed.delta || { ops: [] });
      editorType = 'quill';
    } else {
      const parsedMd = parseMarkdown(file.raw);
      meta = parsedMd.meta;
      content = parsedMd.content;
      editorType = 'markdown';
    }

    const segments = meta.folder ? meta.folder.split('/').filter(Boolean) : (file.relDir || []);
    const folderId = ensureFolder(segments);

    notes.push({
      title: meta.title || file.filename.replace(/\.(quill\.json|md)$/, ''),
      content,
      editorType,
      tags: meta.tags || [],
      pinned: !!meta.pinned,
      folderId,
      createdAt: meta.created,
      updatedAt: meta.updated,
      githubPath: file.sourcePath,
      githubSha: file.sourceSha,
    });
  }
  return { notes, folders: [...foldersByPath.values()] };
}

export class GitHubSync {
  constructor({ token, owner, repo, basePath = 'notes' }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.basePath = basePath.replace(/^\/+|\/+$/g, '');
  }

  headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async testConnection() {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Connection failed (${res.status}): ${await this._err(res)}`);
    const data = await res.json();
    return { ok: true, permissions: data.permissions };
  }

  async _err(res) {
    try {
      const j = await res.json();
      return j.message || res.statusText;
    } catch {
      return res.statusText;
    }
  }

  async _createBlob(content) {
    const blobRes = await fetch(`${API}/repos/${this.owner}/${this.repo}/git/blobs`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, encoding: 'utf-8' }),
    });
    if (!blobRes.ok) throw new Error(`Blob create failed: ${await this._err(blobRes)}`);
    return blobRes.json();
  }

  /**
   * Cheap check for "has anything changed on GitHub" — the date of the
   * most recent commit that touched basePath, without pulling any file
   * contents. Used for the on-load sync-status banner.
   */
  async getLatestRemoteChangeTime() {
    const res = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/commits?path=${encodeURIComponent(this.basePath)}&per_page=1`,
      { headers: this.headers() }
    );
    if (res.status === 404 || res.status === 409) return null; // repo/path has no commits yet
    if (!res.ok) throw new Error(`Commit lookup failed: ${await this._err(res)}`);
    const commits = await res.json();
    if (!Array.isArray(commits) || commits.length === 0) return null;
    const c = commits[0];
    return c.commit?.committer?.date || c.commit?.author?.date || null;
  }

  /**
   * Atomic multi-file commit via the Git Data API. This is a MIRROR push:
   * any previously-synced path that no longer corresponds to a currently
   * pushed note (deleted locally, or renamed so its slug/path changed) is
   * removed from the tree, not just left behind. Pass `previousPaths` —
   * every githubPath this client has ever seen for this repo, including
   * for notes since deleted — so stale files can be identified.
   */
  async saveNotes(notes, folders, { commitMessage, previousPaths = new Set(), renderQuillHtml } = {}) {
    const branchRes = await fetch(`${API}/repos/${this.owner}/${this.repo}`, {
      headers: this.headers(),
    });
    if (!branchRes.ok) throw new Error(`Repo lookup failed: ${await this._err(branchRes)}`);
    const repoData = await branchRes.json();
    const branch = repoData.default_branch;

    const refRes = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`,
      { headers: this.headers() }
    );
    if (!refRes.ok) throw new Error(`Ref lookup failed: ${await this._err(refRes)}`);
    const refData = await refRes.json();
    const latestCommitSha = refData.object.sha;

    const commitRes = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/git/commits/${latestCommitSha}`,
      { headers: this.headers() }
    );
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // Quill snapshots live in a separate top-level directory, sibling to
    // basePath — this is what makes FR-66 (pull ignores notes-html/) true
    // by construction: pull only ever lists contents under basePath.
    const HTML_BASE = 'notes-html';

    // 1. Create a blob per note, and track the set of paths this push writes.
    const treeEntries = [];
    const newPaths = new Set();
    let htmlSnapshotsWritten = 0;

    for (const note of notes) {
      const dirPath = `${this.basePath}/${folderPath(folders, note.folderId)}`.replace(/\/+$/, '').replace(/^\/+/, '');
      const slug = `${slugify(note.title)}-${note.id.slice(0, 8)}`;

      if (note.editorType === 'quill') {
        // Source of truth: the Delta itself, never converted (FR-63).
        const quillPath = `${dirPath}/${slug}.quill.json`;
        let delta;
        try {
          delta = JSON.parse(note.content || '{"ops":[]}');
        } catch {
          delta = { ops: [] };
        }
        const quillFileContent = JSON.stringify(
          {
            title: note.title || 'Untitled',
            folder: folderDisplayPath(folders, note.folderId),
            tags: note.tags || [],
            pinned: !!note.pinned,
            created: note.createdAt,
            updated: note.updatedAt,
            editorType: 'quill',
            delta,
          },
          null,
          2
        );
        const quillBlob = await this._createBlob(quillFileContent);
        treeEntries.push({ path: quillPath, mode: '100644', type: 'blob', sha: quillBlob.sha });
        newPaths.add(quillPath);
        note.githubPath = quillPath;
        note.githubSha = quillBlob.sha;

        // Read-only HTML snapshot, only regenerated if content actually
        // changed since the last successful sync (FR-65). Rendering
        // itself needs a live Quill instance, which this module doesn't
        // have — the caller supplies a renderQuillHtml(note) callback.
        const htmlPath = `${HTML_BASE}/${folderPath(folders, note.folderId)}`.replace(/\/+$/, '').replace(/^\/+/, '') + `/${slug}.html`;
        const needsHtmlUpdate =
          !note.githubHtmlSha ||
          !note.lastHtmlSyncedAt ||
          new Date(note.updatedAt) > new Date(note.lastHtmlSyncedAt);

        if (needsHtmlUpdate && typeof renderQuillHtml === 'function') {
          const html = renderQuillHtml(note);
          const htmlBlob = await this._createBlob(html);
          treeEntries.push({ path: htmlPath, mode: '100644', type: 'blob', sha: htmlBlob.sha });
          note.githubHtmlPath = htmlPath;
          note.githubHtmlSha = htmlBlob.sha;
          note.lastHtmlSyncedAt = nowISO();
          htmlSnapshotsWritten++;
        }
        // Either way (updated or unchanged), this path is "current" —
        // mark it so the stale-deletion pass below doesn't remove an
        // HTML snapshot that just wasn't regenerated this round.
        newPaths.add(htmlPath);
      } else {
        const path = `${dirPath}/${slug}.md`;
        const content = noteToMarkdown(note, folders);
        const blob = await this._createBlob(content);
        treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
        newPaths.add(path);
        note.githubPath = path;
        note.githubSha = blob.sha;
      }
    }

    // 1b. Delete any previously-synced path that isn't being written this
    // time — covers locally-deleted notes, renames, and (FR-67) a Quill
    // note's stale .quill.json/.html pair. Restricted to our own two
    // directories as a safety guard against touching unrelated repo files.
    let deletedCount = 0;
    for (const oldPath of previousPaths) {
      if (!oldPath) continue;
      const underBasePath = oldPath.startsWith(this.basePath + '/');
      const underHtmlBase = oldPath.startsWith(HTML_BASE + '/');
      if (!underBasePath && !underHtmlBase) continue;
      if (!newPaths.has(oldPath)) {
        treeEntries.push({ path: oldPath, mode: '100644', type: 'blob', sha: null });
        deletedCount++;
      }
    }

    // 2. Create a new tree on top of the base tree.
    const treeRes = await fetch(`${API}/repos/${this.owner}/${this.repo}/git/trees`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    if (!treeRes.ok) throw new Error(`Tree create failed: ${await this._err(treeRes)}`);
    const tree = await treeRes.json();

    // 3. Create the commit.
    const newCommitRes = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/git/commits`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage || `Sync ${notes.length} note(s) from Marginalia`,
          tree: tree.sha,
          parents: [latestCommitSha],
        }),
      }
    );
    if (!newCommitRes.ok) throw new Error(`Commit create failed: ${await this._err(newCommitRes)}`);
    const newCommit = await newCommitRes.json();

    // 4. Move the branch ref forward.
    const updateRefRes = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: newCommit.sha }),
      }
    );
    if (!updateRefRes.ok) throw new Error(`Ref update failed: ${await this._err(updateRefRes)}`);

    return {
      commitSha: newCommit.sha,
      commitDate: newCommit.committer?.date || newCommit.author?.date || new Date().toISOString(),
      notesUpdated: notes.length,
      notesDeleted: deletedCount,
      htmlSnapshotsWritten,
    };
  }

  /**
   * Pull all .md files under basePath and parse them back into notes,
   * also reconstructing the folder hierarchy so pulled notes land back
   * in the right folder instead of unfiled. Folder identity comes from
   * each note's `folder:` front-matter/metadata field (human-readable,
   * exact names) when present; for files that predate that field, or
   * were added to the repo by hand, it falls back to the physical
   * directory path the file was found in.
   *
   * Only lists contents under basePath — notes-html/ is a sibling
   * directory, so it is never traversed here at all (FR-66/68: the HTML
   * snapshot is write-only and never treated as authoritative).
   */
  async pullNotes() {
    const res = await fetch(
      `${API}/repos/${this.owner}/${this.repo}/contents/${this.basePath}`,
      { headers: this.headers() }
    );
    if (res.status === 404) return { notes: [], folders: [] };
    if (!res.ok) throw new Error(`Pull failed: ${await this._err(res)}`);
    const entries = await res.json();
    const files = await this._collectMarkdownFiles(entries);

    const fileInputs = [];
    for (const file of files) {
      const fileRes = await fetch(file.url, { headers: this.headers() });
      if (!fileRes.ok) continue;
      const fileData = await fileRes.json();
      const raw = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
      const rel = file.path.startsWith(this.basePath + '/') ? file.path.slice(this.basePath.length + 1) : file.path;
      const segs = rel.split('/');
      const filename = segs.pop();
      const kind = filename.endsWith('.quill.json') ? 'quill' : 'markdown';
      fileInputs.push({ relDir: segs, filename, raw, sourcePath: file.path, sourceSha: fileData.sha, kind });
    }
    return reconstructFromMarkdownFiles(fileInputs);
  }

  async _collectMarkdownFiles(entries, acc = []) {
    for (const entry of entries) {
      if (entry.type === 'file' && (entry.name.endsWith('.md') || entry.name.endsWith('.quill.json'))) {
        acc.push(entry);
      } else if (entry.type === 'dir') {
        const res = await fetch(entry.url, { headers: this.headers() });
        if (res.ok) {
          const sub = await res.json();
          await this._collectMarkdownFiles(sub, acc);
        }
      }
    }
    return acc;
  }
}
