const mongoose = require('mongoose');

const ticketCommentSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isInternal: {
    type: Boolean,
    default: false
  },
  attachments: [String]
}, {
  timestamps: true
});

const ticketSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  ticketNumber: {
    type: String
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['technical', 'billing', 'sales', 'other'],
    default: 'technical'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['new', 'open', 'waiting', 'resolved', 'closed'],
    default: 'new'
  },
  submittedBy: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    clientId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Client' 
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  tags: [String],
  attachments: [String],
  comments: [ticketCommentSchema],
  // Recursos vinculados desde el panel de detalle (agentes) — casos y artículos
  // de wiki relacionados al problema reportado.
  linkedCases: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Case' }],
  linkedWikiArticles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Wiki' }],
  resolvedAt: {
    type: Date
  },
  slaNotified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// ticketNumber es único dentro de cada organización (no global)
ticketSchema.index({ organizationId: 1, ticketNumber: 1 }, { unique: true });

// Middleware to generate ticket number before saving (per-organization sequence)
ticketSchema.pre('save', async function(next) {
  if (this.isNew && !this.ticketNumber) {
    try {
      const lastTicket = await this.constructor
        .findOne({ organizationId: this.organizationId }, {}, { sort: { createdAt: -1 } });
      let nextNumber = 1;
      if (lastTicket && lastTicket.ticketNumber) {
        const lastNumberMatch = lastTicket.ticketNumber.match(/TK-(\d+)/);
        if (lastNumberMatch) {
          nextNumber = parseInt(lastNumberMatch[1]) + 1;
        }
      }
      this.ticketNumber = `TK-${nextNumber.toString().padStart(4, '0')}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

module.exports = mongoose.model('Ticket', ticketSchema);
