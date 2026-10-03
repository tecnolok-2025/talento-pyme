import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'apps/web/admin.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'apps/api/package.json'),'utf8'));
const s=api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
const e=api.indexOf('const adminCompanyCategorySchema',s);
const ctx={}; vm.createContext(ctx);
vm.runInContext(api.slice(s,e)+';globalThis.f={buildCandidateAdminClassification};',ctx);
const classify=ctx.f.buildCandidateAdminClassification;
const c=(ultimoTrabajo,experience='',summary='',education='',certifications='')=>({candidateBolsa:{ultimoTrabajo},resume:{experience,summary,education,certifications}});

test('v8.0.1 calidad actual no se convierte en IT por base de datos de mantenimiento',()=>{
  const a=classify(c('Pasante en Calidad','Octubre 2025 - Abril 2026 Pasante en Calidad. Gestión del Sistema de Gestión de Calidad. Seguimiento de CAPA, desvíos y análisis de causa raíz. Auditorías a proveedores. Julio 2024 - Mayo 2025 Pasante en Mantenimiento. Desarrollo de base de datos de mantenimiento.'));
  assert.equal(a.expertiseKey,'CALIDAD_HSE');
  assert.doesNotMatch(a.searchText,/IT \/ Software/);
});

test('v8.0.1 supervisor de línea de ensamble queda en producción y no en logística',()=>{
  const a=classify(c('Supervisor de turno','2016 - 2023 Supervisor de línea de ensamble. Supervisión de personal, cumplimiento del plan de producción y coordinación de línea. Operario de CNC y pintura.'));
  assert.equal(a.expertiseKey,'PRODUCCION');
});

test('v8.0.1 oficial de conexiones eléctricas no queda en IT por software usado',()=>{
  const a=classify(c('Oficial de Conexiones','2024 - Actualidad Oficial de Conexiones eléctricas. Instalación de medidores monofásicos y trifásicos, conexiones eléctricas y tableros.','Operario técnico y de mantenimiento.','Bachiller','Software GNAT.'));
  assert.equal(a.expertiseKey,'ELECTRICA');
  assert.doesNotMatch(a.searchText,/IT \/ Software/);
});

test('v8.0.1 portería con tareas de limpieza queda en maestranza y no vigilancia',()=>{
  const a=classify(c('Auxiliar de Portería y Maestranza','09/2018 - 01/2026 Auxiliar de Portería y Maestranza. Ejecutar limpieza y orden de aulas, sectores y comedor. Control de insumos y rotulado de elementos de limpieza.'));
  assert.equal(a.expertiseKey,'LIMPIEZA');
  assert.notEqual(a.expertiseKey,'SEGURIDAD');
});

test('v8.0.1 calibre de precisión no crea instrumentación',()=>{
  const a=classify(c('Operario de Ensamble','04/2023 - 09/2024 Operario de Ensamble de Motocicletas. Línea de ensamble continuo, torquímetros eléctricos y calibres de precisión. Control visual y calidad del producto.'));
  assert.equal(a.expertiseKey,'PRODUCCION');
  assert.ok(!a.secondaryProfiles.some(x=>x.key==='INSTRUMENTACION'));
});

test('v8.0.1 software de gestión es herramienta y no profesión IT',()=>{
  const a=classify(c('Prácticas administrativas','Agosto 2025 - Noviembre 2025 Prácticas administrativas. Análisis de solicitudes, expedientes, actualización de registros administrativos y atención de consultas.','Técnica Superior en Administración y Gestión Pública.','Técnica Superior en Administración y Gestión Pública.','Tango Gestión y Excel.'));
  assert.equal(a.expertiseKey,'ADMINISTRACION');
  assert.doesNotMatch(a.searchText,/IT \/ Software/);
});

test('v8.0.1 inbound representative se reconoce como logística',()=>{
  const a=classify(c('Representante de Envios/Inbound','Enero 2024 - Febrero 2024 REPRESENTANTE DE ENVÍOS / INBOUND REPRESENTATIVE. Uso de WMS, lectoras de códigos de barras, gestión de inventarios y procesamiento de ingresos.'));
  assert.equal(a.expertiseKey,'LOGISTICA');
});

test('v8.0.1 mantenimiento del orden no crea mantenimiento técnico',()=>{
  const a=classify(c('Emprendimiento propio','2024 - Marzo 2026 Emprendimiento gastronómico propio. Control de stock, recepción de mercadería, producción, preparación y packaging. Organización y mantenimiento del orden del depósito.'));
  assert.ok(['PRODUCCION','LOGISTICA'].includes(a.expertiseKey));
  assert.ok(!a.secondaryProfiles.some(x=>x.key==='MANTENIMIENTO'));
  assert.doesNotMatch(a.searchText,/Mantenimiento de equipos/);
});

test('v8.0.1 un secundario de confianza baja no contamina el buscador',()=>{
  const a=classify(c('Supervisor de producción','2024 - Actualidad Supervisor de producción. Línea de producción, manufactura y coordinación de equipo. 2022 - 2023 Cocinero. Preparación de alimentos y cocina.'));
  assert.equal(a.expertiseKey,'PRODUCCION');
  const secondary=a.secondaryProfiles.find(x=>x.key==='GASTRONOMIA');
  if(secondary) assert.equal(secondary.searchable,false);
  assert.doesNotMatch(a.searchText,/Gastronomía/);
});

test('v8.0.1 expone antecedente vs complementario en administración',()=>{
  assert.equal(pkg.version,'8.0.1');
  assert.match(api,/CANDIDATE_CLASSIFICATION_VERSION = '8\.0\.0'/);
  assert.match(admin,/Perfiles complementarios \/ antecedentes/);
  assert.match(admin,/antecedente/);
});

test('v8.0.1 actividad administrativa actual prevalece sobre maestranza histórica',()=>{
  const a=classify(c('', '03/2025 - Actualidad Gestionar documentación administrativa de automotores para trámites de transferencias y bajas. 09/2024 - 02/2025 Encargada y Camarera. Ejecutar tareas generales de limpieza y atención al cliente.'));
  assert.equal(a.expertiseKey,'ADMINISTRACION');
  assert.doesNotMatch(a.searchText,/Limpieza \/ Maestranza/);
});

test('v8.0.1 repositor actual prevalece sobre pasantía técnica histórica',()=>{
  const a=classify(c('Repositor','2023 - 2026 Repositor, cajero y atención al cliente. Manejo de caja, reposición y atención a clientes. 2022 - 2023 Pasante técnico en mantenimiento industrial. Mantenimiento preventivo y correctivo.'));
  assert.equal(a.expertiseKey,'COMERCIAL');
  assert.ok(!a.searchText.includes('Mantenimiento de equipos e instalaciones'));
});

test('v8.0.1 mandataria actual se clasifica en administración aunque haya producción histórica',()=>{
  const a=classify(c('', '2024 Operario de producción. Inspección visual y proceso productivo. 2023 - Actualidad Mandataria Nacional. Trámites, registros administrativos y documentación de automotores.'));
  assert.equal(a.expertiseKey,'ADMINISTRACION');
});
