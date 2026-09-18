// ============================================
// DataCenter — Auth Routes
// ============================================

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

const router = Router();

// M-02: Strict login rate limiter (10 attempts per 15 min per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many login attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => req.ip,
});

router.post('/login', loginLimiter, ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', authenticate, ctrl.logout);
router.post('/register', authenticate, requireAdmin, ctrl.register);

module.exports = router;
