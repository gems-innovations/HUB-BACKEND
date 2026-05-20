const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  // Información básica
  title: { 
    type: String, 
    required: true,
    trim: true
  },
  description: { 
    type: String,
    default: ''
  },
  
  // Tipo de tarea (jerarquía Scrum completa)
  type: { 
    type: String, 
    enum: ['epic', 'feature', 'user-story', 'task', 'bug', 'subtask'],
    default: 'task'
  },
  
  // Estado (workflow)
  status: { 
    type: String, 
    enum: ['new', 'active', 'resolved', 'closed', 'removed'],
    default: 'new'
  },
  
  // Estado del board Kanban
  boardStatus: {
    type: String,
    enum: ['backlog', 'todo', 'in-progress', 'review', 'testing', 'done'],
    default: 'backlog'
  },
  
  // Prioridad
  priority: { 
    type: String, 
    enum: ['critical', 'high', 'medium', 'low'],
    default: 'medium'
  },
  
  // Asignación
  assignedTo: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  
  // Creador y propietario
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  
  // Tablero al que pertenece
  boardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Board',
    default: null
  },
  
  // Relaciones jerárquicas Scrum
  parentTask: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Task',
    default: null
  },
  epicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    default: null
  },
  featureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    default: null
  },
  userStoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    default: null
  },
  blockedBy: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Task'
  }],
  relatedTasks: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Task'
  }],
  
  // Estimación y seguimiento
  estimatedHours: { 
    type: Number,
    default: 0
  },
  actualHours: { 
    type: Number,
    default: 0
  },
  remainingHours: {
    type: Number,
    default: 0
  },
  completionPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Sesiones de tiempo en vivo (Timer activo)
  activeSessions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startTime: { type: Date, default: Date.now }
  }],
  
  // Registro histórico de tiempos
  timeLogs: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startTime: Date,
    endTime: Date,
    durationHours: Number,
    notes: String
  }],
  
  // Fechas
  startDate: { 
    type: Date,
    default: null
  },
  dueDate: { 
    type: Date,
    default: null
  },
  completedDate: {
    type: Date,
    default: null
  },
  
  // Etiquetas y categorías
  tags: [{ 
    type: String,
    trim: true
  }],
  labels: [{
    name: String,
    color: String
  }],
  
  // Sprint/Iteración
  sprint: {
    id: String,
    name: String,
    startDate: Date,
    endDate: Date
  },
  
  // Integración con GitHub
  github: {
    repoOwner: String,
    repoName: String,
    branch: String,
    branchUrl: String,
    pullRequest: {
      number: Number,
      url: String,
      status: String,
      mergedAt: Date
    },
    commits: [{
      sha: String,
      message: String,
      author: String,
      date: Date,
      url: String
    }],
    lastSync: Date
  },
  
  // Cliente relacionado (opcional)
  clientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Client',
    default: null
  },
  
  // Comentarios y actividad
  comments: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    text: String,
    images: [{ url: String, name: String }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Adjuntos
  attachments: [{
    name: String,
    url: String,
    type: String,
    size: Number,
    uploadedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User'
    },
    uploadedAt: { 
      type: Date, 
      default: Date.now 
    }
  }],
  
  // Criterios de aceptación (para user stories)
  acceptanceCriteria: [{
    description: String,
    completed: { 
      type: Boolean, 
      default: false 
    }
  }],
  
  // Historial de cambios
  history: [{
    field: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
    changedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User'
    },
    changedAt: { 
      type: Date, 
      default: Date.now 
    }
  }],
  
  // Metadatos
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Índices para mejorar rendimiento
TaskSchema.index({ status: 1, boardStatus: 1 });
TaskSchema.index({ assignedTo: 1 });
TaskSchema.index({ createdBy: 1 });
TaskSchema.index({ boardId: 1 });
TaskSchema.index({ 'github.branch': 1 });
TaskSchema.index({ 'sprint.id': 1 });
TaskSchema.index({ tags: 1 });
TaskSchema.index({ priority: 1, dueDate: 1 });

// Middleware para actualizar updatedAt y calcular remaining hours
TaskSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Calcular horas restantes
  if (this.estimatedHours && this.actualHours) {
    this.remainingHours = Math.max(0, this.estimatedHours - this.actualHours);
  }
  
  // Calcular porcentaje de completitud basado en horas (solo si no se ingresó manualmente)
  if (this.isModified('actualHours') && !this.isModified('completionPercentage') && this.estimatedHours > 0) {
    this.completionPercentage = Math.min(100, Math.round((this.actualHours / this.estimatedHours) * 100));
  }
  
  // Marcar fecha de completitud si cambia a done
  if (this.boardStatus === 'done' && !this.completedDate) {
    this.completedDate = new Date();
  }
  
  next();
});

// Métodos de instancia
TaskSchema.methods.addComment = function(userId, text, images = []) {
  this.comments.push({ userId, text, images });
  return this.save();
};

TaskSchema.methods.addAttachment = function(attachmentData) {
  this.attachments.push(attachmentData);
  return this.save();
};

TaskSchema.methods.updateGitHubInfo = function(githubData) {
  this.github = { ...this.github.toObject(), ...githubData, lastSync: new Date() };
  return this.save();
};

TaskSchema.methods.logChange = function(field, oldValue, newValue, userId) {
  this.history.push({
    field,
    oldValue,
    newValue,
    changedBy: userId
  });
};

// Métodos estáticos
TaskSchema.statics.findByBoard = function(boardStatus) {
  return this.find({ boardStatus })
    .populate('assignedTo', 'name email photo')
    .populate('createdBy', 'name email')
    .sort({ priority: -1, updatedAt: -1 });
};

TaskSchema.statics.findBySprint = function(sprintId) {
  return this.find({ 'sprint.id': sprintId })
    .populate('assignedTo', 'name email photo')
    .populate('createdBy', 'name email')
    .sort({ boardStatus: 1, priority: -1 });
};

TaskSchema.statics.findByGitHubBranch = function(branch) {
  return this.findOne({ 'github.branch': branch })
    .populate('assignedTo', 'name email photo')
    .populate('createdBy', 'name email');
};

module.exports = mongoose.model('Task', TaskSchema);
