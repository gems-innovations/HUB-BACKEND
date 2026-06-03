const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Membership = require('../models/Membership');
const Organization = require('../models/Organization');
const { tenantContextMiddleware } = require('../services/tenantContext');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET no está definido o es muy corto (mínimo 32 caracteres). Configura process.env.JWT_SECRET.');
  process.exit(1);
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
// Token "pre-auth": emitido tras validar credenciales, antes de elegir org.
const PRE_AUTH_EXPIRES_IN = '10m';

/**
 * Verifica JWT. Si el token incluye organizationId, carga el Membership y la Organization
 * y los inyecta en req. Si solo trae userId (token pre-auth), `req.preAuth = true` y
 * el endpoint debe rechazar el acceso a datos de tenant.
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'Token de acceso requerido' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
    }

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }
    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Usuario inactivo' });
    }

    req.user = user;
    req.userId = user._id;

    // Token pre-auth (sin orgId): permite listar memberships y elegir org, nada más.
    if (!decoded.organizationId) {
      req.preAuth = true;
      return next();
    }

    let membership = await Membership.findOne({
      user: user._id,
      organization: decoded.organizationId,
      status: 'active'
    }).populate('organization');

    // Super-admin: si no hay Membership real, sintetizamos uno virtual con permisos plenos
    // contra cualquier organización activa. No persiste en BD.
    if (!membership && user.isSuperAdmin) {
      const org = await Organization.findOne({ _id: decoded.organizationId, status: 'active' });
      if (!org) return res.status(403).json({ success: false, message: 'Organización inactiva' });

      membership = {
        _id: null,
        user: user._id,
        organization: org,
        role: 'admin',
        isOwner: false,
        isSuperAdminSession: true,
        status: 'active',
        permissions: {
          dashboard: true,
          clients: { view: true, create: true, edit: true, delete: true },
          activities: { view: true, create: true, edit: true, delete: true },
          reports: { view: true, export: true },
          accounting: { view: true, create: true, edit: true, delete: true },
          cases: { view: true, create: true, edit: true, delete: true },
          team: { view: true, create: true, edit: true, delete: true }
        }
      };
    }

    if (!membership) {
      return res.status(403).json({ success: false, message: 'Sin acceso a esta organización' });
    }
    if (!membership.organization || membership.organization.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Organización inactiva' });
    }

    req.membership = membership;
    req.organization = membership.organization;
    req.organizationId = membership.organization._id;
    req.isSuperAdminSession = !!membership.isSuperAdminSession;
    req.tenantFilter = { organizationId: membership.organization._id };

    // Envolver el resto del request en el AsyncLocalStorage del tenant.
    // El plugin Mongoose lee de aquí para inyectar filtros automáticamente.
    return tenantContextMiddleware(req, res, next);
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ success: false, message: 'Error de autenticación' });
  }
};

/**
 * Asegura que la request tenga organización (no es un token pre-auth).
 * Usar como segundo middleware en rutas que tocan datos de tenant.
 */
const requireOrganization = (req, res, next) => {
  if (!req.organizationId) {
    return res.status(403).json({ success: false, message: 'Selecciona una organización para continuar' });
  }
  next();
};

/**
 * Verifica permisos específicos leyendo del Membership (per-org).
 * Admin de la org (membership.role === 'admin' o isOwner) tiene acceso total.
 */
const requirePermission = (module, action = 'view') => {
  return (req, res, next) => {
    try {
      const membership = req.membership;
      if (!membership) {
        return res.status(401).json({ success: false, message: 'Sin organización activa' });
      }

      if (membership.isOwner || membership.role === 'admin' || membership.isSuperAdminSession) {
        return next();
      }

      const modulePerms = membership.permissions && membership.permissions[module];
      const allowed = modulePerms && (modulePerms === true || modulePerms[action] === true);

      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: `No tienes permisos para ${action} en ${module}`
        });
      }
      next();
    } catch (error) {
      console.error('Permission middleware error:', error);
      return res.status(500).json({ success: false, message: 'Error verificando permisos' });
    }
  };
};

/**
 * Requiere que el usuario sea super-administrador de plataforma (User.isSuperAdmin).
 * Independiente de Memberships. Usar para rutas /api/admin/*.
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Requiere permisos de super-administrador' });
  }
  next();
};

/**
 * Requiere un rol específico del Membership en la organización activa.
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    const membership = req.membership;
    if (!membership) {
      return res.status(401).json({ success: false, message: 'Sin organización activa' });
    }
    if (membership.isOwner || membership.isSuperAdminSession || roles.includes(membership.role)) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Sin rol necesario para esta acción' });
  };
};

/**
 * Helper para tags de Mongoose: forza filtros a la org activa.
 * Uso: const items = await Model.find(tenantQuery(req, { extra: 'filter' }));
 */
const tenantQuery = (req, extra = {}) => {
  if (!req.organizationId) {
    throw new Error('tenantQuery requiere req.organizationId — usa authenticateToken + requireOrganization');
  }
  return { organizationId: req.organizationId, ...extra };
};

const generateToken = (userId, organizationId = null) => {
  const payload = { userId };
  if (organizationId) payload.organizationId = organizationId;
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: organizationId ? JWT_EXPIRES_IN : PRE_AUTH_EXPIRES_IN
  });
};

const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

const generateRefreshToken = async (userId, organizationId = null, req = null) => {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  const rt = new RefreshToken({
    token,
    user: userId,
    organization: organizationId,
    expiresAt,
    deviceInfo: req ? req.get('user-agent') : null,
    ipAddress: req ? (req.ip || req.connection?.remoteAddress) : null
  });

  await rt.save();
  return token;
};

module.exports = {
  authenticateToken,
  requireOrganization,
  requirePermission,
  requireRole,
  requireSuperAdmin,
  generateToken,
  generateRefreshToken,
  tenantQuery,
  JWT_SECRET
};
