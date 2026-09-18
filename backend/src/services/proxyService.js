// ============================================
// DataCenter — Proxy Service (CRUD)
// ============================================

const db = require('../db');
const logger = require('../logger');

/**
 * Get all proxies accessible by a user.
 * Admin sees all. Users see only assigned proxies.
 */
async function getProxiesForUser(userId, role, filters = {}) {
  let query, params;

  if (role === 'admin' || role === 'operator') {
    query = `
      SELECT p.*, pg.name as group_name
      FROM proxies p
      LEFT JOIN proxy_groups pg ON p.group_id = pg.id
      WHERE p.is_active = true
    `;
    params = [];
  } else {
    query = `
      SELECT p.*, pg.name as group_name
      FROM proxies p
      LEFT JOIN proxy_groups pg ON p.group_id = pg.id
      INNER JOIN user_proxies up ON p.id = up.proxy_id
      WHERE up.user_id = $1 AND p.is_active = true
    `;
    params = [userId];
  }

  // Apply filters
  if (filters.groupId) {
    params.push(filters.groupId);
    query += ` AND p.group_id = $${params.length}`;
  }
  if (filters.status) {
    params.push(filters.status);
    query += ` AND p.status = $${params.length}`;
  }
  if (filters.search) {
    // M-01: Escape LIKE wildcards
    const escapedSearch = filters.search.replace(/[%_]/g, '\\$&');
    params.push(`%${escapedSearch}%`);
    query += ` AND (p.port::text LIKE $${params.length} OR p.current_ip LIKE $${params.length} OR p.router_ip LIKE $${params.length})`;
  }

  query += ' ORDER BY p.port ASC';

  const result = await db.query(query, params);
  return result.rows.map(sanitizeProxy);
}

/**
 * Get a single proxy by port.
 */
async function getProxyByPort(port) {
  const result = await db.query(
    `SELECT p.*, pg.name as group_name FROM proxies p
     LEFT JOIN proxy_groups pg ON p.group_id = pg.id
     WHERE p.port = $1`, [port]
  );
  return result.rows[0] || null;
}

/**
 * Get a single proxy by ID.
 */
async function getProxyById(id) {
  const result = await db.query(
    `SELECT p.*, pg.name as group_name FROM proxies p
     LEFT JOIN proxy_groups pg ON p.group_id = pg.id
     WHERE p.id = $1`, [id]
  );
  return result.rows[0] || null;
}

/**
 * Check if a user has access to a specific proxy.
 */
async function userHasAccess(userId, proxyId, role) {
  if (role === 'admin' || role === 'operator') return true;

  const result = await db.query(
    'SELECT 1 FROM user_proxies WHERE user_id = $1 AND proxy_id = $2',
    [userId, proxyId]
  );
  return result.rows.length > 0;
}

/**
 * Get proxy groups.
 */
async function getGroups() {
  const result = await db.query(
    `SELECT pg.*, COUNT(p.id) as proxy_count
     FROM proxy_groups pg
     LEFT JOIN proxies p ON pg.id = p.group_id AND p.is_active = true
     GROUP BY pg.id ORDER BY pg.name`
  );
  return result.rows;
}

/**
 * Get reset logs for a proxy.
 */
async function getResetLogs(proxyId, limit = 50) {
  const result = await db.query(
    `SELECT rl.*, u.username as triggered_by_name
     FROM reset_logs rl
     LEFT JOIN users u ON rl.triggered_by = u.id
     WHERE rl.proxy_id = $1
     ORDER BY rl.created_at DESC LIMIT $2`,
    [proxyId, limit]
  );
  return result.rows;
}

/**
 * Get system-wide statistics.
 */
async function getSystemStats() {
  const result = await db.query(`
    SELECT 
      COUNT(*) FILTER (WHERE is_active) as total,
      COUNT(*) FILTER (WHERE status = 'online') as online,
      COUNT(*) FILTER (WHERE status = 'offline') as offline,
      COUNT(*) FILTER (WHERE status = 'resetting') as resetting,
      COUNT(*) FILTER (WHERE status = 'error') as errors,
      COUNT(*) FILTER (WHERE status = 'idle') as idle,
      SUM(connections) as total_connections
    FROM proxies
  `);
  return result.rows[0];
}

/**
 * Remove sensitive fields from proxy data before sending to client.
 */
function sanitizeProxy(proxy) {
  const { router_ssh_key, router_ssh_pass, ...safe } = proxy;
  return safe;
}

module.exports = {
  getProxiesForUser, getProxyByPort, getProxyById,
  userHasAccess, getGroups, getResetLogs, getSystemStats,
};
