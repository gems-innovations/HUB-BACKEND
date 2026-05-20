// Helpers para crear notificaciones de mención, asignación y comentarios.
// Se hacen "fire and forget" — si alguno falla no rompe la operación principal.

const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Detecta menciones @nombre en un texto y devuelve los _id de usuarios coincidentes.
 * Hace match por User.name removiendo espacios y case-insensitive.
 */
async function resolveMentionedUserIds(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/@(\w+)/g) || [];
  if (matches.length === 0) return [];

  const handles = matches.map(m => m.slice(1).toLowerCase());

  // Traer todos los usuarios activos y comparar contra nombre sin espacios
  const users = await User.find({}).select('_id name').lean();
  const found = new Set();
  for (const u of users) {
    const handle = (u.name || '').replace(/\s+/g, '').toLowerCase();
    if (handles.includes(handle)) found.add(String(u._id));
  }
  return Array.from(found);
}

/**
 * Crea notificaciones de mención para cada usuario mencionado en el texto.
 */
async function notifyMentions({ text, entityType, entityId, entityTitle, fromUserId }) {
  try {
    const userIds = await resolveMentionedUserIds(text);
    if (userIds.length === 0) return;

    const ops = userIds
      .filter(uid => String(uid) !== String(fromUserId)) // no auto-notificarse
      .map(uid => ({
        userId: uid,
        category: 'mention',
        entityType,
        entityId,
        title: 'Te mencionaron en una tarea',
        message: entityTitle || '',
        read: false,
        fromUserId,
        metadata: { text }
      }));

    if (ops.length > 0) await Notification.insertMany(ops);
  } catch (e) {
    console.warn('notifyMentions error:', e.message);
  }
}

/**
 * Crea notificaciones de asignación para los usuarios asignados (excluyendo al asignador).
 */
async function notifyAssignment({ assignedTo, entityType, entityId, entityTitle, fromUserId }) {
  try {
    const list = Array.isArray(assignedTo) ? assignedTo : [assignedTo];
    const ops = list
      .filter(uid => uid && String(uid) !== String(fromUserId))
      .map(uid => ({
        userId: uid,
        category: 'assignment',
        entityType,
        entityId,
        title: 'Nueva tarea asignada',
        message: entityTitle || '',
        read: false,
        fromUserId
      }));

    if (ops.length > 0) await Notification.insertMany(ops);
  } catch (e) {
    console.warn('notifyAssignment error:', e.message);
  }
}

/**
 * Notifica a los demás asignados/seguidores cuando se agrega un comentario nuevo (no mención).
 */
async function notifyComment({ recipients, entityType, entityId, entityTitle, fromUserId, snippet }) {
  try {
    const ops = (recipients || [])
      .filter(uid => uid && String(uid) !== String(fromUserId))
      .map(uid => ({
        userId: uid,
        category: 'comment',
        entityType,
        entityId,
        title: 'Nuevo comentario en una tarea',
        message: entityTitle || '',
        read: false,
        fromUserId,
        metadata: { snippet }
      }));

    if (ops.length > 0) await Notification.insertMany(ops);
  } catch (e) {
    console.warn('notifyComment error:', e.message);
  }
}

module.exports = {
  resolveMentionedUserIds,
  notifyMentions,
  notifyAssignment,
  notifyComment
};
