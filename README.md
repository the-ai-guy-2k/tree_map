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

The database is created on first run at `data/tree.db` and seeded from `seed.json`
(the seed only runs when the database is empty — your edits are never overwritten).

## Deploy on Replit (from GitHub)

1. Push this repo to GitHub (already at `the-ai-guy-2k/tree_map`).
2. In Replit: **Create → Import from GitHub**, paste the repo URL.
3. Replit auto-detects Node. The included `.replit` file sets the run command to `npm start`.
   (If it asks, set the run command to `npm start` manually.)
4. The app listens on `process.env.PORT` (Replit sets this automatically).
5. Data persists in the repl's filesystem at `data/tree.db`.

> Note: make sure the Replit account's billing is current — an unpaid/suspended
> account takes deployments offline.

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
- `GET /api/export` — full JSON backup of the tree.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bubbles` | All bubbles |
| POST | `/api/bubbles` | `{parent_id, label, sub, branch}` |
| PATCH | `/api/bubbles/:id` | `{label, sub, branch, status, note, parent_id, touched}` — any edit stamps `touched` = today |
| DELETE | `/api/bubbles/:id` | Deletes the bubble and its subtree (Nebula is protected) |
| GET | `/api/export` | JSON backup download |
| GET | `/api/health` | Health check |

## Project layout

```
tree_map/
├── server.js        # Express + node:sqlite API + static hosting
├── seed.json        # Seed dataset (first run only)
├── package.json
├── .replit          # Replit run command
├── data/            # SQLite database lives here (gitignored)
└── public/
    ├── index.html   # App shell
    ├── styles.css
    └── app.js       # Tree rendering, pan/zoom, panel, search
```
