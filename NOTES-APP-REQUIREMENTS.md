# Lightweight Personal Notes App — Requirements Specification

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Draft for Implementation  
**Hosting Target:** GitHub Pages (`*.github.io`)  
**Primary Goal:** A privacy-first, offline-capable note-taking application that a user can clone, host for free on GitHub Pages, use across devices on the same local network, and optionally persist notes back into the same repository.

---

## 1. Executive Summary & Feasibility

### 1.1 Is this a good idea?

**Yes — it is a strong idea** for the following reasons:

- Completely free hosting and zero ongoing cost.
- Data stays under the user’s control (local-first + optional GitHub private storage).
- Unique combination of local-first PWA + same-network WebRTC sharing + GitHub persistence creates a compelling personal workflow that existing tools rarely offer together.
- Excellent learning / portfolio project that demonstrates modern frontend, PWA, IndexedDB, GitHub API, and WebRTC.
- Aligns with the “clone → host → use → save back to repo” mental model.

### 1.2 Is it possible?

**Yes, fully possible** with current browser and GitHub capabilities (2026):

| Capability                        | Feasibility | Notes |
|-----------------------------------|-------------|-------|
| Static frontend on GitHub Pages   | Excellent   | Pure HTML/JS/CSS or Vite build |
| Offline-first + PWA               | Excellent   | Service Worker + IndexedDB |
| Folders / Tags / Pin / Archive    | Excellent   | Client-side data model |
| Full-text search                  | Excellent   | MiniSearch or Fuse.js |
| Rich Markdown / TipTap editor     | Excellent   | Mature libraries |
| Save notes as `.md` via GitHub API| Good        | Requires user-provided Fine-grained PAT |
| Same-network live sharing (WebRTC)| Good        | DataChannel + signaling (PeerJS Cloud or manual/QR) |
| Multi-device conflict handling    | Medium      | Needs clear UX for last-write-wins or manual merge |

**Key technical enablers already proven in production:**
- Browser → GitHub Contents / Git Data API with Fine-grained PAT (used by Notesz and similar apps).
- WebRTC DataChannel for sharing application state on the same LAN.
- IndexedDB + PWA for robust offline experience.

---

## 2. Vision & Primary Usage Scenario

### 2.1 Vision Statement

> A lightweight, beautiful, offline-first note-taking PWA that lives entirely on GitHub Pages. Users clone the repository, enable Pages, and immediately have a private notes app. While working, they can share the live session with any device on the same Wi-Fi via WebRTC. When finished, they can commit the notes (as clean Markdown files) back into the same repository so the knowledge persists with the code.

### 2.2 Primary User Journey

1. User clones the repository.
2. Enables GitHub Pages (or uses an existing `gh-pages` / `docs` setup).
3. Opens `https://<username>.github.io/<repo>/` on Device A.
4. Creates folders and notes, tags them, pins important ones.
5. On Device B (same Wi-Fi), opens the same URL and joins a short-lived WebRTC session.
6. Both devices see the current notes state (read-only or collaborative depending on mode).
7. When done, user on Device A clicks **“Save to GitHub”**, provides / uses a Fine-grained PAT, and the notes are committed as Markdown files into a `notes/` directory of the same repository.
8. Next time any device loads the app (even offline), the latest local copy is available; a manual or automatic pull from GitHub can refresh the baseline.

---

## 3. Functional Requirements

### 3.1 Core Note Management (Must Have)

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-01  | Create, edit, and soft-delete notes                                         | P0       |
| FR-02  | Support hierarchical **folders** (create, rename, move, delete folders)     | P0       |
| FR-03  | Create notes inside any folder                                              | P0       |
| FR-04  | Support **tags** (add / remove / filter by multiple tags)                   | P0       |
| FR-05  | **Pin** notes (pinned notes appear at top)                                  | P0       |
| FR-06  | **Archive** notes (hide from main list, recoverable)                        | P0       |
| FR-07  | Auto-save with debounce (no explicit “Save” required for local changes)     | P0       |
| FR-08  | Note metadata: title, createdAt, updatedAt, folderId, tags[], pinned, archived, content | P0 |

### 3.2 Editor (Must Have)

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-09  | Markdown-first editor with live preview (or side-by-side)                   | P0       |
| FR-10  | Recommended: TipTap (rich text + Markdown) **or** CodeMirror 6              | P0       |
| FR-11  | Support common Markdown: headings, lists, code blocks, tables, links, images (local or URL) | P0 |
| FR-12  | Keyboard shortcuts for formatting and navigation                            | P1       |
| FR-13  | Optional simple `contenteditable` fallback for ultra-light builds           | P2       |

