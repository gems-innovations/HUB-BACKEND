const { Resend } = require('resend');
const User = require('../models/User');

// ─── Core helper ──────────────────────────────────────────────────────────────
async function sendMail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
  if (!apiKey) { console.warn('[Email] Skipping: RESEND_API_KEY no configurada'); return null; }
  console.log('[Email] sendMail to:', to);
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM || 'GEMS Hub <info@gemsinnovations.com>';
  try {
    const { data, error } = await resend.emails.send({ from, to, subject, html, text });
    if (error) { console.error('[Email] Error:', to, error.message); return null; }
    console.log('[Email] Sent:', to, '| id:', data.id);
    return data;
  } catch (err) {
    console.error('[Email] Error:', to, err.message);
    return null;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function normalize(s) {
  return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,'').toLowerCase();
}
const getFrontendUrl = () => process.env.FRONTEND_URL || 'https://hub.gemsinnovations.com';
const YEAR = new Date().getFullYear();

// ─── Dark design tokens ───────────────────────────────────────────────────────
// Outer bg, card, elements, borders, accent, text hierarchy
const D = {
  outer:   '#07080f',
  card:    '#0d0f1a',
  el:      '#131520',
  el2:     '#191c2b',
  border:  '#1e2236',
  border2: '#252840',
  accent:  '#7c3aed',
  acBg:    'rgba(124,58,237,.14)',
  acBorder:'rgba(124,58,237,.28)',
  indigo:  '#4f46e5',
  t0:      '#eef0ff',  // primary text
  t1:      '#8890a8',  // secondary
  t2:      '#444c68',  // tertiary
  success: '#22c55e',
  warn:    '#f59e0b',
  err:     '#ef4444',
};

// Priority config (dark-optimized colors)
const PRI = {
  critical:{ stripe:'#ef4444', bg:'rgba(239,68,68,.12)',  text:'#f87171', border:'rgba(239,68,68,.25)',  label:'Crítica' },
  high:    { stripe:'#f97316', bg:'rgba(249,115,22,.12)', text:'#fb923c', border:'rgba(249,115,22,.25)', label:'Alta'    },
  medium:  { stripe:'#eab308', bg:'rgba(234,179,8,.12)',  text:'#fbbf24', border:'rgba(234,179,8,.25)',  label:'Media'   },
  low:     { stripe:'#22c55e', bg:'rgba(34,197,94,.12)',  text:'#4ade80', border:'rgba(34,197,94,.25)',  label:'Baja'    },
};
function pri(p) { return PRI[p] || { stripe:'#7c3aed', bg:D.acBg, text:'#a78bfa', border:D.acBorder, label: p||'Media' }; }

// Badge pills
function badge(label, bg, text, border) {
  return `<span style="display:inline-block;background:${bg};color:${text};border:1px solid ${border};border-radius:20px;padding:2px 11px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">${esc(label)}</span>`;
}
function priBadge(p)   { const c=pri(p); return badge(c.label, c.bg, c.text, c.border); }
function typBadge(t)   { if(!t) return ''; return `&nbsp;${badge(t, D.acBg, '#a78bfa', D.acBorder)}`; }

