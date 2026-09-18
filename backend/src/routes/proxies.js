// ============================================
// DataCenter — Proxy Routes
// ============================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/proxyController');

const router = Router();

router.get('/', authenticate, ctrl.list);
router.get('/groups', authenticate, ctrl.listGroups);
router.get('/:id', authenticate, ctrl.getById);

module.exports = router;
