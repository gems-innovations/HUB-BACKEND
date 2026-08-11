/**
 * Rutas de super-administración de la plataforma.
 * Todas requieren User.isSuperAdmin === true.
 *
 * Estas rutas NO operan dentro de un tenant — operan a nivel plataforma. Por eso
 * usamos runWithoutTenant para queries que cruzan organizaciones.
 */
const express = require('express');
const router = express.Router();
const Organization = require('../models/Organization');
const Membership = require('../models/Membership');
const User = require('../models/User');
const { requireSuperAdmin } = require('../middleware/auth');
const { runWithoutTenant } = require('../services/tenantContext');
const { ensureDefaultRolesForOrg } = require('../services/initService');
const SuperAdminAudit = require('../models/SuperAdminAudit');

// Escapa caracteres especiales de regex — usado en la búsqueda de /organizations.
// (bug encontrado: se llamaba más abajo sin estar definida, rompía con 500 cualquier
// búsqueda con texto).
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper de auditoría — fire-and-forget, no rompe la request si falla.
function audit(req, action, opts = {}) {
  SuperAdminAudit.create({
    superAdminId: req.user._id,
    organizationId: opts.organizationId || null,
    targetUserId: opts.targetUserId || null,
    action,
    metadata: opts.metadata || null,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('user-agent')
  }).catch(err => console.error('[admin/audit]', action, err.message));
}

// Todas las rutas debajo requieren super-admin
router.use(requireSuperAdmin);

// ───── Organizaciones ─────

