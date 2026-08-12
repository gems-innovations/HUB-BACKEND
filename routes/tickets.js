const express = require('express');
const router = express.Router();
const Ticket = require('../models/Ticket');
const User = require('../models/User');
const Membership = require('../models/Membership');
const Organization = require('../models/Organization');
const Case = require('../models/Case');
const Wiki = require('../models/Wiki');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { runWithTenant } = require('../services/tenantContext');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  notifyTicketCreated,
  notifyStatusChanged,
  notifyNewComment
} = require('../services/emailService');

// ─── Upload de adjuntos de tickets ─────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/tickets/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, 'ticket-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname));
  }
});

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
]);
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'), false);
  }
});

// El frontend ya valida tipo/tamaño/cantidad antes de enviar, pero si alguien
// llega directo a la API (u otro cliente futuro) sin pasar por esa validación,
// esto evita que un error crudo de Multer (en inglés, tipo "File too large")
// llegue tal cual al usuario final.
function handleUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'Cada archivo debe pesar máximo 10MB' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ success: false, error: 'Máximo 5 archivos por envío' });
      }
      return res.status(400).json({ success: false, error: err.message || 'No se pudo procesar el archivo adjunto' });
    });
  };
}
const uploadTicketFiles = handleUpload(upload.array('files', 5));

const getPriorityText = (priority) => ({
  low: '🟢 Baja', medium: '🟡 Media', high: '🟠 Alta', urgent: '🔴 Urgente'
})[priority] || '🟡 Media';

// Sólo agentes/dueños pueden ver todos los tickets de la org, reasignar o cambiar estado.
const requireAgent = requireRole('admin', 'supervisor', 'support');

// Un ticket "es del cliente" si el userId coincide o, si no hay cuenta, por email
// (formulario público no siempre trae userId). Se usa para que un cliente sólo
// pueda ver/comentar SU PROPIO ticket, nunca el de otro cliente de la misma org.
function ownsTicket(ticket, user) {
  if (ticket.submittedBy?.userId && String(ticket.submittedBy.userId) === String(user._id)) return true;
  if (ticket.submittedBy?.email && user.email && ticket.submittedBy.email.toLowerCase() === user.email.toLowerCase()) return true;
  return false;
}
function isAgent(req) {
  const m = req.membership;
  return !!m && (m.isOwner || m.isSuperAdminSession || ['admin', 'supervisor', 'support'].includes(m.role));
}

