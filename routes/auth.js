const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Membership = require('../models/Membership');
const Organization = require('../models/Organization');
const RefreshToken = require('../models/RefreshToken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { generateToken, generateRefreshToken, authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { sendVerificationEmail } = require('../services/emailService');

const router = express.Router();

// ───── Upload de fotos de perfil ─────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../uploads/profiles');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueName = `profile-${req.user._id}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten imágenes JPG, PNG, WEBP o GIF'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ───── Helpers ─────
function membershipSummary(m) {
  return {
    organizationId: m.organization._id,
    organizationName: m.organization.name,
    organizationSlug: m.organization.slug,
    branding: m.organization.branding,
    role: m.role,
    isOwner: m.isOwner,
    isSuperAdminSession: !!m.isSuperAdminSession,
    status: m.status
  };
}

async function loadActiveMemberships(userId, user) {
  // Super-admin: ve TODAS las orgs activas como "memberships virtuales".
  if (user && user.isSuperAdmin) {
    const { runWithoutTenant } = require('../services/tenantContext');
    const orgs = await runWithoutTenant(() =>
      Organization.find({ status: 'active' }).sort({ name: 1 })
    );
    return orgs.map(org => ({
      organization: org,
      role: 'admin',
      isOwner: false,
      isSuperAdminSession: true,
      status: 'active',
      permissions: {}
    }));
  }
  return Membership.find({ user: userId, status: 'active' })
    .populate({ path: 'organization', match: { status: 'active' } });
}

// ───── POST /register ─────
// Solo se permite registro abierto si no hay usuarios en el sistema (bootstrap del primer admin).
// En modo SaaS futuro, el alta de usuarios se hará por invitación dentro de una org.
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string'
        || !name.trim() || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Nombre, email y contraseña son requeridos' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const userCount = await User.countDocuments();
    if (userCount > 0) {
      return res.status(403).json({
        success: false,
        message: 'Registro cerrado. Solicita una invitación al administrador de tu organización.'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: 'El email ya está registrado' });
    }

    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'admin'
    });
    await user.save();

    // Crear org default y membership owner
    let org = await Organization.findOne({ slug: 'gems' });
    if (!org) {
      org = await Organization.create({
        name: 'GEMS Innovations',
        slug: 'gems',
        plan: 'enterprise',
        createdBy: user._id
      });
    }

    await Membership.create({
      user: user._id,
      organization: org._id,
      role: 'admin',
      isOwner: true,
      status: 'active',
      acceptedAt: new Date()
    });

    const token = generateToken(user._id, org._id);
    res.status(201).json({
      success: true,
      message: 'Usuario administrador creado',
      data: { token, user: user.toJSON(), organization: org }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// ───── POST /register-org (Self-Service Onboarding) ─────
router.post('/register-org', async (req, res) => {
  try {
    const { orgName, userName, email, password } = req.body;

    if (typeof orgName !== 'string' || typeof userName !== 'string'
        || typeof email !== 'string' || typeof password !== 'string'
        || !orgName.trim() || !userName.trim() || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Todos los campos son requeridos' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'El email ya está registrado' });
    }

    // Generate slug from orgName
    let baseSlug = orgName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (baseSlug.length < 3) baseSlug += '-org';
    let slug = baseSlug;
    let slugCounter = 1;
    while (await Organization.findOne({ slug })) {
      slug = `${baseSlug}-${slugCounter}`;
      slugCounter++;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create User (unverified)
    const user = new User({
      name: userName.trim(),
      email: normalizedEmail,
      password,
      role: 'admin',
      isVerified: false,
      verificationToken
    });
    await user.save();

    // Create Organization with 14-day trial
    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + 14);

    const org = await Organization.create({
      name: orgName.trim(),
      slug,
      plan: 'free_trial',
      trialExpiresAt,
      createdBy: user._id
    });

    // Create Membership as Owner
    await Membership.create({
      user: user._id,
      organization: org._id,
      role: 'admin',
      isOwner: true,
      status: 'active',
      acceptedAt: new Date()
    });

    // Send verification email
    await sendVerificationEmail(user, verificationToken, req);

    res.status(201).json({
      success: true,
      message: 'Organización creada. Por favor verifica tu correo para activar la cuenta.'
    });
  } catch (error) {
    console.error('Register-org error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// ───── GET /verify-email/:token ─────
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({ verificationToken: token });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Token de verificación inválido o expirado' });
    }

    user.isVerified = true;
    user.verificationToken = null;
    await user.save();

    res.json({ success: true, message: 'Correo verificado exitosamente. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// ───── POST /login ─────
// Si el usuario tiene 1 org activa → token completo (con orgId).
// Si tiene varias → token pre-auth + lista de memberships para que el frontend muestre selector.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validación estricta de tipo — mongo-sanitize ya neutraliza operadores como $ne,
    // pero un atacante puede mandar email/password como objeto/array. Sin este check,
    // .trim() / .toLowerCase() abajo crashearían con 500 (DoS leve + log noise).
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Email y contraseña son requeridos' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }
    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Usuario inactivo. Contacta al administrador' });
    }
    if (user.isVerified === false) {
      return res.status(401).json({ success: false, message: 'Debes verificar tu correo electrónico antes de iniciar sesión' });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
    }

    user.lastLogin = new Date();
    await user.save();

    // 2FA check
    if (user.isTwoFactorEnabled) {
      const tempToken = jwt.sign({ userId: user._id, require2FA: true }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({
        success: true,
        message: 'Código de verificación 2FA requerido',
        data: { require2FA: true, tempToken }
      });
    }

    const memberships = (await loadActiveMemberships(user._id, user)).filter(m => m.organization);

    if (memberships.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'No perteneces a ninguna organización activa. Solicita una invitación.'
      });
    }

    // Super-admin: siempre va al selector (para que pueda elegir entre todos los tenants),
    // aunque solo exista 1 organización.
    if (memberships.length === 1 && !user.isSuperAdmin) {
      const m = memberships[0];
      const token = generateToken(user._id, m.organization._id);
      const refreshToken = await generateRefreshToken(user._id, m.organization._id, req);
      
      m.lastActiveAt = new Date();
      await m.save();
      return res.json({
        success: true,
        message: 'Inicio de sesión exitoso',
        data: {
          token,
          refreshToken,
          user: user.toJSON(),
          organization: m.organization,
          membership: { role: m.role, isOwner: m.isOwner, permissions: m.permissions },
          requiresOrgSelection: false
        }
      });
    }

    // Múltiples orgs → token pre-auth + selector
    const preAuthToken = generateToken(user._id, null);
    res.json({
      success: true,
      message: 'Selecciona la organización para continuar',
      data: {
        token: preAuthToken,
        user: user.toJSON(),
        memberships: memberships.map(membershipSummary),
        requiresOrgSelection: true
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// ───── POST /select-org ─────
// Llamado con un token pre-auth para emitir el token final con orgId.
router.post('/select-org', authenticateToken, async (req, res) => {
  try {
    const { organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organizationId requerido' });
    }

    // Super-admin: puede entrar a cualquier org activa sin Membership
    if (req.user.isSuperAdmin) {
      const { runWithoutTenant } = require('../services/tenantContext');
      const org = await runWithoutTenant(() =>
        Organization.findOne({ _id: organizationId, status: 'active' })
      );
      if (!org) {
        return res.status(404).json({ success: false, message: 'Organización no encontrada o inactiva' });
      }
      
      // Registrar en la auditoría de accesos Super-Admin
      const SuperAdminAudit = require('../models/SuperAdminAudit');
      try {
        await SuperAdminAudit.create({
          superAdminId: req.user._id,
          organizationId: org._id,
          action: 'login_as_superadmin',
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('user-agent')
        });
      } catch (auditErr) {
        console.error('Error registrando auditoría de super-admin:', auditErr);
        // No bloqueamos el login por un error en el log
      }

      const token = generateToken(req.user._id, org._id);
      const refreshToken = await generateRefreshToken(req.user._id, org._id, req);
      return res.json({
        success: true,
        data: {
          token,
          refreshToken,
          user: req.user.toJSON(),
          organization: org,
          membership: {
            role: 'admin',
            isOwner: false,
            isSuperAdminSession: true,
            permissions: {}
          }
        }
      });
    }

    const membership = await Membership.findOne({
      user: req.user._id,
      organization: organizationId,
      status: 'active'
    }).populate({ path: 'organization', match: { status: 'active' } });

    if (!membership || !membership.organization) {
      return res.status(403).json({ success: false, message: 'Sin acceso a esta organización' });
    }

    membership.lastActiveAt = new Date();
    await membership.save();

    const token = generateToken(req.user._id, membership.organization._id);
    const refreshToken = await generateRefreshToken(req.user._id, membership.organization._id, req);
    res.json({
      success: true,
      data: {
        token,
        refreshToken,
        user: req.user.toJSON(),
        organization: membership.organization,
        membership: { role: membership.role, isOwner: membership.isOwner, permissions: membership.permissions }
      }
    });
  } catch (error) {
    console.error('Select-org error:', error);
    res.status(500).json({ success: false, message: 'Error seleccionando organización' });
  }
});

// ───── POST /switch-org ─────
// Cambiar de organización con un token ya autenticado (mismo flujo que select-org).
router.post('/switch-org', authenticateToken, async (req, res) => {
  return router.handle({ ...req, url: '/select-org', method: 'POST' }, res);
});

// ───── GET /me ─────
router.get('/me', authenticateToken, async (req, res) => {
  if (req.preAuth) {
    const memberships = (await loadActiveMemberships(req.user._id, req.user)).filter(m => m.organization);
    return res.json({
      success: true,
      data: {
        user: req.user.toJSON(),
        memberships: memberships.map(membershipSummary),
        requiresOrgSelection: true
      }
    });
  }
  res.json({
    success: true,
    data: {
      user: req.user.toJSON(),
      organization: req.organization,
      membership: {
        role: req.membership.role,
        isOwner: req.membership.isOwner,
        permissions: req.membership.permissions,
        department: req.membership.department,
        position: req.membership.position
      }
    }
  });
});

// ───── GET /memberships ─────
router.get('/memberships', authenticateToken, async (req, res) => {
  const memberships = (await loadActiveMemberships(req.user._id, req.user)).filter(m => m.organization);
  res.json({ success: true, data: memberships.map(membershipSummary) });
});

// ───── GET /profile (compat) ─────
router.get('/profile', authenticateToken, async (req, res) => {
  res.json({ success: true, data: { user: req.user.toJSON() } });
});

// ───── PUT /profile ─────
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, avatar } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Nombre y email son requeridos' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const conflict = await User.findOne({ email: normalizedEmail, _id: { $ne: req.user._id } });
    if (conflict) {
      return res.status(400).json({ success: false, message: 'El email ya está en uso' });
    }

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      {
        name: name.trim(),
        email: normalizedEmail,
        phone: phone?.trim() || null,
        avatar: avatar
      },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({ success: true, message: 'Perfil actualizado', data: { user: updated.toJSON() } });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Error actualizando perfil' });
  }
});

// ───── PUT /change-password ─────
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Contraseña actual y nueva son requeridas' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres' });
    }

    const user = await User.findById(req.user._id);
    const isValid = await user.comparePassword(currentPassword);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Contraseña actual incorrecta' });
    }

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Contraseña actualizada' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Error cambiando contraseña' });
  }
});

