const mongoose = require('mongoose');

// Dispositivo que ya pasó 2FA una vez y el usuario marcó como "confiar" —
// mientras el deviceId siga vigente, el login se salta el paso de 2FA en ese
// dispositivo. El deviceId es un secreto opaco generado por el servidor
// (como el refreshToken), no un fingerprint derivado del user-agent.
const trustedDeviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  label: {
    type: String
  },
  deviceInfo: {
    type: String
  },
  ipAddress: {
    type: String
  },
  lastUsedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, {
  timestamps: true
});

trustedDeviceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
trustedDeviceSchema.index({ user: 1 });

module.exports = mongoose.model('TrustedDevice', trustedDeviceSchema);
