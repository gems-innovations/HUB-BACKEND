const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Case = require('../models/Case');
const router = express.Router();

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '..', 'uploads');
    // Crear directorio si no existe
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generar nombre único para el archivo
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const basename = path.basename(file.originalname, extension);
    cb(null, basename + '-' + uniqueSuffix + extension);
  }
});

// Filtros de archivos permitidos
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'text/plain',
    'application/zip',
    'application/x-rar-compressed'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB máximo
  }
});

// GET - Obtener todos los casos con filtros
router.get('/', async (req, res) => {
  try {
    const { tipo, estado, prioridad, cliente_id, asignado_a, categoria, page = 1, limit = 10 } = req.query;
    
    // Construir filtros
    let filters = {};
    if (tipo) filters.tipo = tipo;
    if (estado) filters.estado = estado;
    if (prioridad) filters.prioridad = prioridad;
    if (cliente_id) filters.cliente_id = cliente_id;
    if (asignado_a) filters.asignado_a = asignado_a;
    if (categoria) filters.categoria = categoria;
    
    // Paginación
    const skip = (page - 1) * limit;
    
    const cases = await Case.find(filters)
      .populate('cliente_id', 'nombre empresa email')
      .populate('asignado_a', 'name email role')
      .populate('comentarios.autor', 'name email')
      .populate('dailyLogs.autor', 'name email avatar')
      .populate('linkedTickets', 'subject ticketNumber status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Case.countDocuments(filters);
    
    res.json({
      cases,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: total
      }
    });
  } catch (error) {
    console.error('Error fetching cases:', error);
    res.status(500).json({ error: 'Error al obtener los casos' });
  }
});

// GET - Obtener caso por ID
router.get('/:id', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id)
      .populate('cliente_id', 'nombre empresa email telefono')
      .populate('asignado_a', 'name email role avatar')
      .populate('comentarios.autor', 'name email avatar')
      .populate('dailyLogs.autor', 'name email avatar')
      .populate('linkedTickets');
    
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    res.json(case_item);
  } catch (error) {
    console.error('Error fetching case:', error);
    res.status(500).json({ error: 'Error al obtener el caso' });
  }
});

// POST - Crear nuevo caso (con archivos opcionales)
router.post('/', upload.array('archivos', 10), async (req, res) => {
  try {
    console.log('=== CASE CREATION DEBUG ===');
    console.log('Request headers:', req.headers);
    console.log('Request body:', req.body);
    console.log('Files received:', req.files);
    console.log('Body keys:', Object.keys(req.body));
    console.log('Body values:', Object.values(req.body));
    
    // Crear el caso con los datos del formulario
    const caseData = {
      titulo: req.body.titulo,
      descripcion: req.body.descripcion,
      tipo: req.body.tipo,
      estado: req.body.estado || 'abierto',
      prioridad: req.body.prioridad || 'media',
      progreso: req.body.progreso ? parseInt(req.body.progreso) : 0,
      cliente_id: req.body.cliente_id || null,
      categoria: req.body.categoria || '',
      archivos: []
    };

    // Procesar archivos si existen
    if (req.files && req.files.length > 0) {
      caseData.archivos = req.files.map(file => ({
        nombre: file.originalname,
        url: `/uploads/${file.filename}`,
        tipo: file.mimetype,
        tamaño: file.size,
        fecha_subida: new Date()
      }));
    }
    
    const newCase = new Case(caseData);
    const savedCase = await newCase.save();
    
    const populatedCase = await Case.findById(savedCase._id)
      .populate('cliente_id', 'nombre empresa email')
      .populate('asignado_a', 'name email role');
    
    res.status(201).json(populatedCase);
  } catch (error) {
    console.error('Error creating case:', error.message);
    console.error('Validation errors:', error.errors);
    res.status(400).json({ 
      error: 'Error al crear el caso', 
      details: error.message,
      validationErrors: error.errors 
    });
  }
});

// POST - Subir archivos a un caso
router.post('/:id/upload', upload.array('files', 5), async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    const uploadedFiles = req.files.map(file => ({
      nombre: file.originalname,
      url: `/uploads/${file.filename}`,
      tipo: path.extname(file.originalname).toLowerCase(),
      tamaño: file.size,
      fecha_subida: new Date()
    }));
    
    case_item.archivos.push(...uploadedFiles);
    await case_item.save();
    
    res.json({
      message: 'Archivos subidos exitosamente',
      files: uploadedFiles
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'Error al subir los archivos' });
  }
});

