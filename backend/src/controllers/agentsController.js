const crypto = require('crypto');
const db = require('../db');
const logger = require('../logger');

// Helper to hash agent tokens
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** POST /api/agents/register
 * Body: { name, host, region, capabilities }
 * Header: X-AGENT-SECRET: <shared secret>
 * Returns: { id, agentToken }
 */
async function register(req, res) {
  try {
    const secret = process.env.AGENT_REGISTRATION_SECRET;
    const provided = req.headers['x-agent-secret'];
    if (!secret || provided !== secret) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { name, host, region, capabilities } = req.body;
    if (!name) return res.status(400).json({ error: 'validation', message: 'name required' });

    const agentToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(agentToken);

    const result = await db.query(
      `INSERT INTO node_agents (name, host, region, agent_token_hash, status, last_heartbeat, capabilities)
       VALUES ($1, $2, $3, $4, 'online', NOW(), $5) RETURNING id, name, host, region, status, last_heartbeat, capabilities`,
      [name, host || null, region || null, tokenHash, capabilities || null]
    );

    const agent = result.rows[0];
    res.status(201).json({ id: agent.id, agentToken });
  } catch (err) {
    logger.error('Agent register error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

/** POST /api/agents/:id/heartbeat
 * Header: Authorization: Bearer <agentToken>
 * Body: { status, capabilities }
 */
async function heartbeat(req, res) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'validation' });

    const tokenHash = hashToken(token);
    const agentRes = await db.query('SELECT id FROM node_agents WHERE id = $1 AND agent_token_hash = $2', [id, tokenHash]);
    if (!agentRes.rows.length) return res.status(401).json({ error: 'unauthorized' });

    const { status, capabilities } = req.body;
    const allowed = ['online', 'offline', 'degraded'];
    const newStatus = allowed.includes(status) ? status : 'online';

    await db.query('UPDATE node_agents SET status=$1, last_heartbeat=NOW(), capabilities=$2 WHERE id=$3', [newStatus, capabilities || null, id]);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Agent heartbeat error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

/** GET /api/agents
 * Requires authenticated operator/admin
 */
async function listAgents(req, res) {
  try {
    const result = await db.query('SELECT id, name, host, region, status, last_heartbeat, capabilities, created_at FROM node_agents ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    logger.error('Agent list error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

module.exports = { register, heartbeat, listAgents };
