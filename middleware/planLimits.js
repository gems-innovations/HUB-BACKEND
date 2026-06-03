/**
 * Helpers para verificar los límites del plan antes de crear recursos.
 *
 * Lógica de límites efectivos:
 *  - Si la org tiene limits.maxUsers > 0  → usar ese valor explícito
 *  - Si la org tiene limits.maxUsers = 0 Y el plan es free/free_trial → usar FREE_DEFAULTS
 *  - Si la org tiene limits.maxUsers = 0 Y el plan es starter/pro/enterprise → ilimitado
 *
 * Esto cubre orgs creadas antes de que se introdujeran los límites.
 */

const Organization = require('../models/Organization');
const Membership   = require('../models/Membership');
const Task         = require('../models/Task');

// Límites por defecto para planes gratuitos (sin límite explícito en BD)
const FREE_PLANS    = ['free', 'free_trial'];
const FREE_DEFAULTS = { maxUsers: 5, maxTasks: 50 };

function resolveLimit(org, field) {
  const explicit = org.limits?.[field] ?? 0;
  if (explicit > 0) return explicit;                         // límite explícito
  if (FREE_PLANS.includes(org.plan)) return FREE_DEFAULTS[field]; // plan gratuito legacy
  return 0;                                                  // 0 = ilimitado (planes pagos)
}

// ─── Verificar límite de usuarios ─────────────────────────────────────────────
async function checkUserLimit(req, res, next) {
  try {
    const orgId = req.organizationId;
    if (!orgId) return next();

    const org = await Organization.findById(orgId).select('limits plan').lean();
    if (!org) return next();

    const maxUsers = resolveLimit(org, 'maxUsers');
    if (maxUsers === 0) return next(); // ilimitado

    const currentCount = await Membership.countDocuments({
      organization: orgId,
      status: 'active'
    });

    if (currentCount >= maxUsers) {
      return res.status(403).json({
        success: false,
        code: 'LIMIT_USERS',
        message: `Has alcanzado el límite de ${maxUsers} usuarios del plan gratuito. Actualiza tu plan para agregar más miembros.`,
        limit: maxUsers,
        current: currentCount,
        upgrade: true
      });
    }

    next();
  } catch (err) {
    console.error('[planLimits] checkUserLimit error:', err.message);
    next();
  }
}

// ─── Verificar límite de tareas ───────────────────────────────────────────────
async function checkTaskLimit(req, res, next) {
  try {
    const orgId = req.organizationId;
    if (!orgId) return next();

    const org = await Organization.findById(orgId).select('limits plan').lean();
    if (!org) return next();

    const maxTasks = resolveLimit(org, 'maxTasks');
    if (maxTasks === 0) return next(); // ilimitado

    const currentCount = await Task.countDocuments({ organizationId: orgId });

    if (currentCount >= maxTasks) {
      return res.status(403).json({
        success: false,
        code: 'LIMIT_TASKS',
        message: `Has alcanzado el límite de ${maxTasks} tareas del plan gratuito. Actualiza tu plan para crear más tareas.`,
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