// DELETE - Eliminar archivo de un caso
router.delete('/:id/files/:fileIndex', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    const fileIndex = parseInt(req.params.fileIndex);
    if (fileIndex >= 0 && fileIndex < case_item.archivos.length) {
      const file = case_item.archivos[fileIndex];
      
      // Eliminar archivo físico
      const filePath = path.join(__dirname, '..', file.url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      // Eliminar de la base de datos
      case_item.archivos.splice(fileIndex, 1);
      await case_item.save();
      
      res.json({ message: 'Archivo eliminado exitosamente' });
    } else {
      res.status(404).json({ error: 'Archivo no encontrado' });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Error al eliminar el archivo' });
  }
});

// PUT - Actualizar caso (con archivos opcionales)
router.put('/:id', upload.array('archivos', 10), async (req, res) => {
  try {
    console.log('Updating case with body:', req.body);
    console.log('Files received:', req.files);
    
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    // Preparar datos de actualización
    const updateData = {
      titulo: req.body.titulo || case_item.titulo,
      descripcion: req.body.descripcion || case_item.descripcion,
      tipo: req.body.tipo || case_item.tipo,
      estado: req.body.estado || case_item.estado,
      prioridad: req.body.prioridad || case_item.prioridad,
      progreso: req.body.progreso !== undefined ? parseInt(req.body.progreso) : case_item.progreso,
      metodologia: req.body.metodologia || case_item.metodologia,
      wikiContent: req.body.wikiContent || case_item.wikiContent,
      cliente_id: req.body.cliente_id || case_item.cliente_id,
      asignado_a: req.body.asignado_a || case_item.asignado_a,
      categoria: req.body.categoria || case_item.categoria,
      gravedad: req.body.gravedad || case_item.gravedad,
      impacto: req.body.impacto || case_item.impacto,
      updatedAt: new Date()
    };

    // Manejar tags si vienen como string o array
    if (req.body.tags) {
      updateData.tags = Array.isArray(req.body.tags) ? req.body.tags : req.body.tags.split(',').map(t => t.trim());
    }

    // Si hay nuevos archivos, agregarlos a los existentes
    if (req.files && req.files.length > 0) {
      const newFiles = req.files.map(file => ({
        nombre: file.originalname,
        url: `/uploads/${file.filename}`,
        tipo: file.mimetype,
        tamaño: file.size,
        fecha_subida: new Date()
      }));
      
      updateData.archivos = [...case_item.archivos, ...newFiles];
    }
    
    const updatedCase = await Case.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('cliente_id', 'nombre empresa email')
    .populate('asignado_a', 'name email role');
    
    res.json(updatedCase);
  } catch (error) {
    console.error('Error updating case:', error.message);
    console.error('Validation errors:', error.errors);
    res.status(400).json({ 
      error: 'Error al actualizar el caso', 
      details: error.message,
      validationErrors: error.errors 
    });
  }
});

// POST - Agregar comentario a un caso
router.post('/:id/comments', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    const comment = {
      autor: req.body.autor,
      comentario: req.body.comentario,
      tipo: req.body.tipo || 'comentario',
      fecha: new Date()
    };
    
    case_item.comentarios.push(comment);
    await case_item.save();
    
    const updatedCase = await Case.findById(req.params.id)
      .populate('cliente_id', 'nombre empresa email')
      .populate('asignado_a', 'name email role avatar')
      .populate('comentarios.autor', 'name email avatar')
      .populate('dailyLogs.autor', 'name email avatar');
    
    res.json(updatedCase);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(400).json({ error: 'Error al agregar el comentario' });
  }
});

// PUT - Actualizar progreso de seguimiento
router.put('/:id/progress', async (req, res) => {
  try {
    const { progreso } = req.body;
    
    const case_item = await Case.findByIdAndUpdate(
      req.params.id,
      { progreso },
      { new: true }
    );
    
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    res.json(case_item);
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(400).json({ error: 'Error al actualizar el progreso' });
  }
});

// POST - Agregar hito a seguimiento
router.post('/:id/milestones', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    const milestone = {
      nombre: req.body.nombre,
      descripcion: req.body.descripcion,
      fecha_objetivo: req.body.fecha_objetivo,
      completado: false
    };
    
    case_item.hitos.push(milestone);
    await case_item.save();
    
    res.json(case_item);
  } catch (error) {
    console.error('Error adding milestone:', error);
    res.status(400).json({ error: 'Error al agregar el hito' });
  }
});

