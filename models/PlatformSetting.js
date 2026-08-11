const mongoose = require('mongoose');

// Configuración a nivel PLATAFORMA (no por organización) — a diferencia de
// Setting.js, que siempre requiere organizationId. Se usa hoy solo para el
// interruptor global de módulos (routes/admin.js), pero sirve para cualquier
// config futura que aplique a todos los tenants por igual.
const platformSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed
}, { timestamps: true });

module.exports = mongoose.model('PlatformSetting', platformSettingSchema);