// ───── PÚBLICAS ─────
// POST /api/tickets/public/:orgSlug  — formulario externo de soporte
// Resuelve la org por slug y crea el ticket dentro de su contexto.
router.post('/public/:orgSlug', uploadTicketFiles, async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: req.params.orgSlug, status: 'active' });
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organización no encontrada o inactiva' });
    }

    await runWithTenant(org._id, async () => {
      const { subject, description, category, priority, name, email, clientId, userId } = req.body;
      const attachments = (req.files || []).map(f => `/uploads/tickets/${f.filename}`);

      const ticket = new Ticket({
        organizationId: org._id, // explícito + plugin lo refuerza
        subject, description, category, priority, attachments,
        submittedBy: { name, email, clientId, userId }
      });

      // Auto-asignación: agente de soporte con menos tickets activos en esta org
      const supportMembers = await Membership.find({
        organization: org._id,
        role: 'support',
        status: 'active'
      }).populate('user');
      const supportAgents = supportMembers.map(m => m.user).filter(u => u && u.isActive);

      let assignedAgent = null;
      if (supportAgents.length > 0) {
        const loads = await Promise.all(supportAgents.map(async (agent) => {
          const count = await Ticket.countDocuments({
            organizationId: org._id,
            assignedTo: agent._id,
            status: { $in: ['new', 'open', 'waiting'] }
          });
          return { agent, count };
        }));
        loads.sort((a, b) => a.count - b.count);
        assignedAgent = loads[0].agent;
        ticket.assignedTo = assignedAgent._id;
        ticket.status = 'open';
      }

      await ticket.save();

      const populated = await Ticket.findOne({ _id: ticket._id, organizationId: org._id })
        .populate('assignedTo', 'name email avatar');

      notifyTicketCreated(populated || ticket, assignedAgent)
        .catch(e => console.error('[Email] notifyTicketCreated:', e.message));

      res.status(201).json({
        success: true,
        data: populated || ticket,
        message: 'Ticket creado exitosamente'
      });
    });
  } catch (error) {
    console.error('Error creating public ticket:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// ───── AUTENTICADAS ─────
// (authenticateToken + requireOrganization ya viene del wall global en index.js,
//  los mantengo explícitos aquí también como defensa adicional)

// POST /api/tickets  — creación manual por un agente logueado.
// A diferencia de /public/:orgSlug (que resuelve la org por slug de la URL, pensado
// para el formulario externo sin sesión), esta ruta usa req.organizationId del
// propio token — así el ticket SIEMPRE queda en la organización real del agente,
// sin depender de adivinar/asumir un slug por defecto.
router.post('/', authenticateToken, requireAgent, uploadTicketFiles, async (req, res) => {
  try {
    const { subject, description, category, priority, name, email, clientId, assignedTo } = req.body;
    if (!subject || !description) {
      return res.status(400).json({ success: false, error: 'Asunto y descripción son requeridos' });
    }
    const attachments = (req.files || []).map(f => `/uploads/tickets/${f.filename}`);

    const ticket = new Ticket({
      organizationId: req.organizationId,
      subject, description, category, priority, attachments,
      submittedBy: { name: name || req.user.name, email: email || req.user.email, clientId, userId: req.user._id },
      status: 'open'
    });

    if (assignedTo) {
      const member = await Membership.findOne({ user: assignedTo, organization: req.organizationId, status: 'active' });
      if (member) ticket.assignedTo = assignedTo;
    }

    await ticket.save();
    const populated = await Ticket.findOne({ _id: ticket._id, organizationId: req.organizationId })
      .populate('assignedTo', 'name email avatar');

    notifyTicketCreated(populated || ticket, populated?.assignedTo || null)
      .catch(e => console.error('[Email] notifyTicketCreated:', e.message));

    res.status(201).json({ success: true, data: populated || ticket, message: 'Ticket creado exitosamente' });
  } catch (error) {
    console.error('Error creating internal ticket:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/', authenticateToken, requireAgent, async (req, res) => {
  try {
    const { status, priority, category, assignedTo } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const skip = (page - 1) * limit;

    const query = { organizationId: req.organizationId };
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (category) query.category = category;
    if (assignedTo) query.assignedTo = assignedTo;

    const total = await Ticket.countDocuments(query);
    const tickets = await Ticket.find(query)
      .populate('assignedTo', 'name email avatar photo')
      .populate('submittedBy.userId', 'name email avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({ success: true, data: tickets, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/my', authenticateToken, requireAgent, async (req, res) => {
  try {
    // Sin límite, un agente con mucho historial traía TODA su bandeja en cada
    // toggle a "Mi Bandeja" — tope razonable para no volverse un query sin fondo.
    const tickets = await Ticket.find({ organizationId: req.organizationId, assignedTo: req.user._id })
      .populate('submittedBy.userId', 'name email avatar')
      .sort({ updatedAt: -1 })
      .limit(200);
    res.json({ success: true, data: tickets });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/client-history', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    const query = {
      organizationId: req.organizationId,
      $or: [
        { 'submittedBy.userId': req.user._id },
        { 'submittedBy.email': req.user.email }
      ]
    };

    const total = await Ticket.countDocuments(query);
    const tickets = await Ticket.find(query)
      .populate('assignedTo', 'name email avatar position')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({ success: true, data: tickets, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ _id: req.params.id, organizationId: req.organizationId })
      .populate('assignedTo', 'name email avatar')
      .populate('comments.author', 'name email avatar role')
      .populate('linkedCases', 'titulo')
      .populate('linkedWikiArticles', 'titulo');

    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket no encontrado' });

    // Un cliente/no-agente sólo puede ver su propio ticket, aunque conozca el _id
    // de otro dentro de la misma organización.
    if (!isAgent(req) && !ownsTicket(ticket, req.user)) {
      return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
    }

    // Los comentarios internos nunca deben llegar a un cliente, sin importar el rol
    // exacto — si no es agente, se filtran antes de responder (defensa en profundidad,
    // el frontend ya los oculta pero no hay que confiar sólo en eso).
    const data = ticket.toObject();
    if (!isAgent(req)) {
      data.comments = data.comments.filter(c => !c.isInternal);
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch('/:id/status', authenticateToken, requireAgent, async (req, res) => {
  try {
    const { status, assignedTo } = req.body;
    const ticket = await Ticket.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket no encontrado' });

    const oldStatus = ticket.status;
    const updateData = { updatedAt: new Date() };
    if (status) updateData.status = status;
    if (status === 'resolved') updateData.resolvedAt = new Date();

    // Reasignar a otro agente — valida que sea un miembro activo de esta org
    // antes de aceptarlo (evita asignar a un userId ajeno a la organización).
    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === '') {
        updateData.assignedTo = null;
      } else {
        const member = await Membership.findOne({ user: assignedTo, organization: req.organizationId, status: 'active' });
        if (!member) return res.status(400).json({ success: false, message: 'El agente no pertenece a esta organización' });
        updateData.assignedTo = assignedTo;
      }
    }

    const updated = await Ticket.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.organizationId },
      updateData,
      { new: true }
    ).populate('assignedTo', 'name email avatar');

    if (status && status !== oldStatus) {
      notifyStatusChanged(updated, oldStatus, status).catch(e => console.error('[Email] notifyStatusChanged:', e.message));
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// PATCH /api/tickets/:id  — edición de "Recursos Vinculados" (casos/wiki) del panel
// de detalle. Sólo agentes; se valida que cada recurso pertenezca a ESTA organización
// antes de guardarlo, para no poder vincular (y así filtrar la existencia de) un
// Case/Wiki de otra organización sólo por adivinar su _id.
router.patch('/:id', authenticateToken, requireAgent, async (req, res) => {
  try {
    const { linkedCases, linkedWikiArticles, tags } = req.body;
    const update = {};

    if (linkedCases !== undefined) {
      const ids = Array.isArray(linkedCases) ? linkedCases : [];
      if (ids.length) {
        const count = await Case.countDocuments({ _id: { $in: ids }, organizationId: req.organizationId });
        if (count !== ids.length) {
          return res.status(400).json({ success: false, message: 'Uno o más casos no pertenecen a esta organización' });
        }
      }
      update.linkedCases = ids;
    }
    if (linkedWikiArticles !== undefined) {
      const ids = Array.isArray(linkedWikiArticles) ? linkedWikiArticles : [];
      if (ids.length) {
        const count = await Wiki.countDocuments({ _id: { $in: ids }, organizationId: req.organizationId });
        if (count !== ids.length) {
          return res.status(400).json({ success: false, message: 'Uno o más artículos de wiki no pertenecen a esta organización' });
        }
      }
      update.linkedWikiArticles = ids;
    }
    if (Array.isArray(tags)) update.tags = tags;

    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'Nada que actualizar' });
    }
    update.updatedAt = new Date();

    const ticket = await Ticket.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.organizationId },
      update,
      { new: true }
    )
      .populate('assignedTo', 'name email avatar')
      .populate('linkedCases', 'titulo')
      .populate('linkedWikiArticles', 'titulo');

    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
    res.json({ success: true, data: ticket });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/:id/comments', authenticateToken, uploadTicketFiles, async (req, res) => {
  try {
    const { text, isInternal } = req.body;
    const attachments = (req.files || []).map(f => `/uploads/tickets/${f.filename}`);

    const ticket = await Ticket.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket no encontrado' });

    const agent = isAgent(req);
    // Un cliente sólo puede comentar en SU propio ticket, y nunca puede marcar
    // una nota como interna (aunque el frontend no debería mandarlo, no confiamos
    // en eso — se fuerza aquí sin importar lo que llegue en el body).
    if (!agent) {
      if (!ownsTicket(ticket, req.user)) {
        return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
      }
    }

    ticket.comments.push({
      text,
      author: req.user._id,
      isInternal: agent && (isInternal === 'true' || isInternal === true),
      attachments
    });
    await ticket.save();

    const populated = await Ticket.findOne({ _id: req.params.id, organizationId: req.organizationId })
      .populate('assignedTo', 'name email')
      .populate('comments.author', 'name email avatar role');

    const newComment = populated.comments[populated.comments.length - 1];
    notifyNewComment(populated, newComment, req.user).catch(e => console.error('[Email] notifyNewComment:', e.message));
    res.json({ success: true, data: newComment });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
