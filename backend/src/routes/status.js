// ============================================
// DataCenter — Status Routes
// ============================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/statusController');

const router = Router();

router.get('/', authenticate, ctrl.getStatus);
router.get('/resets', authenticate, ctrl.resetStats);

module.exports = router;
