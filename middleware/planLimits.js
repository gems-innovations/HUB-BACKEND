/**
 * Helpers para verificar los límites del plan antes de crear recursos.
 * Uso en rutas:
 *   const { checkUserLimit, checkTaskLimit } = require('../middleware/planLimits')
 *   router.post('/', checkUserLimit, async (req, res) => { ... })
 */

const Organization = require('../models/Organization');
const Membership   = require('../models/Membership');
const Task         = require('../models/Task');

// ─── Verificar límite de usuarios ────────────────────────────────────────────
async function checkUserLimit(req, res, next) {
  try {
    const orgId = req.organizationId;
    if (!orgId) return next();

    const org = await Organization.findById(orgId).select('limits plan').lean();
    if (!org) return next();

    const maxUsers = org.limits?.maxUsers || 0;
    if (maxUsers === 0) return next(); // 0 = ilimitado

    const currentCount = await Membership.countDocuments({
      organization: orgId,
      status: 'active'
    });

    if (currentCount >= maxUsers) {
      return res.status(403).json({
        success: false,
        code: 'LIMIT_USERS',
        message: `Has alcanzado el límite de ${maxUsers} usuarios del plan gratuito.`,
        limit: maxUsers,
        current: currentCount,
        upgrade: true
      });
    }

    next();
  } catch (err) {
    console.error('[planLimits] checkUserLimit error:', err.message);
    next(); // No bloquear si el check falla
  }
}

// ─── Verificar límite de tareas ───────────────────────────────────────────────
async function checkTaskLimit(req, res, next) {
  try {
    const orgId = req.organizationId;
    if (!orgId) return next();

    const org = await Organization.findById(orgId).select('limits plan').lean();
    if (!org) return next();

    const maxTasks = org.limits?.maxTasks || 0;
    if (maxTasks === 0) return next(); // 0 = ilimitado

    const currentCount = await Task.countDocuments({ organizationId: orgId });

    if (currentCount >= maxTasks) {
      return res.status(403).json({
        success: false,
        code: 'LIMIT_TASKS',
        message: `Has alcanzado el límite de ${maxTasks} tareas del plan gratuito.`,
        limit: maxTasks,
        current: currentCount,
        upgrade: true
      });
    }

    next();
  } catch (err) {
    console.error('[planLimits] checkTaskLimit error:', err.message);
    next();
  }
}

module.exports = { checkUserLimit, checkTaskLimit };
