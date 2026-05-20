const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const Activity = require('../models/Activity');
const Task = require('../models/Task');
const { authenticateToken } = require('../middleware/auth');

// Helper: notificaciones virtuales de vencimientos (no se persisten,
// se calculan en cada request para que siempre estén al día).
async function computeDueNotifications(userId) {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h

  // Activities asignadas al usuario con dueDate
  const activities = await Activity.find({
    assignedTo: { $in: [userId] },
    status: { $nin: ['completed', 'cancelled'] },
    dueDate: { $ne: null }
  }).select('_id title dueDate status').lean();

  // Tasks asignadas al usuario con dueDate
  const tasks = await Task.find({
    assignedTo: userId,
    status: { $nin: ['completed', 'cancelled'] },
    dueDate: { $ne: null }
  }).select('_id title dueDate status').lean();

  const virtual = [];

  for (const a of activities) {
    const due = new Date(a.dueDate);
    if (due < now) {
      virtual.push({
        _id: `due-activity-${a._id}`,
        userId,
        category: 'overdue',
        entityType: 'activity',
        entityId: a._id,
        title: 'Tarea vencida',
        message: a.title,
        read: false,
        virtual: true,
        createdAt: due
      });
    } else if (due <= soon) {
      virtual.push({
        _id: `soon-activity-${a._id}`,
        userId,
        category: 'due-soon',
        entityType: 'activity',
        entityId: a._id,
        title: 'Vence pronto',
        message: a.title,
        read: false,
        virtual: true,
        createdAt: now
      });
    }
  }

  for (const t of tasks) {
    const due = new Date(t.dueDate);
    if (due < now) {
      virtual.push({
        _id: `due-task-${t._id}`,
        userId,
        category: 'overdue',
        entityType: 'task',
        entityId: t._id,
        title: 'Tarea vencida',
        message: t.title,
        read: false,
        virtual: true,
        createdAt: due
      });
    } else if (due <= soon) {
      virtual.push({
        _id: `soon-task-${t._id}`,
        userId,
        category: 'due-soon',
        entityType: 'task',
        entityId: t._id,
        title: 'Vence pronto',
        message: t.title,
        read: false,
        virtual: true,
        createdAt: now
      });
    }
  }

  return virtual;
}

// ── Listar notificaciones del usuario ─────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const stored = await Notification.find({ userId })
      .populate('fromUserId', 'name email photo')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const virtual = await computeDueNotifications(userId);

    // Combinar y ordenar: virtuales primero (más relevantes), luego persistidas
    const all = [...virtual, ...stored].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    res.json(all);
  } catch (error) {
    console.error('Error listando notificaciones:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Conteo de no leídas ───────────────────────────────────────────────────────
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const persisted = await Notification.countDocuments({ userId, read: false });
    const virtual = await computeDueNotifications(userId);
    res.json({ count: persisted + virtual.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Marcar una como leída ─────────────────────────────────────────────────────
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    // Las virtuales no se persisten; ignoramos si el id empieza con prefijos virtuales
    if (typeof req.params.id === 'string' && /^(due|soon)-/.test(req.params.id)) {
      return res.json({ ok: true, virtual: true });
    }
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { read: true },
      { new: true }
    );
    if (!n) return res.status(404).json({ error: 'No encontrada' });
    res.json(n);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Marcar todas como leídas ──────────────────────────────────────────────────
router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    await Notification.updateMany({ userId, read: false }, { read: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Eliminar notificación ─────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (typeof req.params.id === 'string' && /^(due|soon)-/.test(req.params.id)) {
      return res.json({ ok: true, virtual: true });
    }
    await Notification.findOneAndDelete({ _id: req.params.id, userId });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Crear notificación (uso interno y debug) ──────────────────────────────────
router.post('/', authenticateToken, async (req, res) => {
  try {
    const n = new Notification(req.body);
    await n.save();
    res.json(n);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
