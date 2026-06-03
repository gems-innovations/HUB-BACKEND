const { Resend } = require('resend');
const User = require('../models/User');

// ─── Core helper (Resend HTTP API) ────────────────────────────────────────────
async function sendMail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
  if (!apiKey) { console.warn('[Email] Skipping: RESEND_API_KEY no configurada'); return null; }
  console.log('[Email] Attempting sendMail to:', to);
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || 'GEMS Hub <info@gemsinnovations.com>';
  try {
    const { data, error } = await resend.emails.send({ from, to, subject, html, text });
    if (error) { console.error('[Email] Error sending to', to, '–', error.message); return null; }
    console.log('[Email] Sent to', to, '| id:', data.id);
    return data;
  } catch (err) {
    console.error('[Email] Error sending to', to, '–', err.message);
    return null;
  }
}

// ─── Shared utilities ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();
}

const getFrontendUrl = () => process.env.FRONTEND_URL || 'https://hub.gemsinnovations.com';
const YEAR = new Date().getFullYear();

// ─── Priority badge ───────────────────────────────────────────────────────────
const PRIORITY_MAP = {
  critical: { bg: '#fff1f2', text: '#e11d48', border: '#fecdd3', label: 'Crítica' },
  high:     { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa', label: 'Alta'    },
  medium:   { bg: '#fefce8', text: '#a16207', border: '#fde68a', label: 'Media'   },
  low:      { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0', label: 'Baja'    },
};
function priorityBadge(p) {
  const c = PRIORITY_MAP[p] || { bg: '#f8fafc', text: '#475569', border: '#e2e8f0', label: p || 'Media' };
  return `<span style="display:inline-block;background:${c.bg};color:${c.text};border:1px solid ${c.border};border-radius:20px;padding:3px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">${c.label}</span>`;
}
function typeBadge(type) {
  if (!type) return '';
  return `&nbsp;<span style="display:inline-block;background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe;border-radius:20px;padding:3px 14px;font-size:11px;font-weight:600;">${escHtml(type)}</span>`;
}

// ─── Base email layout ────────────────────────────────────────────────────────
function emailBase({ preheader, headerHtml, bodyHtml, footerExtra = '' }) {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>GEMS Hub</title>
  <style>
    @media only screen and (max-width:620px){
      .email-card{border-radius:0!important;}
      .email-body{padding:28px 24px!important;}
      .email-header{padding:28px 24px 24px!important;}
      .feature-cell{display:block!important;width:100%!important;padding:6px 0!important;}
      .meta-table{width:100%!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#edf2f7;font-family:'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#edf2f7;opacity:0;">${preheader}&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;</div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#edf2f7">
    <tr>
      <td align="center" style="padding:36px 16px 48px;">
        <!-- Card wrapper -->
        <table role="presentation" class="email-card" cellspacing="0" cellpadding="0" border="0"
          style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 40px rgba(30,27,75,0.13);">
          <tr><td>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">

              <!-- HEADER -->
              ${headerHtml}

              <!-- BODY -->
              ${bodyHtml}

              <!-- FOOTER -->
              <tr>
                <td style="background:#f8fafc;padding:22px 40px;text-align:center;border-top:1px solid #e8edf3;">
                  ${footerExtra}
                  <p style="margin:0 0 3px;font-size:12px;color:#94a3b8;">© ${YEAR} GEMS Innovations · GEMS Hub</p>
                  <p style="margin:0;font-size:11px;color:#c4cdd8;">Este es un mensaje automático, por favor no respondas a este correo.</p>
                </td>
              </tr>

            </table>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Shared header block ──────────────────────────────────────────────────────
function brandHeader({ subtitle, icon, gradient = 'linear-gradient(140deg,#1e1b4b 0%,#4338ca 100%)', subtitleColor = '#c7d2fe' }) {
  return `<tr>
    <td class="email-header" style="background:${gradient};padding:36px 40px 30px;text-align:center;">
      <!-- Logo pill -->
      <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
        <tr>
          <td style="background:rgba(255,255,255,0.16);border-radius:10px;padding:7px 20px;">
            <span style="font-size:17px;font-weight:800;color:#ffffff;letter-spacing:-0.2px;">GEMS Hub</span>
          </td>
        </tr>
      </table>
      <!-- Icon -->
      <div style="margin:18px auto 10px;width:56px;height:56px;background:rgba(255,255,255,0.14);border-radius:16px;text-align:center;line-height:56px;font-size:28px;">${icon}</div>
      <!-- Subtitle -->
      <p style="margin:0;font-size:15px;font-weight:500;color:${subtitleColor};">${subtitle}</p>
    </td>
  </tr>`;
}

// ─── CTA button ───────────────────────────────────────────────────────────────
function ctaBtn(url, label, bg = '#4338ca') {
  return `<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td style="border-radius:11px;background:${bg};">
        <a href="${url}" style="display:inline-block;padding:14px 46px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:11px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

// ─── Meta info row ────────────────────────────────────────────────────────────
function metaRow(icon, label, valueHtml, isLast = false) {
  return `<tr>
    <td style="padding:13px 18px;${isLast ? '' : 'border-bottom:1px solid #f1f5f9;'}vertical-align:top;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="width:30px;font-size:17px;vertical-align:middle;padding-right:12px;">${icon}</td>
          <td style="vertical-align:middle;">
            <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">${label}</p>
            <p style="margin:3px 0 0;font-size:14px;font-weight:600;color:#0f172a;">${valueHtml}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. BIENVENIDA / VERIFICACIÓN DE CUENTA
// ═════════════════════════════════════════════════════════════════════════════
async function sendVerificationEmail(user, token) {
  const verifyUrl = `${getFrontendUrl()}/verify-email?token=${token}`;
  const name = escHtml(user.name);

  const headerHtml = brandHeader({
    subtitle: '¡Tu cuenta está casi lista!',
    icon: '🚀',
    gradient: 'linear-gradient(140deg,#1e1b4b 0%,#312e81 50%,#4338ca 100%)',
    subtitleColor: '#e0e7ff',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:40px 40px 36px;background:#ffffff;">

      <!-- Greeting -->
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:#0f172a;line-height:1.2;">¡Hola, ${name}! 👋</h1>
      <p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.7;">Gracias por unirte a <strong>GEMS Hub</strong>. Confirma tu correo para activar tu cuenta y comenzar tu prueba gratuita.</p>

      <!-- Trial badge -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:32px;">
        <tr>
          <td style="background:linear-gradient(135deg,#ede9fe,#e0e7ff);border-radius:14px;padding:18px 22px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="width:48px;vertical-align:middle;">
                  <div style="width:44px;height:44px;background:#4338ca;border-radius:11px;text-align:center;line-height:44px;font-size:22px;">⭐</div>
                </td>
                <td style="padding-left:16px;vertical-align:middle;">
                  <p style="margin:0 0 3px;font-size:15px;font-weight:800;color:#1e1b4b;">Free Trial · 14 días gratis</p>
                  <p style="margin:0;font-size:13px;color:#4338ca;font-weight:500;">Sin tarjeta de crédito &nbsp;·&nbsp; Cancela cuando quieras</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Feature highlights -->
      <p style="margin:0 0 14px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.8px;">Todo lo que encontrarás</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:36px;">
        <tr>
          <td class="feature-cell" style="width:33.33%;padding-right:6px;vertical-align:top;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border-radius:12px;">
              <tr><td style="padding:18px 14px;text-align:center;">
                <div style="font-size:26px;margin-bottom:10px;">📋</div>
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#0f172a;">Tareas</p>
                <p style="margin:0;font-size:11px;color:#64748b;line-height:1.4;">Kanban y seguimiento de proyectos</p>
              </td></tr>
            </table>
          </td>
          <td class="feature-cell" style="width:33.33%;padding:0 3px;vertical-align:top;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border-radius:12px;">
              <tr><td style="padding:18px 14px;text-align:center;">
                <div style="font-size:26px;margin-bottom:10px;">👥</div>
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#0f172a;">CRM</p>
                <p style="margin:0;font-size:11px;color:#64748b;line-height:1.4;">Clientes, equipo e historial</p>
              </td></tr>
            </table>
          </td>
          <td class="feature-cell" style="width:33.33%;padding-left:6px;vertical-align:top;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border-radius:12px;">
              <tr><td style="padding:18px 14px;text-align:center;">
                <div style="font-size:26px;margin-bottom:10px;">🎫</div>
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#0f172a;">Soporte</p>
                <p style="margin:0;font-size:11px;color:#64748b;line-height:1.4;">Tickets con SLA y reportes</p>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
        <tr>
          <td style="border-radius:12px;background:linear-gradient(135deg,#4338ca,#7c3aed);box-shadow:0 6px 20px rgba(67,56,202,0.35);">
            <a href="${verifyUrl}" style="display:inline-block;padding:16px 52px;font-size:16px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:12px;letter-spacing:0.2px;">Verificar mi cuenta →</a>
          </td>
        </tr>
      </table>

      <!-- Fallback link -->
      <div style="background:#f8fafc;border-radius:10px;padding:16px 20px;text-align:center;">
        <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">¿El botón no funciona? Copia este enlace en tu navegador:</p>
        <a href="${verifyUrl}" style="font-size:12px;color:#4338ca;word-break:break-all;">${verifyUrl}</a>
      </div>

    </td>
  </tr>`;

  return await sendMail({
    to: user.email,
    subject: '¡Activa tu cuenta en GEMS Hub! 🚀',
    html: emailBase({
      preheader: `${user.name}, activa tu cuenta y empieza tu free trial de 14 días en GEMS Hub.`,
      headerHtml,
      bodyHtml,
    }),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. TAREA / ACTIVIDAD ASIGNADA
// ═════════════════════════════════════════════════════════════════════════════
function taskAssignedHtml(task, assignee, creator) {
  const taskUrl = `${getFrontendUrl()}/tasks`;
  const isActivity = !!task.activityType;
  const typeLabel  = isActivity ? 'actividad' : 'tarea';
  const dueStr = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('es-CR', { year:'numeric', month:'long', day:'numeric' })
    : null;

  const headerHtml = brandHeader({
    subtitle: `Nueva ${typeLabel} asignada`,
    icon: isActivity ? '📌' : '✅',
    gradient: 'linear-gradient(140deg,#0f172a 0%,#1e3a5f 60%,#1e40af 100%)',
    subtitleColor: '#bfdbfe',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:36px 40px 36px;background:#ffffff;">

      <!-- Greeting -->
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Hola, ${escHtml(assignee.name)} 👋</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
        <strong style="color:#0f172a;">${escHtml(creator.name)}</strong> te ha asignado la siguiente ${typeLabel} en GEMS Hub.
      </p>

      <!-- Task card -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:22px;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <!-- Colored top bar -->
        <tr><td style="background:linear-gradient(90deg,#4338ca,#7c3aed);height:4px;padding:0;line-height:0;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:22px 22px 20px;background:#fafbff;">
            <!-- Title -->
            <p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#0f172a;line-height:1.3;">${escHtml(task.title)}</p>
            ${task.description
              ? `<p style="margin:0 0 16px;font-size:13px;color:#64748b;line-height:1.65;">${escHtml(task.description)}</p>`
              : ''}
            <!-- Badges -->
            <div style="margin-top:4px;">
              ${priorityBadge(task.priority)}${typeBadge(task.type || task.activityType)}
            </div>
          </td>
        </tr>
      </table>

      <!-- Meta info -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:32px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#fafbfc;">
        ${dueStr ? metaRow('📅', 'Fecha límite', dueStr) : ''}
        ${metaRow('👤', 'Asignado por', escHtml(creator.name), !dueStr)}
        ${dueStr ? metaRow('📁', 'Tipo', typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1), true) : ''}
      </table>

      <!-- CTA -->
      <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
        <tr>
          <td style="border-radius:11px;background:#4338ca;box-shadow:0 4px 14px rgba(67,56,202,0.30);">
            <a href="${taskUrl}" style="display:inline-block;padding:14px 46px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:11px;">Ver ${typeLabel} en GEMS Hub →</a>
          </td>
        </tr>
      </table>

    </td>
  </tr>`;

  return emailBase({
    preheader: `${creator.name} te asignó: "${task.title}" — revísala en GEMS Hub.`,
    headerHtml,
    bodyHtml,
  });
}

async function notifyTaskAssigned(task, creator) {
  const assignees = Array.isArray(task.assignedTo) ? task.assignedTo : [task.assignedTo];
  const creatorId = (creator?._id || creator?.id || '').toString();
  console.log('[Email] notifyTaskAssigned | assignees:', assignees.length, '| creatorId:', creatorId);

  for (const assignee of assignees) {
    const assigneeId = (assignee?._id || assignee?.id || '').toString();
    if (!assignee?.email) { console.warn('[Email] Skipping assignee (no email):', assigneeId); continue; }
    if (assigneeId === creatorId) { console.log('[Email] Skipping creator self-assignment:', assignee.email); continue; }

    await sendMail({
      to: assignee.email,
      subject: `Te asignaron: "${task.title}" — GEMS Hub`,
      html: taskAssignedHtml(task, assignee, creator),
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. MENCIÓN EN COMENTARIO
// ═════════════════════════════════════════════════════════════════════════════

// Resuelve @menciones a objetos de usuario con name + email
async function resolveMentionedUsers(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/@([\p{L}\p{N}_]+)/gu) || [];
  if (!matches.length) return [];
  const handles = matches.map(m => normalize(m.slice(1)));
  const users = await User.find({}).select('name email').lean();
  const found = [];
  const seen = new Set();
  for (const u of users) {
    const handle = normalize(u.name);
    if (handles.includes(handle) || handles.some(h => h.length >= 3 && handle.startsWith(h))) {
      if (!seen.has(String(u._id))) { seen.add(String(u._id)); found.push(u); }
    }
  }
  return found;
}

function mentionEmailHtml(mentionedUser, sender, resourceTitle, commentText, resourceType, resourceUrl) {
  const typeLabel = resourceType === 'activity' ? 'actividad' : 'tarea';

  // Resaltar @menciones en el texto del comentario
  const highlightedText = escHtml(commentText)
    .replace(/@([\wÀ-ž_]+)/g,
      '<span style="background:#ede9fe;color:#7c3aed;padding:1px 5px;border-radius:5px;font-weight:700;">@$1</span>');

  const senderInitial = escHtml((sender.name || '?').trim()[0]).toUpperCase();

  const headerHtml = brandHeader({
    subtitle: 'Te mencionaron en un comentario',
    icon: '💬',
    gradient: 'linear-gradient(140deg,#2d1b69 0%,#5b21b6 60%,#7c3aed 100%)',
    subtitleColor: '#ede9fe',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:36px 40px 36px;background:#ffffff;">

      <!-- Greeting -->
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Hola, ${escHtml(mentionedUser.name)} 👋</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
        <strong style="color:#0f172a;">${escHtml(sender.name)}</strong> te mencionó en la ${typeLabel}
        <strong style="color:#0f172a;">"${escHtml(resourceTitle)}"</strong>.
      </p>

      <!-- Comment bubble -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:22px;border:1px solid #ede9fe;border-radius:14px;overflow:hidden;">
        <!-- Author bar -->
        <tr>
          <td style="background:#faf5ff;padding:14px 18px;border-bottom:1px solid #ede9fe;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="width:36px;height:36px;background:#7c3aed;border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:15px;font-weight:800;color:#ffffff;line-height:36px;display:block;">${senderInitial}</span>
                </td>
                <td style="padding-left:12px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:700;color:#1e1b4b;">${escHtml(sender.name)}</p>
                  <p style="margin:0;font-size:11px;color:#a78bfa;">Ahora mismo</p>
                </td>
                <td style="text-align:right;vertical-align:middle;">
                  <span style="display:inline-block;background:#ede9fe;color:#7c3aed;border-radius:20px;padding:2px 12px;font-size:11px;font-weight:700;">@${escHtml(mentionedUser.name.split(' ')[0])}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Comment text -->
        <tr>
          <td style="padding:18px 20px 20px;background:#fdf9ff;">
            <p style="margin:0;font-size:14px;color:#1e1b4b;line-height:1.75;">${highlightedText}</p>
          </td>
        </tr>
      </table>

      <!-- Context card -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:32px;border-left:4px solid #7c3aed;background:#faf5ff;border-radius:0 10px 10px 0;overflow:hidden;">
        <tr>
          <td style="padding:14px 18px;">
            <p style="margin:0;font-size:11px;color:#a78bfa;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">En la ${typeLabel}</p>
            <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#0f172a;">${escHtml(resourceTitle)}</p>
          </td>
        </tr>
      </table>

      <!-- CTA -->
      <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
        <tr>
          <td style="border-radius:11px;background:#7c3aed;box-shadow:0 4px 14px rgba(124,58,237,0.30);">
            <a href="${resourceUrl}" style="display:inline-block;padding:14px 46px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:11px;">Ver comentario en GEMS Hub →</a>
          </td>
        </tr>
      </table>

    </td>
  </tr>`;

  return emailBase({
    preheader: `${sender.name} te mencionó en "${resourceTitle}" — revisa el comentario.`,
    headerHtml,
    bodyHtml,
  });
}

async function notifyMentionEmail({ text, sender, resourceTitle, resourceType, resourceId }) {
  try {
    const mentionedUsers = await resolveMentionedUsers(text);
    if (!mentionedUsers.length) return;

    const senderId = String(sender?._id || sender?.id || '');
    const resourceUrl = `${getFrontendUrl()}/${resourceType === 'activity' ? 'activities' : 'tasks'}`;

    for (const user of mentionedUsers) {
      if (!user.email) continue;
      if (String(user._id) === senderId) continue; // no notificar auto-mención

      await sendMail({
        to: user.email,
        subject: `${sender.name} te mencionó en "${resourceTitle}" — GEMS Hub`,
        html: mentionEmailHtml(user, sender, resourceTitle, text, resourceType, resourceUrl),
      });
    }
  } catch (err) {
    console.warn('[Email] notifyMentionEmail error:', err.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. SOPORTE — TICKET CREADO (CLIENTE)
// ═════════════════════════════════════════════════════════════════════════════
function ticketCreatedClientHtml(ticket) {
  const clientName = escHtml(ticket.submittedBy?.name || 'Cliente');
  const ticketId   = escHtml(String(ticket.ticketNumber || ticket._id));

  const headerHtml = brandHeader({
    subtitle: 'Ticket de soporte creado',
    icon: '🎫',
    gradient: 'linear-gradient(140deg,#0f172a 0%,#1e3a5f 60%,#0369a1 100%)',
    subtitleColor: '#bae6fd',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:36px 40px 36px;background:#ffffff;">

      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Hola, ${clientName} 👋</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
        Tu solicitud ha sido registrada exitosamente. Nuestro equipo la revisará a la brevedad.
      </p>

      <!-- Ticket details table -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:28px;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="background:#f0f9ff;padding:14px 20px;border-bottom:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#0369a1;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">Detalles del ticket</p>
          </td>
        </tr>
        <tr>
          <td>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:13px 20px;border-bottom:1px solid #f1f5f9;width:38%;font-size:13px;font-weight:600;color:#64748b;">Número</td>
                <td style="padding:13px 20px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:800;color:#0f172a;">#${ticketId}</td>
              </tr>
              <tr>
                <td style="padding:13px 20px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;color:#64748b;">Asunto</td>
                <td style="padding:13px 20px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;">${escHtml(ticket.subject)}</td>
              </tr>
              <tr>
                <td style="padding:13px 20px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:600;color:#64748b;">Prioridad</td>
                <td style="padding:13px 20px;border-bottom:1px solid #f1f5f9;">${priorityBadge(ticket.priority)}</td>
              </tr>
              <tr>
                <td style="padding:13px 20px;font-size:13px;font-weight:600;color:#64748b;">Estado</td>
                <td style="padding:13px 20px;font-size:13px;font-weight:700;color:#0f172a;text-transform:capitalize;">${escHtml(ticket.status || 'open')}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Info note -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:4px;">
        <tr>
          <td style="background:#f0fdf4;border-radius:10px;padding:14px 18px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="font-size:18px;padding-right:12px;vertical-align:middle;">✅</td>
                <td style="font-size:13px;color:#166534;line-height:1.6;">Recibirás actualizaciones por correo cuando el estado de tu ticket cambie.</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

    </td>
  </tr>`;

  return emailBase({
    preheader: `Ticket #${ticketId} recibido: ${ticket.subject} — te avisaremos cuando haya novedades.`,
    headerHtml,
    bodyHtml,
  });
}

// ─── Ticket creado — notificación interna ─────────────────────────────────────
function ticketCreatedInternalHtml(ticket, assignedAgent) {
  const ticketId = escHtml(String(ticket.ticketNumber || ticket._id));

  const headerHtml = brandHeader({
    subtitle: 'Nuevo ticket recibido',
    icon: '🔔',
    gradient: 'linear-gradient(140deg,#14532d 0%,#166534 60%,#16a34a 100%)',
    subtitleColor: '#bbf7d0',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:36px 40px 36px;background:#ffffff;">

      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Nuevo ticket de soporte</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;">Acaba de llegar un nuevo ticket y requiere atención.</p>

      <!-- Cliente info -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:18px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:#f0fdf4;padding:12px 18px;border-bottom:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;color:#16a34a;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">Cliente</p>
          </td>
        </tr>
        <tr><td>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${metaRow('👤', 'Nombre', escHtml(ticket.submittedBy?.name || '—'))}
            ${metaRow('✉️', 'Email', escHtml(ticket.submittedBy?.email || '—'), true)}
          </table>
        </td></tr>
      </table>

      <!-- Ticket details -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:28px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:#f8fafc;padding:12px 18px;border-bottom:1px solid #e2e8f0;">
            <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">Ticket #${ticketId}</p>
          </td>
        </tr>
        <tr><td>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${metaRow('📋', 'Asunto', escHtml(ticket.subject))}
            ${metaRow('🔥', 'Prioridad', priorityBadge(ticket.priority))}
            ${metaRow('📝', 'Descripción', `<span style="font-weight:400;color:#475569;">${escHtml(ticket.description || '—')}</span>`, !assignedAgent)}
            ${assignedAgent ? metaRow('👤', 'Asignado a', `<strong>${escHtml(assignedAgent.name)}</strong>`, true) : ''}
          </table>
        </td></tr>
      </table>

      ${ctaBtn(`${getFrontendUrl()}/tickets`, 'Ver ticket en GEMS Hub', '#16a34a')}

    </td>
  </tr>`;

  return emailBase({
    preheader: `Nuevo ticket de ${ticket.submittedBy?.name}: "${ticket.subject}"`,
    headerHtml,
    bodyHtml,
  });
}

// ─── Cambio de estado ─────────────────────────────────────────────────────────
function ticketStatusChangedHtml(ticket, oldStatus, newStatus) {
  const statusColors = { open:'#3b82f6', 'in-progress':'#f59e0b', resolved:'#10b981', closed:'#6b7280' };
  const newColor = statusColors[newStatus] || '#4338ca';
  const ticketId = escHtml(String(ticket.ticketNumber || ticket._id));

  const headerHtml = brandHeader({
    subtitle: 'Estado de tu ticket actualizado',
    icon: '🔄',
    gradient: `linear-gradient(140deg,#0f172a 0%,#1e3a5f 60%,${newColor} 100%)`,
    subtitleColor: '#bfdbfe',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:36px 40px 36px;background:#ffffff;">

      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">
        Hola, ${escHtml(ticket.submittedBy?.name || 'Cliente')} 👋
      </h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
        El estado de tu ticket <strong style="color:#0f172a;">#${ticketId}</strong> ha sido actualizado.
      </p>

      <!-- Status change visual -->
      <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
        <tr>
          <td style="background:#f8fafc;border-radius:10px;padding:12px 20px;font-size:14px;font-weight:600;color:#64748b;text-align:center;">
            ${escHtml(oldStatus)}
          </td>
          <td style="padding:0 16px;font-size:20px;color:#94a3b8;">→</td>
          <td style="background:${newColor}1a;border:1px solid ${newColor}40;border-radius:10px;padding:12px 20px;font-size:14px;font-weight:700;color:${newColor};text-align:center;">
            ${escHtml(newStatus)}
          </td>
        </tr>
      </table>

      <!-- Ticket summary -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:32px;background:#f8fafc;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${metaRow('🎫', 'Ticket', `#${ticketId}`)}
            ${metaRow('📋', 'Asunto', escHtml(ticket.subject), true)}
          </table>
        </td></tr>
      </table>

      ${ctaBtn(`${getFrontendUrl()}/tickets`, 'Ver mi ticket →')}

    </td>
  </tr>`;

  return emailBase({
    preheader: `Tu ticket #${ticketId} cambió de "${oldStatus}" a "${newStatus}".`,
    headerHtml,
    bodyHtml,
  });
}

// ─── Nuevo comentario en ticket (respuesta de soporte) ────────────────────────
function ticketCommentHtml({ ticket, commentText, authorName, isAgentReply }) {
  const ticketId   = escHtml(String(ticket.ticketNumber || ticket._id));
  const recipName  = isAgentReply
    ? escHtml(ticket.submittedBy?.name || 'Cliente')
    : escHtml(ticket.assignedTo?.name || 'Agente');

  const gradient = isAgentReply
    ? 'linear-gradient(140deg,#0f172a 0%,#1e3a5f 60%,#0369a1 100%)'
    : 'linear-gradient(140deg,#1e1b4b 0%,#312e81 60%,#4338ca 100%)';

  const accentColor = isAgentReply ? '#0369a1' : '#4338ca';
  const subtitleText = isAgentReply
    ? 'El equipo de soporte respondió tu ticket'
    : 'El cliente respondió al ticket';

  const authorInitial = escHtml((authorName || '?').trim()[0]).toUpperCase();

  const headerHtml = brandHeader({
    subtitle: subtitleText,
    icon: isAgentReply ? '💬' : '📩',
    gradient,
    subtitleColor: '#bfdbfe',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:36px 40px 36px;background:#ffffff;">

      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Hola, ${recipName} 👋</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
        Hay una nueva respuesta en el ticket <strong style="color:#0f172a;">#${ticketId}: ${escHtml(ticket.subject)}</strong>.
      </p>

      <!-- Comment bubble -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:22px;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="background:#f8fafc;padding:14px 18px;border-bottom:1px solid #e2e8f0;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="width:36px;height:36px;background:${accentColor};border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:15px;font-weight:800;color:#fff;line-height:36px;display:block;">${authorInitial}</span>
                </td>
                <td style="padding-left:12px;vertical-align:middle;">
                  <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;">${escHtml(authorName)}</p>
                  <p style="margin:0;font-size:11px;color:#94a3b8;">${isAgentReply ? 'Equipo de soporte' : 'Cliente'}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 20px 20px;background:#ffffff;">
            <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.75;font-style:italic;">"${escHtml(commentText)}"</p>
          </td>
        </tr>
      </table>

      <!-- Ticket ref -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:32px;border-left:4px solid ${accentColor};background:#f8fafc;border-radius:0 10px 10px 0;">
        <tr>
          <td style="padding:14px 18px;">
            <p style="margin:0;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">Ticket</p>
            <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#0f172a;">#${ticketId}: ${escHtml(ticket.subject)}</p>
          </td>
        </tr>
      </table>

      ${ctaBtn(`${getFrontendUrl()}/tickets`, 'Ver conversación completa →', accentColor)}

    </td>
  </tr>`;

  return emailBase({
    preheader: `${authorName} respondió al ticket #${ticketId}: "${ticket.subject}"`,
    headerHtml,
    bodyHtml,
  });
}

// ─── SLA alert ────────────────────────────────────────────────────────────────
function slAlertHtml(ticket) {
  const ticketId = escHtml(String(ticket.ticketNumber));

  const headerHtml = brandHeader({
    subtitle: 'Ticket sin atender — requiere acción inmediata',
    icon: '🚨',
    gradient: 'linear-gradient(140deg,#7f1d1d 0%,#b91c1c 100%)',
    subtitleColor: '#fecaca',
  });

  const bodyHtml = `<tr>
    <td class="email-body" style="padding:36px 40px 36px;background:#ffffff;">

      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Alerta de SLA</h1>
      <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
        El siguiente ticket lleva <strong style="color:#dc2626;">más de 2 horas</strong> sin ser atendido.
      </p>

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="margin-bottom:32px;border:2px solid #fecaca;border-radius:14px;overflow:hidden;background:#fff5f5;">
        <tr>
          <td style="background:#fee2e2;padding:12px 18px;border-bottom:1px solid #fecaca;">
            <p style="margin:0;font-size:11px;color:#dc2626;text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">⚠️ Ticket en riesgo #${ticketId}</p>
          </td>
        </tr>
        <tr><td>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${metaRow('📋', 'Asunto', escHtml(ticket.subject))}
            ${metaRow('👤', 'Cliente', escHtml(ticket.submittedBy?.name || '—'))}
            ${metaRow('🔥', 'Prioridad', priorityBadge(ticket.priority))}
            ${metaRow('📊', 'Estado', escHtml(ticket.status), true)}
          </table>
        </td></tr>
      </table>

      ${ctaBtn(`${getFrontendUrl()}/tickets`, 'Atender ticket ahora →', '#dc2626')}

    </td>
  </tr>`;

  return emailBase({
    preheader: `⚠️ ALERTA: Ticket #${ticketId} lleva más de 2 horas sin atender.`,
    headerHtml,
    bodyHtml,
  });
}

// ─── Exported notification helpers ───────────────────────────────────────────

async function notifyTicketCreated(ticket, assignedAgent) {
  console.log('[Email] notifyTicketCreated:', ticket.ticketNumber || ticket._id);
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
      subject: `Nuevo ticket de ${ticket.submittedBy?.name}: ${ticket.subject}`,
      html: ticketCreatedInternalHtml(ticket, assignedAgent),
    });
  }
}

async function notifyStatusChanged(ticket, oldStatus, newStatus) {
  if (ticket.submittedBy?.email) {
    await sendMail({
      to: ticket.submittedBy.email,
      subject: `[Ticket #${ticket.ticketNumber || ticket._id}] Estado actualizado: ${newStatus}`,
      html: ticketStatusChangedHtml(ticket, oldStatus, newStatus),
    });
  }
}

async function notifyNewComment(ticket, comment, author) {
  const isAgentReply = ['admin', 'supervisor', 'support'].includes(author.role);

  if (isAgentReply && !comment.isInternal && ticket.submittedBy?.email) {
    await sendMail({
      to: ticket.submittedBy.email,
      subject: `Nueva respuesta en tu Ticket #${ticket.ticketNumber || ticket._id}`,
      html: ticketCommentHtml({
        ticket,
        commentText: comment.text,
        authorName: author.name,
        isAgentReply: true,
      }),
    });
  }

  if (!isAgentReply && ticket.assignedTo?.email) {
    await sendMail({
      to: ticket.assignedTo.email,
      subject: `El cliente respondió al Ticket #${ticket.ticketNumber || ticket._id}`,
      html: ticketCommentHtml({
        ticket,
        commentText: comment.text,
        authorName: ticket.submittedBy?.name || 'Cliente',
        isAgentReply: false,
      }),
    });
  }
}

async function notifySLAAlert(ticket) {
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_USER;
  if (!supportEmail) return;
  await sendMail({
    to: supportEmail,
    subject: `⚠️ ALERTA SLA: Ticket #${ticket.ticketNumber} sin atender`,
    html: slAlertHtml(ticket),
  });
}

module.exports = {
  sendMail,
  notifyTicketCreated,
  notifyStatusChanged,
  notifyNewComment,
  notifySLAAlert,
  sendVerificationEmail,
  notifyTaskAssigned,
  notifyMentionEmail,
};
