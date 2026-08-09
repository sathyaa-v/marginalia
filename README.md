# Marginalia — a local-first notebook for GitHub Pages

A privacy-first, offline-capable notes app. No build step, no server, no
account. Clone it, turn on GitHub Pages, and it's yours.

## Get it running (under 5 minutes)

1. **Clone or fork this repository.**
2. **Enable GitHub Pages**: repo Settings → Pages → Source → "Deploy from a
   branch" → pick `main` and `/ (root)` → Save.
3. Open `https://<your-username>.github.io/<repo-name>/`. That's it — you
   have a private notes app. Nothing is sent anywhere until you choose to
   sync or share.
4. Optional: tap **Install** in your browser's address bar (or "Add to Home
   Screen" on mobile) to use it like a native app, offline.

## Table of contents

Notes with 3 or more headings get an auto-generated, collapsible table of
contents at the top of the preview pane. Click any entry to smooth-scroll
to that section. Short notes don't get one — no clutter for a two-paragraph
note.

## Markdown ZIP export/import

Alongside JSON export/import, the sidebar now has **Export as Markdown
ZIP** and **Import Markdown ZIP**:

- **Export** writes every note as a `.md` file with front-matter, nested
  into folders matching your actual folder structure — this uses the
  exact same front-matter format as GitHub sync, so a ZIP export is
  readable by the same tooling.
- **Import** reads a ZIP (yours or one built by hand) and reconstructs
  folders from each file's `folder:` front-matter field, falling back to
  the file's physical directory if that field is missing. Import is
  **additive** (like JSON import) — it doesn't reset or delete anything
  local; only the GitHub "Pull & reset" flow does that.

## Smooth transitions

Color and shadow changes (theme/palette switching, hover states, note
selection) now animate instead of snapping instantly; modals fade and
scale in; mobile tab switches fade in; note cards lift slightly on hover;
TOC navigation smooth-scrolls. All of this respects
`prefers-reduced-motion` — durations collapse to effectively zero if the
OS setting is on.

## Theme

The 🎨 **Theme** button in the sidebar opens a picker with two independent
choices:

- **Appearance** — System / Light / Dark, same as before.
- **Text size** — Small / Medium / Large / X-Large. Scales font sizes
  throughout the app (note list, editor, previews, modals — not just one
  panel), so it works as a real accessibility control, not a cosmetic one.
- **Palette** — five color themes, each with its own light and dark
  variant: **Ledger** (the original warm ochre/teal/clay), **Slate**
  (cool blue-gray), **Forest** (earthy green), **Rosewood** (warm
  brick/terracotta), and **Ink & Paper** (monochrome, high contrast).

All three choices persist independently (`localStorage`).

## Skim view

Sometimes you want to scan several notes' actual formatting, not just a
plain-text snippet. Two entry points, same underlying view (respects
whatever folder/tag/search filter is currently active):

- **Desktop**: the 📖 button in the note list header toggles between
  compact cards and full rendered previews (headings, code blocks, lists,
  etc.), faded out after ~220px so you can skim many notes at once.
- **Mobile**: a dedicated **Skim** tab alongside Library/Notes/Write.

Clicking any card opens that note in the editor as usual.

## Markdown syntax reference

The ❓ button in the editor toolbar opens a categorized list of markdown
syntax (headings, emphasis, lists, blocks, links/media, tables). Tapping
an item inserts it at your cursor — or wraps your current selection for
things like bold/italic/inline code/links, same as the keyboard shortcuts.

## Dual editor mode: Quill (rich text) or Markdown

Every note now has an `editorType`, chosen once at creation and fixed for
that note's lifetime (switching an existing note's type isn't supported —
matches the requirements doc's explicit scope call).

- **New notes default to Quill** (rich text, WYSIWYG) — just click **+
  New**.
- To create a **Markdown** note instead, click the small **▾** next to
  **+ New** and choose it from the dropdown.