### 3.2.1 Dual Editor Mode — Quill (Rich Text) vs Markdown

Marginalia supports **two editor types per note**, chosen at note creation and fixed for the life of that note (switching editor type on an existing note is out of scope for now).

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-54  | User selects editor type (**Quill** rich text or Markdown) when creating a new note | P0 |
| FR-55  | **Quill is the default** editor type for new notes                          | P0       |
| FR-56  | Quill loaded via CDN `<script>` tag, no build step, consistent with existing vanilla-JS/no-bundler architecture | P0 |
| FR-57  | Quill content stored as **Delta (JSON)**, not converted to Markdown, in both IndexedDB and on local save | P0 |
| FR-58  | Note metadata gains an `editorType: 'quill' \| 'markdown'` field; opening a note loads the matching editor automatically | P0 |
| FR-59  | Quill notes support a syntax-highlighted code block format, integrated with the existing highlight.js dependency | P0 |
| FR-60  | Plain-text extraction from Quill Delta feeds the existing search index (MiniSearch/Fuse) alongside Markdown note text | P0 |
| FR-61  | Skim view / rendered preview renders Quill notes via a read-only Quill instance (or Delta→HTML render), and Markdown notes via the existing marked.js/DOMPurify pipeline | P0 |
| FR-62  | JSON export/import (FR-29/FR-31) includes `editorType` and Delta content unchanged; Markdown ZIP export (FR-30) converts Quill notes to Markdown at export time only — local storage is never converted | P1 |

### 3.3 Organization & Navigation

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-14  | Sidebar with collapsible folder tree                                        | P0       |
| FR-15  | Drag-and-drop notes between folders                                         | P1       |
| FR-16  | Quick filter by tag, pinned, archived                                       | P0       |
| FR-17  | Breadcrumb or path display when inside a folder                             | P1       |

### 3.4 Search

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-18  | Full-text client-side search across title + content                         | P0       |
| FR-19  | Library: MiniSearch (preferred) or Fuse.js                                  | P0       |
| FR-20  | Instant results while typing (debounced)                                    | P0       |
| FR-21  | Highlight matching snippets                                                 | P1       |

### 3.5 Theme & Appearance

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-22  | Dark / Light / System preference modes                                      | P0       |
| FR-23  | Smooth theme transition, persisted preference                               | P0       |
| FR-24  | High-quality typography and spacing (best-in-class UI)                      | P0       |

### 3.6 Offline & PWA

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-25  | Full offline functionality after first load                                 | P0       |
| FR-26  | Installable as PWA (“Add to Home Screen”) on mobile & desktop               | P0       |
| FR-27  | Service Worker caches app shell + assets                                    | P0       |
| FR-28  | Offline indicator in UI                                                     | P1       |

### 3.7 Import / Export

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-29  | Export all notes as JSON                                                    | P0       |
| FR-30  | Export all notes as Markdown ZIP (preserving folder structure)              | P0       |
| FR-31  | Import from previously exported JSON or Markdown ZIP                        | P0       |
| FR-32  | Export single note as `.md`                                                 | P1       |

### 3.8 GitHub Persistence (Primary Sync Mode)

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-33  | User can configure a Fine-grained Personal Access Token (PAT)               | P0       |
| FR-34  | Token stored **only** in browser (localStorage / IndexedDB), never committed | P0       |
| FR-35  | Notes saved as individual `.md` files under a configurable path (default `notes/`) | P0 |
| FR-36  | Folder hierarchy mapped to directories or front-matter `folder:` field    | P0       |
| FR-37  | “Save to GitHub” / “Sync Now” action that creates a commit                  | P0       |
| FR-38  | Optional “Pull from GitHub” to refresh local notes from the repository      | P1       |
| FR-39  | Clear status feedback (success, rate-limit, permission error)               | P0       |
| FR-40  | Support both classic Contents API and Git Data API (blob/tree/commit) for multi-file commits | P1 |
| FR-63  | Quill notes are **never** converted to Markdown for GitHub sync. Each Quill note commits its Delta as the source-of-truth file: `notes/<folder-path>/<note-slug>.quill.json` (front-matter fields + Delta content) | P0 |
| FR-64  | A read-only rendered HTML snapshot of each Quill note is committed to a **separate, non-synced folder**: `notes-html/<folder-path>/<note-slug>.html`, for readability when browsing the repo on GitHub.com. This file is write-only — never read back during Pull | P0 |
| FR-65  | HTML snapshot regeneration is **only-on-change**: compare against the last-synced `updatedAt`/content hash for that note, and only include a new `.html` blob in the commit tree if the Quill note's content actually changed since the last successful sync | P0 |
| FR-66  | Pull from GitHub (FR-38) explicitly ignores `notes-html/` — it is not authoritative and must never be reconstructed into local state | P0 |
| FR-67  | Deleting or converting a Quill note removes both its `.quill.json` and its `notes-html/*.html` via the existing stale-file deletion logic | P0 |
| FR-68  | HTML snapshots are **display-only, not re-editable**: Quill always reloads a note from its `.quill.json` Delta, never by re-importing the `.html` (Delta→HTML→Delta round-trips are not guaranteed lossless) | P0 |

