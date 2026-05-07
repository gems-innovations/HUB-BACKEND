const mongoose = require('mongoose');

const wikiSchema = new mongoose.Schema({
  titulo: {
    type: String,
    required: true,
    trim: true
  },
  categoria: {
    type: String,
    enum: ['proceso', 'codigo', 'manual', 'otros'],
    default: 'proceso'
  },
  contenido: {
    type: String,
    required: true
  },
  descripcion: {
    type: String,
    trim: true
  },
  tags: [String],
  autor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  archivos: [{
    nombre: String,
    url: String,
    tipo: String
  }],
  vistas: {
    type: Number,
    default: 0
  },
  linkedTickets: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket'
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Wiki', wikiSchema);
