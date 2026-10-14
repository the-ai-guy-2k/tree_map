# TAIG Tree Map Live

Sanil's tree-map UI as a real app: the same bottom-up tree (Nebula base → TAIG ITS, TAIG Promo, TAIG TAN, COTT),
backed by a SQLite database so **everything persists** — bubble notes, statuses, label/sub edits, added/removed
bubbles, and last-touched dates.

## Run locally

Requires Node 22+ (uses the built-in `node:sqlite` — no native modules).

```bash
npm install
npm start
```

Open http://localhost:3000

`npm test` runs the API suite and then the headless UI suite. It starts and stops its own server on a temporary database, so it does not touch `data/tree.db`. The first run downloads Playwright's Chromium.

The database is created on first run at `data/tree.db` and seeded from `seed.json`
(the seed only runs when the database is empty — your edits are never overwritten).

## Shared JSON

Edit locally, save, then press **Sync**. The tree is written to `TAIG-Tree-Map.json` on the Kobe shared drive. Muse reads that file every 15 minutes and can write it back. SQLite remains the local store of record. The JSON file is only the interchange.

`SHARED_JSON_PATH` is the full path to that file. **The default is unset (empty), so sync stays off** until you point it at the Drive folder on this machine. Google Drive for Desktop mounts the Kobe folder at a different path on each computer.

```bash
# bash
SHARED_JSON_PATH="/path/to/Kobe/TAIG-Tree-Map.json" npm start

# Windows PowerShell
$env:SHARED_JSON_PATH = "G:\Shared drives\Kobe\TAIG-Tree-Map.json"
npm start
```

On startup, if that file exists and its `meta.exportedAt` is newer than the database's last write, the app imports it. Rows are matched by bubble id. A repeated id keeps the entry with the latest `touched`; if those dates are equal, it keeps the fuller note. The import upserts. It does not delete local bubbles that are absent from the file, and it does not create bubbles that are not in the file.

**Sync** writes schema v1 with `exportedBy` set to `app` and a new `exportedAt`. The only bubble fields in the file are `id`, `label`, `sub`, `branch`, `parentId`, `touched`, `note`, and `status`.

Last writer wins. Do not edit the tree in the app and in Muse inside the same 15-minute window. On the next startup, the newer `exportedAt` (compared with the local last write) is the copy that sticks.

## Deploy to Replit

Import from GitHub → select repo → branch `deployable` → Run.

1. In Replit: **Create → Import from GitHub**, and select `the-ai-guy-2k/tree_map`.
2. Choose the `deployable` branch. That branch is the demo baseline.
3. Run. The included `.replit` file sets the run command to `npm start`.
4. The app listens on `process.env.PORT` (Replit sets this; locally it falls back to 3000).
5. On first run the empty database is seeded from `seed.json`. Later runs leave existing data alone. The file lives at `data/tree.db` and is not committed.

> Note: make sure the Replit account's billing is current — an unpaid/suspended
> account takes deployments offline.

## Branch protection

`deployable` is the demo branch. GitHub Actions (`.github/workflows/ci.yml`) runs on every push and on every pull request into `main` or `deployable`. The three checks are `api-tests`, `ui-tests`, and `structure`. Replit imports `deployable` from GitHub, so a green merge is the deploy. Nothing should merge until those checks pass. GitHub will not enforce that until the branch rule is on, and this account cannot turn the rule on through the API. After the workflow has run once, turn it on:

1. Open [the-ai-guy-2k/tree_map](https://github.com/the-ai-guy-2k/tree_map).
2. **Settings → Branches → Add rule**.
3. Branch name pattern: `deployable`.
4. Turn on **Require a pull request before merging**.
5. Turn on **Require status checks to pass before merging**.
6. In the status-check search box, add `api-tests`, `ui-tests`, and `structure`.
7. Save changes.

If those three names are missing from the search box, open a pull request so Actions can run once, then come back and add them.

## Features

- Bottom-up tree rendering (Nebula oval base, four domain hubs)
- Pan (drag), zoom (scroll), Fit / Expand all / Fold controls
- Per-domain focus tabs (Overview, TAIG ITS, TAIG Promo, TAIG TAN, COTT)
- Search across labels, sub-lines, and notes (Enter jumps to first match)
- Click any bubble → detail panel:
  - Edit label + sub-line inline
  - Status: Active / Waiting / Done / Blocked (colored dots)
  - Per-bubble notes (noted bubbles wear a ✎ marker) — **saved to the database**
  - Branch color picker
  - Add child bubble under any bubble, delete bubbles (whole subtree)
  - Fold / unfold branches
- TODAY tags: computed from each bubble's last-touched date vs the viewer's date —
  they clear on their own each day. Any edit marks the bubble touched today.
- Sync writes the tree to the shared JSON file (`SHARED_JSON_PATH`) for Muse's 15-minute pickup.
- `GET /api/export` — full JSON backup of the tree.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bubbles` | All bubbles |
| POST | `/api/bubbles` | `{parent_id, label, sub, branch}` |
| PATCH | `/api/bubbles/:id` | `{label, sub, branch, status, note, parent_id, touched}` — any edit stamps `touched` = today |
| DELETE | `/api/bubbles/:id` | Deletes the bubble and its subtree (Nebula is protected) |
| GET | `/api/export` | JSON backup download |
| POST | `/api/sync` | Write schema v1 to `SHARED_JSON_PATH` |
| GET | `/api/health` | Health check |

## Project layout

```
tree_map/
├── server.js        # Express + node:sqlite API + static hosting
├── seed.json        # Seed dataset (first run only)
├── package.json
├── .replit          # Replit run command
├── .github/workflows/ci.yml
├── tests/           # API suite, Playwright UI suite, structure checks
├── data/            # SQLite database lives here (gitignored)
└── public/
    ├── index.html   # App shell
    ├── style.css
    └── app.js       # Tree rendering, pan/zoom, panel, search
```
