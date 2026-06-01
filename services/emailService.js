const nodemailer = require('nodemailer');

// ─── Transporter ─────────────────────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
}

// ─── Core helper ─────────────────────────────────────────────────────────────
async function sendMail({ to, subject, html, text }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[Email] Skipping: Missing config:', {
      host: host ? 'OK' : 'MISSING',
      user: user ? 'OK' : 'MISSING',
      pass: pass ? 'OK' : 'MISSING'
    });
    return null;
  }

  console.log('[Email] Attempting sendMail to:', to);

  // Crear transporter fresco por envío para evitar conexiones colgadas
  const t = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  try {
    const info = await t.sendMail({
      from: process.env.EMAIL_FROM || `"GEMS Hub" <${user}>`,
      to,
      subject,
      html,
      text,
    });
    console.log('[Email] Sent to', to, '| messageId:', info.messageId);
    return info;
  } catch (err) {
    console.error('[Email] Error sending to', to, '–', err.message, err.code || '');
    return null;
  } finally {
    t.close();
  }
}

// ─── Templates ───────────────────────────────────────────────────────────────

function ticketCreatedClientHtml(ticket) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;background:#f9fafc;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Customer CRM Support</h1>
      <p style="color:#a0aec0;margin:8px 0 0;font-size:14px">Confirmación de ticket creado</p>
    </div>
    <div style="padding:32px 40px;background:#fff">
      <p style="font-size:16px;color:#2d3748">Hola <strong>${ticket.submittedBy?.name || 'Cliente'}</strong>,</p>
      <p style="color:#4a5568">Tu solicitud ha sido registrada exitosamente. El equipo de soporte la atenderá a la brevedad.</p>
      <div style="background:#f7fafc;border-left:4px solid #667eea;border-radius:8px;padding:20px;margin:24px 0">
        <p style="margin:0 0 8px;color:#718096;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Detalles del ticket</p>
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>ID:</strong> #${ticket.ticketNumber || ticket._id}</p>
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>Asunto:</strong> ${ticket.subject}</p>
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>Prioridad:</strong> ${ticket.priority || 'Media'}</p>
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>Estado:</strong> ${ticket.status || 'open'}</p>
      </div>
      <p style="color:#718096;font-size:13px">Recibirás actualizaciones por este medio cuando el estado de tu ticket cambie.</p>
    </div>
    <div style="background:#f7fafc;padding:20px 40px;text-align:center">
      <p style="color:#a0aec0;font-size:12px;margin:0">© ${new Date().getFullYear()} Customer CRM Support</p>
    </div>
  </div>`;
}

function ticketCreatedInternalHtml(ticket, assignedAgent) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;background:#f9fafc;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">🎫 Nuevo Ticket Recibido</h1>
      <p style="color:#a0aec0;margin:8px 0 0;font-size:14px">Notificación interna</p>
    </div>
    <div style="padding:32px 40px;background:#fff">
      <div style="background:#f7fafc;border-left:4px solid #48bb78;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>Nombre:</strong> ${ticket.submittedBy?.name || '—'}</p>
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>Email:</strong> ${ticket.submittedBy?.email || '—'}</p>
      </div>
      <div style="background:#f7fafc;border-left:4px solid #667eea;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>Asunto:</strong> ${ticket.subject}</p>
        <p style="margin:6px 0;font-size:14px;color:#2d3748"><strong>Descripción:</strong> ${ticket.description}</p>
      </div>
      ${assignedAgent ? `<p style="color:#4a5568;font-size:14px">Asignado a: <strong>${assignedAgent.name}</strong></p>` : ''}
    </div>
  </div>`;
}

function ticketStatusChangedHtml(ticket, oldStatus, newStatus) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;background:#f9fafc;border-radius:12px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Actualización de ticket</h1>
    </div>
    <div style="padding:32px 40px;background:#fff">
      <p style="font-size:16px;color:#2d3748">Hola <strong>${ticket.submittedBy?.name || 'Cliente'}</strong>,</p>
      <p style="color:#4a5568">El estado de tu ticket #${ticket.ticketNumber || ticket._id} ha cambiado de <strong>${oldStatus}</strong> a <strong>${newStatus}</strong>.</p>
    </div>
  </div>`;
}

// ─── Exported notification helpers ───────────────────────────────────────────

async function notifyTicketCreated(ticket, assignedAgent) {
  console.log('[Email] notifyTicketCreated called for ticket:', ticket.ticketNumber || ticket._id);
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  if (ticket.submittedBy?.email) {
    await sendMail({
      to: ticket.submittedBy.email,
      subject: `[Ticket #${ticket.ticketNumber || ticket._id}] Recibido: ${ticket.subject}`,
      html: ticketCreatedClientHtml(ticket),
    });
  }
  if (supportEmail) {
    await sendMail({
      to: supportEmail,
      subject: `🎫 Nuevo ticket de ${ticket.submittedBy?.name}: ${ticket.subject}`,
      html: ticketCreatedInternalHtml(ticket, assignedAgent),
    });
  }
}

