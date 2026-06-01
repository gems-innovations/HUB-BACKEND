/**
 * Crea un tenant DEMO completamente poblado para demos y onboarding de prospectos.
 *
 * Tenant:        Demo GEMS (slug: demo)
 * Owner:         demo@gems.cr / Demo12345
 * Miembros:      4 (admin, manager, agente comercial, soporte)
 * Datos sembrados:
 *   • 6 clientes (industrias variadas)
 *   • 10 actividades (estados/prioridades mezclados)
 *   • 4 casos
 *   • 4 tickets (con auto-asignación a soporte)
 *   • 4 prospectos en distintos puntos del pipeline
 *
 * Uso:
 *   # Contra .env (dev):
 *   node scripts/seedDemoTenant.js --confirm
 *
 *   # Contra otra BD (ej. prod):
 *   $env:MONGO_URI="..."; node scripts/seedDemoTenant.js --confirm
 *
 *   # Re-crear desde cero (borra y vuelve a sembrar):
 *   node scripts/seedDemoTenant.js --confirm --reset
 *
 *   # Dry-run (no escribe nada):
 *   node scripts/seedDemoTenant.js
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

require('dotenv').config();
const mongoose = require('mongoose');
mongoose.set('autoIndex', false);
mongoose.plugin(require('../models/plugins/tenantScope'));

const CONFIRM = process.argv.includes('--confirm');
const RESET   = process.argv.includes('--reset');

const SLUG = 'demo';

function previewTarget(uri) {
  try {
    const m = uri.match(/@([^/]+)\/([^?]+)/);
    return m ? `${m[1]}/${m[2]}` : '(no parseable)';
  } catch { return '(no parseable)'; }
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI no definido.'); process.exit(1);
  }
  console.log(`Target: ${previewTarget(process.env.MONGO_URI)}`);
  if (!CONFIRM) {
    console.log('\nDry-run. Vuelve a correr con --confirm para sembrar.');
    process.exit(0);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Conectado.\n');

  const Organization        = require('../models/Organization');
  const Membership          = require('../models/Membership');
  const User                = require('../models/User');
  const Client              = require('../models/Client');
  const Activity            = require('../models/Activity');
  const Case                = require('../models/Case');
  const Ticket              = require('../models/Ticket');
  const ProspectConversation = require('../models/ProspectConversation');
  const { ensureDefaultRolesForOrg } = require('../services/initService');
  const { runWithTenant } = require('../services/tenantContext');

  // ───── Si --reset, borrar todo lo que existía para slug 'demo' ─────
  let org = await Organization.findOne({ slug: SLUG });
  if (RESET && org) {
    console.log('[reset] Borrando datos de demo existentes...');
    const orgId = org._id;
    await Promise.all([
      Client.deleteMany({ organizationId: orgId }),
      Activity.deleteMany({ organizationId: orgId }),
      Case.deleteMany({ organizationId: orgId }),
      Ticket.deleteMany({ organizationId: orgId }),
      ProspectConversation.deleteMany({ organizationId: orgId }),
      Membership.deleteMany({ organization: orgId }),
      require('../models/Role').deleteMany({ organizationId: orgId }),
      Organization.deleteOne({ _id: orgId })
    ]);
    // Borrar usuarios demo (los que crearemos abajo). NO toca tu admin.
    await User.deleteMany({ email: { $regex: /@demo\.gems\.cr$/ } });
    org = null;
    console.log('  ✓ Reset completo.\n');
  }

  // ───── Organización ─────
  if (!org) {
    org = await Organization.create({
      name: 'Demo GEMS',
      slug: SLUG,
      status: 'active',
      plan: 'pro',
      contact: { email: 'demo@gems.cr', country: 'CR' },
      branding: {
        displayName: 'Demo GEMS',
        accentColor: '#0ea5e9',
        primaryColor: '#0ea5e9',
        darkMode: false
      }
    });
    console.log('✅ Org creada:', org.name, org._id);
  } else {
    console.log('• Org ya existe:', org._id);
  }

  await ensureDefaultRolesForOrg(org._id);
  console.log('✅ Roles del sistema.\n');

  // ───── Usuarios ─────
  const userDefs = [
    { name: 'Diana Owner',     email: 'diana.owner@demo.gems.cr',   role: 'admin',    isOwner: true,  position: 'CEO' },
    { name: 'Mateo Manager',   email: 'mateo.manager@demo.gems.cr', role: 'manager',  isOwner: false, position: 'Country Manager' },
    { name: 'Carla Comercial', email: 'carla.ventas@demo.gems.cr',  role: 'user',     isOwner: false, position: 'Ejecutiva Comercial' },
    { name: 'Sergio Soporte',  email: 'sergio.soporte@demo.gems.cr',role: 'support',  isOwner: false, position: 'Agente de Soporte' }
  ];

  const users = {};
  for (const def of userDefs) {
    let u = await User.findOne({ email: def.email });
    if (!u) {
      u = await User.create({
        name: def.name,
        email: def.email,
        password: 'Demo12345',
        role: def.role,
        position: def.position,
        isActive: true,
        isVerified: true,
        phone: '+506 8' + Math.floor(1000000 + Math.random() * 9000000)
      });
      console.log('  ✓ Usuario:', def.email);
    } else {
      console.log('  · Ya existe:', def.email);
    }
    users[def.role + (def.isOwner ? '-owner' : '')] = u;

    // Membership
    const existing = await Membership.findOne({ user: u._id, organization: org._id });
    if (!existing) {
      await Membership.create({
        user: u._id,
        organization: org._id,
        role: def.role,
        isOwner: def.isOwner,
        status: 'active',
        position: def.position,
        acceptedAt: new Date()
      });
    }
  }
  console.log('✅ 4 miembros del equipo.\n');

  const owner = users['admin-owner'];

  // ───── Datos de tenant (todo dentro de runWithTenant para que el plugin haga su magia) ─────
  await runWithTenant(org._id, async () => {

    // Clientes
    const clientDefs = [
      { name: 'Helado Tropical S.A.',     email: 'contacto@helado-tropical.cr',  phone: '+506 22221111', company: 'Helado Tropical', tags: ['retail','enterprise'], profile: { industry: 'Retail',         size: 'Mediana' } },
      { name: 'Constructora Andes',       email: 'info@andes.cr',                phone: '+506 22222222', company: 'Constructora Andes', tags: ['construccion'],  profile: { industry: 'Construcción',   size: 'Grande' } },
      { name: 'Clínica San Rafael',       email: 'admin@sanrafael.cr',           phone: '+506 22223333', company: 'Clínica San Rafael', tags: ['salud','vip'],   profile: { industry: 'Salud',           size: 'Mediana' } },
      { name: 'EduTech Latam',            email: 'hola@edutech-latam.com',       phone: '+506 22224444', company: 'EduTech Latam', tags: ['edtech','saas'],     profile: { industry: 'Educación',       size: 'Pequeña' } },
      { name: 'Café Origen',              email: 'pedidos@cafeorigen.cr',        phone: '+506 22225555', company: 'Café Origen', tags: ['food','export'],       profile: { industry: 'Alimentos',       size: 'Pequeña' } },
      { name: 'LogiCargo CR',             email: 'ventas@logicargo.cr',          phone: '+506 22226666', company: 'LogiCargo', tags: ['logistica'],             profile: { industry: 'Logística',       size: 'Grande' } }
    ];
    const clients = [];
    for (const c of clientDefs) {
      const existing = await Client.findOne({ email: c.email });
      if (existing) { clients.push(existing); continue; }
      clients.push(await Client.create(c));
    }
    console.log('✅', clients.length, 'clientes.');

    // Actividades
    const statuses   = ['pending','in-progress','completed','overdue'];
    const priorities = ['low','medium','high','urgent'];
    const titles = [
      'Reunión de descubrimiento',
      'Enviar propuesta comercial',
      'Demo técnica del producto',
      'Seguimiento de propuesta',
      'Renovación de contrato anual',
      'Capacitación al equipo del cliente',
      'Auditoría de uso de plataforma',
      'Llamada de cierre',
      'Revisión trimestral (QBR)',
      'Onboarding inicial'
    ];
    let createdAct = 0;
    for (let i = 0; i < titles.length; i++) {
      const due = new Date(); due.setDate(due.getDate() + (i - 4) * 2); // unas vencidas, otras futuras
      const exists = await Activity.findOne({ title: titles[i], clientId: clients[i % clients.length]._id });
      if (exists) continue;
      await Activity.create({
        title: titles[i],
        description: `Actividad demo #${i + 1} para ilustrar el seguimiento operativo del cliente.`,
        status: statuses[i % statuses.length],
        priority: priorities[i % priorities.length],
        clientId: clients[i % clients.length]._id,
        assignedTo: [users['user']._id, users['manager']._id].slice(0, (i % 2) + 1),
        createdBy: owner._id,
        dueDate: due,
        estimatedTime: ['30 minutos','1 hora','2 horas','4 horas'][i % 4]
      });
      createdAct++;
    }
    console.log('✅', createdAct, 'actividades.');

    // Casos
    const caseDefs = [
      { titulo: 'Migración del CRM antiguo',         tipo: 'seguimiento', estado: 'en_progreso', prioridad: 'alta',     cliente_id: clients[0]._id, progreso: 45 },
      { titulo: 'Bug intermitente en facturación',   tipo: 'incidencia',  estado: 'abierto',     prioridad: 'critica',  cliente_id: clients[1]._id, gravedad: 'mayor',   impacto: 'alto' },
      { titulo: 'Contrato anual 2026',               tipo: 'documento',   estado: 'resuelto',    prioridad: 'media',    cliente_id: clients[2]._id },
      { titulo: 'Plan de capacitación Q1',           tipo: 'seguimiento', estado: 'abierto',     prioridad: 'media',    cliente_id: clients[3]._id, progreso: 10 }
    ];
    let createdCase = 0;
    for (const c of caseDefs) {
      const exists = await Case.findOne({ titulo: c.titulo, cliente_id: c.cliente_id });
      if (exists) continue;
      await Case.create({
        ...c,
        descripcion: `Caso de demostración para "${c.titulo}". Sirve para mostrar el flujo operativo.`,
        asignado_a: users['manager']._id
      });
      createdCase++;
    }
    console.log('✅', createdCase, 'casos.');

    // Tickets
    const ticketDefs = [
      { subject: 'No puedo iniciar sesión',     priority: 'urgent', category: 'technical', status: 'new' },
      { subject: 'Cómo exportar reporte PDF',   priority: 'low',    category: 'other',     status: 'open' },
      { subject: 'Cargo duplicado en factura',  priority: 'high',   category: 'billing',   status: 'waiting' },
      { subject: 'Quiero contratar el plan Pro',priority: 'medium', category: 'sales',     status: 'resolved' }
    ];
    let createdTk = 0;
    for (let i = 0; i < ticketDefs.length; i++) {
      const td = ticketDefs[i];
      const cli = clients[i % clients.length];
      const exists = await Ticket.findOne({ subject: td.subject, 'submittedBy.email': cli.email });
      if (exists) continue;
      await Ticket.create({
        ...td,
        description: 'Ticket de demostración. Detalle del problema reportado por el cliente.',
        submittedBy: { name: cli.name, email: cli.email, clientId: cli._id },
        assignedTo: users['support']._id
      });
      createdTk++;
    }
    console.log('✅', createdTk, 'tickets.');

    // Prospectos (pipeline)
    const prospectDefs = [
      { prospectName: 'Andrea Castillo', company: 'Castillo Consultores', status: 'nuevo',       source: 'web',      estimatedValue: 1500, contactEmail: 'andrea@castillo.cr',  contactPhone: '+506 87111111' },
      { prospectName: 'Bruno Ramírez',   company: 'Ramírez Boutique',     status: 'calificado',  source: 'referido', estimatedValue: 3200, contactEmail: 'bruno@ramirez.cr',    contactPhone: '+506 87222222' },
      { prospectName: 'Camila Vega',     company: 'Vega Logistics',       status: 'propuesta',   source: 'linkedin', estimatedValue: 8500, contactEmail: 'camila@vegalog.cr',   contactPhone: '+506 87333333' },
      { prospectName: 'Diego Mora',      company: 'Mora Wellness',        status: 'seguimiento', source: 'evento',   estimatedValue: 5000, contactEmail: 'diego@morawellness.cr',contactPhone: '+506 87444444' }
    ];
    let createdProsp = 0;
    for (const p of prospectDefs) {
      const exists = await ProspectConversation.findOne({ prospectName: p.prospectName });
      if (exists) continue;
      const conv = await ProspectConversation.create({
        ...p,
        createdBy: users['user']._id,
        ownerId:   users['user']._id,
        messages: [
          { role: 'user',      content: `Diagnóstico inicial de ${p.company}.` },
          { role: 'assistant', content: `Propuesta sugerida para ${p.company}: módulo Clientes + Pipeline + Reportes ejecutivos.` }
        ]
      });
      conv.addTimelineEntry('created', `Prospecto creado: ${p.prospectName}`);
      conv.addTimelineEntry('status',  `Estado inicial: ${p.status}`);
      await conv.save();
      createdProsp++;
    }
    console.log('✅', createdProsp, 'prospectos.');

  });

  console.log('\n══════ DEMO TENANT LISTO ══════');
  console.log('Org:        ', org.name, '(slug:', SLUG + ')');
  console.log('URL login:  https://hub.gemsinnovations.com/login');
  console.log('Owner:      diana.owner@demo.gems.cr / Demo12345');
  console.log('Manager:    mateo.manager@demo.gems.cr / Demo12345');
  console.log('Comercial:  carla.ventas@demo.gems.cr / Demo12345');
  console.log('Soporte:    sergio.soporte@demo.gems.cr / Demo12345');
  console.log('\nO entra como super-admin y selecciona "Demo GEMS" del listado.');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
