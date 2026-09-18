// ============================================
// DataCenter — Auth Controller
// ============================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const logger = require('../logger');
const antiAbuse = require('../services/antiAbuse');

/**
 * POST /api/login
 */
async function login(req, res) {
  try {
    const { username, password } = req.body;
    const clientIp = req.ip;

    if (!username || !password) {
      return res.status(400).json({ error: 'validation', message: 'Username and password required' });
    }

    // Check IP block
    try {
      if (await antiAbuse.isBlocked(clientIp)) {
        return res.status(429).json({ error: 'blocked', message: 'Too many failed attempts. Try later.' });
      }
    } catch (e) {
      // If Redis is down, continue without abuse check but log it
      logger.warn('Anti-abuse check failed (Redis down?)', { error: e.message });
    }

    let result;
    try {
      result = await db.query('SELECT * FROM users WHERE username = $1 AND is_active = true', [username]);
    } catch (e) {
      logger.error('DB error during login', { error: e.message });
      return res.status(503).json({ error: 'service_unavailable', message: 'Service temporarily unavailable' });
    }

    if (!result.rows.length) {
      await antiAbuse.trackAuthFailure(clientIp);
      logger.warn('Login: user not found', { username, ip: clientIp });
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const abuse = await antiAbuse.trackAuthFailure(clientIp);
      if (abuse.blocked) await antiAbuse.blockIp(clientIp, 900);
      logger.warn('Login: invalid password', { username, ip: clientIp });
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    }

    // Generate tokens
    const accessToken = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiry }
    );

    const refreshToken = crypto.randomBytes(64).toString('hex');
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, refreshExpiry]
    );

    // Audit log
    await db.query(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [user.id, 'login', JSON.stringify({ username }), clientIp]
    );

    logger.info('Login: success', { userId: user.id, username, ip: clientIp });

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
      expiresIn: config.jwt.accessExpiry,
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'server_error', message: 'Internal server error' });
  }
}

/**
 * POST /api/refresh
 */
async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'validation', message: 'Refresh token required' });

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const result = await db.query(
      `SELECT rt.*, u.username, u.role FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1 AND rt.expires_at > NOW()`, [tokenHash]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'invalid_token', message: 'Invalid or expired refresh token' });
    }

    const row = result.rows[0];

    // Delete old token
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [row.id]);

    // Issue new tokens
    const accessToken = jwt.sign(
      { id: row.user_id, username: row.username, role: row.role },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiry }
    );

    const newRefresh = crypto.randomBytes(64).toString('hex');
    const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [row.user_id, newHash, expiry]);

    res.json({ accessToken, refreshToken: newRefresh, expiresIn: config.jwt.accessExpiry });
  } catch (err) {
    logger.error('Refresh error', { error: err.message });
    res.status(500).json({ error: 'server_error', message: 'Internal server error' });
  }
}

/**
 * POST /api/logout
 */
async function logout(req, res) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Logout error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

/**
 * POST /api/register (admin only)
 */
async function register(req, res) {
  try {
    const { username, email, phone, password, role } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'validation', message: 'Username, email, and password required' });
    }

    const hash = await bcrypt.hash(password, 12);
    // H-02: Generate secure random proxy password
    const proxyPassword = crypto.randomBytes(8).toString('hex');
    const result = await db.query(
      `INSERT INTO users (username, email, phone, password_hash, proxy_password, role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, role`,
      [username, email, phone || null, hash, proxyPassword, role || 'user']
    );

    await db.query('INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'register_user', JSON.stringify({ newUser: username }), req.ip]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'conflict', message: 'Username or email already exists' });
    }
    logger.error('Register error', { error: err.message });
    res.status(500).json({ error: 'server_error' });
  }
}

module.exports = { login, refresh, logout, register };