### 3.9 WebRTC Peer-to-Peer Sharing (Secondary Mode)

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-41  | Ability to start a temporary sharing session on the same local network      | P0       |
| FR-42  | Other devices on the same Wi-Fi can join and view the current notes state   | P0       |
| FR-43  | Data transfer via WebRTC DataChannel (no file content leaves the LAN)      | P0       |
| FR-44  | Signaling options: PeerJS Cloud (easiest) **or** manual SDP / QR code exchange | P0 |
| FR-45  | Session is ephemeral; no permanent room or account required                 | P0       |
| FR-46  | Clear visual indicator when a peer is connected                             | P1       |
| FR-47  | Optional read-only vs collaborative mode (future)                           | P2       |

### 3.10 Best-in-Class UI / UX (Must Have)

| ID     | Requirement                                                                 | Priority |
|--------|-----------------------------------------------------------------------------|----------|
| FR-48  | Clean, modern, distraction-free interface                                   | P0       |
| FR-49  | Responsive design (mobile-first, excellent tablet & desktop experience)     | P0       |
| FR-50  | Fast perceived performance (skeleton loaders, optimistic UI)                | P0       |
| FR-51  | Keyboard-first navigation where sensible                                    | P1       |
| FR-52  | Accessible (ARIA, focus management, sufficient contrast)                    | P0       |
| FR-53  | Delightful micro-interactions without feeling heavy                         | P1       |

---

## 4. Non-Functional Requirements

| ID      | Category          | Requirement |
|---------|-------------------|-------------|
| NFR-01  | Performance       | App shell loads in < 1.5 s on typical broadband; search returns in < 100 ms for 2 000 notes |
| NFR-02  | Storage           | IndexedDB as primary store; handle at least 5 000 notes comfortably |
| NFR-03  | Security           | PAT never leaves the user’s browser; no analytics or third-party tracking by default |
| NFR-04  | Privacy           | All note content stays local unless user explicitly triggers GitHub sync or WebRTC share |
| NFR-05  | Compatibility     | Latest Chrome, Firefox, Safari, Edge (desktop + mobile) |
| NFR-06  | Bundle Size       | Target < 400 KB gzipped for core app (excluding optional heavy editor plugins) |
| NFR-07  | Maintainability   | Clear separation: UI / Domain / Storage / Sync adapters |

---