async function notifyStatusChanged(ticket, oldStatus, newStatus) {
  if (ticket.submittedBy?.email) {
    await sendMail({
      to: ticket.submittedBy.email,
      subject: `[Ticket #${ticket.ticketNumber || ticket._id}] Estado: ${newStatus}`,
      html: ticketStatusChangedHtml(ticket, oldStatus, newStatus),
    });
  }
}

async function notifyNewComment(ticket, comment, author) {
  const isAuthorAgent = ['admin', 'supervisor', 'support'].includes(author.role);

  // 1. If agent commented, notify CLIENT (only if not internal)
  if (isAuthorAgent && !comment.isInternal && ticket.submittedBy?.email) {
    await sendMail({
      to: ticket.submittedBy.email,
      subject: `Nueva respuesta en su Ticket #${ticket.ticketNumber || ticket._id}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
          <div style="background: #111827; color: white; padding: 24px; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Actualización de Soporte</h2>
          </div>
          <div style="padding: 24px; color: #374151; line-height: 1.6;">
            <p>Hola <strong>${ticket.submittedBy.name}</strong>,</p>
            <p>Nuestro equipo ha respondido a tu ticket <strong>${ticket.subject}</strong>:</p>
            <div style="background: #f9fafb; padding: 16px; border-radius: 8px; border-left: 4px solid #4f46e5; margin: 20px 0; font-style: italic;">
              "${comment.text}"
            </div>
            <p>Puedes ver la conversación completa o responder desde tu panel de cliente.</p>
          </div>
        </div>
      `
    });
  }

  // 2. If client commented, notify AGENT
  if (!isAuthorAgent && ticket.assignedTo?.email) {
    await sendMail({
      to: ticket.assignedTo.email,
      subject: `El cliente respondió al Ticket #${ticket.ticketNumber || ticket._id}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
          <div style="background: #4f46e5; color: white; padding: 24px;">
            <h2 style="margin: 0;">Respuesta del Cliente</h2>
          </div>
          <div style="padding: 24px; color: #374151;">
            <p>El cliente <strong>${ticket.submittedBy.name}</strong> ha dejado un nuevo comentario en el ticket <strong>#${ticket.ticketNumber || ticket._id}</strong>:</p>
            <div style="background: #fef3c7; padding: 16px; border-radius: 8px; border-left: 4px solid #d97706; margin: 20px 0;">
              "${comment.text}"
            </div>
          </div>
        </div>
      `
    });
  }
}

async function notifySLAAlert(ticket) {
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  if (!supportEmail) return;

  await sendMail({
    to: supportEmail,
    subject: `⚠️ ALERTA SLA: Ticket #${ticket.ticketNumber} pendiente`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #ef4444; border-radius: 12px; overflow: hidden;">
        <div style="background: #ef4444; color: white; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px;">🚨 ALERTA DE RETRASO</h1>
        </div>
        <div style="padding: 24px; color: #374151; line-height: 1.6;">
          <p>El siguiente ticket lleva más de 2 horas sin ser atendido:</p>
          <ul style="background: #fee2e2; padding: 16px; border-radius: 8px; list-style: none;">
            <li><strong>Ticket:</strong> #${ticket.ticketNumber}</li>
            <li><strong>Asunto:</strong> ${ticket.subject}</li>
            <li><strong>Cliente:</strong> ${ticket.submittedBy.name}</li>
            <li><strong>Estado:</strong> ${ticket.status}</li>
          </ul>
        </div>
      </div>
    `
  });
}

async function sendVerificationEmail(user, token, req) {
  // Use frontend URL for the verification link
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

  return await sendMail({
    to: user.email,
    subject: 'Activa tu cuenta en GEMS Hub 🚀',
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Inter', Arial, sans-serif;">
        <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05);">
          
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%); padding: 40px 30px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">¡Bienvenido a GEMS Hub!</h1>
            <p style="margin: 10px 0 0; color: #e0e7ff; font-size: 16px; opacity: 0.9;">El centro de comando para tu equipo</p>
          </div>
          
          <div style="padding: 40px 30px; color: #374151;">
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Hola <span style="color: #111827; font-weight: 600;">${user.name}</span>,</p>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Estamos muy emocionados de tenerte a bordo. Has dado el primer paso para revolucionar la gestión de clientes y proyectos de tu empresa.</p>
            <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px;">Para activar tu <strong style="color:#111827;">Free Trial de 14 días</strong> y acceder a todas las funcionalidades premium, por favor confirma tu dirección de correo electrónico.</p>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${verifyUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(79, 70, 229, 0.2);">Verificar mi cuenta</a>
            </div>
            
            <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; border-left: 4px solid #4f46e5;">
              <p style="margin: 0; font-size: 14px; color: #4b5563;"><strong>¿Qué sigue?</strong><br>Una vez verifiques tu cuenta, podrás configurar tu espacio de trabajo e invitar a tu equipo de inmediato.</p>
            </div>
          </div>
          
          <div style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">Si el botón superior no funciona, copia y pega este enlace en tu navegador:</p>
            <p style="color: #4f46e5; word-break: break-all; font-size: 13px;">${verifyUrl}</p>
            <p style="margin-top: 16px; font-size: 13px; color: #64748b;">&copy; ${new Date().getFullYear()} GEMS Hub. Todos los derechos reservados.</p>
          </div>
        </div>
      </body>
      </html>
    `
  });
}

