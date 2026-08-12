// Helpers para crear notificaciones de mención, asignación y comentarios.
// Se hacen "fire and forget" — si alguno falla no rompe la operación principal.

const Notification = require('../models/Notification');
const User = require('../models/User');
const Membership = require('../models/Membership');

/**
 * Normaliza un nombre: quita tildes, espacios y baja a minúsculas.
 * "Sebastián Pulgarín Gómez" -> "sebastianpulgaringomez"
 */
function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remover combining marks
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Detecta menciones @nombre en un texto y devuelve los _id de usuarios coincidentes.
 */
async function resolveMentionedUserIds(text, organizationId) {
  if (!text || typeof text !== 'string') return [];
  // Regex unicode-aware: acepta letras con tildes/ñ, números y _
  const matches = text.match(/@([\p{L}\p{N}_]+)/gu) || [];
  if (matches.length === 0) return [];

  const handles = matches.map(m => normalize(m.slice(1)));

  // Solo usuarios con membership activa en la MISMA organización de la
  // actividad/tarea — antes buscaba en TODOS los usuarios de la base,
  // pudiendo mencionar (y notificar) a alguien de otra organización si
  // el nombre coincidía.
  let userIds = null;
  if (organizationId) {
    const memberships = await Membership.find({ organization: organizationId, status: 'active' }).select('user').lean();
    userIds = memberships.map(m => m.user);
  }
  const userQuery = userIds ? { _id: { $in: userIds } } : {};
  const users = await User.find(userQuery).select('_id name').lean();
  const found = new Set();
  for (const u of users) {
    const handle = normalize(u.name);
    // Match exacto, o que el handle del texto sea prefijo del nombre completo (tolerancia)
    if (handles.includes(handle) || handles.some(h => h.length >= 3 && handle.startsWith(h))) {
      found.add(String(u._id));
    }
  }
  return Array.from(found);
}

/**
 * Crea notificaciones de mención para cada usuario mencionado en el texto.
 * NOTA: permite auto-mención (útil para testing y para recordatorios personales).
 */
async function notifyMentions({ text, entityType, entityId, entityTitle, fromUserId, organizationId }) {
  try {
    const userIds = await resolveMentionedUserIds(text, organizationId);
    if (userIds.length === 0) return;

    const ops = userIds.map(uid => ({
      userId: uid,
      organizationId,
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
 * Crea notificaciones de asignación (excluye al asignador para evitar auto-spam).
 */
async function notifyAssignment({ assignedTo, entityType, entityId, entityTitle, fromUserId, organizationId }) {
  try {
    const list = Array.isArray(assignedTo) ? assignedTo : [assignedTo];
    const ops = list
      .filter(uid => uid && String(uid) !== String(fromUserId))
      .map(uid => ({
        userId: uid,
        organizationId,
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
 * Notifica a los demás asignados cuando se agrega un comentario nuevo (no mención).
 */
async function notifyComment({ recipients, entityType, entityId, entityTitle, fromUserId, snippet, organizationId }) {
  try {
    const ops = (recipients || [])
      .filter(uid => uid && String(uid) !== String(fromUserId))
      .map(uid => ({
        userId: uid,
        organizationId,
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
