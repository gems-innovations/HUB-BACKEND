const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  title: { type: String, required: true },
  description: String,
  date: Date,
  status: { 
    type: String, 
    enum: ['pending', 'in-progress', 'completed', 'cancelled', 'overdue'], 
    default: 'pending' 
  },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Referencia a múltiples miembros del equipo
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'urgent'], 
    default: 'medium' 
  },
  dueDate: { type: Date },
  estimatedTime: { type: String }, // Ej: "2 horas", "30 minutos"
  taskId: { type: String }, // ✅ ID de la tarea del board asociada (para sincronización)
  completionPercentage: { type: Number, default: 0, min: 0, max: 100 },
  timeSpent: { type: Number, default: 0 }, // En segundos
  activeSessions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startTime: { type: Date, default: Date.now }
  }],
  comments: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
    images: [{ url: String, name: String }],
    createdAt: { type: Date, default: Date.now }
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Quien creó la actividad
  // Historial de cambios de campo — mismo patrón ya usado en Task.js, para
  // que quede registro de quién cambió qué (fechas, asignado, prioridad, etc.)
  history: [{
    field: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Middleware para actualizar updatedAt en cada modificación
ActivitySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

ActivitySchema.methods.logChange = function(field, oldValue, newValue, userId) {
  this.history.push({ field, oldValue, newValue, changedBy: userId });
};

module.exports = mongoose.model('Activity', ActivitySchema);
