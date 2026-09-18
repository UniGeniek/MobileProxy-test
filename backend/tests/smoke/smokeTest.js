// Smoke test for DataCenter reset pipeline
// Usage: NODE_ENV=development node smokeTest.js --api http://localhost:4000 --count 50 --parallel 25 --timeout 120000

const db = require('../../src/db');
const config = require('../../src/config');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { setTimeout: sleep } = require('timers/promises');

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const COUNT = parseInt(process.env.SMOKE_COUNT || process.argv.find(a => a.startsWith('--count='))?.split('=')[1] || 30, 10);
const PARALLEL = parseInt(process.env.SMOKE_PARALLEL || process.argv.find(a => a.startsWith('--parallel='))?.split('=')[1] || 20, 10);
const TIMEOUT_MS = parseInt(process.env.SMOKE_TIMEOUT || process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] || 120000, 10);

async function ensureUser() {
  const username = 'smoke_tester';
  let res = await db.query('SELECT id FROM users WHERE username=$1', [username]);
  if (!res.rows.length) {
    const hash = await bcrypt.hash('smoke_password', 8);
    const ins = await db.query(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'operator') RETURNING id`,
      [username, 'smoke@local', hash]
    );
    res = { rows: [{ id: ins.rows[0].id }] };
  }
  const userId = res.rows[0].id;
  const token = jwt.sign({ id: userId, username: 'smoke_tester', role: 'operator' }, config.jwt.secret, { expiresIn: '1h' });
  return { userId, token };
}

async function pickPorts(n) {
  const res = await db.query('SELECT id, port FROM proxies WHERE is_active = true ORDER BY random() LIMIT $1', [Math.max(n, 100)]);
  if (!res.rows.length) throw new Error('No proxies found in DB to target');
  const ports = [];
  for (let i = 0; i < n; i++) {
    const r = res.rows[i % res.rows.length];
    ports.push({ proxyId: r.id, port: r.port });
  }
  return ports;
}

async function doRequests(ports, token) {
  const results = [];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const batches = [];
  for (let i = 0; i < ports.length; i += PARALLEL) batches.push(ports.slice(i, i + PARALLEL));

  for (const batch of batches) {
    const promises = batch.map(async (p) => {
      try {
        const resp = await fetch(`${API_BASE}/api/reset`, { method: 'POST', headers, body: JSON.stringify({ port: p.port }) });
        const body = await resp.json().catch(() => ({}));
        return { ok: resp.ok, status: resp.status, body };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    const outs = await Promise.all(promises);
    results.push(...outs);
    // brief pause between batches to increase overlap
    await sleep(50);
  }
  return results;
}

async function pollJobs(resetJobIds, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  const states = new Map(); // jobId -> array of observed states (with timestamp)
  const finalStates = new Set(['success', 'failed', 'dead_letter']);

  resetJobIds.forEach(id => states.set(id, []));

  while (Date.now() - start < timeoutMs) {
    const res = await db.query('SELECT id, state, attempts, queue_job_id, updated_at FROM reset_jobs WHERE id = ANY($1)', [resetJobIds]);
    for (const r of res.rows) {
      const hist = states.get(r.id) || [];
      const last = hist[hist.length - 1];
      if (!last || last.state !== r.state) hist.push({ state: r.state, at: r.updated_at });
      states.set(r.id, hist);
    }

    // check if all reached final
    let allFinal = true;
    for (const id of resetJobIds) {
      const hist = states.get(id) || [];
      const last = hist[hist.length - 1];
      if (!last || !finalStates.has(last.state)) { allFinal = false; break; }
    }
    if (allFinal) break;
    await sleep(500);
  }

  // fetch final snapshot
  const finalRes = await db.query('SELECT id, state, attempts, queue_job_id FROM reset_jobs WHERE id = ANY($1)', [resetJobIds]);
  const report = { final: finalRes.rows, history: {} };
  for (const [k, v] of states.entries()) report.history[k] = v;
  return report;
}

function analyze(report) {
  const anomalies = [];
  const perFinal = {};
  for (const row of report.final) {
    perFinal[row.state] = (perFinal[row.state] || 0) + 1;
    if (!['success', 'failed', 'dead_letter'].includes(row.state)) anomalies.push({ id: row.id, reason: 'non_final_state', state: row.state });
    if (row.attempts > 3) anomalies.push({ id: row.id, reason: 'high_attempts', attempts: row.attempts });
  }

  // check history anomalies
  for (const [id, hist] of Object.entries(report.history)) {
    const states = hist.map(h => h.state);
    // duplicate running
    const runningCount = states.filter(s => s === 'running').length;
    if (runningCount > 1) anomalies.push({ id, reason: 'multiple_running', states });
    // regression: queued after running
    const idxRunning = states.indexOf('running');
    const idxQueuedAfter = states.indexOf('queued', idxRunning + 1);
    if (idxRunning >= 0 && idxQueuedAfter >= 0) anomalies.push({ id, reason: 'queued_after_running', states });
  }

  return { perFinal, anomalies };
}

async function main() {
  console.log('Smoke test starting, API=', API_BASE, 'count=', COUNT, 'parallel=', PARALLEL);
  const { userId, token } = await ensureUser();
  console.log('Using test user', userId);

  const ports = await pickPorts(COUNT);
  console.log('Picked', ports.length, 'targets');

  const results = await doRequests(ports, token);
  const created = results.filter(r => r.ok && r.body && r.body.resetJobId).map(r => r.body.resetJobId);
  console.log('Created jobs:', created.length, 'of', ports.length);
  if (!created.length) {
    console.error('No jobs created; check API auth and proxy availability');
    process.exit(2);
  }

  const report = await pollJobs(created, TIMEOUT_MS);
  const analysis = analyze(report);

  console.log('Final counts:', analysis.perFinal);
  if (analysis.anomalies.length) {
    console.error('Anomalies detected:', analysis.anomalies.slice(0, 20));
    process.exit(3);
  }

  console.log('Smoke test PASSED — no anomalies detected');
  process.exit(0);
}

main().catch(err => { console.error('Smoke test error', err); process.exit(1); });
