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
and compares that timestamp against your newest local note. If they
disagree by more than a few seconds, a banner appears at the top with
**Push** and **Pull** buttons (whichever direction looks right is
highlighted) so you can resolve it without opening Settings. A bad token,
being offline, or a rate limit just fails silently here — real errors
still surface when you use the GitHub sync modal directly.

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
