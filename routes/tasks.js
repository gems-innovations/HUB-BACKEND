const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Task = require('../models/Task');
const Board = require('../models/Board');
const { authenticateToken } = require('../middleware/auth');
const { notifyMentions, notifyAssignment, notifyComment } = require('../services/notificationHelpers');
const { notifyTaskAssigned, notifyMentionEmail } = require('../services/emailService');
const { checkTaskLimit } = require('../middleware/planLimits');

// Configuración de multer para imágenes de comentarios en tareas
const taskCommentsUploadDir = path.join(__dirname, '..', 'uploads', 'task-comments');
if (!fs.existsSync(taskCommentsUploadDir)) {
  fs.mkdirSync(taskCommentsUploadDir, { recursive: true });
}
const taskCommentImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, taskCommentsUploadDir),
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `task-comment-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});
const taskCommentImageUpload = multer({
  storage: taskCommentImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'), false);
    }
    cb(null, true);
  }
});

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// ==================== TAREAS ====================

// Obtener todas las tareas con filtros
router.get('/', async (req, res) => {
  try {
    const { 
      boardStatus, 
      status, 
      priority, 
      assignedTo, 
      sprint,
      type,
      tags,
      board,
      department
    } = req.query;
    
    let filter = {};
    
    // Solo filtrar por board si se proporciona
    if (board) {
      filter.boardId = board;
    }
    
    if (boardStatus) filter.boardStatus = boardStatus;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (sprint) filter['sprint.id'] = sprint;
    if (type) filter.type = type;
    if (tags) filter.tags = { $in: tags.split(',') };

    // Filtro por departamento del usuario asignado
    if (department) {
      const User = require('../models/User');
      const usersInDept = await User.find({ department }).select('_id');
      const userIds = usersInDept.map(u => u._id);
      
      if (filter.assignedTo) {
        // Si ya hay un assignedTo, cruzamos (esto es raro pero por si acaso)
        if (userIds.some(id => id.toString() === filter.assignedTo.toString())) {
          filter.assignedTo = filter.assignedTo;
        } else {
          // No coincide con el departamento, devolvemos nada
          filter.assignedTo = null;
        }
      } else {
        filter.assignedTo = { $in: userIds };
      }
    }
    
    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name email photo role department')
      .populate('createdBy', 'name email photo')
      .populate('parentTask', 'title type status')
      .populate('blockedBy', 'title status')
      .populate('activeSessions.userId', 'name email photo')
      .populate('comments.userId', 'name email photo')
      .sort({ priority: -1, updatedAt: -1 });
    
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener tareas por board status (para Kanban)
router.get('/board/:boardStatus', async (req, res) => {
  try {
    const tasks = await Task.findByBoard(req.params.boardStatus);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener tareas por sprint
router.get('/sprint/:sprintId', async (req, res) => {
  try {
    const tasks = await Task.findBySprint(req.params.sprintId);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener tareas asignadas al usuario actual
router.get('/my-tasks', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    
    const tasks = await Task.find({ 
      assignedTo: userId,
      boardStatus: { $ne: 'done' }
    })
      .populate('assignedTo', 'name email photo')
      .populate('createdBy', 'name email')
      .sort({ priority: -1, dueDate: 1 });
    
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una tarea por ID
router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId })
      .populate('assignedTo', 'name email photo role department')
      .populate('createdBy', 'name email photo')
      .populate('parentTask', 'title type status')
      .populate('blockedBy', 'title status')
      .populate('relatedTasks', 'title type status')
      .populate('comments.userId', 'name email photo')
      .populate('attachments.uploadedBy', 'name email photo')
      .populate('activeSessions.userId', 'name email photo')
      .populate('timeLogs.userId', 'name email photo');
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar tarea por rama de GitHub
router.get('/github/branch/:branch', async (req, res) => {
  try {
    const task = await Task.findByGitHubBranch(req.params.branch);
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada para esta rama' });
    }
    
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nueva tarea
router.post('/', checkTaskLimit, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const taskData = {
      ...req.body,
      createdBy: userId
    };

    const task = new Task(taskData);
    await task.save();

    await task.populate('assignedTo', 'name email photo role');
    await task.populate('createdBy', 'name email photo');

    // Notificación in-app: asignación al crear tarea
    notifyAssignment({
      assignedTo: task.assignedTo?._id || task.assignedTo,
      entityType: 'task',
      entityId: task._id,
      entityTitle: task.title,
      fromUserId: userId
    });

    // Notificación por email a los asignados (sin await para no bloquear la respuesta)
    const assignees = Array.isArray(task.assignedTo) ? task.assignedTo.filter(Boolean) : [];
    console.log('[Task] Creada:', task.title, '| assignedTo count:', assignees.length, '| createdBy:', task.createdBy?.email);
    if (assignees.length) {
      notifyTaskAssigned(task, task.createdBy).catch(err =>
        console.error('[Email] notifyTaskAssigned error:', err.message)
      );
    }

    res.status(201).json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar tarea
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    // Registrar cambios en el historial
    const changedFields = Object.keys(req.body);
    changedFields.forEach(field => {
      if (task[field] !== req.body[field]) {
        task.logChange(field, task[field], req.body[field], userId);
      }
    });
    
    // Actualizar campos
    Object.assign(task, req.body);
    await task.save();
    
    await task.populate('assignedTo', 'name email photo role');
    await task.populate('createdBy', 'name email photo');
    
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Mover tarea en el board (cambiar boardStatus)
router.patch('/:id/move', async (req, res) => {
  try {
    const { boardStatus } = req.body;
    const userId = req.user.id || req.user._id;
    
    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    task.logChange('boardStatus', task.boardStatus, boardStatus, userId);
    task.boardStatus = boardStatus;
    
    // Si se mueve a done, marcar como completada y DETENER TIMERS
    if (boardStatus === 'done') {
      task.status = 'resolved';
      task.completedDate = new Date();
      task.completionPercentage = 100;

      // Detener todas las sesiones activas
      if (task.activeSessions && task.activeSessions.length > 0) {
        const endTime = new Date();
        task.activeSessions.forEach(session => {
          const durationMs = endTime.getTime() - session.startTime.getTime();
          const durationHours = durationMs / (1000 * 60 * 60);
          
          task.timeLogs.push({
            userId: session.userId,
            startTime: session.startTime,
            endTime,
            durationHours,
            notes: 'Finalizado automáticamente al completar tarea'
          });
          
          task.actualHours = (task.actualHours || 0) + durationHours;
        });
        task.activeSessions = [];
      }
    }
    
    await task.save();
    
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Agregar comentario a tarea (soporta texto y/o imágenes via multipart)
router.post('/:id/comments', taskCommentImageUpload.array('images', 10), async (req, res) => {
  try {
    const text = (req.body?.text || '').toString();
    const userId = req.user.id || req.user._id;
    const files = req.files || [];

    if (!text.trim() && files.length === 0) {
      return res.status(400).json({ error: 'El comentario no puede estar vacío' });
    }

    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    const host = `${req.protocol}://${req.get('host')}`;
    const images = files.map(f => ({
      url: `${host}/uploads/task-comments/${f.filename}`,
      name: f.originalname
    }));

    await task.addComment(userId, text, images);
    await task.populate('comments.userId', 'name email photo');

    // Notificaciones: menciones + comentario para el asignado
    notifyMentions({
      text,
      entityType: 'task',
      entityId: task._id,
      entityTitle: task.title,
      fromUserId: userId
    });
    notifyMentionEmail({
      text,
      sender: req.user,
      resourceTitle: task.title,
      resourceType: 'task',
      resourceId: task._id,
    });
    notifyComment({
      recipients: task.assignedTo ? [task.assignedTo] : [],
      entityType: 'task',
      entityId: task._id,
      entityTitle: task.title,
      fromUserId: userId,
      snippet: (text || '').slice(0, 80)
    });

    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Editar comentario de tarea (solo el autor)
