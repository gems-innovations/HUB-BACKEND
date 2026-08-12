const express = require('express');
const router = express.Router();
const Board = require('../models/Board');
const Task = require('../models/Task');
const { authenticateToken } = require('../middleware/auth');

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// ==================== BOARDS ====================

// Obtener todos los boards del usuario
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    
    const boards = await Board.findByUser(userId)
      .populate('members.userId', 'name email photo role')
      .populate('client', 'name company email phone');
    
    res.json(boards);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener board por ID
router.get('/:id', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId })
      .populate('createdBy', 'name email photo')
      .populate('members.userId', 'name email photo role')
      .populate('client', 'name company email phone');
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    res.json(board);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener board con todas sus tareas
router.get('/:id/full', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId })
      .populate('createdBy', 'name email photo')
      .populate('members.userId', 'name email photo role');
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    // Obtener todas las tareas del board (filtrar por algún criterio si es necesario)
    // Por ahora, asumimos que las tareas se relacionan por algún campo
    // Esto puede mejorarse según tu lógica de negocio
    
    res.json(board);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar board por repo de GitHub
router.get('/github/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    
    const board = await Board.findByGitHubRepo(owner, repo)
      .populate('createdBy', 'name email photo')
      .populate('members.userId', 'name email photo role');
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado para este repositorio' });
    }
    
    res.json(board);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear nuevo board
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    
    // Columnas por defecto para Kanban
    const defaultColumns = [
      { id: '1', name: 'Backlog', order: 1, mappedStatus: 'backlog', color: '#gray' },
      { id: '2', name: 'To Do', order: 2, mappedStatus: 'todo', color: '#blue' },
      { id: '3', name: 'In Progress', order: 3, mappedStatus: 'in-progress', color: '#yellow', wipLimit: 3 },
      { id: '4', name: 'Review', order: 4, mappedStatus: 'review', color: '#purple' },
      { id: '5', name: 'Testing', order: 5, mappedStatus: 'testing', color: '#orange' },
      { id: '6', name: 'Done', order: 6, mappedStatus: 'done', color: '#green' }
    ];
    
    const boardData = {
      ...req.body,
      createdBy: userId,
      columns: req.body.columns || defaultColumns,
      members: [{ userId, role: 'owner' }]
    };
    
    const board = new Board(boardData);
    await board.save();
    
    await board.populate('createdBy', 'name email photo');
    await board.populate('members.userId', 'name email photo role');
    await board.populate('client', 'name company email phone');
    
    res.status(201).json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar board
