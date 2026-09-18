// ============================================
// DataCenter — JWT Auth Middleware
// ============================================

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const logger = require('../logger');

/**
 * Verify JWT access token from Authorization header.
 * Attaches decoded user to req.user.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Missing or invalid Authorization header',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    const userRes = await db.query(
      'SELECT id, username, role, account_status FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'invalid_token', message: 'User not found' });
    }

    const user = userRes.rows[0];

    // H-04: Block suspended users
    if (user.account_status === 'suspended') {
      return res.status(403).json({
        error: 'account_suspended',
        message: 'Account is suspended. Please contact support.',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'token_expired',
        message: 'Access token has expired',
      });
    }
    if (err.name === 'JsonWebTokenError') {
      logger.warn('Auth: invalid token attempt', { ip: req.ip, error: err.message });
      return res.status(401).json({
        error: 'invalid_token',
        message: 'Invalid access token',
      });
    }
    logger.error('Auth middleware error', { error: err.message });
    return res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * Require admin role.
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Admin access required',
    });
  }
  next();
}

/**
 * Require admin or operator role.
 */
function requireOperator(req, res, next) {
  if (!['admin', 'operator'].includes(req.user?.role)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Operator access required',
    });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireOperator };
