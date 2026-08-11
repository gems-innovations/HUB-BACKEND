const mongoose = require('mongoose');

const superAdminAuditSchema = new mongoose.Schema({
  superAdminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    // Las acciones de grant/revoke super-admin no son sobre una org, son de plataforma.
    required: false,
    index: true,
    default: null
  },
  // Para grant/revoke: el usuario afectado
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  action: {
    type: String,
    required: true,
    enum: [
      'login_as_superadmin',
      'org_create',
      'org_update',
      'org_archive',
      'superadmin_grant',
      'superadmin_revoke',
      'modules_update',
      'other_action'
    ],
    default: 'login_as_superadmin'
  },
  // Detalles libres: changes para updates, payload original, etc.
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
}, {
  timestamps: true // Esto agrega createdAt y updatedAt automáticamente
});

// Índice compuesto para buscar rápidamente por admin y org, o ordenar por fecha
superAdminAuditSchema.index({ superAdminId: 1, createdAt: -1 });
superAdminAuditSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model('SuperAdminAudit', superAdminAuditSchema);