router.put('/:id', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    // Verificar permisos (solo owner o admin pueden editar)
    const userId = req.user.id || req.user._id;
    const member = board.members.find(m => m.userId.toString() === userId.toString());
    
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return res.status(403).json({ error: 'No tienes permisos para editar este board' });
    }
    
    Object.assign(board, req.body);
    await board.save();
    
    await board.populate('createdBy', 'name email photo');
    await board.populate('members.userId', 'name email photo role');
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Agregar miembro al board
router.post('/:id/members', async (req, res) => {
  try {
    const { userId, role } = req.body;
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    await board.addMember(userId, role);
    await board.populate('members.userId', 'name email photo role');
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Remover miembro del board
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    await board.removeMember(req.params.userId);
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Agregar columna al board
router.post('/:id/columns', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    await board.addColumn(req.body);
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reordenar columnas
router.put('/:id/columns/reorder', async (req, res) => {
  try {
    const { columns } = req.body;
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    board.columns = columns;
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== SPRINTS ====================

// Crear sprint
router.post('/:id/sprints', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    if (board.type !== 'scrum') {
      return res.status(400).json({ error: 'Solo los boards Scrum pueden tener sprints' });
    }
    
    await board.createSprint(req.body);
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Obtener sprint activo
router.get('/:id/sprints/active', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    const activeSprint = board.getActiveSprint();
    
    if (!activeSprint) {
      return res.status(404).json({ error: 'No hay sprint activo' });
    }
    
    // Obtener tareas del sprint
    const tasks = await Task.findBySprint(activeSprint.id, req.organizationId);
    
    res.json({
      sprint: activeSprint,
      tasks
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Activar sprint
router.patch('/:id/sprints/:sprintId/activate', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    // Desactivar otros sprints activos
    board.sprints.forEach(s => {
      if (s.status === 'active') {
        s.status = 'completed';
      }
    });
    
    // Activar el sprint seleccionado (buscar por id o _id)
    const sprint = board.sprints.find(s => 
      (s.id && s.id === req.params.sprintId) || 
      (s._id && s._id.toString() === req.params.sprintId)
    );
    
    if (sprint) {
      sprint.status = 'active';
    } else {
      return res.status(404).json({ error: 'Sprint no encontrado' });
    }
    
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Completar sprint
router.patch('/:id/sprints/:sprintId/complete', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    const sprint = board.sprints.find(s => 
      (s.id && s.id === req.params.sprintId) || 
      (s._id && s._id.toString() === req.params.sprintId)
    );
    
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint no encontrado' });
    }
    
    sprint.status = 'completed';
    
    // Calcular métricas del sprint
    const sprintTasks = await Task.find({ 'sprint.id': req.params.sprintId });
    sprint.taskCount = sprintTasks.length;
    sprint.completedTaskCount = sprintTasks.filter(t => t.boardStatus === 'done').length;
    sprint.velocity = sprintTasks
      .filter(t => t.boardStatus === 'done')
      .reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
    
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar sprint
router.patch('/:id/sprints/:sprintId', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    const sprint = board.sprints.find(s => 
      (s.id && s.id === req.params.sprintId) || 
      (s._id && s._id.toString() === req.params.sprintId)
    );
    
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint no encontrado' });
    }
    
    // Actualizar campos permitidos
    if (req.body.name) sprint.name = req.body.name;
    if (req.body.goal) sprint.goal = req.body.goal;
    if (req.body.startDate) sprint.startDate = req.body.startDate;
    if (req.body.endDate) sprint.endDate = req.body.endDate;
    if (req.body.status) sprint.status = req.body.status;
    
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Eliminar sprint
router.delete('/:id/sprints/:sprintId', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    const sprintIndex = board.sprints.findIndex(s => 
      (s.id && s.id === req.params.sprintId) || 
      (s._id && s._id.toString() === req.params.sprintId)
    );
    
    if (sprintIndex === -1) {
      return res.status(404).json({ error: 'Sprint no encontrado' });
    }
    
    const sprint = board.sprints[sprintIndex];
    
    // No permitir eliminar sprints activos
    if (sprint.status === 'active') {
      return res.status(400).json({ error: 'No se puede eliminar un sprint activo. Primero compĺetalo o desactívalo.' });
    }
    
    // Eliminar el sprint
    board.sprints.splice(sprintIndex, 1);
    
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== GITHUB ====================

// Conectar board con GitHub
router.post('/:id/github/connect', async (req, res) => {
  try {
    const { repoOwner, repoName, defaultBranch } = req.body;
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    board.github = {
      connected: true,
      repoOwner,
      repoName,
      defaultBranch: defaultBranch || 'main',
      lastSync: new Date()
    };
    
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Desconectar board de GitHub
router.post('/:id/github/disconnect', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    board.github.connected = false;
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Archivar board
router.patch('/:id/archive', async (req, res) => {
  try {
    const board = await Board.findOne({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    board.isArchived = true;
    board.isActive = false;
    await board.save();
    
    res.json(board);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Eliminar board
router.delete('/:id', async (req, res) => {
  try {
    const board = await Board.findOneAndDelete({ _id: req.params.id, organizationId: req.organizationId });
    
    if (!board) {
      return res.status(404).json({ error: 'Board no encontrado' });
    }
    
    res.json({ message: 'Board eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