router.put('/:id/comments/:commentId', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { text } = req.body;

    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

    const comment = task.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    if (String(comment.userId) !== String(userId)) {
      return res.status(403).json({ error: 'Solo el autor puede editar su comentario' });
    }

    comment.text = text;
    await task.save();
    await task.populate('comments.userId', 'name email photo');

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar comentario de tarea (solo el autor)
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

    const comment = task.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    if (String(comment.userId) !== String(userId)) {
      return res.status(403).json({ error: 'Solo el autor puede eliminar su comentario' });
    }

    task.comments.pull(req.params.commentId);
    await task.save();
    await task.populate('comments.userId', 'name email photo');

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agregar adjunto a tarea
router.post('/:id/attachments', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const attachmentData = {
      ...req.body,
      uploadedBy: userId
    };
    
    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    await task.addAttachment(attachmentData);
    
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar información de GitHub
router.patch('/:id/github', async (req, res) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    await task.updateGitHubInfo(req.body);
    
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== TIME TRACKING (TIMER) ====================

// Iniciar temporizador
router.post('/:id/timer/start', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    // Verificar si ya tiene una sesión activa
    const hasActiveSession = task.activeSessions.some(session => session.userId.toString() === userId.toString());
    if (hasActiveSession) {
      return res.status(400).json({ error: 'Ya tienes un temporizador activo para esta tarea' });
    }
    
    task.activeSessions.push({
      userId,
      startTime: new Date()
    });
    
    await task.save();
    
    // Devolvemos la tarea con datos populados
    await task.populate('activeSessions.userId', 'name email photo');
    
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Detener temporizador
router.post('/:id/timer/stop', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const task = await Task.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    // Buscar la sesión activa del usuario
    const sessionIndex = task.activeSessions.findIndex(session => session.userId.toString() === userId.toString());
    
    if (sessionIndex === -1) {
      return res.status(400).json({ error: 'No hay temporizador activo para esta tarea' });
    }
    
    const session = task.activeSessions[sessionIndex];
    const endTime = new Date();
    
    // Calcular duración en horas
    const durationMs = endTime.getTime() - session.startTime.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    
    // Remover sesión activa
    task.activeSessions.splice(sessionIndex, 1);
    
    // Agregar al log de tiempos
    task.timeLogs.push({
      userId,
      startTime: session.startTime,
      endTime,
      durationHours,
      notes: req.body.notes || ''
    });
    
    // Actualizar horas actuales
    task.actualHours = (task.actualHours || 0) + durationHours;
    
    // El middleware pre('save') se encargará de recalcular remainingHours y completionPercentage
    await task.save();
    
    await task.populate('activeSessions.userId', 'name email photo');
    await task.populate('timeLogs.userId', 'name email photo');
    
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar tarea
router.delete('/:id', async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    
    res.json({ message: 'Tarea eliminada exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ESTADÍSTICAS ====================

// Obtener estadísticas de tareas
router.get('/stats/overview', async (req, res) => {
  try {
    const { sprint } = req.query;
    let filter = {};
    
    if (sprint) {
      filter['sprint.id'] = sprint;
    }
    
    const stats = await Task.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          byStatus: {
            $push: '$boardStatus'
          },
          byPriority: {
            $push: '$priority'
          },
          byType: {
            $push: '$type'
          },
          totalEstimatedHours: { $sum: '$estimatedHours' },
          totalActualHours: { $sum: '$actualHours' },
          avgCompletionPercentage: { $avg: '$completionPercentage' }
        }
      }
    ]);
    
    if (stats.length === 0) {
      return res.json({
        total: 0,
        byStatus: {},
        byPriority: {},
        byType: {},
        totalEstimatedHours: 0,
        totalActualHours: 0,
        avgCompletionPercentage: 0
      });
    }
    
    const result = stats[0];
    
    // Contar por categorías
    const countByArray = (arr) => {
      return arr.reduce((acc, val) => {
        acc[val] = (acc[val] || 0) + 1;
        return acc;
      }, {});
    };
    
    res.json({
      total: result.total,
      byStatus: countByArray(result.byStatus),
      byPriority: countByArray(result.byPriority),
      byType: countByArray(result.byType),
      totalEstimatedHours: result.totalEstimatedHours,
      totalActualHours: result.totalActualHours,
      avgCompletionPercentage: Math.round(result.avgCompletionPercentage || 0)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
