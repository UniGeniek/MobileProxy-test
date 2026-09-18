// ============================================
// DataCenter — Reset Controller
// ============================================

const proxyService = require('../services/proxyService');
const { checkResetRateLimit } = require('../middleware/rateLimit');
const { enqueueReset, getQueueStats } = require('../services/resetQueue');
const antiAbuse = require('../services/antiAbuse');
const logger = require('../logger');

/**
 * POST /api/reset
 * Body: { port: number } or { ports: number[] } for bulk
 */
async function reset(req, res) {
  try {
    const { port, ports } = req.body;
    const userId = req.user.id;
    const clientIp = req.ip;

    // Single reset
    if (port && !ports) {
      return await resetSingle(port, userId, clientIp, req.user.role, res);
    }

    // Bulk reset
    if (ports && Array.isArray(ports)) {
      return await resetBulk(ports, userId, clientIp, req.user.role, res);
    }

    return res.status(400).json({ error: 'validation', message: 'Provide port or ports[]' });
  } catch (err) {
    logger.error('Reset error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

async function resetSingle(port, userId, clientIp, role, res) {
  // Get proxy
  const proxy = await proxyService.getProxyByPort(port);
  if (!proxy) return res.status(404).json({ error: 'not_found', message: `Port ${port} not found` });

  // Check access
  const hasAccess = await proxyService.userHasAccess(userId, proxy.id, role);
  if (!hasAccess) return res.status(403).json({ error: 'forbidden' });

  // Check if already resetting
  if (proxy.status === 'resetting') {
    return res.status(409).json({ error: 'already_resetting', message: `Port ${port} is already resetting` });
  }

  // Anti-abuse check
  const abuse = await antiAbuse.checkResetAbuse(userId);
  if (abuse.abusive) {
    return res.status(429).json({ error: 'abuse_detected', message: 'Too many resets. Slow down.' });
  }

  // Rate limit check
  const rateLimit = await checkResetRateLimit(port, userId);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'rate_limited',
      message: rateLimit.message,
      reason: rateLimit.reason,
      retryIn: rateLimit.retryIn,
    });
  }

  // Enqueue
  const job = await enqueueReset({ proxyId: proxy.id, port, userId, clientIp });

  res.status(202).json({
    message: 'Reset created',
    resetJobId: job.resetJobId,
    resetLogId: job.resetLogId,
    port,
  });
}

async function resetBulk(ports, userId, clientIp, role, res) {
  if (ports.length > 20) {
    return res.status(400).json({ error: 'validation', message: 'Max 20 ports per bulk reset' });
  }

  const results = [];

  for (const port of ports) {
    const proxy = await proxyService.getProxyByPort(port);
    if (!proxy) { results.push({ port, error: 'not_found' }); continue; }

    const hasAccess = await proxyService.userHasAccess(userId, proxy.id, role);
    if (!hasAccess) { results.push({ port, error: 'forbidden' }); continue; }

    if (proxy.status === 'resetting') { results.push({ port, error: 'already_resetting' }); continue; }

    const rateLimit = await checkResetRateLimit(port, userId);
    if (!rateLimit.allowed) {
      results.push({ port, error: 'rate_limited', retryIn: rateLimit.retryIn });
      continue;
    }

    const job = await enqueueReset({ proxyId: proxy.id, port, userId, clientIp });
    results.push({ port, status: 'created', resetJobId: job.resetJobId });
  }

  res.status(202).json({ results });
}

/**
 * GET /api/reset/queue
 */
async function queueStatus(req, res) {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (err) {
    logger.error('Queue status error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

module.exports = { reset, queueStatus };
