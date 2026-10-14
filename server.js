// TAIG Tree Map Live — Express + node:sqlite.
// Seed runs only when the database is empty. Existing notes are never wiped.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.TREE_DB
  ? path.resolve(process.env.TREE_DB)
  : path.join(DATA_DIR, 'tree.db');
// Empty by default. Drive mount paths differ per machine, so sync stays off until this is set.
const SHARED_JSON_PATH = process.env.SHARED_JSON_PATH || '';

const BRANCHES = new Set([
  'nebula', 'its', 'taig2k', 'services', 'duval', 'funding', 'clients',
  'c3', 'ideas', 'social', 'promo', 'future', 'tan', 'cott',
]);
const STATUSES = new Set(['active', 'waiting', 'done', 'blocked', 'none']);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS bubbles (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    label TEXT NOT NULL,
    sub TEXT DEFAULT '',
    branch TEXT DEFAULT 'its',
    status TEXT DEFAULT '',
    note TEXT DEFAULT '',
    touched TEXT DEFAULT '',
    sort INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_parent ON bubbles(parent_id);
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function newId() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function apiStatus(stored) {
  if (!stored || stored === 'none') return 'none';
  return STATUSES.has(stored) ? stored : 'none';
}

function storeStatus(status) {
  return !status || status === 'none' ? '' : status;
}

function rowToBubble(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    sub: row.sub || '',
    branch: row.branch || 'its',
    parentId: row.parent_id || null,
    touched: row.touched || '',
    note: row.note || '',
    status: apiStatus(row.status),
    sort: row.sort ?? 0,
  };
}

function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM bubbles').get();
  if (row.cnt > 0) return;
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  const ins = db.prepare(
    'INSERT INTO bubbles (id, parent_id, label, sub, branch, status, note, touched, sort) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  seed.bubbles.forEach((b, i) => {
    ins.run(
      b.id, b.parent_id || null, b.label, b.sub || '', b.branch || 'its',
      b.status || '', b.note || '', b.touched || '', b.sort ?? i
    );
  });
  console.log(`Seeded ${seed.bubbles.length} bubbles`);
}
seedIfEmpty();

function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : '';
}

function setMeta(key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function stampWrite() {
  setMeta('lastWrite', new Date().toISOString());
}

function timeMs(iso) {
  const n = Date.parse(iso || '');
  return Number.isFinite(n) ? n : 0;
}

function asText(value) {
  return typeof value === 'string' ? value : '';
}

function preferBubble(current, incoming) {
  const currentTouched = asText(current.touched);
  const incomingTouched = asText(incoming.touched);
  if (currentTouched !== incomingTouched) return incomingTouched > currentTouched ? incoming : current;
  const currentNote = asText(current.note).length;
  const incomingNote = asText(incoming.note).length;
  if (currentNote !== incomingNote) return incomingNote > currentNote ? incoming : current;
  return incoming;
}

function dedupeShared(list) {
  const byId = new Map();
  for (const raw of list) {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue;
    if (typeof raw.label !== 'string' || !raw.label.trim()) continue;
    const id = raw.id.trim();
    const entry = {
      id,
      label: raw.label.trim(),
      sub: raw.sub == null ? '' : asText(raw.sub),
      branch: typeof raw.branch === 'string' && BRANCHES.has(raw.branch) ? raw.branch : '',
      parentId: typeof raw.parentId === 'string' && raw.parentId.trim() ? raw.parentId.trim() : null,
      touched: asText(raw.touched),
      note: asText(raw.note),
      status: typeof raw.status === 'string' && STATUSES.has(raw.status) ? raw.status : 'none',
    };
    const prev = byId.get(id);
    byId.set(id, prev ? preferBubble(prev, entry) : entry);
  }
  return [...byId.values()];
}

function importSharedJson() {
  if (!SHARED_JSON_PATH || !fs.existsSync(SHARED_JSON_PATH)) return;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(SHARED_JSON_PATH, 'utf8'));
  } catch (err) {
    console.error('Shared JSON could not be read');
    return;
  }
  if (!doc || !doc.meta || doc.meta.schemaVersion !== 1 || !Array.isArray(doc.bubbles)) {
    console.error('Shared JSON is not schema v1');
    return;
  }
  const exportedAt = typeof doc.meta.exportedAt === 'string' ? doc.meta.exportedAt : '';
  if (!exportedAt || !timeMs(exportedAt)) {
    console.error('Shared JSON has no exportedAt');
    return;
  }
  const lastWrite = getMeta('lastWrite');
  if (lastWrite && timeMs(exportedAt) <= timeMs(lastWrite)) {
    console.log('Shared JSON is not newer than the local tree');
    return;
  }
  const incoming = dedupeShared(doc.bubbles);
  const upsert = db.prepare(`
    INSERT INTO bubbles (id, parent_id, label, sub, branch, status, note, touched, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      parent_id = excluded.parent_id,
      label = excluded.label,
      sub = excluded.sub,
      branch = excluded.branch,
      status = excluded.status,
      note = excluded.note,
      touched = excluded.touched
  `);
  const nextSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM bubbles WHERE parent_id IS ?');
  db.exec('BEGIN');
  try {
    for (const b of incoming) {
      const sort = (nextSort.get(b.parentId)?.m ?? -1) + 1;
      upsert.run(
        b.id, b.parentId, b.label, b.sub, b.branch, storeStatus(b.status), b.note, b.touched, sort
      );
    }
    setMeta('lastWrite', exportedAt);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Shared JSON import failed');
    return;
  }
  console.log(`Imported ${incoming.length} bubbles from shared JSON`);
}
importSharedJson();