// Avatar initial circle
function avatar(name, size=40, bg=`linear-gradient(135deg,${D.indigo},${D.accent})`) {
  const initials = (name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
  return `<table cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="width:${size}px;height:${size}px;background:${bg};border-radius:50%;text-align:center;vertical-align:middle;font-size:${Math.round(size*.38)}px;font-weight:800;color:#fff;font-family:Arial,sans-serif;">
      <span style="display:block;line-height:${size}px;">${initials}</span>
    </td>
  </tr></table>`;
}

// ─── Base dark layout ─────────────────────────────────────────────────────────
function emailBase({ preheader, headerRow, bodyRows, footerExtra='' }) {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>GEMS Hub</title>
  <style>
    @media only screen and (max-width:600px){
      .main-card{border-radius:0!important;border-left:none!important;border-right:none!important;}
      .pad{padding-left:20px!important;padding-right:20px!important;}
      .feat-cell{display:block!important;width:100%!important;padding:4px 0!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${D.outer};font-family:'Segoe UI',system-ui,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:${D.outer};opacity:0;">${preheader}&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${D.outer}">
    <tr>
      <td align="center" style="padding:44px 16px 56px;">
        <table role="presentation" class="main-card" cellspacing="0" cellpadding="0" border="0"
          style="max-width:580px;width:100%;background:${D.card};border-radius:14px;border:1px solid ${D.border};overflow:hidden;">
          <tr><td>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">

              <!-- ── APP BAR ─────────────────────────────────────────────── -->
              <tr>
                <td class="pad" style="padding:16px 28px;border-bottom:1px solid ${D.border};">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <!-- Logo mark -->
                      <td style="vertical-align:middle;">
                        <table cellspacing="0" cellpadding="0" border="0">
                          <tr>
                            <td style="width:8px;height:8px;background:${D.accent};border-radius:3px;vertical-align:middle;"></td>
                            <td style="padding-left:8px;font-size:13px;font-weight:800;color:${D.t0};letter-spacing:-.1px;vertical-align:middle;">GEMS Hub</td>
                          </tr>
                        </table>
                      </td>
                      <!-- Right slot (header badge or empty) -->
                      <td align="right" style="vertical-align:middle;">${headerRow}</td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- ── BODY ROWS ──────────────────────────────────────────── -->
              ${bodyRows}

              <!-- ── FOOTER ─────────────────────────────────────────────── -->
              <tr>
                <td style="padding:14px 28px;border-top:1px solid ${D.border};text-align:center;">
                  ${footerExtra}
                  <p style="margin:0;font-size:11px;color:${D.t2};">© ${YEAR} GEMS Innovations &nbsp;·&nbsp; Mensaje automático</p>
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

// Shared CTA button row
function ctaRow(url, label, bg=D.accent) {
  return `<tr>
    <td class="pad" style="padding:0 28px 28px;" align="center">
      <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="background:${bg};border-radius:9px;box-shadow:0 0 20px rgba(124,58,237,.3);">
            <a href="${url}" style="display:inline-block;padding:13px 44px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:9px;letter-spacing:.1px;">
              ${label}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// Divider row
function divRow() {
  return `<tr><td style="background:${D.border};height:1px;padding:0;line-height:0;font-size:0;">&nbsp;</td></tr>`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. TAREA / ACTIVIDAD ASIGNADA
// ═════════════════════════════════════════════════════════════════════════════
function taskAssignedHtml(task, assignee, creator) {
  const taskUrl    = `${getFrontendUrl()}/tasks`;
  const isActivity = !!task.activityType;
  const typeLabel  = isActivity ? 'actividad' : 'tarea';
  const priorityC  = pri(task.priority);
  const dueStr     = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('es-CR',{year:'numeric',month:'long',day:'numeric'})
    : null;

  const notifBadge = `<span style="background:${D.acBg};border:1px solid ${D.acBorder};color:#a78bfa;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.3px;">
    Nueva ${typeLabel}
  </span>`;

  const bodyRows = `

    <!-- ── SENDER ROW ───────────────────────────────── -->
    <tr>
      <td class="pad" style="padding:24px 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="width:44px;vertical-align:top;">${avatar(creator.name)}</td>
            <td style="padding-left:12px;vertical-align:middle;">
              <p style="margin:0;font-size:14px;color:${D.t0};line-height:1.4;">
                <strong style="color:${D.t0};">${esc(creator.name)}</strong>
                <span style="color:${D.t1};"> te asignó una ${typeLabel}</span>
              </p>
              <p style="margin:3px 0 0;font-size:11px;color:${D.t2};">Ahora mismo</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── KANBAN CARD ──────────────────────────────── -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border2};border-radius:10px;overflow:hidden;">
          <tr>
            <!-- Priority stripe -->
            <td style="width:3px;background:${priorityC.stripe};padding:0;"></td>
            <td style="padding:18px 18px 16px;">
              <!-- Title -->
              <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:${D.t0};line-height:1.35;">${esc(task.title)}</p>
              <!-- Description -->
              ${task.description
                ? `<p style="margin:0 0 14px;font-size:13px;color:${D.t1};line-height:1.65;">${esc(task.description)}</p>`
                : `<div style="height:10px;"></div>`}
              <!-- Badges -->
              <table cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>${priBadge(task.priority)}</td>
                  ${(task.type||task.activityType) ? `<td style="padding-left:6px;">${typBadge(task.type||task.activityType)}</td>` : ''}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── META ROWS ─────────────────────────────────── -->
    ${dueStr ? `<tr>
      <td class="pad" style="padding:0 28px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border};border-radius:8px;padding:12px 16px;">
          <tr>
            <td style="font-size:15px;padding-right:10px;color:${D.t1};vertical-align:middle;">📅</td>
            <td style="vertical-align:middle;">
              <p style="margin:0;font-size:11px;color:${D.t2};text-transform:uppercase;letter-spacing:.6px;font-weight:700;">Fecha límite</p>
              <p style="margin:2px 0 0;font-size:13px;font-weight:600;color:${D.t0};">${dueStr}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>` : ''}

    <!-- ── DIVIDER + CTA ─────────────────────────────── -->
    ${divRow()}
    ${ctaRow(taskUrl, `Abrir ${typeLabel} en GEMS Hub &nbsp;→`)}
  `;

  return emailBase({
    preheader: `${creator.name} te asignó: "${task.title}"`,
    headerRow: notifBadge,
    bodyRows,
  });
}

async function notifyTaskAssigned(task, creator) {
  const assignees = Array.isArray(task.assignedTo) ? task.assignedTo : [task.assignedTo];
  const creatorId = (creator?._id || creator?.id || '').toString();
  console.log('[Email] notifyTaskAssigned | assignees:', assignees.length);
  for (const assignee of assignees) {
    const assigneeId = (assignee?._id || assignee?.id || '').toString();
    if (!assignee?.email) { console.warn('[Email] No email:', assigneeId); continue; }
    if (assigneeId === creatorId) continue;
    await sendMail({
      to: assignee.email,
      subject: `${creator.name} te asignó: "${task.title}" — GEMS Hub`,
      html: taskAssignedHtml(task, assignee, creator),
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. MENCIÓN EN COMENTARIO
// ═════════════════════════════════════════════════════════════════════════════
async function resolveMentionedUsers(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/@([\p{L}\p{N}_]+)/gu) || [];
  if (!matches.length) return [];
  const handles = matches.map(m => normalize(m.slice(1)));
  const users = await User.find({}).select('name email').lean();
  const found = []; const seen = new Set();
  for (const u of users) {
    const h = normalize(u.name);
    if (handles.includes(h) || handles.some(x => x.length >= 3 && h.startsWith(x))) {
      if (!seen.has(String(u._id))) { seen.add(String(u._id)); found.push(u); }
    }
  }
  return found;
}

function mentionEmailHtml(mentionedUser, sender, resourceTitle, commentText, resourceType, resourceUrl) {
  const typeLabel = resourceType === 'activity' ? 'actividad' : 'tarea';

  const highlightedText = esc(commentText)
    .replace(/@([\wÀ-ž_]+)/g,
      `<span style="background:${D.acBg};color:#c4b5fd;padding:1px 5px;border-radius:4px;font-weight:700;">@$1</span>`);

  const senderInitial = esc((sender.name||'?').trim()[0]).toUpperCase();

  const notifBadge = `<span style="background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.25);color:#c4b5fd;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.3px;">
    Mención
  </span>`;

  const bodyRows = `

    <!-- ── SENDER ───────────────────────────── -->
    <tr>
      <td class="pad" style="padding:24px 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="width:44px;vertical-align:top;">${avatar(sender.name)}</td>
            <td style="padding-left:12px;vertical-align:middle;">
              <p style="margin:0;font-size:14px;color:${D.t0};line-height:1.4;">
                <strong style="color:${D.t0};">${esc(sender.name)}</strong>
                <span style="color:${D.t1};"> te mencionó en</span>
                <strong style="color:${D.t0};"> "${esc(resourceTitle)}"</strong>
              </p>
              <p style="margin:3px 0 0;font-size:11px;color:${D.t2};">Ahora mismo &nbsp;·&nbsp; ${typeLabel}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── COMMENT BUBBLE ────────────────────── -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border2};border-radius:10px;overflow:hidden;">
          <!-- Author bar -->
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid ${D.border};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:28px;height:28px;background:${D.accent};border-radius:50%;text-align:center;vertical-align:middle;font-size:12px;font-weight:800;color:#fff;">
                    <span style="display:block;line-height:28px;">${senderInitial}</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="font-size:13px;font-weight:600;color:${D.t0};">${esc(sender.name)}</span>
                    <span style="font-size:11px;color:${D.t2};margin-left:8px;">comentó</span>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="background:${D.acBg};color:#c4b5fd;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;border:1px solid ${D.acBorder};">@${esc(mentionedUser.name.split(' ')[0])}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Comment text -->
          <tr>
            <td style="padding:16px 18px;">
              <p style="margin:0;font-size:14px;color:${D.t0};line-height:1.75;">${highlightedText}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── CONTEXT PILL ────────────────────── -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"
          style="border-left:3px solid ${D.accent};background:${D.el};border-radius:0 8px 8px 0;padding:12px 16px;">
          <tr>
            <td>
              <p style="margin:0;font-size:11px;color:${D.t2};text-transform:uppercase;letter-spacing:.6px;font-weight:700;">En la ${typeLabel}</p>
              <p style="margin:3px 0 0;font-size:13px;font-weight:700;color:${D.t0};">${esc(resourceTitle)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${divRow()}
    ${ctaRow(resourceUrl, 'Ver comentario en GEMS Hub &nbsp;→')}
  `;

  return emailBase({
    preheader: `${sender.name} te mencionó en "${resourceTitle}"`,
    headerRow: notifBadge,
    bodyRows,
  });
}

async function notifyMentionEmail({ text, sender, resourceTitle, resourceType, resourceId }) {
  try {
    const mentionedUsers = await resolveMentionedUsers(text);
    if (!mentionedUsers.length) return;
    const senderId    = String(sender?._id || sender?.id || '');
    const resourceUrl = `${getFrontendUrl()}/${resourceType === 'activity' ? 'activities' : 'tasks'}`;
    for (const user of mentionedUsers) {
      if (!user.email || String(user._id) === senderId) continue;
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
// 3. BIENVENIDA / VERIFICACIÓN
// ═════════════════════════════════════════════════════════════════════════════
async function sendVerificationEmail(user, token) {
  const verifyUrl = `${getFrontendUrl()}/verify-email?token=${token}`;

  const bodyRows = `

    <!-- ── HERO ─────────────────────────────── -->
    <tr>
      <td style="padding:40px 28px 28px;text-align:center;">
        <!-- Glow ring -->
        <div style="display:inline-block;background:${D.acBg};border:1px solid ${D.acBorder};border-radius:20px;padding:14px 20px;margin-bottom:24px;font-size:30px;line-height:1;">🚀</div>
        <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;color:${D.t0};line-height:1.2;">¡Hola, ${esc(user.name)}!</h1>
        <p style="margin:0;font-size:15px;color:${D.t1};line-height:1.7;max-width:420px;margin:0 auto;">
          Tu cuenta está lista. Confirma tu correo para activar tu prueba gratuita y empezar a gestionar tu equipo desde GEMS Hub.
        </p>
      </td>
    </tr>

    <!-- ── TRIAL BADGE ─────────────────────── -->
    <tr>
      <td class="pad" style="padding:0 28px 28px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border2};border-radius:10px;">
          <tr>
            <td style="padding:16px 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:40px;vertical-align:middle;">
                    <div style="width:36px;height:36px;background:linear-gradient(135deg,${D.indigo},${D.accent});border-radius:9px;text-align:center;line-height:36px;font-size:18px;">⭐</div>
                  </td>
                  <td style="padding-left:14px;vertical-align:middle;">
                    <p style="margin:0 0 2px;font-size:14px;font-weight:800;color:${D.t0};">Free Trial · 14 días</p>
                    <p style="margin:0;font-size:12px;color:${D.t1};">Sin tarjeta de crédito &nbsp;·&nbsp; Cancela cuando quieras</p>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.25);border-radius:20px;padding:3px 12px;font-size:11px;font-weight:700;">Activo</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── FEATURE GRID ─────────────────────── -->
    <tr>
      <td class="pad" style="padding:0 28px 32px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td class="feat-cell" style="width:33.33%;padding-right:5px;vertical-align:top;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                style="background:${D.el};border:1px solid ${D.border};border-radius:9px;">
                <tr><td style="padding:16px;text-align:center;">
                  <div style="font-size:22px;margin-bottom:8px;">📋</div>
                  <p style="margin:0 0 3px;font-size:12px;font-weight:700;color:${D.t0};">Tareas</p>
                  <p style="margin:0;font-size:11px;color:${D.t2};line-height:1.4;">Kanban y seguimiento</p>
                </td></tr>
              </table>
            </td>
            <td class="feat-cell" style="width:33.33%;padding:0 2.5px;vertical-align:top;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                style="background:${D.el};border:1px solid ${D.border};border-radius:9px;">
                <tr><td style="padding:16px;text-align:center;">
                  <div style="font-size:22px;margin-bottom:8px;">👥</div>
                  <p style="margin:0 0 3px;font-size:12px;font-weight:700;color:${D.t0};">CRM</p>
                  <p style="margin:0;font-size:11px;color:${D.t2};line-height:1.4;">Clientes y equipo</p>
                </td></tr>
              </table>
            </td>
            <td class="feat-cell" style="width:33.33%;padding-left:5px;vertical-align:top;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                style="background:${D.el};border:1px solid ${D.border};border-radius:9px;">
                <tr><td style="padding:16px;text-align:center;">
                  <div style="font-size:22px;margin-bottom:8px;">🎫</div>
                  <p style="margin:0 0 3px;font-size:12px;font-weight:700;color:${D.t0};">Soporte</p>
                  <p style="margin:0;font-size:11px;color:${D.t2};line-height:1.4;">Tickets y SLA</p>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${divRow()}

    <!-- ── CTA ─────────────────────────────── -->
    <tr>
      <td class="pad" style="padding:28px 28px 8px;" align="center">
        <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="background:linear-gradient(135deg,${D.indigo},${D.accent});border-radius:9px;box-shadow:0 0 24px rgba(124,58,237,.35);">
              <a href="${verifyUrl}" style="display:inline-block;padding:14px 52px;font-size:15px;font-weight:800;color:#fff;text-decoration:none;border-radius:9px;letter-spacing:.1px;">
                Verificar mi cuenta →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Fallback link -->
    <tr>
      <td style="padding:16px 28px 28px;text-align:center;">
        <p style="margin:0 0 4px;font-size:11px;color:${D.t2};">¿El botón no funciona? Copia este enlace:</p>
        <a href="${verifyUrl}" style="font-size:11px;color:#a78bfa;word-break:break-all;">${verifyUrl}</a>
      </td>
    </tr>
  `;

  return await sendMail({
    to: user.email,
    subject: '¡Activa tu cuenta en GEMS Hub! 🚀',
    html: emailBase({
      preheader: `${user.name}, activa tu cuenta para comenzar tu free trial de 14 días.`,
      headerRow: `<span style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);color:#4ade80;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.3px;">Nuevo usuario</span>`,
      bodyRows,
    }),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. SOPORTE — TICKET CREADO (CLIENTE)
