const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'pending', 'archived'],
    default: 'active',
    index: true
  },
  plan: {
    type: String,
    enum: ['free', 'free_trial', 'starter', 'pro', 'enterprise'],
    default: 'free'
  },
  trialExpiresAt: {
    type: Date,
    default: null
  },
  // Si se llena, queries de esta org deben enrutar a una conexión Mongo dedicada.
  // Por ahora todas usan la conexión por defecto (shared DB con organizationId scoping).
  dbConnection: {
    uri: { type: String, default: null },
    dbName: { type: String, default: null },
    migratedAt: { type: Date, default: null }
  },
  branding: {
    displayName: { type: String, default: null },
    logo: { type: String, default: null },
    primaryColor: { type: String, default: '#8b5cf6' },
    accentColor: { type: String, default: '#8b5cf6' },
    darkMode: { type: Boolean, default: false }
  },
  contact: {
    email: { type: String, default: null },
    phone: { type: String, default: null },
    country: { type: String, default: null }
  },
  limits: {
    maxUsers:     { type: Number, default: 0 }, // 0 = ilimitado
    maxTasks:     { type: Number, default: 0 }, // 0 = ilimitado
    maxStorageMb: { type: Number, default: 0 }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

organizationSchema.methods.usesDedicatedDb = function() {
  return !!(this.dbConnection && this.dbConnection.uri);
};

module.exports = mongoose.model('Organization', organizationSchema);
