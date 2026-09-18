// ============================================
// DataCenter — Reset Routes
// ============================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/resetController');

const router = Router();

router.post('/', authenticate, ctrl.reset);
router.get('/queue', authenticate, ctrl.queueStatus);

module.exports = router;