// ═════════════════════════════════════════════════════════════════════════════
function ticketCreatedClientHtml(ticket) {
  const ticketId  = esc(String(ticket.ticketNumber || ticket._id));
  const priC      = pri(ticket.priority);

  const bodyRows = `
    <tr>
      <td class="pad" style="padding:28px 28px 24px;">
        <h1 style="margin:0 0 8px;font-size:20px;font-weight:800;color:${D.t0};">Hola, ${esc(ticket.submittedBy?.name || 'Cliente')} 👋</h1>
        <p style="margin:0;font-size:14px;color:${D.t1};line-height:1.65;">Tu solicitud fue registrada. Nuestro equipo de soporte la revisará a la brevedad.</p>
      </td>
    </tr>

    <!-- Ticket card -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border2};border-radius:10px;overflow:hidden;">
          <tr>
            <td style="width:3px;background:${priC.stripe};padding:0;"></td>
            <td style="padding:16px 18px;">
              <p style="margin:0;font-size:11px;color:${D.t2};text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:12px;">Ticket #${ticketId}</p>
              <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:${D.t0};">${esc(ticket.subject)}</p>
              <table cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>${priBadge(ticket.priority)}</td>
                  <td style="padding-left:8px;">
                    <span style="background:${D.el2};color:${D.t1};border:1px solid ${D.border};border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">${esc(ticket.status||'open')}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Confirmation note -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.18);border-radius:8px;padding:12px 16px;">
          <tr>
            <td style="font-size:15px;padding-right:10px;vertical-align:middle;">✅</td>
            <td style="font-size:13px;color:#4ade80;line-height:1.5;">Recibirás actualizaciones por correo cuando el estado cambie.</td>
          </tr>
        </table>
      </td>
    </tr>
    ${divRow()}
    <tr><td style="height:24px;"></td></tr>
  `;

  return emailBase({
    preheader: `Ticket #${ticketId} recibido: ${ticket.subject}`,
    headerRow: `<span style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);color:#60a5fa;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;">Soporte</span>`,
    bodyRows,
  });
}