// ─── Task notifications ───────────────────────────────────────────────────────

function taskAssignedHtml(task, assignee, creator) {
  const priorityColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280' };
  const priorityColor = priorityColors[task.priority] || '#6b7280';
  const frontendUrl = process.env.FRONTEND_URL || 'https://hub.gemsinnovations.com';
  const taskUrl = `${frontendUrl}/tasks`;
  const dueDateStr = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('es-CR', { dateStyle: 'long' })
    : null;

  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;background:#f9fafc;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#1e1b4b 0%,#4338ca 100%);padding:32px 40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">GEMS Hub</h1>
      <p style="color:#c7d2fe;margin:8px 0 0;font-size:14px">Se te ha asignado una tarea</p>
    </div>
    <div style="padding:32px 40px;background:#fff">
      <p style="font-size:16px;color:#1e293b;margin:0 0 8px">Hola <strong>${assignee.name}</strong>,</p>
      <p style="color:#475569;margin:0 0 24px"><strong>${creator.name}</strong> te ha asignado la siguiente tarea:</p>
      <div style="background:#f8fafc;border-left:4px solid #8b5cf6;border-radius:8px;padding:20px;margin-bottom:24px">
        <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a">${task.title}</p>
        ${task.description ? `<p style="margin:0 0 14px;font-size:14px;color:#475569;line-height:1.6">${task.description}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
          <span style="background:${priorityColor}1a;color:${priorityColor};border:1px solid ${priorityColor}40;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;text-transform:uppercase">${task.priority || 'media'}</span>
          ${task.type ? `<span style="background:#8b5cf61a;color:#7c3aed;border:1px solid #8b5cf640;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600">${task.type}</span>` : ''}
        </div>
      </div>
      ${dueDateStr ? `<p style="color:#64748b;font-size:14px;margin:0 0 20px">Fecha límite: <strong style="color:#0f172a">${dueDateStr}</strong></p>` : ''}
      <div style="text-align:center;margin:28px 0 8px">
        <a href="${taskUrl}" style="display:inline-block;background:#8b5cf6;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-weight:600;font-size:15px">Ver tarea en GEMS Hub</a>
      </div>
    </div>
    <div style="background:#f1f5f9;padding:18px 40px;text-align:center;border-top:1px solid #e2e8f0">
      <p style="color:#94a3b8;font-size:12px;margin:0">&copy; ${new Date().getFullYear()} GEMS Innovations · GEMS Hub</p>
    </div>
  </div>`;
}

async function notifyTaskAssigned(task, creator) {
  const assignees = Array.isArray(task.assignedTo) ? task.assignedTo : [task.assignedTo];
  const creatorId = (creator?._id || creator?.id || '').toString();

  console.log('[Email] notifyTaskAssigned | assignees:', assignees.length, '| creatorId:', creatorId);

  for (const assignee of assignees) {
    const assigneeId = (assignee?._id || assignee?.id || '').toString();
    console.log('[Email] Checking assignee:', assigneeId, '| email:', assignee?.email || 'MISSING');

    if (!assignee?.email) {
      console.warn('[Email] Skipping assignee (no email):', assigneeId);
      continue;
    }
    if (assigneeId === creatorId) {
      console.log('[Email] Skipping creator self-assignment:', assignee.email);
      continue;
    }

    await sendMail({
      to: assignee.email,
      subject: `[GEMS Hub] Tarea asignada: ${task.title}`,
      html: taskAssignedHtml(task, assignee, creator),
    });
  }
}

module.exports = {
  sendMail,
  notifyTicketCreated,
  notifyStatusChanged,
  notifyNewComment,
  notifySLAAlert,
  sendVerificationEmail,
  notifyTaskAssigned,
};
