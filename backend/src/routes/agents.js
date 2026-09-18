const { Router } = require('express');
const { authenticate, requireOperator } = require('../middleware/auth');
const ctrl = require('../controllers/agentsController');

const router = Router();

// Registration uses shared secret header X-AGENT-SECRET
router.post('/register', ctrl.register);

// Heartbeat uses agent token in Bearer
router.post('/:id/heartbeat', ctrl.heartbeat);

// List requires operator privileges
router.get('/', authenticate, requireOperator, ctrl.listAgents);

module.exports = router;