// ─── Ticket creado — interno ──────────────────────────────────────────────────
function ticketCreatedInternalHtml(ticket, assignedAgent) {
  const ticketId = esc(String(ticket.ticketNumber || ticket._id));

  const bodyRows = `
    <tr>
      <td class="pad" style="padding:28px 28px 20px;">
        <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:${D.t0};">Nuevo ticket de soporte</h1>
        <p style="margin:0;font-size:14px;color:${D.t1};">Acaba de llegar y requiere atención.</p>
      </td>
    </tr>

    <!-- Cliente -->
    <tr>
      <td class="pad" style="padding:0 28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border2};border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid ${D.border};">
              <p style="margin:0;font-size:11px;color:${D.t2};text-transform:uppercase;letter-spacing:.6px;font-weight:700;">Cliente</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 16px;">
              <table width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:13px;color:${D.t1};width:40%;font-weight:600;padding-bottom:8px;">Nombre</td>
                  <td style="font-size:13px;color:${D.t0};font-weight:600;padding-bottom:8px;">${esc(ticket.submittedBy?.name||'—')}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:${D.t1};font-weight:600;">Email</td>
                  <td style="font-size:13px;color:${D.t0};">${esc(ticket.submittedBy?.email||'—')}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Ticket details -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border2};border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid ${D.border};">
              <p style="margin:0;font-size:11px;color:${D.t2};text-transform:uppercase;letter-spacing:.6px;font-weight:700;">Ticket #${ticketId}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 16px;">
              <table width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:13px;color:${D.t1};width:36%;font-weight:600;padding-bottom:8px;vertical-align:top;">Asunto</td>
                  <td style="font-size:13px;color:${D.t0};padding-bottom:8px;font-weight:600;">${esc(ticket.subject)}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:${D.t1};font-weight:600;padding-bottom:8px;">Prioridad</td>
                  <td style="padding-bottom:8px;">${priBadge(ticket.priority)}</td>
                </tr>
                ${ticket.description ? `<tr>
                  <td style="font-size:13px;color:${D.t1};font-weight:600;vertical-align:top;">Descripción</td>
                  <td style="font-size:13px;color:${D.t1};line-height:1.5;">${esc(ticket.description)}</td>
                </tr>` : ''}
                ${assignedAgent ? `<tr>
                  <td style="font-size:13px;color:${D.t1};font-weight:600;padding-top:8px;">Asignado a</td>
                  <td style="font-size:13px;color:${D.t0};font-weight:700;padding-top:8px;">${esc(assignedAgent.name)}</td>
                </tr>` : ''}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${divRow()}
    ${ctaRow(`${getFrontendUrl()}/tickets`, 'Ver ticket en GEMS Hub &nbsp;→', D.success)}
  `;

  return emailBase({
    preheader: `Nuevo ticket de ${ticket.submittedBy?.name}: "${ticket.subject}"`,
    headerRow: `<span style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);color:#4ade80;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;">Interno</span>`,
    bodyRows,
  });
}

