// Starts and restarts the app on an isolated database so tests never touch data/tree.db.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');

function baseUrl() {
  return process.env.BASE_URL || 'http://127.0.0.1:3461';
}

function pidPath() {
  return process.env.SERVER_PID_FILE || path.join(os.tmpdir(), 'taig-tree-map-test.pid');
}

function ensureIsolatedEnv() {
  if (!process.env.BASE_URL) process.env.BASE_URL = 'http://127.0.0.1:3461';
  if (!process.env.TREE_DB) {
    process.env.TREE_DB = path.join(os.tmpdir(), `taig-api-${process.pid}.db`);
    fs.rmSync(process.env.TREE_DB, { force: true });
  }
  if (!process.env.SERVER_PID_FILE) process.env.SERVER_PID_FILE = `${process.env.TREE_DB}.pid`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url = baseUrl(), tries = 50) {
  let last = 'no response';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      const body = await res.json().catch(() => null);
      if (res.ok && body && body.ok === true) return body;
      last = `status ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await sleep(200);
  }
  throw new Error(`server did not become healthy at ${url} (${last})`);
}

function startServer() {
  ensureIsolatedEnv();
  const port = new URL(baseUrl()).port || '80';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: port, TREE_DB: process.env.TREE_DB },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  fs.writeFileSync(pidPath(), String(child.pid));
  return child.pid;
}

function readPid() {
  try {
    return Number(fs.readFileSync(pidPath(), 'utf8'));
  } catch {
    return 0;
  }
}

async function stopServer() {
  const pid = readPid();
  if (!pid) return;
  try { process.kill(pid); } catch { /* already stopped */ }
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      fs.rmSync(pidPath(), { force: true });
      return;
    }
    await sleep(100);
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already stopped */ }
  fs.rmSync(pidPath(), { force: true });
}

async function restartServer() {
  await stopServer();
  await sleep(200);
  startServer();
  await waitForHealth();
}

module.exports = {
  root,
  baseUrl,
  ensureIsolatedEnv,
  startServer,
  stopServer,
  restartServer,
  waitForHealth,
};
