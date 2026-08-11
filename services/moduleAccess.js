const PlatformSetting = require('../models/PlatformSetting');
const Organization = require('../models/Organization');

// Módulos "apagables" — deben coincidir con los ids usados en
// stores/auth.ts::getAvailableModules() del frontend. Dashboard, Clientes,
// Perfil y las pantallas de super-admin son núcleo y nunca se incluyen aquí.
const TOGGLEABLE_MODULES = [
  'prospects', 'activities', 'reports', 'tickets', 'cases', 'wiki', 'team'
];

// Todo módulo empieza habilitado por defecto (fail-open) — sólo se oculta si
// alguien lo apaga explícitamente, global o por organización.
function defaultModuleMap() {
  return Object.fromEntries(TOGGLEABLE_MODULES.map(m => [m, true]));
}

async function getGlobalModuleToggles() {
  const setting = await PlatformSetting.findOne({ key: 'moduleToggles' }).lean();
  return { ...defaultModuleMap(), ...(setting?.value || {}) };
}

// Resuelve el mapa efectivo para UNA organización: global, con las
// excepciones puntuales de esa org (Organization.moduleOverrides) por encima.
async function getEffectiveModules(organizationId) {
  const [globalMap, org] = await Promise.all([
    getGlobalModuleToggles(),
    Organization.findById(organizationId).select('moduleOverrides').lean()
  ]);
  const overrides = org?.moduleOverrides || {};
  const effective = {};
  for (const m of TOGGLEABLE_MODULES) {
    effective[m] = overrides[m] !== undefined ? !!overrides[m] : !!globalMap[m];
  }
  return effective;
}

module.exports = { TOGGLEABLE_MODULES, defaultModuleMap, getGlobalModuleToggles, getEffectiveModules };