// ─── Estado de ticket cambiado ────────────────────────────────────────────────
function ticketStatusChangedHtml(ticket, oldStatus, newStatus) {
  const ticketId  = esc(String(ticket.ticketNumber || ticket._id));
  const statusCol = { open:'#60a5fa', 'in-progress':'#fbbf24', resolved:'#4ade80', closed:'#8b92a5' };
  const newCol    = statusCol[newStatus] || D.accent;

  const bodyRows = `
    <tr>
      <td class="pad" style="padding:28px 28px 20px;">
        <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:${D.t0};">
          Hola, ${esc(ticket.submittedBy?.name||'Cliente')} 👋
        </h1>
        <p style="margin:0;font-size:14px;color:${D.t1};">El estado de tu ticket fue actualizado.</p>
      </td>
    </tr>

    <!-- Status transition -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;" align="center">
        <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="background:${D.el};border:1px solid ${D.border};border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;color:${D.t1};">${esc(oldStatus)}</td>
            <td style="padding:0 14px;font-size:18px;color:${D.t2};">→</td>
            <td style="background:rgba(${newCol.slice(1).match(/../g).map(x=>parseInt(x,16)).join(',')},0.12);border:1px solid rgba(${newCol.slice(1).match(/../g).map(x=>parseInt(x,16)).join(',')},0.28);border-radius:8px;padding:10px 18px;font-size:13px;font-weight:700;color:${newCol};">${esc(newStatus)}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Ticket ref -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border};border-radius:8px;padding:14px 16px;">
          <tr>
            <td>
              <p style="margin:0;font-size:11px;color:${D.t2};text-transform:uppercase;letter-spacing:.6px;font-weight:700;">Ticket #${ticketId}</p>
              <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:${D.t0};">${esc(ticket.subject)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${divRow()}
    ${ctaRow(`${getFrontendUrl()}/tickets`, 'Ver mi ticket &nbsp;→')}
  `;

  return emailBase({
    preheader: `Tu ticket #${ticketId} cambió de "${oldStatus}" a "${newStatus}"`,
    headerRow: `<span style="background:rgba(${newCol.slice(1).match(/../g).map(x=>parseInt(x,16)).join(',')},0.1);border:1px solid rgba(${newCol.slice(1).match(/../g).map(x=>parseInt(x,16)).join(',')},0.25);color:${newCol};padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;">Actualización</span>`,
    bodyRows,
  });
}