- Opening any note automatically loads the matching editor — Quill notes
  show the Quill toolbar and WYSIWYG surface; Markdown notes show the
  familiar textarea (with preview toggle and syntax reference, which are
  hidden for Quill notes since Quill's own toolbar already covers that).
- Quill content is stored as **Delta (JSON)**, not converted to Markdown,
  in IndexedDB and on every local save — verified by reading straight
  from IndexedDB in testing rather than trusting the code by inspection.
- Quill is loaded via a pinned CDN `<script>` tag
  (`quill@1.3.7`), consistent with the rest of the stack — no bundler.

**Scope note — what's actually wired up vs. not:**

- **Implemented:** the core editor experience (FR-54–FR-58) — type
  picker, Quill-by-default, CDN loading, Delta storage, correct editor
  auto-loading. Also wired: Quill's built-in syntax highlighting via the
  shared highlight.js instance (FR-59), search indexing against Quill's
  extracted plain text instead of raw Delta JSON (FR-60), skim-view
  rendering of Quill notes via Quill's own renderer (FR-61), Markdown
  ZIP / single-note export converting Quill notes to Markdown at export
  time only (FR-62), and full GitHub sync (FR-63–FR-68): pushing a Quill
  note commits its Delta as `.quill.json` (source of truth, verified via
  an actual push→pull round trip in testing — content, tags, pin state,
  and folder nesting all survive intact) *and* a companion read-only
  `notes-html/*.html` snapshot rendered through Quill's own renderer, so
  the note is human-readable if you browse the repo on GitHub directly.
  The snapshot only regenerates when the note actually changed since the
  last sync, and both files get cleaned up together when a note is
  deleted or its GitHub sync path changes.
- **Known limitation:** pull never reads `notes-html/` back (by design —
  it's write-only, sourced fresh from `.quill.json` every time), so after
  a pull, the next push will regenerate every Quill note's HTML snapshot
  once, even for notes that didn't actually change — a minor inefficiency,
  not a correctness issue.

Full detail in `NOTES-APP-REQUIREMENTS.md` §3.2.1.

## Editor improvements (behavior only — same textarea + preview layout)

- **Sanitized preview.** Rendered Markdown now goes through DOMPurify
  before hitting the page. Previously `marked.parse()` output went
  straight into `innerHTML`, which meant a note containing malicious HTML
  — typed, JSON-imported, or pulled from a repo — could execute in the
  preview pane. Worth pulling if you ever remove the DOMPurify script tag.
- **Syntax highlighting** in fenced code blocks (highlight.js), themed to
  match the app's existing palette rather than a stock theme.
- **Tab / Shift+Tab** indent and outdent the current line (or selected
  lines) by two spaces, instead of moving focus out of the editor.
- **Enter inside a list** continues the `-`/`1.`/`- [ ]` marker on the next
  line; pressing Enter again on an empty item removes the marker and exits
  the list.
- **Formatting shortcuts**, active while the editor has focus:
  `Cmd/Ctrl+B` bold, `Cmd/Ctrl+I` italic, `Cmd/Ctrl+E` inline code,
  `Cmd/Ctrl+K` insert link, `Cmd/Ctrl+Shift+C` fenced code block. Each
  toggles off if the selection is already wrapped.
- **Smart paste** — pasting a URL over a text selection wraps the
  selection as a markdown link instead of overwriting it with the raw URL.
- **Auto-pairing** — typing `(`, `[`, `{`, `"`, `'`, or `` ` `` while text
  is selected wraps the selection instead of replacing it.
- **Word count / reading time** now show in the existing metadata line
  under the title.

## What works today (Phase 1)

- Create, edit, pin, archive, and soft-delete notes
- Folders and tags, with quick filtering
- Markdown editor with live preview
- Instant full-text search
- Light / dark / system theme
- Full offline support once loaded (installable PWA)
- Export all notes as JSON, export a single note as `.md`
- Import from a JSON export

## GitHub sync (Phase 2, included)

Open **GitHub sync** in the sidebar and provide:

- A **Fine-grained Personal Access Token** scoped to *this one repository*,
  with **Contents: Read & Write** and **Metadata: Read** permissions —
  nothing more. Create one at
  `github.com/settings/personal-access-tokens/new`.
- The repo owner, repo name, and the path notes should live under
  (defaults to `notes/`).

**Push (overwrite repo)** commits every active note as a Markdown file with
front-matter in a single atomic commit (via the Git Data API — not one
request per file), and **mirrors** your local notes: any file in the repo
that no longer matches a local note (because you deleted it, or renamed it
so its slug changed) is removed from the repo too, not just left behind.

**Pull & reset local notes** replaces your local notes wholesale with
whatever's currently in the repo — it's a reset, not a merge, so pulling
twice in a row doesn't create duplicates. Because it discards anything
local you haven't pushed yet, it asks you to click twice to confirm.

Using the same PAT + owner/repo/path on a second browser or device lets it
read and write the same repository, effectively syncing your notes across
them — push from one, pull-and-reset on the other. The token never leaves
your browser except to talk to `api.github.com`.

**Folders sync too.** Push writes each note under its folder's directory
in the repo (`notes/work/sub-project/...`) *and* records the folder's
real name/path in front-matter (`folder: "Work/Sub Project"`), so casing
and spacing survive round-trips even though the directory name itself is
slugified. Pull rebuilds the folder hierarchy locally from that field —
new folders are created as needed, matching names are reused, and each
note is filed into the right one. (Files added to the repo by hand, with
no `folder:` field, fall back to whatever directory they're sitting in.)

Conflict handling is last-write-wins only; there's no merge UI, so if you
edit the same note on two devices before syncing, whichever side pushes
or pulls last wins.

### Automatic sync check on load

Once a PAT is configured, every time the app loads it makes one lightweight
API call (the latest commit touching the notes path — no file contents)
and compares it against a **sync baseline** recorded locally the last time
this browser actually pushed or pulled this specific repo — not against
your notes' own edit timestamps. (An earlier version compared "when was
this note last edited" directly against "when was the latest commit,"
which are two different clocks — a commit is always at least as new as
the edit it contains, so that comparison falsely claimed GitHub was newer
right after a clean pull. Fixed by tracking what was actually synced.)

If GitHub has changed since your last sync, or you've edited locally
since then, a banner appears at the top with **Push** and **Pull**
buttons (whichever direction looks right is highlighted; if both sides
changed, neither is emphasized). A bad token, being offline, or a rate
limit just fails silently here — real errors still surface when you use
the GitHub sync modal directly.

## Share on Wi-Fi (Phase 3, included)

Open **Share on Wi-Fi** in the sidebar, pick **Host** on one device and
**Join** on the other, both on the same Wi-Fi network. Two modes:

- **Easy (PeerJS)** — the host gets a short code, the joiner types it in.
  A brief connection handshake is relayed through PeerJS's free signaling
  service; your note *content* never touches it, only the two devices
  finding each other.
- **Offline (manual)** — no third party involved at all. The host
  generates a connection code you copy to the other device by hand; the
  joiner generates a reply code you copy back. Clunkier, but genuinely
  nothing leaves the LAN.

The joining device sees a read-only snapshot of the host's current notes,
and can copy an individual note into its own local library with **Import
to my notes** — that's a one-time copy, not live sync back to the host.

Note: PeerJS mode depends on that free signaling service being reachable
and on your network allowing the resulting WebRTC connection through. Most
home Wi-Fi works fine; some corporate/guest networks with client isolation
will block it — use Offline mode there, or accept it may not connect.

## What's not built yet

- **Markdown ZIP export/import with folder structure** (Phase 4) is on
  the roadmap in `NOTES-APP-REQUIREMENTS.md` but not implemented.
- Conflict handling is last-write-wins only — there's no merge UI.
- Wi-Fi sharing is view-only; there's no collaborative editing (out of
  scope per the spec, FR-47).

## A note on data durability

Your notes live in this browser's IndexedDB. That's normally durable, but
iOS Safari in particular can evict site data under storage pressure with no
warning. The app asks the browser to persist storage on first load, and
will nudge you to export or sync once you've built up a meaningful number
of notes — but **export regularly** (sidebar → "Export notes") if these
notes matter to you.

## Project structure

```
index.html          app shell
css/styles.css       all styling (CSS custom properties for theming)
js/db.js             IndexedDB wrapper
js/search.js         in-house full-text search
js/github.js         GitHub Git Data API sync adapter
js/webrtc.js         Same-Wi-Fi sharing (PeerJS + manual SDP)
js/app.js            UI state, rendering, event wiring
manifest.json, sw.js PWA manifest + service worker
NOTES-APP-REQUIREMENTS.md   full requirements spec and roadmap
```

No package.json, no build tooling — edit the files and refresh.