## 5. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (GitHub Pages)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │   React /   │  │   TipTap /   │  │  MiniSearch        │  │
│  │   Vue /     │  │   CodeMirror │  │  (search index)    │  │
│  │   Svelte    │  └──────────────┘  └────────────────────┘  │
│  └──────┬──────┘                                            │
│         │                                                   │
│  ┌──────▼──────────────────────────────────────────────┐    │
│  │              Domain Layer (Notes, Folders, Tags)    │    │
│  └──────┬──────────────────────┬───────────────────────┘    │
│         │                      │                            │
│  ┌──────▼──────┐        ┌──────▼──────┐                     │
│  │  IndexedDB  │        │  Sync       │                     │
│  │  (primary)  │        │  Adapters   │                     │
│  └─────────────┘        └──────┬──────┘                     │
│                                │                            │
│               ┌────────────────┼────────────────┐           │
│               │                │                │           │
│        ┌──────▼─────┐   ┌──────▼─────┐   ┌──────▼─────┐     │
│        │ GitHub API │   │  WebRTC    │   │ Export/    │     │
│        │  Adapter   │   │  Adapter   │   │ Import     │     │
│        └────────────┘   └────────────┘   └────────────┘     │
└─────────────────────────────────────────────────────────────┘
          │                     │
          ▼                     ▼
   GitHub Repository      Same Wi-Fi Device
   (notes/*.md)           (DataChannel)
```

### 5.1 Data Model (Suggested)

```ts
interface Note {
  id: string;                 // uuid
  title: string;
  editorType: 'quill' | 'markdown'; // default: 'quill'
  content: string;            // Markdown text, OR Quill Delta serialized as JSON string
  folderId: string | null;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  createdAt: string;          // ISO
  updatedAt: string;          // ISO
  // optional GitHub metadata
  githubPath?: string;        // notes/<path>/<slug>.md or .quill.json
  githubSha?: string;
  githubHtmlPath?: string;    // notes-html/<path>/<slug>.html (Quill notes only)
  githubHtmlSha?: string;
  lastHtmlSyncedAt?: string;  // ISO — used for only-on-change HTML regeneration
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Folder hierarchy is stored as a tree in IndexedDB and mapped to a directory structure (or front-matter) when exporting / syncing to GitHub.

---

## 6. Storage & Sync Strategies

### 6.1 Local (Always On)

- Primary store: **IndexedDB** (via Dexie.js or idb).
- Auto-save every change (debounced).
- Service Worker keeps the app usable offline.

### 6.2 GitHub API Sync

- User generates a **Fine-grained Personal Access Token** with:
  - Repository access: only the notes repository
  - Permissions: Contents (Read & Write), Metadata (Read)
- Token is entered once in the app Settings and stored locally.
- On “Save to GitHub”:
  1. Serialize current notes + folders into files, **branching by `editorType`**:
     - Markdown notes → `notes/<folder-path>/<note-slug>.md` (unchanged)
     - Quill notes → `notes/<folder-path>/<note-slug>.quill.json` (front-matter + Delta, source of truth) **plus**, only if content changed since last sync, a regenerated `notes-html/<folder-path>/<note-slug>.html` (read-only rendered snapshot; see FR-63–FR-68)
  2. Use GitHub Contents API or Git Data API to create a single atomic commit covering all changed files across both formats.
  3. Pull explicitly skips `notes-html/` entirely — it is never treated as authoritative.
- Front-matter recommended for metadata:

```markdown
---
title: Meeting Notes
tags: [work, project-x]
pinned: true
created: 2026-08-05T10:00:00Z
updated: 2026-08-05T12:30:00Z
---

# Meeting Notes

Content here...
```

### 6.3 WebRTC Peer-to-Peer (Same Network)

- One device becomes the **host** and creates a short-lived session.
- Other devices join via:
  - PeerJS Cloud room code, **or**
  - QR code / manual SDP exchange (fully serverless).
- Once connected, the host streams a snapshot (or incremental updates) of the current notes state over a reliable DataChannel.
- Ideal for “I want to quickly show / continue working on another device in the same room”.
- No data leaves the local network.

---

## 7. Recommended Tech Stack

| Layer              | Recommendation                          | Alternatives                  |
|--------------------|-----------------------------------------|-------------------------------|
| Framework          | React 19 + TypeScript **or** Vue 3      | Svelte, Solid                 |
| Build              | Vite                                    | —                             |
| Styling            | Tailwind CSS + shadcn/ui or Radix       | Vanilla CSS, UnoCSS           |
| Editor             | Quill (rich text, default) + Markdown editor (dual mode) | TipTap, CodeMirror 6, Milkdown |
| Local DB           | Dexie.js (IndexedDB wrapper)            | idb, RxDB                     |
| Search             | MiniSearch                              | Fuse.js                       |
| PWA                | vite-plugin-pwa                         | Workbox manually              |
| GitHub Client      | @octokit/rest or fetch + Contents API   | isomorphic-git (heavier)      |
| WebRTC             | PeerJS (easiest) or native + manual SDP | simple-peer                   |
| State              | Zustand / Pinia / Jotai                 | Redux Toolkit                 |
| Icons              | Lucide                                  | Heroicons                     |

---

## 8. UI / UX Principles (Best-in-Class)

- **Distraction-free writing**: editor takes center stage; chrome is minimal.
- **Instant feedback**: every action feels immediate (optimistic updates).
- **Clear hierarchy**: folders on the left, notes list, then editor.
- **Mobile excellence**: bottom navigation or slide-over sidebar on small screens.
- **Empty states**: helpful illustrations and clear next actions.
- **Status awareness**: subtle indicators for offline, syncing, peer connected.
- **Keyboard first**: power users should rarely need the mouse.
- **Accessibility**: full keyboard navigation, proper ARIA labels, reduced-motion support.

---

## 9. Phased Implementation Roadmap

### Phase 1 — Core Local App (MVP)
- Project scaffolding (Vite + chosen framework + Tailwind)
- IndexedDB data model + CRUD
- Folders + Tags + Pin + Archive
- TipTap / CodeMirror editor
- Full-text search
- Dark / Light mode
- Basic responsive UI
- Export / Import (JSON)
- PWA support

### Phase 2 — GitHub Persistence
- Settings screen for PAT + repo configuration
- Serialize notes → Markdown with front-matter
- Commit via GitHub API
- Pull from GitHub
- Conflict / error handling UX

### Phase 3 — WebRTC Sharing
- Host / Join session UI
- PeerJS (or manual SDP) integration
- Snapshot transfer of current notes state
- Connection status indicators

### Phase 4 — Polish & Advanced
- Drag-and-drop organization
- Markdown ZIP export/import preserving folders
- Keyboard shortcuts panel
- Performance optimizations for large note sets
- Optional encryption of local store

### Phase 5 — Dual Editor Mode (Quill + Markdown)
- Quill CDN integration, no-build-step (consistent with existing stack)
- Editor-type picker on note creation, Quill as default
- `editorType` field added to Note model + IndexedDB schema
- Quill Delta search-index text extraction
- Skim view rendering for Quill notes (read-only Quill / Delta→HTML)
- GitHub sync: `.quill.json` (source of truth) + only-on-change `notes-html/*.html` snapshot
- Pull logic updated to ignore `notes-html/`
- Stale-file deletion extended to cover both Quill file types

---

## 10. Risks & Mitigations

| Risk                              | Impact | Mitigation |
|-----------------------------------|--------|------------|
| User loses PAT or mistypes it     | High   | Clear instructions + “Test connection” button |
| Concurrent edits from two devices | Medium | Last-write-wins + timestamp comparison; later: CRDT or manual merge |
| GitHub API rate limits            | Medium | Batch commits, show remaining quota, exponential backoff |
| WebRTC fails on some networks     | Medium | Fallback to manual SDP/QR + clear error messages |
| IndexedDB cleared by browser      | High   | Prominent Export button + optional auto-backup reminders |
| Large images / attachments        | Medium | Defer or store as external links initially |

---

## 11. Success Criteria

- A user can clone the repo, enable Pages, and start taking notes in under 5 minutes.
- Notes remain available offline after first visit.
- A second device on the same Wi-Fi can view the live session within 30 seconds.
- Notes can be committed back to the repository as clean Markdown with one click (after PAT setup).
- The app feels fast, calm, and professional on both phone and desktop.
- Zero data leaves the user’s control unless they explicitly choose to sync or share.

---

## 12. Open Questions / Decisions Needed

1. Preferred framework: React, Vue, or Svelte?
2. ~~Editor preference: TipTap (richer) vs CodeMirror (more Markdown-native)?~~ **Resolved:** dual mode — Quill (rich text, default) or Markdown editor, chosen per note. See §3.2.1 and FR-54–FR-68.
3. Should WebRTC sessions allow collaborative editing in Phase 3, or stay view-only initially?
4. Folder structure in GitHub: real directories or flat files + front-matter path?
5. Do we want optional end-to-end encryption of the local store (passphrase)?
6. Should editor type be switchable on an existing note post-creation (currently out of scope — see §3.2.1)?

---

## 13. Conclusion

This architecture is **both desirable and technically feasible**.  

It delivers a modern, privacy-respecting, offline-first notes experience while leveraging the free infrastructure of GitHub Pages and the power of WebRTC for local network convenience. The dual persistence model (local-first + optional GitHub) plus ephemeral same-network sharing creates a workflow that is rare among existing tools and highly practical for personal knowledge management.

The project can be delivered incrementally, with a solid local MVP in Phase 1 that already provides significant value.

---

*Document prepared for implementation planning. Ready to be exported, version-controlled, and used as the living requirements baseline.*
