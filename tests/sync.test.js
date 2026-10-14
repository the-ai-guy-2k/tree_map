const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const port = 3463;
const base = `http://127.0.0.1:${port}`;
const db = path.join(os.tmpdir(), `taig-sync-${process.pid}.db`);
const jsonPath = path.join(os.tmpdir(), `taig-sync-${process.pid}.json`);
let child = null;

function bubble(partial) {
  return {
    id: '',
    label: '',
    sub: null,
    branch: null,
    parentId: null,
    touched: null,
    note: '',
    status: 'none',
    ...partial,
  };
}

function writeJson(bubbles, exportedAt) {
  const doc = {
    meta: {
      schemaVersion: 1,
      exportedAt,
      exportedBy: 'muse',
      bubbleCount: bubbles.length,
    },
    bubbles,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(doc));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      const body = await res.json();
      if (res.ok && body.ok === true) return;
    } catch { /* booting */ }
    await sleep(200);
  }
  throw new Error('sync test server did not become healthy');
}

function start() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      TREE_DB: db,
      SHARED_JSON_PATH: jsonPath,
    },
    stdio: 'ignore',
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const proc = child;
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill();
  });
}

async function restart() {
  await stop();
  await sleep(200);
  start();
  await waitHealth();
}

async function api(pathname, options) {
  const res = await fetch(`${base}${pathname}`, options);
  const text = await res.text();
  let body = null;
  if (text) body = JSON.parse(text);
  return { status: res.status, body };
}

async function bubbles() {
  const res = await api('/api/bubbles');
  assert.equal(res.status, 200);
  return res.body.bubbles;
}

before(async () => {
  fs.rmSync(db, { force: true });
  fs.rmSync(jsonPath, { force: true });
  writeJson([
    bubble({
      id: 'cott',
      label: 'COTT',
      sub: 'Crumbs on the Table — the label',
      branch: 'cott',
      parentId: 'nebula',
      touched: '2026-10-01',
      note: 'from muse',
      status: 'waiting',
    }),
    bubble({ id: 'sync-by-date', label: 'Older', parentId: 'cott', touched: '2026-10-01', note: 'this older note is much longer', status: 'none' }),
    bubble({ id: 'sync-by-date', label: 'Newer', parentId: 'cott', touched: '2026-10-13', note: 'short', status: 'active' }),
    bubble({ id: 'sync-by-note', label: 'Short', parentId: 'cott', touched: '2026-10-02', note: 'tiny', status: 'none' }),
    bubble({ id: 'sync-by-note', label: 'Full', parentId: 'cott', touched: '2026-10-02', note: 'the fullest note', status: 'done' }),
    bubble({ id: 'sync-new', label: 'From JSON', parentId: 'cott', note: 'imported', status: 'done' }),
  ], '2026-10-14T18:00:00.000Z');
  start();
  await waitHealth();
});

after(async () => {
  await stop();
  fs.rmSync(db, { force: true });
  fs.rmSync(`${db}-journal`, { force: true });
  fs.rmSync(jsonPath, { force: true });
  fs.rmSync(`${jsonPath}.tmp`, { force: true });
});

test('shared JSON import, sync, and round trip', { timeout: 60000 }, async () => {
  const imported = await bubbles();
  const ids = imported.map((b) => b.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(imported.length, 48);
  const cott = imported.find((b) => b.id === 'cott');
  assert.equal(cott.note, 'from muse');
  assert.equal(cott.status, 'waiting');
  const byDate = imported.find((b) => b.id === 'sync-by-date');
  assert.equal(byDate.label, 'Newer');
  assert.equal(byDate.status, 'active');
  const byNote = imported.find((b) => b.id === 'sync-by-note');
  assert.equal(byNote.label, 'Full');
  assert.equal(byNote.note, 'the fullest note');
  assert.equal(byNote.status, 'done');
  const created = imported.find((b) => b.id === 'sync-new');
  assert.equal(created.note, 'imported');
  assert.equal(created.parentId, 'cott');

  const local = await api('/api/bubbles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentId: 'nebula', label: 'Local only' }),
  });
  assert.equal(local.status, 201);

  writeJson([
    bubble({
      id: 'cott',
      label: 'COTT',
      branch: 'cott',
      parentId: 'nebula',
      touched: '2026-10-14',
      note: 'muse again',
      status: 'active',
    }),
  ], new Date(Date.now() + 60 * 1000).toISOString());
  await restart();
  const merged = await bubbles();
  const mergedIds = merged.map((b) => b.id);
  assert.equal(mergedIds.length, new Set(mergedIds).size);
  assert.ok(merged.some((b) => b.id === local.body.id && b.label === 'Local only'));
  assert.equal(merged.find((b) => b.id === 'cott').note, 'muse again');
  assert.equal(merged.find((b) => b.id === 'sync-new').note, 'imported');

  const patched = await api('/api/bubbles/cott', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: 'edited in the app' }),
  });
  assert.equal(patched.status, 200);
  writeJson([
    bubble({ id: 'cott', label: 'COTT', parentId: 'nebula', note: 'stale', status: 'none' }),
  ], '2020-01-01T00:00:00.000Z');
  await restart();
  assert.equal((await bubbles()).find((b) => b.id === 'cott').note, 'edited in the app');

  const beforeSync = new Date().toISOString();
  const synced = await api('/api/sync', { method: 'POST' });
  assert.equal(synced.status, 200);
  assert.equal(synced.body.exportedBy, 'app');
  assert.equal(synced.body.schemaVersion, 1);
  assert.ok(synced.body.exportedAt >= beforeSync);
  const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(doc.meta.exportedBy, 'app');
  assert.equal(doc.meta.schemaVersion, 1);
  assert.equal(doc.meta.bubbleCount, doc.bubbles.length);
  assert.equal(doc.meta.exportedAt, synced.body.exportedAt);
  const wireCott = doc.bubbles.find((b) => b.id === 'cott');
  assert.equal(wireCott.note, 'edited in the app');
  assert.deepEqual(Object.keys(wireCott), ['id', 'label', 'sub', 'branch', 'parentId', 'touched', 'note', 'status']);
  assert.ok(doc.bubbles.some((b) => b.label === 'Local only'));

  await stop();
  fs.rmSync(db, { force: true });
  await sleep(200);
  start();
  await waitHealth();
  const restored = await bubbles();
  const restoredIds = restored.map((b) => b.id);
  assert.equal(restoredIds.length, new Set(restoredIds).size);
  assert.equal(restored.find((b) => b.id === 'cott').note, 'edited in the app');
  assert.ok(restored.some((b) => b.label === 'Local only'));
  assert.ok(restored.some((b) => b.id === 'sync-new'));
});