// GET /api/admin/organizations  → lista todas
router.get('/organizations', async (req, res) => {
  try {
    const { status, q } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { slug: { $regex: safe, $options: 'i' } }
      ];
    }

    const orgs = await runWithoutTenant(() =>
      Organization.find(filter).sort({ createdAt: -1 }).lean()
    );

    // Anotar conteo de miembros activos por org (puede ser caro con muchas orgs;
    // si llega a serlo, mover a vista paginada o a un endpoint dedicado).
    const orgIds = orgs.map(o => o._id);
    const memberCounts = await runWithoutTenant(() =>
      Membership.aggregate([
        { $match: { organization: { $in: orgIds }, status: 'active' } },
        { $group: { _id: '$organization', count: { $sum: 1 } } }
      ])
    );
    const countMap = Object.fromEntries(memberCounts.map(c => [String(c._id), c.count]));

    res.json({
      success: true,
      data: orgs.map(o => ({ ...o, memberCount: countMap[String(o._id)] || 0 }))
    });
  } catch (err) {
    console.error('[admin] list orgs error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/organizations/:id  → detalle
router.get('/organizations/:id', async (req, res) => {
  try {
    const org = await runWithoutTenant(() => Organization.findById(req.params.id));
    if (!org) return res.status(404).json({ success: false, message: 'Organización no encontrada' });
    res.json({ success: true, data: org });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/organizations  → crear
router.post('/organizations', async (req, res) => {
  try {
    const { name, slug, plan, contact, branding, ownerEmail, ownerName, ownerPassword } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: 'Nombre y slug son requeridos' });
    }

    const result = await runWithoutTenant(async () => {
      const exists = await Organization.findOne({ slug: slug.toLowerCase().trim() });
      if (exists) throw new Error('Ya existe una organización con ese slug');

      const org = await Organization.create({
        name: name.trim(),
        slug: slug.toLowerCase().trim(),
        plan: plan || 'free',
        status: 'active',
        contact: contact || {},
        branding: branding || { primaryColor: '#8b5cf6', accentColor: '#8b5cf6' },
        createdBy: req.user._id
      });

      // Roles del sistema dentro de la nueva org
      await ensureDefaultRolesForOrg(org._id);

      // Si se proporcionó un owner, crear/asignar
      if (ownerEmail) {
        let owner = await User.findOne({ email: ownerEmail.trim().toLowerCase() });
        if (!owner) {
          if (!ownerPassword || ownerPassword.length < 8) {
            throw new Error('Para crear un owner nuevo, ownerPassword (≥8 chars) es requerido');
          }
          owner = await User.create({
            name: ownerName || ownerEmail.split('@')[0],
            email: ownerEmail.trim().toLowerCase(),
            password: ownerPassword,
            role: 'admin',
            isActive: true,
            isVerified: true
          });
        }

        await Membership.create({
          user: owner._id,
          organization: org._id,
          role: 'admin',
          isOwner: true,
          status: 'active',
          invitedBy: req.user._id,
          acceptedAt: new Date()
        });
      }

      return org;
    });

    audit(req, 'org_create', {
      organizationId: result._id,
      metadata: { name: result.name, slug: result.slug, plan: result.plan, ownerEmail: ownerEmail || null }
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('[admin] create org error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH /api/admin/organizations/:id  → editar
router.patch('/organizations/:id', async (req, res) => {
  try {
    const updates = {};
    const allowed = ['name', 'plan', 'status', 'contact', 'branding', 'limits', 'trialExpiresAt'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const org = await runWithoutTenant(() =>
      Organization.findByIdAndUpdate(req.params.id, updates, { new: true })
    );
    if (!org) return res.status(404).json({ success: false, message: 'Organización no encontrada' });

    audit(req, 'org_update', { organizationId: org._id, metadata: { changes: updates } });
    res.json({ success: true, data: org });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/admin/organizations/:id  → archiva (no borra)
router.delete('/organizations/:id', async (req, res) => {
  try {
    const org = await runWithoutTenant(() =>
      Organization.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true })
    );
    if (!org) return res.status(404).json({ success: false, message: 'Organización no encontrada' });

    audit(req, 'org_archive', { organizationId: org._id, metadata: { name: org.name } });
    res.json({ success: true, data: org, message: 'Organización archivada' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/admin/organizations/:id/stats  → métricas para el panel de control.
// El frontend no llamaba esto todavía (endpoint "huérfano") — se amplía aquí y se
// conecta en OrganizationsAdmin.vue con un modal de detalle por organización.
router.get('/organizations/:id/stats', async (req, res) => {
  try {
    const orgId = req.params.id;
    const org = await runWithoutTenant(() => Organization.findById(orgId).lean());
    if (!org) return res.status(404).json({ success: false, message: 'Organización no encontrada' });

    const Client = require('../models/Client');
    const Activity = require('../models/Activity');
    const Case = require('../models/Case');
    const Ticket = require('../models/Ticket');
    const Task = require('../models/Task');
    const Wiki = require('../models/Wiki');
    const ProspectConversation = require('../models/ProspectConversation');

    const counts = await runWithoutTenant(async () => {
      const [client, activity, caseCount, ticket, task, wiki, prospectconversation, roleAgg, ticketsOpen] = await Promise.all([
        Client.countDocuments({ organizationId: orgId }),
        Activity.countDocuments({ organizationId: orgId }),
        Case.countDocuments({ organizationId: orgId }),
        Ticket.countDocuments({ organizationId: orgId }),
        Task.countDocuments({ organizationId: orgId }),
        Wiki.countDocuments({ organizationId: orgId }),
        ProspectConversation.countDocuments({ organizationId: orgId }),
        Membership.aggregate([
          { $match: { organization: org._id, status: 'active' } },
          { $group: { _id: '$role', count: { $sum: 1 } } }
        ]),
        Ticket.countDocuments({ organizationId: orgId, status: { $in: ['new', 'open', 'waiting'] } })
      ]);
      return {
        client, activity, case: caseCount, ticket, task, wiki, prospectconversation,
        members: roleAgg.reduce((s, r) => s + r.count, 0),
        membersByRole: Object.fromEntries(roleAgg.map(r => [r._id || 'sin-rol', r.count])),
        ticketsOpen
      };
    });

    // Última actividad real de la organización — el más reciente entre estas 3
    // colecciones (suficiente como pulso de "¿sigue usando esto de verdad?").
    const [lastActivity, lastCase, lastTicket] = await runWithoutTenant(() => Promise.all([
      Activity.findOne({ organizationId: orgId }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
      Case.findOne({ organizationId: orgId }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
      Ticket.findOne({ organizationId: orgId }).sort({ updatedAt: -1 }).select('updatedAt').lean()
    ]));
    const lastDates = [lastActivity, lastCase, lastTicket]
      .map(d => d?.updatedAt).filter(Boolean).map(d => new Date(d).getTime());
    const lastActivityAt = lastDates.length ? new Date(Math.max(...lastDates)) : null;

    let trialDaysRemaining = null;
    if (org.plan === 'free_trial' && org.trialExpiresAt) {
      trialDaysRemaining = Math.ceil((new Date(org.trialExpiresAt).getTime() - Date.now()) / 86400000);
    }

    res.json({
      success: true,
      data: {
        ...counts,
        plan: org.plan,
        status: org.status,
        createdAt: org.createdAt,
        trialDaysRemaining,
        lastActivityAt
      }
    });
  } catch (err) {
    console.error('[admin] org stats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ───── Super-admins ─────

// GET /api/admin/super-admins  → lista
router.get('/super-admins', async (req, res) => {
  try {
    const admins = await User.find({ isSuperAdmin: true }).select('-password').lean();
    res.json({ success: true, data: admins });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/admin/super-admins/:userId/grant
router.post('/super-admins/:userId/grant', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, { isSuperAdmin: true }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    audit(req, 'superadmin_grant', { targetUserId: user._id, metadata: { email: user.email, name: user.name } });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/admin/super-admins/:userId/revoke
router.post('/super-admins/:userId/revoke', async (req, res) => {
  try {
    // Evitar quedarse sin super-admins
    const count = await User.countDocuments({ isSuperAdmin: true });
    if (count <= 1) {
      return res.status(400).json({ success: false, message: 'No puedes revocar al último super-admin' });
    }
    const user = await User.findByIdAndUpdate(req.params.userId, { isSuperAdmin: false }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    audit(req, 'superadmin_revoke', { targetUserId: user._id, metadata: { email: user.email, name: user.name } });
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ───── Auditoría ─────

// GET /api/admin/audit-logs  → lista el registro de accesos de super-admins
router.get('/audit-logs', async (req, res) => {
  try {
    const SuperAdminAudit = require('../models/SuperAdminAudit');
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const logs = await runWithoutTenant(() => 
      SuperAdminAudit.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('superAdminId', 'name email')
        .populate('organizationId', 'name slug')
        .lean()
    );
    
    const total = await runWithoutTenant(() => SuperAdminAudit.countDocuments());
    
    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('[admin] audit logs error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
