// ============================================
// DataCenter — Proxy Controller
// ============================================

const proxyService = require('../services/proxyService');
const { getRateLimitInfo } = require('../middleware/rateLimit');
const logger = require('../logger');

/**
 * GET /api/proxies
 */
async function list(req, res) {
  try {
    const filters = {
      groupId: req.query.group_id,
      status: req.query.status,
      search: req.query.search,
    };

    // --- MOCK FOR TEST ACCOUNT ---
    if (req.user.id === 999) {
      const mockProxies = [
        { id: 'p1', port: 3001, status: 'online', type: 'http', ip: '1.1.1.1', country: 'US', operator: 'T-Mobile', expires_at: null },
        { id: 'p2', port: 3002, status: 'online', type: 'http', ip: '2.2.2.2', country: 'US', operator: 'AT&T', expires_at: null },
        { id: 'p3', port: 3003, status: 'resetting', type: 'http', ip: '3.3.3.3', country: 'US', operator: 'Verizon', expires_at: null },
        { id: 'p4', port: 3004, status: 'offline', type: 'http', ip: '0.0.0.0', country: 'US', operator: 'T-Mobile', expires_at: null },
      ];
      return res.json({ proxies: mockProxies, total: mockProxies.length });
    }
    // ----------------------------

    const proxies = await proxyService.getProxiesForUser(req.user.id, req.user.role, filters);

    // Attach rate limit info for each proxy
    const enriched = await Promise.all(proxies.map(async (p) => {
      const rateInfo = await getRateLimitInfo(p.port, req.user.id);
      return { ...p, rateLimit: rateInfo };
    }));

    res.json({ proxies: enriched, total: enriched.length });
  } catch (err) {
    logger.error('Proxy list error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

/**
 * GET /api/proxies/:id
 */
async function getById(req, res) {
  try {
    const proxy = await proxyService.getProxyById(req.params.id);
    if (!proxy) return res.status(404).json({ error: 'not_found' });

    const hasAccess = await proxyService.userHasAccess(req.user.id, proxy.id, req.user.role);
    if (!hasAccess) return res.status(403).json({ error: 'forbidden' });

    const rateInfo = await getRateLimitInfo(proxy.port, req.user.id);
    const logs = await proxyService.getResetLogs(proxy.id, 20);

    res.json({ ...proxy, rateLimit: rateInfo, recentResets: logs });
  } catch (err) {
    logger.error('Proxy get error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

/**
 * GET /api/proxies/groups
 */
async function listGroups(req, res) {
  try {
    // --- MOCK FOR TEST ACCOUNT ---
    if (req.user && req.user.id === 999) {
      return res.json({ groups: [
        { id: 'g1', name: 'US-Mobile', description: 'US LTE Proxies' },
        { id: 'g2', name: 'EU-Residential', description: 'European IP pool' }
      ]});
    }
    // ----------------------------

    const groups = await proxyService.getGroups();
    res.json({ groups });
  } catch (err) {
    logger.error('Groups list error', { error: err.message });
    res.json({ groups: [] });
  }
}

module.exports = { list, getById, listGroups };