// PUT - Marcar hito como completado
router.put('/:id/milestones/:milestoneIndex/complete', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    const milestoneIndex = parseInt(req.params.milestoneIndex);
    if (milestoneIndex >= 0 && milestoneIndex < case_item.hitos.length) {
      case_item.hitos[milestoneIndex].completado = true;
      case_item.hitos[milestoneIndex].fecha_completado = new Date();
      await case_item.save();
      
      res.json(case_item);
    } else {
      res.status(404).json({ error: 'Hito no encontrado' });
    }
  } catch (error) {
    console.error('Error completing milestone:', error);
    res.status(400).json({ error: 'Error al completar el hito' });
  }
});

// DELETE - Eliminar caso
router.delete('/:id', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    // Eliminar archivos físicos asociados
    case_item.archivos.forEach(file => {
      const filePath = path.join(__dirname, '..', file.url);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    
    await Case.findByIdAndDelete(req.params.id);
    res.json({ message: 'Caso eliminado exitosamente' });
  } catch (error) {
    console.error('Error deleting case:', error);
    res.status(500).json({ error: 'Error al eliminar el caso' });
  }
});

// GET - Estadísticas de casos
router.get('/stats/summary', async (req, res) => {
  try {
    const stats = await Case.aggregate([
      {
        $group: {
          _id: '$tipo',
          total: { $sum: 1 },
          abiertos: {
            $sum: {
              $cond: [{ $eq: ['$estado', 'abierto'] }, 1, 0]
            }
          },
          en_progreso: {
            $sum: {
              $cond: [{ $eq: ['$estado', 'en_progreso'] }, 1, 0]
            }
          },
          resueltos: {
            $sum: {
              $cond: [{ $eq: ['$estado', 'resuelto'] }, 1, 0]
            }
          },
          cerrados: {
            $sum: {
              $cond: [{ $eq: ['$estado', 'cerrado'] }, 1, 0]
            }
          }
        }
      }
    ]);
    
    const priorities = await Case.aggregate([
      {
        $group: {
          _id: '$prioridad',
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.json({
      by_type: stats,
      by_priority: priorities
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// POST - Agregar log diario a un caso
router.post('/:id/daily-logs', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    
    const log = {
      autor: req.body.autor,
      que_se_hizo: req.body.que_se_hizo,
      bloqueos: req.body.bloqueos,
      siguientes_pasos: req.body.siguientes_pasos,
      sentimiento: req.body.sentimiento || '😐',
      fecha: new Date()
    };
    
    if (!case_item.dailyLogs) case_item.dailyLogs = [];
    case_item.dailyLogs.unshift(log); // Lo más nuevo arriba
    await case_item.save();
    
    const updatedCase = await Case.findById(req.params.id)
      .populate('cliente_id', 'nombre empresa email')
      .populate('asignado_a', 'name email role avatar')
      .populate('comentarios.autor', 'name email avatar')
      .populate('dailyLogs.autor', 'name email avatar');
    
    res.json(updatedCase);
  } catch (error) {
    console.error('Error adding daily log:', error);
    res.status(400).json({ error: 'Error al agregar el seguimiento diario' });
  }
});

// POST - Vincular ticket a un caso
router.post('/:id/tickets', async (req, res) => {
  try {
    const { ticketId } = req.body;
    const case_item = await Case.findById(req.params.id);
    
    if (!case_item) return res.status(404).json({ error: 'Caso no encontrado' });
    
    if (!case_item.linkedTickets.includes(ticketId)) {
      case_item.linkedTickets.push(ticketId);
      await case_item.save();
    }
    
    const populated = await Case.findById(case_item._id)
      .populate('cliente_id', 'nombre empresa email')
      .populate('asignado_a', 'name email role avatar')
      .populate('comentarios.autor', 'name email avatar')
      .populate('dailyLogs.autor', 'name email avatar')
      .populate('linkedTickets');
      
    res.json(populated);
  } catch (error) {
    res.status(400).json({ error: 'Error al vincular ticket' });
  }
});

// DELETE - Desvincular ticket de un caso
router.delete('/:id/tickets/:ticketId', async (req, res) => {
  try {
    const case_item = await Case.findById(req.params.id);
    if (!case_item) return res.status(404).json({ error: 'Caso no encontrado' });
    
    case_item.linkedTickets = case_item.linkedTickets.filter(id => id.toString() !== req.params.ticketId);
    await case_item.save();
    
    const populated = await Case.findById(case_item._id)
      .populate('cliente_id', 'nombre empresa email')
      .populate('asignado_a', 'name email role avatar')
      .populate('comentarios.autor', 'name email avatar')
      .populate('dailyLogs.autor', 'name email avatar')
      .populate('linkedTickets');
      
    res.json(populated);
  } catch (error) {
    res.status(400).json({ error: 'Error al desvincular ticket' });
  }
});

module.exports = router;
