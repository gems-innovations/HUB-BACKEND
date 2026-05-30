const mongoose = require('mongoose');
const User = require('../models/User');
const Client = require('../models/Client');
const Ticket = require('../models/Ticket');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: '.env' });

// Native fetch is available in Node 18+
const API_URL = 'http://localhost:8000/api';

async function runQA() {
  console.log('🚀 Iniciando Auditoría QA de GEMS Hub Backend...');
  let passed = 0;
  let failed = 0;
  let jwtToken = '';

  const testUser = {
    name: 'QA Bot',
    email: 'qa_bot@gemshub.test',
    password: 'Password123!',
    role: 'admin'
  };

  const testClient = {
    name: 'Cliente QA Test',
    email: 'cliente_qa@test.com',
    phone: '1234567890'
  };

  try {
    // 1. Conexión a Base de Datos de Prueba (o real para borrar al final)
    console.log('🔄 Conectando a MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Conexión Exitosa a MongoDB');

    // Limpiar restos de QA anteriores
    await User.deleteMany({ email: testUser.email });
    await Client.deleteMany({ email: testClient.email });

    // 2. Probar Crear Usuario y Login
    console.log('\n--- 🧪 TEST: Autenticación ---');
    const hashedPassword = await bcrypt.hash(testUser.password, 10);
    const userDoc = new User({ ...testUser, password: hashedPassword });
    await userDoc.save();
    console.log('✅ Usuario QA creado manualmente en BD.');

    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password })
    });
    const loginData = await loginRes.json();
    
    if (loginRes.ok && loginData.token) {
      console.log('✅ Login Exitoso. Token JWT recibido.');
      jwtToken = loginData.token;
      passed++;
    } else {
      console.error('❌ Falló el Login:', loginData);
      failed++;
    }

    // 3. Probar Clientes (CRUD)
    console.log('\n--- 🧪 TEST: Módulo de Clientes ---');
    const clientRes = await fetch(`${API_URL}/clients`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify(testClient)
    });
    
    let clientId = null;
    if (clientRes.ok) {
      const clientData = await clientRes.json();
      console.log('✅ Cliente creado vía API HTTP.');
      clientId = clientData._id || clientData.client?._id;
      passed++;
    } else {
      console.error('❌ Falló crear cliente:', await clientRes.text());
      failed++;
    }

    // 4. Probar Tickets / Casos
    console.log('\n--- 🧪 TEST: Módulo de Casos (Tickets) ---');
    if (clientId) {
      const ticketRes = await fetch(`${API_URL}/tickets`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          client: clientId,
          title: 'Ticket QA de Prueba',
          description: 'Probando el sistema automáticamente.',
          priority: 'high',
          status: 'new'
        })
      });
      
      if (ticketRes.ok) {
        console.log('✅ Ticket (Caso) creado vía API HTTP.');
        passed++;
      } else {
        console.error('❌ Falló crear Ticket:', await ticketRes.text());
        failed++;
      }
    } else {
      console.log('⚠️ Saltando test de tickets por fallo en clientes.');
    }

    // 5. Probar estado de WhatsApp
    console.log('\n--- 🧪 TEST: Módulo de WhatsApp (Integración Baileys) ---');
    const wppRes = await fetch(`${API_URL}/whatsapp/status`);
    if (wppRes.ok) {
      const wppData = await wppRes.json();
      console.log(`✅ WhatsApp Endpoint vivo. Estado actual: ${wppData.ready ? 'Vinculado' : 'No Vinculado'}`);
      passed++;
    } else {
      console.error('❌ Falló consultar estado de WhatsApp:', await wppRes.text());
      failed++;
    }

  } catch (err) {
    console.error('❌ Error general durante la auditoría:', err);
    failed++;
  } finally {
    // 6. Limpiar Basura
    console.log('\n🧹 Limpiando base de datos de pruebas...');
    await User.deleteMany({ email: testUser.email });
    await Client.deleteMany({ email: testClient.email });
    // Borrar el ticket creado
    await Ticket.deleteMany({ title: 'Ticket QA de Prueba' });
    console.log('✅ Limpieza completada.');

    mongoose.connection.close();
    
    console.log('\n📊 --- RESULTADOS DE AUDITORÍA ---');
    console.log(`Tests Pasados: ${passed}`);
    console.log(`Tests Fallados: ${failed}`);
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runQA();
