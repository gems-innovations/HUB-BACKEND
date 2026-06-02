const express = require('express');
const router = express.Router();
const Role = require('../models/Role');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Middleware de autenticación para todas las rutas
router.use(authenticateToken);

// Obtener todos los roles
router.get('/', async (req, res) => {
  try {
    const roles = await Role.find({ isSystem: true }).sort({ name: 1 });
    res.json({ success: true, data: roles });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al obtener roles', error: error.message });
  }
});

// Crear un nuevo rol (perfil)
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, description, permissions } = req.body;
    
    const existingRole = await Role.findOne({ name });
    if (existingRole) {
      return res.status(400).json({ success: false, message: 'El rol ya existe' });
    }

    const newRole = new Role({
      name,
      description,
      permissions,
      isSystem: false // Roles creados por usuarios no son de sistema
    });
    
    await newRole.save();
    res.status(201).json({ success: true, data: newRole });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error al crear rol', error: error.message });
  }
});

// Actualizar un rol
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const { name, description, permissions } = req.body;
    
    const role = await Role.findById(roleId);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Rol no encontrado' });
    }
    
    // Si es sistema, maybe we don't want them to change 'name', but fine to change permissions.
    if (role.isSystem && name !== role.name) {
      return res.status(400).json({ success: false, message: 'No puedes cambiar el nombre de un rol de sistema' });
    }

    role.name = name || role.name;
    role.description = description !== undefined ? description : role.description;
    role.permissions = permissions || role.permissions;

    await role.save();
    res.json({ success: true, data: role });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error al actualizar rol', error: error.message });
  }
});

// Eliminar un rol
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) {
      return res.status(404).json({ success: false, message: 'Rol no encontrado' });
    }

    if (role.isSystem) {
      return res.status(400).json({ success: false, message: 'No se puede eliminar un rol del sistema' });
    }

    await Role.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Rol eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al eliminar rol', error: error.message });
  }
});

module.exports = router;