function sharedBubble(row) {
  return {
    id: row.id,
    label: row.label,
    sub: row.sub ? row.sub : null,
    branch: row.branch ? row.branch : null,
    parentId: row.parent_id || null,
    touched: row.touched ? row.touched : null,
    note: row.note || '',
    status: apiStatus(row.status),
  };
}

function buildSharedDoc() {
  const rows = db.prepare('SELECT * FROM bubbles ORDER BY sort, label').all();
  const bubbles = rows.map(sharedBubble);
  return {
    meta: {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: 'app',
      bubbleCount: bubbles.length,
    },
    bubbles,
  };
}

function writeSharedJson(doc) {
  const dir = path.dirname(SHARED_JSON_PATH);
  if (!fs.existsSync(dir)) {
    const err = new Error('shared directory missing');
    err.code = 'ENOENT';
    throw err;
  }
  const tmp = `${SHARED_JSON_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  try {
    fs.renameSync(tmp, SHARED_JSON_PATH);
  } catch (err) {
    fs.rmSync(SHARED_JSON_PATH, { force: true });
    fs.renameSync(tmp, SHARED_JSON_PATH);
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readBubble(id) {
  return db.prepare('SELECT * FROM bubbles WHERE id = ?').get(id);
}

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/bubbles', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM bubbles ORDER BY sort, label').all();
    res.json({ bubbles: rows.map(rowToBubble) });
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.post('/api/bubbles', (req, res) => {
  try {
    const b = req.body || {};
    const parentId = b.parentId === undefined ? (b.parent_id ?? null) : b.parentId;
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (!label) return res.status(400).json({ error: 'label required' });
    if (!parentId || typeof parentId !== 'string') return res.status(400).json({ error: 'parent required' });
    const parent = readBubble(parentId);
    if (!parent) return res.status(404).json({ error: 'not found' });
    const branch = typeof b.branch === 'string' && BRANCHES.has(b.branch) ? b.branch : (parent.branch || 'its');
    const sub = typeof b.sub === 'string' ? b.sub : '';
    const id = newId();
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM bubbles WHERE parent_id IS ?').get(parentId);
    const sort = (maxSort ? maxSort.m : -1) + 1;
    const touched = todayStr();
    db.prepare(
      'INSERT INTO bubbles (id, parent_id, label, sub, branch, status, note, touched, sort) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(id, parentId, label, sub, branch, '', '', touched, sort);
    db.prepare('UPDATE bubbles SET touched = ? WHERE id = ?').run(touched, parentId);
    stampWrite();
    res.status(201).json(rowToBubble(readBubble(id)));
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.patch('/api/bubbles/:id', (req, res) => {
  try {
    const cur = readBubble(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const next = {
      label: cur.label,
      sub: cur.sub || '',
      branch: cur.branch || 'its',
      status: apiStatus(cur.status),
      note: cur.note || '',
    };
    if (typeof b.label === 'string') {
      const label = b.label.trim();
      if (!label) return res.status(400).json({ error: 'label required' });
      next.label = label;
    }
    if (typeof b.sub === 'string') next.sub = b.sub;
    if (typeof b.note === 'string') next.note = b.note;
    if (typeof b.branch === 'string') {
      if (!BRANCHES.has(b.branch)) return res.status(400).json({ error: 'bad branch' });
      next.branch = b.branch;
    }
    if (typeof b.status === 'string') {
      if (!STATUSES.has(b.status)) return res.status(400).json({ error: 'bad status' });
      next.status = b.status;
    }
    const touched = todayStr();
    db.prepare(
      'UPDATE bubbles SET label=?, sub=?, branch=?, status=?, note=?, touched=? WHERE id=?'
    ).run(next.label, next.sub, next.branch, storeStatus(next.status), next.note, touched, cur.id);
    stampWrite();
    res.json(rowToBubble(readBubble(cur.id)));
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.delete('/api/bubbles/:id', (req, res) => {
  try {
    const cur = readBubble(req.params.id);
    if (!cur) return res.status(404).json({ error: 'not found' });
    if (cur.id === 'nebula') return res.status(400).json({ error: 'cannot delete the Nebula base' });
    const snapshot = rowToBubble(cur);
    const all = db.prepare('SELECT id, parent_id FROM bubbles').all();
    const kids = new Map();
    all.forEach((r) => {
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id).push(r.id);
    });
    const doomed = [cur.id];
    for (let i = 0; i < doomed.length; i++) {
      (kids.get(doomed[i]) || []).forEach((k) => doomed.push(k));
    }
    const del = db.prepare('DELETE FROM bubbles WHERE id = ?');
    doomed.forEach((id) => del.run(id));
    stampWrite();
    res.json(snapshot);
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.post('/api/sync', (req, res) => {
  try {
    if (!SHARED_JSON_PATH) return res.status(400).json({ error: 'SHARED_JSON_PATH is not set' });
    const doc = buildSharedDoc();
    writeSharedJson(doc);
    setMeta('lastWrite', doc.meta.exportedAt);
    res.json(doc.meta);
  } catch (err) {
    if (err && err.code === 'ENOENT') return res.status(400).json({ error: 'shared directory missing' });
    res.status(400).json({ error: 'could not write shared JSON' });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM bubbles ORDER BY sort, label').all();
    res.json({ exportedAt: new Date().toISOString(), bubbles: rows.map(rowToBubble) });
  } catch (err) {
    res.status(400).json({ error: 'bad request' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ error: 'bad request' });
});

app.listen(PORT, () => console.log(`TAIG Tree Map Live on :${PORT}`));
