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

**Save to GitHub** commits every note as a Markdown file with front-matter
in a single atomic commit (via the Git Data API — not one request per
file). **Pull from GitHub** reads that folder back in. The token never
leaves your browser except to talk to `api.github.com`.

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

The joining device sees a read-only snapshot of the host's current notes.
It's intentionally view-only and never writes anything into its own
storage — there's no merge or write-back in this version. Sessions are
ephemeral and close when you close the dialog or the tab.

Note: PeerJS mode depends on that free signaling service being reachable
and on your network allowing the resulting WebRTC connection through. Most
home Wi-Fi works fine; some corporate/guest networks with client isolation
will block it — use Offline mode there, or accept it may not connect.

## What's not built yet

- **Markdown ZIP export/import with folder structure** (Phase 4) is on
  the roadmap in `NOTES-APP-REQUIREMENTS.md` but not implemented.
- Conflict handling is last-write-wins only — there's no merge UI. If you
  edit the same note from two devices before syncing, the later save wins.
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