// ─── Nuevo comentario en ticket ───────────────────────────────────────────────
function ticketCommentHtml({ ticket, commentText, authorName, isAgentReply }) {
  const ticketId   = esc(String(ticket.ticketNumber || ticket._id));
  const recipName  = isAgentReply ? esc(ticket.submittedBy?.name||'Cliente') : esc(ticket.assignedTo?.name||'Agente');
  const tagColor   = isAgentReply ? '#60a5fa' : '#fbbf24';
  const tagBg      = isAgentReply ? 'rgba(96,165,250,.1)' : 'rgba(251,191,36,.1)';
  const tagBorder  = isAgentReply ? 'rgba(96,165,250,.25)' : 'rgba(251,191,36,.25)';
  const initials   = esc((authorName||'?').trim()[0]).toUpperCase();

  const bodyRows = `
    <tr>
      <td class="pad" style="padding:28px 28px 20px;">
        <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:${D.t0};">Hola, ${recipName} 👋</h1>
        <p style="margin:0;font-size:14px;color:${D.t1};">
          Hay una nueva respuesta en el ticket <strong style="color:${D.t0};">#${ticketId}: ${esc(ticket.subject)}</strong>.
        </p>
      </td>
    </tr>

    <!-- Comment bubble -->
    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:${D.el};border:1px solid ${D.border2};border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid ${D.border};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="width:30px;height:30px;background:${D.accent};border-radius:50%;text-align:center;vertical-align:middle;font-size:12px;font-weight:800;color:#fff;">
                    <span style="display:block;line-height:30px;">${initials}</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="font-size:13px;font-weight:600;color:${D.t0};">${esc(authorName)}</span>
                    <span style="font-size:11px;color:${D.t2};margin-left:8px;">${isAgentReply ? 'Soporte' : 'Cliente'}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 18px;">
              <p style="margin:0;font-size:14px;color:${D.t0};line-height:1.75;font-style:italic;">"${esc(commentText)}"</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${divRow()}
    ${ctaRow(`${getFrontendUrl()}/tickets`, 'Ver conversación completa &nbsp;→')}
  `;

  return emailBase({
    preheader: `${authorName} respondió al ticket #${ticketId}: "${ticket.subject}"`,
    headerRow: `<span style="background:${tagBg};border:1px solid ${tagBorder};color:${tagColor};padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;">Respuesta</span>`,
    bodyRows,
  });
}

