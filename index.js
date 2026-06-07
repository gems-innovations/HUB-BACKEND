// Fix DNS SRV resolution en Node.js v17+ / Windows
// El DNS local de Windows bloquea queries SRV de MongoDB Atlas — forzar Google DNS
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// ───── Registro de plugin global de tenant scope ─────
// IMPORTANTE: debe registrarse ANTES de cargar cualquier modelo para que se aplique a todos.
require('dotenv').config();
const mongooseBootstrap = require('mongoose');
const tenantScopePlugin = require('./models/plugins/tenantScope');
mongooseBootstrap.plugin(tenantScopePlugin);

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 15000; // 15 segundos
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const { tenantContextMiddleware } = require('./services/tenantContext');

// ───── CORS: allowlist por env ─────
// CORS_ORIGINS="https://app.gemshub.com,https://acme.gemshub.com"
// En dev: si no se define, refleja el origen (acepta localhost:5173, 127.0.0.1, etc.)
const allowlist = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin: (origin, callback) => {
    // Permitir llamadas sin origen (Postman, curl, healthchecks) y mismo-origen
    if (!origin) return callback(null, true);
    if (allowlist.length === 0) return callback(null, true); // modo dev
    if (allowlist.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origen no autorizado: ${origin}`));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
  exposedHeaders: ['Content-Disposition']
};

const app = express();
const server = http.createServer(app);

// Confiar en el proxy (Render, Cloudflare) para rate limit por IP real
app.set('trust proxy', 1);

// ───── Helmet: cabeceras de seguridad ─────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // permite servir uploads desde el frontend
  contentSecurityPolicy: false // CSP la maneja el frontend en index.html
}));

// CORS antes del parser
app.use(cors(corsOptions));

// Límites de body — protege contra payloads enormes
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Sanitización contra NoSQL injection (remueve $ y . de keys en body/query/params)
app.use(mongoSanitize());

// Bloquea HTTP Parameter Pollution (?role=admin&role=user)
app.use(hpp());

// ───── Redis para rate limiting distribuido ─────
// Si REDIS_URL no está configurado, cae en memoria (solo para dev local).
let redisClient = null;
let redisReady = false;

if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL, {
    enableOfflineQueue: false,   // no acumular comandos si Redis está caído
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: false,
  });
  redisClient.on('connect', () => {
    redisReady = true;
    console.log('[Redis] Conectado — rate limiting persistente activo');
  });
  redisClient.on('error', (err) => {
    redisReady = false;
    console.error('[Redis] Error de conexión:', err.message);
  });
  redisClient.on('close', () => {
    redisReady = false;
  });
} else {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[Rate limit] ADVERTENCIA: REDIS_URL no configurado — usando memoria (no persiste entre reinicios)');
  }
}

// Construye un RedisStore si Redis está disponible, o undefined para usar memoria.
// sendCommand tiene try/catch: si Redis cae en runtime, el limiter usa passOnStoreError
// y deja pasar la petición en lugar de romper el servidor.
function makeStore(prefix) {
  if (!redisClient) return undefined;
  return new RedisStore({
    sendCommand: async (...args) => {
      if (!redisReady) throw new Error('Redis no disponible');
      return redisClient.call(...args);
    },
    prefix,
  });
}

// ───── Middleware: verificar si la IP está baneada ─────
// Cuando un limiter supera su cuota, escribe ban:<ip> en Redis con TTL de 1h.
// Esta comprobación corre ANTES de los limiters.
async function banCheckMiddleware(req, res, next) {
  if (!redisClient || !redisReady) return next();
  try {
    const ttl = await redisClient.ttl(`ban:${req.ip}`);
    if (ttl > 0) {
      const minutosRestantes = Math.ceil(ttl / 60);
      return res.status(429).json({
        success: false,
        message: `IP bloqueada por exceso de solicitudes. Intenta de nuevo en ${minutosRestantes} minuto(s).`,
        retryAfter: ttl,
      });
    }
  } catch (_) { /* Si Redis falla, dejamos pasar */ }
  next();
}

// Escribe el ban en Redis (1 hora). Llamado desde los handlers de los limiters.
async function banIp(ip) {
  if (!redisClient || !redisReady) return;
  try {
    await redisClient.set(`ban:${ip}`, '1', 'EX', 3600);
  } catch (_) { /* ignorar fallos de Redis */ }
}

// ───── Rate limiting ─────
// General: 50 req/min por IP. Si se supera → ban de 1 hora en Redis.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,          // ventana de 1 minuto
  max: 50,                       // 50 solicitudes por minuto
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,        // si Redis falla, deja pasar en lugar de romper
  store: makeStore('rl:gen:'),
  handler: async (req, res) => {
    await banIp(req.ip);
    res.status(429).json({
      success: false,
      message: 'Has excedido el límite de solicitudes. Tu IP ha sido bloqueada por 1 hora.',
    });
  },
});

// Auth: 10 intentos fallidos/15min → ban de 1 hora.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,  // no penaliza logins correctos
  passOnStoreError: true,
  store: makeStore('rl:auth:'),
  handler: async (req, res) => {
    await banIp(req.ip);
    res.status(429).json({
      success: false,
      message: 'Demasiados intentos fallidos. Tu IP ha sido bloqueada por 1 hora.',
    });
  },
});

// Refresh tokens: alta frecuencia legítima (múltiples pestañas / NAT compartido).
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: makeStore('rl:refresh:'),
  message: { success: false, message: 'Demasiadas renovaciones de sesión.' },
});

// Self-service onboarding: estricto contra spam de organizaciones.
const registerOrgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,    // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: makeStore('rl:regorgs:'),
  message: { success: false, message: 'Demasiados intentos de registro. Intenta en 1 hora.' },
});

// Primero verificamos bans, luego aplicamos el limiter por ventana.
app.use('/api/', banCheckMiddleware);
app.use('/api/', generalLimiter);

// Socket.IO CORS: usa la misma allowlist
const io = socketIo(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

let avisosGroupId = null; // Guardar el ID del grupo 'avisos' automáticamente

// Servir archivos estáticos de uploads. CORS lo maneja el middleware global (allowlist).
// Cross-Origin-Resource-Policy: cross-origin permite que el frontend cargue las imágenes.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=31536000');
  }
}));

// Healthcheck público (sin rate limit estricto)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 });
});

// Create uploads/chat directory if it doesn't exist
const fs = require('fs');

const chatUploadsDir = path.join(__dirname, 'uploads', 'chat');
if (!fs.existsSync(chatUploadsDir)) {
  fs.mkdirSync(chatUploadsDir, { recursive: true });
}

// Store io instance in app for use in routes
app.set('io', io);

// Importar rutas
const authRoutes = require('./routes/auth');
const clientsRoutes = require('./routes/clients');
const activitiesRoutes = require('./routes/activities');
const paymentsRoutes = require('./routes/payments');
const accountingRoutes = require('./routes/accounting');
const casesRoutes = require('./routes/cases');
const followupsRoutes = require('./routes/followups');
const issuesRoutes = require('./routes/issues');
const notificationsRoutes = require('./routes/notifications');
const docsRoutes = require('./routes/docs');

const minutesRoutes = require('./routes/minutes');
const settingsRoutes = require('./routes/settings');
const teamRoutes = require('./routes/team');
const reportsRoutes = require('./routes/reports');

const chatRoutes = require('./routes/chat');
const prospectsRoutes = require('./routes/prospects');
const avatarRoutes = require('./routes/avatars');
const taskReportsRoutes = require('./routes/taskReports');
const tasksRoutes = require('./routes/tasks');
const boardsRoutes = require('./routes/boards');
const githubRoutes = require('./routes/github');
const ticketsRoutes = require('./routes/tickets');
const rolesRoutes = require('./routes/roles');
const wikiRoutes = require('./routes/wiki');
const aiRoutes = require('./routes/ai');
const adminRoutes = require('./routes/admin');

// Usar rutas — rate limits específicos por sub-ruta antes del authLimiter genérico.
// Orden importa: los limiters específicos se montan ANTES del general para que matcheen primero.
app.use('/api/auth/refresh', refreshLimiter);
app.use('/api/auth/register-org', registerOrgLimiter);
app.use('/api/auth', authLimiter, authRoutes);

// ───── Wall: todas las demás rutas /api/* requieren autenticación + org activa ─────
// Rutas públicas explícitas que se saltan este wall: las definidas ANTES de esta línea
// (ej. /api/auth, /api/health). Rutas tipo /api/tickets/public deben usar un sub-router.
const { authenticateToken, requireOrganization } = require('./middleware/auth');
const publicWhitelist = [
  /^\/api\/tickets\/public\/[^/]+$/, // formulario externo de soporte (con orgSlug)
  /^\/api\/health$/,
  // Verificación de email — el link llega por correo, no puede pedir token
  /^\/api\/auth\/verify-email\/[^/]+$/,
];
app.use('/api', (req, res, next) => {
  if (publicWhitelist.some(rx => rx.test(req.originalUrl.split('?')[0]))) return next();
  return authenticateToken(req, res, (err) => {
    if (err) return next(err);
    return requireOrganization(req, res, next);
  });
});

app.use('/api/clients', clientsRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/followups', followupsRoutes);
app.use('/api/issues', issuesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/minutes', minutesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/prospects', prospectsRoutes);
app.use('/api/avatars', avatarRoutes);
app.use('/api/task-reports', taskReportsRoutes);
app.use('/api/taskReports', taskReportsRoutes); // Alias para compatibilidad
app.use('/api/tasks', tasksRoutes);
app.use('/api/boards', boardsRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);


// Conexión a MongoDB usando .env
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', async () => {
  console.log('Connected to MongoDB');
  
  // ─── One-time initialization ───
  const { ensureSupportUser, ensureDefaultRoles } = require('./services/initService');
  await ensureSupportUser();
  await ensureDefaultRoles();

  // Inicializar servicios de cron
  const { initTaskReportsCron, initTeamReportsCron, initSlaCron } = require('./services/cronService');
  initTaskReportsCron(app);
  initTeamReportsCron(app);
  initSlaCron();
});

// Socket.IO con autenticación obligatoria + scope por organización (ver socket/index.js)
require('./socket/index')(io);

// ─── Global Error Handling Middleware ───
app.use((err, req, res, next) => {
  console.error('[Global Error]', err.stack || err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Customer Touch Backend running on port ${PORT}`);
});