// ───── POST /verify-token (compat) ─────
router.post('/verify-token', authenticateToken, async (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user.toJSON(),
      organization: req.organization || null,
      requiresOrgSelection: !!req.preAuth
    }
  });
});

// ───── POST /logout ─────
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await RefreshToken.deleteOne({ token: refreshToken });
    }
  } catch (err) {
    console.error('Logout error removing RT:', err);
  }
  res.json({ success: true, message: 'Sesión cerrada' });
});

// ───── POST /upload-photo ─────
router.post('/upload-photo', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
    }

    const user = await User.findById(req.user._id);
    if (user.photo) {
      const oldPath = path.join(__dirname, '../uploads/profiles', path.basename(user.photo));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const photoUrl = `/uploads/profiles/${req.file.filename}`;
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { photo: photoUrl },
      { new: true }
    ).select('-password');

    res.json({ success: true, message: 'Foto actualizada', photoUrl, user: updated });
  } catch (error) {
    console.error('Upload photo error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(error.message?.includes('imágenes') ? 400 : 500).json({
      success: false,
      message: error.message || 'Error subiendo foto'
    });
  }
});

// ───── 2FA & Refresh Tokens ─────

// POST /refresh - Usar refresh token para obtener un nuevo access token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'Refresh token requerido' });

    const rt = await RefreshToken.findOne({ token: refreshToken }).populate('user');
    if (!rt) return res.status(401).json({ success: false, message: 'Refresh token inválido' });
    if (rt.expiresAt < new Date()) {
      await RefreshToken.deleteOne({ _id: rt._id });
      return res.status(401).json({ success: false, message: 'Refresh token expirado' });
    }
    if (!rt.user || !rt.user.isActive) {
      return res.status(401).json({ success: false, message: 'Usuario inactivo' });
    }

    // Emitir nuevo access token
    const token = generateToken(rt.user._id, rt.organization || null);
    
    // Opcional: Rotar el refresh token para mayor seguridad
    const newRefreshToken = await generateRefreshToken(rt.user._id, rt.organization || null, req);
    await RefreshToken.deleteOne({ _id: rt._id }); // Borrar el viejo

    res.json({
      success: true,
      data: { token, refreshToken: newRefreshToken }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// POST /verify-2fa - Verificar código durante login
router.post('/verify-2fa', async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ success: false, message: 'Token temporal y código requeridos' });

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Token temporal inválido o expirado' });
    }

    if (!decoded.require2FA) return res.status(400).json({ success: false, message: 'Flujo inválido' });

    // twoFactorSecret tiene select: false, incluirlo explícitamente.
    const user = await User.findById(decoded.userId).select('+twoFactorSecret');
    if (!user || !user.isActive) return res.status(401).json({ success: false, message: 'Usuario inactivo' });
    if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: '2FA no está habilitado para este usuario' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 1 // Permite un poco de desincronización de reloj
    });

    if (!verified) {
      return res.status(401).json({ success: false, message: 'Código incorrecto' });
    }

    // 2FA exitoso, continuar con el flujo normal de login
    const memberships = (await loadActiveMemberships(user._id, user)).filter(m => m.organization);

    if (memberships.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'No perteneces a ninguna organización activa.'
      });
    }

    if (memberships.length === 1 && !user.isSuperAdmin) {
      const m = memberships[0];
      const token = generateToken(user._id, m.organization._id);
      const refreshToken = await generateRefreshToken(user._id, m.organization._id, req);
      
      m.lastActiveAt = new Date();
      await m.save();
      return res.json({
        success: true,
        message: 'Inicio de sesión exitoso',
        data: {
          token,
          refreshToken,
          user: user.toJSON(),
          organization: m.organization,
          membership: { role: m.role, isOwner: m.isOwner, permissions: m.permissions },
          requiresOrgSelection: false
        }
      });
    }

    // Múltiples orgs → pre-auth
    const preAuthToken = generateToken(user._id, null);
    res.json({
      success: true,
      message: 'Selecciona la organización para continuar',
      data: {
        token: preAuthToken,
        user: user.toJSON(),
        memberships: memberships.map(membershipSummary),
        requiresOrgSelection: true
      }
    });

  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// POST /setup-2fa - Iniciar configuración de 2FA (requiere estar logueado).