// ─── SLA Alert ────────────────────────────────────────────────────────────────
function slAlertHtml(ticket) {
  const ticketId = esc(String(ticket.ticketNumber));

  const bodyRows = `
    <tr>
      <td class="pad" style="padding:28px 28px 20px;">
        <h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:${D.t0};">⚠️ Alerta de SLA</h1>
        <p style="margin:0;font-size:14px;color:${D.t1};">El ticket <strong style="color:#f87171;">#${ticketId}</strong> lleva más de 2 horas sin ser atendido.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:0 28px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.22);border-radius:10px;overflow:hidden;">
          <tr>
            <td style="width:3px;background:#ef4444;padding:0;"></td>
            <td style="padding:16px 18px;">
              <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:${D.t0};">${esc(ticket.subject)}</p>
              <table cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-right:10px;">${priBadge(ticket.priority)}</td>
                  <td>
                    <span style="background:rgba(239,68,68,.12);color:#f87171;border:1px solid rgba(239,68,68,.25);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">${esc(ticket.status)}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0;font-size:12px;color:${D.t2};">Cliente: ${esc(ticket.submittedBy?.name||'—')}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    ${divRow()}
    ${ctaRow(`${getFrontendUrl()}/tickets`, 'Atender ticket ahora &nbsp;→', '#ef4444')}
  `;

  return emailBase({
    preheader: `⚠️ ALERTA SLA: Ticket #${ticketId} sin atender por 2+ horas`,
    headerRow: `<span style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.28);color:#f87171;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;">🚨 SLA</span>`,
    bodyRows,
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
      subject: `[Ticket #${ticket.ticketNumber || ticket._id}] Estado: ${newStatus}`,
      html: ticketStatusChangedHtml(ticket, oldStatus, newStatus),
    });
  }
}

async function notifyNewComment(ticket, comment, author) {
  const isAgentReply = ['admin','supervisor','support'].includes(author.role);
  if (isAgentReply && !comment.isInternal && ticket.submittedBy?.email) {
    await sendMail({
      to: ticket.submittedBy.email,
      subject: `Nueva respuesta en tu Ticket #${ticket.ticketNumber || ticket._id}`,
      html: ticketCommentHtml({ ticket, commentText:comment.text, authorName:author.name, isAgentReply:true }),
    });
  }
  if (!isAgentReply && ticket.assignedTo?.email) {
    await sendMail({
      to: ticket.assignedTo.email,
      subject: `El cliente respondió al Ticket #${ticket.ticketNumber || ticket._id}`,
      html: ticketCommentHtml({ ticket, commentText:comment.text, authorName:ticket.submittedBy?.name||'Cliente', isAgentReply:false }),
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
