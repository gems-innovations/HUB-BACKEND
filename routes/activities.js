const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Activity = require('../models/Activity');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { notifyMentions, notifyAssignment, notifyComment } = require('../services/notificationHelpers');
const { notifyTaskAssigned, notifyMentionEmail } = require('../services/emailService');

// Configuración de multer para imágenes de comentarios
const commentsUploadDir = path.join(__dirname, '..', 'uploads', 'activity-comments');
if (!fs.existsSync(commentsUploadDir)) {
  fs.mkdirSync(commentsUploadDir, { recursive: true });
}
const commentImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, commentsUploadDir),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `comment-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});
const commentImageUpload = multer({
  storage: commentImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB por imagen
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'), false);
    }
    cb(null, true);
  }
});

// Compara valores para el historial de cambios — un !== ingenuo marca como
// "cambio" cualquier array (assignedTo) o Date reconstruido aunque el valor
// real sea el mismo, así que arrays se comparan por contenido y fechas por
// timestamp.
function valuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (v) => (v || []).map(x => String(x?._id || x)).sort();
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  }
  const aIsDate = a instanceof Date || (typeof a === 'string' && !isNaN(Date.parse(a)) && /^\d{4}-\d{2}-\d{2}/.test(a));
  const bIsDate = b instanceof Date || (typeof b === 'string' && !isNaN(Date.parse(b)) && /^\d{4}-\d{2}-\d{2}/.test(b));
  if (aIsDate && bIsDate) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return String(a ?? '') === String(b ?? '');
}

// Registra en activity.history los campos de `fields` cuyo valor en `updates`
// difiera del actual — no persiste, solo llena el array; el caller hace .save().
function logFieldChanges(activity, updates, fields, userId) {
  fields.forEach(field => {
    if (!(field in updates)) return
    const oldValue = activity[field]
    const newValue = updates[field]
    if (!valuesEqual(oldValue, newValue)) {
      activity.logChange(field, oldValue, newValue, userId)
    }
  });
}

const HISTORY_TRACKED_FIELDS = ['title', 'status', 'priority', 'date', 'dueDate', 'assignedTo', 'clientId', 'estimatedTime', 'completionPercentage', 'description'];

// Crear nueva actividad
router.post('/', authenticateToken, async (req, res) => {
  console.log('🚀 [ACTIVITIES] Iniciando creación de nueva actividad');
  console.log('📝 [ACTIVITIES] Datos recibidos:', JSON.stringify(req.body, null, 2));

  try {
    const userId = req.user?._id || req.user?.id;
    const activity = new Activity({ ...req.body, createdBy: userId });
    await activity.save();

    // Notificación: asignación al crear la actividad
    notifyAssignment({
      assignedTo: activity.assignedTo,
      entityType: 'activity',
      entityId: activity._id,
      entityTitle: activity.title,
      fromUserId: userId,
      organizationId: req.organizationId
    });

    console.log('✅ [ACTIVITIES] Activity saved with ID:', activity._id);
    console.log('👤 [ACTIVITIES] Saved assignedTo:', activity.assignedTo);

    // Poblar la actividad creada antes de enviarla
    const populatedActivity = await Activity.findById(activity._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo phone avatar')
      .populate('createdBy', 'name email');

    // Notificación por email a los asignados
    const assignees = Array.isArray(populatedActivity.assignedTo)
      ? populatedActivity.assignedTo.filter(Boolean)
      : [];
    console.log('[Activity] Email notify | assignedTo count:', assignees.length, '| createdBy:', populatedActivity.createdBy?.email);
    if (assignees.length) {
      notifyTaskAssigned(populatedActivity, populatedActivity.createdBy).catch(err =>
        console.error('[Email] notifyTaskAssigned (activity) error:', err.message)
      );
    }

    console.log('✅ [ACTIVITIES] Actividad creada exitosamente');
    res.json(populatedActivity);
  } catch (error) {
    console.error('❌ [ACTIVITIES] Error creating activity:', error);
    res.status(400).json({ error: error.message });
  }
});

// Obtener actividades pendientes asignadas al usuario logueado
router.get('/mine', async (req, res) => {
  try {
    // El ID del usuario logueado debe estar en req.user._id (middleware de autenticación)
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    const activities = await Activity.find({ assignedTo: { $in: [userId] }, status: 'pending', organizationId: req.organizationId })
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .sort({ dueDate: 1 });
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener todas las actividades
router.get('/', async (req, res) => {
  try {
    const { assignedTo, status } = req.query;

    // Construir filtros
    let filter = { organizationId: req.organizationId };
    if (assignedTo) {
      filter.assignedTo = { $in: [assignedTo] };
    }
    if (status) {
      filter.status = status;
    }

    const activities = await Activity.find(filter)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .populate('comments.userId', 'name email photo')
      .populate('history.changedBy', 'name email photo avatar')
      .sort({ createdAt: -1 });

    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener actividad por ID (con comentarios poblados)
router.get('/:id', async (req, res) => {
  try {
    const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId })
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .populate('comments.userId', 'name email photo')
      .populate('history.changedBy', 'name email photo avatar');

    if (!activity) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }
    res.json(activity);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener actividades asignadas a un usuario específico
router.get('/assigned/:userId', async (req, res) => {
  try {
    console.log('[API] Buscando actividades para assignedTo:', req.params.userId);
    const activities = await Activity.find({ assignedTo: { $in: [req.params.userId] }, organizationId: req.organizationId })
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .sort({ dueDate: 1 });
    console.log('[API] Actividades encontradas:', activities.length);
    res.json(activities);
  } catch (error) {
    console.error('❌ Error obteniendo actividades asignadas:', error);
    res.status(500).json({ error: error.message });
  }
});

// Actualizar actividad
router.put('/:id', async (req, res) => {
  try {
    // Antes: findByIdAndUpdate sin filtrar por organizationId (cualquier
    // usuario autenticado de CUALQUIER organización podía editar una
    // actividad ajena si adivinaba el ID) y sin cargar el doc, así que no
    // había forma de comparar valores para el historial. Ahora se carga,
    // se registran los cambios, y se guarda con .save() (dispara los hooks).
    const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!activity) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    const userId = req.user?._id || req.user?.id;
    logFieldChanges(activity, req.body, HISTORY_TRACKED_FIELDS, userId);
    // Solo se permite tocar los campos editables por este endpoint — nunca
    // volcar el body entero con Object.assign, o el cliente podría pisar
    // organizationId, history, comments, createdBy, etc.
    HISTORY_TRACKED_FIELDS.forEach(field => {
      if (field in req.body) activity[field] = req.body[field];
    });
    await activity.save();

    const populated = await Activity.findById(activity._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .populate('history.changedBy', 'name email photo avatar');

    res.json(populated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Cambiar estado de actividad
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });

    if (!activity) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }

    if (status !== activity.status) {
      activity.logChange('status', activity.status, status, req.user?._id || req.user?.id);
    }
    activity.status = status;
    activity.updatedAt = new Date();

    // Si se marca como completada, detener todas las sesiones activas
    if (status === 'completed') {
      activity.completionPercentage = 100;
      
      if (activity.activeSessions && activity.activeSessions.length > 0) {
        const now = new Date();
        activity.activeSessions.forEach(session => {
          const elapsedSeconds = Math.floor((now - session.startTime) / 1000);
          activity.timeSpent = (activity.timeSpent || 0) + elapsedSeconds;
        });
        activity.activeSessions = [];
      }
    }

    await activity.save();

    const populated = await Activity.findById(activity._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .populate('history.changedBy', 'name email photo avatar');

    res.json(populated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reasignar actividad
router.patch('/:id/assign', authenticateToken, async (req, res) => {
  try {
    if (!('assignedTo' in req.body)) {
      return res.status(400).json({ error: 'assignedTo es requerido' });
    }
    const { assignedTo } = req.body;

    // Verificar que el usuario existe
    if (assignedTo) {
      const user = await User.findById(assignedTo);
      if (!user) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
    }

    const existing = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!existing) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }
    logFieldChanges(existing, { assignedTo }, ['assignedTo'], req.user?._id || req.user?.id);
    existing.assignedTo = assignedTo;
    existing.updatedAt = new Date();
    await existing.save();

    const activity = await Activity.findById(existing._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .populate('history.changedBy', 'name email photo avatar');

    // Notificar nueva asignación
    notifyAssignment({
      assignedTo: activity.assignedTo,
      entityType: 'activity',
      entityId: activity._id,
      entityTitle: activity.title,
      fromUserId: req.user?._id || req.user?.id,
      organizationId: req.organizationId
    });

    res.json(activity);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar progreso
router.patch('/:id/progress', async (req, res) => {
  try {
    if (!('completionPercentage' in req.body)) {
      return res.status(400).json({ error: 'completionPercentage es requerido' });
    }
    const { completionPercentage } = req.body;
    const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!activity) return res.status(404).json({ error: 'Actividad no encontrada' });

    logFieldChanges(activity, { completionPercentage }, ['completionPercentage'], req.user?._id || req.user?.id);
    activity.completionPercentage = completionPercentage;
    activity.updatedAt = new Date();
    await activity.save();

    const populated = await Activity.findById(activity._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .populate('history.changedBy', 'name email photo avatar');

    res.json(populated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Toggle Timer
router.post('/:id/timer', async (req, res) => {
  try {
    const { action, userId, minutes } = req.body; // action: 'start' | 'stop' | 'add_manual'
    const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!activity) return res.status(404).json({ error: 'Actividad no encontrada' });

    if (!activity.activeSessions) activity.activeSessions = [];

    if (action === 'start') {
      const isActive = activity.activeSessions.some(s => s.userId.toString() === userId);
      if (!isActive) {
        activity.activeSessions.push({ userId, startTime: new Date() });
        activity.logChange('timer', 'detenido', 'iniciado', userId)
      }
    } else if (action === 'stop') {
      const sessionIndex = activity.activeSessions.findIndex(s => s.userId.toString() === userId);
      if (sessionIndex > -1) {
        const session = activity.activeSessions[sessionIndex];
        const elapsedSeconds = Math.floor((new Date() - session.startTime) / 1000);
        const before = activity.timeSpent || 0
        activity.timeSpent = before + elapsedSeconds;
        activity.logChange('timeSpent', before, activity.timeSpent, userId)
        activity.activeSessions.splice(sessionIndex, 1);
      }
    } else if (action === 'add_manual') {
      if (minutes && !isNaN(minutes)) {
        const before = activity.timeSpent || 0
        activity.timeSpent = before + (parseInt(minutes) * 60)
        activity.logChange('timeSpent', before, activity.timeSpent, userId)
      }
    }

    await activity.save();

    const updatedActivity = await Activity.findById(activity._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo avatar')
      .populate('createdBy', 'name email')
      .populate('history.changedBy', 'name email photo avatar');

    res.json(updatedActivity);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Eliminar actividad
router.delete('/:id', async (req, res) => {
  try {
    const activity = await Activity.findOneAndDelete({ _id: req.params.id, organizationId: req.organizationId });
    if (!activity) {
      return res.status(404).json({ error: 'Actividad no encontrada' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== COMENTARIOS ====================

// Agregar comentario a una actividad (soporta texto + imágenes via multipart)
router.post(
  '/:id/comments',
  authenticateToken,
  commentImageUpload.array('images', 10),
  async (req, res) => {
    try {
      const userId = req.user?._id || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Usuario no autenticado' });

      const text = (req.body?.text || '').toString();
      const files = req.files || [];

      if (!text.trim() && files.length === 0) {
        return res.status(400).json({ error: 'El comentario no puede estar vacío' });
      }

      const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });
      if (!activity) return res.status(404).json({ error: 'Actividad no encontrada' });

      // Construir URLs públicas de las imágenes
      const host = `${req.protocol}://${req.get('host')}`;
      const images = files.map(f => ({
        url: `${host}/uploads/activity-comments/${f.filename}`,
        name: f.originalname
      }));

      activity.comments.push({ userId, text, images, createdAt: new Date() });
      await activity.save();

      // Notificaciones: menciones + comentario general a otros asignados
      notifyMentions({
        text,
        entityType: 'activity',
        entityId: activity._id,
        entityTitle: activity.title,
        fromUserId: userId,
        organizationId: req.organizationId
      });
      notifyMentionEmail({
        text,
        sender: req.user,
        resourceTitle: activity.title,
        resourceType: 'activity',
        resourceId: activity._id,
      });
      notifyComment({
        recipients: activity.assignedTo || [],
        entityType: 'activity',
        entityId: activity._id,
        entityTitle: activity.title,
        fromUserId: userId,
        snippet: text.slice(0, 80),
        organizationId: req.organizationId
      });

      const populated = await Activity.findById(activity._id)
        .populate('clientId', 'name email company')
        .populate('assignedTo', 'name email role photo phone avatar')
        .populate('createdBy', 'name email')
        .populate('comments.userId', 'name email photo');

      res.json(populated);
    } catch (error) {
      console.error('Error agregando comentario a actividad:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Editar comentario (solo el autor)
router.put('/:id/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { text } = req.body;

    const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!activity) return res.status(404).json({ error: 'Actividad no encontrada' });

    const comment = activity.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    if (String(comment.userId) !== String(userId)) {
      return res.status(403).json({ error: 'Solo el autor puede editar su comentario' });
    }

    comment.text = text;
    await activity.save();

    const populated = await Activity.findById(activity._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo phone avatar')
      .populate('createdBy', 'name email')
      .populate('comments.userId', 'name email photo');

    res.json(populated);
  } catch (error) {
    console.error('Error editando comentario:', error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar comentario (solo el autor)
router.delete('/:id/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const activity = await Activity.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!activity) return res.status(404).json({ error: 'Actividad no encontrada' });

    const comment = activity.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    if (String(comment.userId) !== String(userId)) {
      return res.status(403).json({ error: 'Solo el autor puede eliminar su comentario' });
    }

    activity.comments.pull(req.params.commentId);
    await activity.save();

    const populated = await Activity.findById(activity._id)
      .populate('clientId', 'name email company')
      .populate('assignedTo', 'name email role photo phone avatar')
      .populate('createdBy', 'name email')
      .populate('comments.userId', 'name email photo');

    res.json(populated);
  } catch (error) {
    console.error('Error eliminando comentario:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