// Guarda el secret en `pendingTwoFactorSecret` — NO activa 2FA hasta que enable-2fa
// confirme con un código válido. Evita que un atacante con sesión activa pueda
// "secuestrar" la cuenta saltándose el paso de confirmación.
router.post('/setup-2fa', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.isTwoFactorEnabled) {
      return res.status(400).json({ success: false, message: '2FA ya está habilitado' });
    }

    const secret = speakeasy.generateSecret({ name: `GEMS Hub (${user.email})` });

    user.pendingTwoFactorSecret = secret.base32;
    await user.save();

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
    res.json({
      success: true,
      data: { secret: secret.base32, qrCode: qrCodeUrl }
    });
  } catch (error) {
    console.error('Setup 2FA error:', error);
    res.status(500).json({ success: false, message: 'Error configurando 2FA' });
  }
});

// POST /enable-2fa - Confirma configuración: valida código contra pendingTwoFactorSecret
// y solo entonces promueve a twoFactorSecret + isTwoFactorEnabled.
router.post('/enable-2fa', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Código requerido' });

    const user = await User.findById(req.user._id).select('+pendingTwoFactorSecret');
    if (!user.pendingTwoFactorSecret) {
      return res.status(400).json({ success: false, message: 'Debes ejecutar setup-2fa primero' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.pendingTwoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ success: false, message: 'Código incorrecto' });
    }

    // Promover: el secret pendiente se convierte en el confirmado.
    user.twoFactorSecret = user.pendingTwoFactorSecret;
    user.pendingTwoFactorSecret = null;
    user.isTwoFactorEnabled = true;
    await user.save();

    res.json({ success: true, message: '2FA habilitado correctamente' });
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({ success: false, message: 'Error habilitando 2FA' });
  }
});

// POST /disable-2fa - Deshabilitar 2FA (limpia ambos secrets).
router.post('/disable-2fa', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'Contraseña requerida' });

    const user = await User.findById(req.user._id);
    const isValid = await user.comparePassword(password);
    if (!isValid) return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });

    user.isTwoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.pendingTwoFactorSecret = null;
    await user.save();

    res.json({ success: true, message: '2FA deshabilitado' });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({ success: false, message: 'Error deshabilitando 2FA' });
  }
});

module.exports = router;
