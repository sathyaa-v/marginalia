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
 * front-matter field (human-readable, exact names) when present;
 * otherwise it falls back to the physical directory the file was found
 * in (for files added by hand, with no front-matter).
 *
 * @param {Array<{relDir: string[], filename: string, raw: string, sourcePath?: string, sourceSha?: string}>} files
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
    const { meta, content } = parseMarkdown(file.raw);
    const segments = meta.folder ? meta.folder.split('/').filter(Boolean) : (file.relDir || []);
    const folderId = ensureFolder(segments);

    notes.push({
      title: meta.title || file.filename.replace(/\.md$/, ''),
      content,
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
  async saveNotes(notes, folders, { commitMessage, previousPaths = new Set() } = {}) {
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

    // 1. Create a blob per note, and track the set of paths this push writes.
    const treeEntries = [];
    const newPaths = new Set();
    for (const note of notes) {
      const path = `${this.basePath}/${folderPath(folders, note.folderId)}`
        .replace(/\/+$/, '')
        .concat(`/${slugify(note.title)}-${note.id.slice(0, 8)}.md`)
        .replace(/^\/+/, '');
      const content = noteToMarkdown(note, folders);
      const blobRes = await fetch(
        `${API}/repos/${this.owner}/${this.repo}/git/blobs`,
        {
          method: 'POST',
          headers: { ...this.headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, encoding: 'utf-8' }),
        }
      );
      if (!blobRes.ok) throw new Error(`Blob create failed: ${await this._err(blobRes)}`);
      const blob = await blobRes.json();
      treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      newPaths.add(path);
      note.githubPath = path;
      note.githubSha = blob.sha;
    }

    // 1b. Delete any previously-synced path that isn't being written this
    // time — covers locally-deleted notes and renames (old slug/path).
    // Only touch paths under our own basePath, as a safety guard.
    let deletedCount = 0;
    for (const oldPath of previousPaths) {
      if (!oldPath || !oldPath.startsWith(this.basePath + '/')) continue;
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
    };
  }

  /**
   * Pull all .md files under basePath and parse them back into notes,
   * also reconstructing the folder hierarchy so pulled notes land back
   * in the right folder instead of unfiled. Folder identity comes from
   * each note's `folder:` front-matter field (human-readable, exact
   * names) when present; for files that predate that field, or were
   * added to the repo by hand, it falls back to the physical directory
   * path the file was found in.
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
      fileInputs.push({ relDir: segs, filename, raw, sourcePath: file.path, sourceSha: fileData.sha });
    }
    return reconstructFromMarkdownFiles(fileInputs);
  }

  async _collectMarkdownFiles(entries, acc = []) {
    for (const entry of entries) {
      if (entry.type === 'file' && entry.name.endsWith('.md')) {
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
