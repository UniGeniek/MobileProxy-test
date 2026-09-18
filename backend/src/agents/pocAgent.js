// PoC Node Agent
// - Optionally register using AGENT_REGISTRATION_SECRET
// - Heartbeat to API
// - Listen to single execution queue: reset-execution
// - Simulate job execution and publish events to Redis

const { Worker } = require('bullmq');
const fetch = global.fetch || require('node-fetch');
const config = require('../config');
const logger = require('../logger');
const { redis } = require('../redis');

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
let AGENT_ID = process.env.AGENT_ID ? parseInt(process.env.AGENT_ID, 10) : null;
let AGENT_TOKEN = process.env.AGENT_TOKEN || null;
const AGENT_NAME = process.env.AGENT_NAME || 'poc-agent';

async function registerIfNeeded() {
  if (AGENT_ID && AGENT_TOKEN) return;
  const secret = process.env.AGENT_REGISTRATION_SECRET;
  if (!secret) {
    logger.error('No AGENT_ID/AGENT_TOKEN and no AGENT_REGISTRATION_SECRET provided');
    process.exit(1);
  }
  const res = await fetch(`${API_BASE}/api/agents/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AGENT-SECRET': secret },
    body: JSON.stringify({ name: AGENT_NAME, host: process.env.HOSTNAME || null, region: process.env.AGENT_REGION || null, capabilities: { ssh: false } })
  });
  if (!res.ok) {
    const t = await res.text();
    logger.error('Agent register failed', { status: res.status, body: t });
    process.exit(1);
  }
  const body = await res.json();
  AGENT_ID = body.id;
  AGENT_TOKEN = body.agentToken;
  logger.info('Agent registered', { AGENT_ID });
}

async function sendHeartbeat() {
  try {
    const res = await fetch(`${API_BASE}/api/agents/${AGENT_ID}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AGENT_TOKEN}` },
      body: JSON.stringify({ status: 'online', capabilities: { ssh: false } }),
    });
    if (!res.ok) logger.warn('Heartbeat failed', { status: res.status });
  } catch (e) {
    logger.warn('Heartbeat error', { error: e.message });
  }
}

function publishEvent(type, payload) {
  try { redis.publish('events', JSON.stringify({ type, payload })).catch(() => {}); } catch (e) { logger.debug('publish failed', { error: e.message }); }
}

async function startWorkers() {
  const execQueue = `reset-execution`;

  const MODE = (process.env.EXECUTOR_MODE || 'hybrid').toLowerCase();
  if (MODE === 'worker') {
    logger.info('PoC Agent: disabled by EXECUTOR_MODE=worker');
    process.exit(0);
  }
  if (MODE === 'hybrid' && config.env === 'production') {
    logger.error('PoC Agent: hybrid mode is not allowed in production. Set EXECUTOR_MODE=agent or worker. Exiting.');
    process.exit(1);
  }

  const handler = async (job) => {
    logger.info('Agent processing job', { queue: job.queueName, id: job.id, data: job.data });
    // Simulate work PROBABLY SHOULD BE REPLACED WITH REAL EXECUTION LOGIC
    await new Promise(r => setTimeout(r, 2000));
    // Publish event
    publishEvent('proxy:updated', { proxyId: job.data.proxyId, port: job.data.port, status: 'online', currentIp: '1.2.3.4', agent: AGENT_ID });
    publishEvent('reset:complete', { proxyId: job.data.proxyId, port: job.data.port, success: true, agent: AGENT_ID, userId: job.data.requestedBy || job.data.userId });
    return { ok: true };
  };

  const w = new Worker(execQueue, handler, { connection: { host: config.redis.host, port: config.redis.port, password: config.redis.password }, concurrency: 2 });
  w.on('error', (e) => logger.error('Agent worker error', { error: e.message }));
  logger.info('Agent worker started', { execQueue });
}

async function main() {
  await registerIfNeeded();
  // Start heartbeat loop (probably should be a separate process in production)
  await sendHeartbeat();
  setInterval(sendHeartbeat, (parseInt(process.env.HEARTBEAT_SEC, 10) || 30) * 1000);
  await startWorkers();
}

main().catch(err => { logger.error('PoC Agent fatal', { error: err.message }); process.exit(1); });
