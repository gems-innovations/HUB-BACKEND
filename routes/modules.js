const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getEffectiveModules } = require('../services/moduleAccess');

// GET /api/modules — módulos habilitados para la organización del token actual.
// Ya vive detrás del wall global de index.js (requiere sesión + org activa).
router.get('/', authenticateToken, async (req, res) => {
  try {
    const modules = await getEffectiveModules(req.organizationId);
    res.json({ success: true, data: modules });
  } catch (err) {
    console.error('[modules] error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
