import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const api=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ctx={};vm.createContext(ctx);
vm.runInContext(api.slice(api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS'),api.indexOf('const adminCompanyCategorySchema'))+';globalThis.f={buildCandidateAdminClassification,candidateEvidenceYears};',ctx);
const {buildCandidateAdminClassification:classify,candidateEvidenceYears:years}=ctx.f;
const candidate=(b={},r={})=>({candidateBolsa:b,resume:r});

test('v8.0.1 reconoce atención al cliente y caja como experiencia comercial sin inventar antigüedad',()=>{
  const a=classify(candidate({}, {experience:'EXPERIENCIA LABORAL Atención al cliente. Manejo de caja. Cobros y control de stock.'}));
  assert.equal(a.expertiseKey,'COMERCIAL');
  assert.equal(a.classKey,'OPERATIVO');
  assert.equal(a.seniorityKey,'NO_DETERMINADO');
});

test('v8.0.1 reconoce seguridad privada sin confundirla con HSE',()=>{
  const a=classify(candidate({}, {experience:'Vigiladora general. Control de acceso y rondas de vigilancia.'}));
  assert.equal(a.expertiseKey,'SEGURIDAD');
  assert.equal(a.classKey,'OPERATIVO');
});

test('v8.0.1 reconoce limpieza y maestranza como oficio propio',()=>{
  const a=classify(candidate({}, {experience:'Personal de limpieza. Limpieza y orden de los espacios de trabajo.'}));
  assert.equal(a.expertiseKey,'LIMPIEZA');
});

test('v8.0.1 reconoce gastronomía sin derivarla a comercial por atención al público',()=>{
  const a=classify(candidate({}, {experience:'Moza en restaurante. Servicio en salón, toma de pedidos y atención a clientes.'}));
  assert.equal(a.expertiseKey,'GASTRONOMIA');
});

test('v8.0.1 reconoce atención sanitaria y emergencias',()=>{
  const a=classify(candidate({}, {experience:'Técnica en Emergencias Sanitarias. Atención prehospitalaria, triage y operación de móvil del sistema 107.'}));
  assert.equal(a.expertiseKey,'SALUD');
  assert.equal(a.classKey,'TECNICO');
});

test('v8.0.1 reconoce tesorería y cuentas a pagar como finanzas',()=>{
  const a=classify(candidate({}, {experience:'Pasantía en el área de tesorería. Operaciones bancarias, pagos y registración contable.'}));
  assert.equal(a.expertiseKey,'FINANZAS');
});

test('v8.0.1 reconoce project manager como proyectos sin convertir el título en seniority',()=>{
  const a=classify(candidate({ultimoTrabajo:'PROJECT MANAGER'}, {}));
  assert.equal(a.expertiseKey,'PROYECTOS');
  assert.equal(a.profileScore,15);
  assert.equal(a.seniorityKey,'NO_DETERMINADO');
});

test('v8.0.1 reconoce inspector de obras como construcción',()=>{
  const a=classify(candidate({ultimoTrabajo:'Inspector de obras'}, {}));
  assert.equal(a.expertiseKey,'CONSTRUCCION');
});

test('v8.0.1 reconoce operaria en automatización sin usar el área deseada',()=>{
  const a=classify(candidate({ultimoTrabajo:'Operaria en automatización',areaTrabajo:'Logística'}, {}));
  assert.equal(a.expertiseKey,'INSTRUMENTACION');
});

test('v8.0.1 reconoce logística por distribución y paquetería',()=>{
  const a=classify(candidate({}, {experience:'Experiencia en recepción y coordinación de vehículos, distribución y seguimiento de paquetería.'}));
  assert.equal(a.expertiseKey,'LOGISTICA');
});

test('v8.0.1 reconoce mantenimiento de computadoras desde relato original',()=>{
  const a=classify(candidate({voiceNarrativeRaw:'Trabajé realizando mantenimiento de computadoras y soporte a usuarios.'}, {}));
  assert.equal(a.expertiseKey,'IT');
});

test('v8.0.1 reconoce docencia como experiencia propia y no como IT por materia dictada',()=>{
  const a=classify(candidate({ultimoTrabajo:'Profesora de informática'}, {}));
  assert.equal(a.expertiseKey,'EDUCACION');
  assert.equal(a.classKey,'PROFESIONAL');
});

test('v8.0.1 conserva trayectoria cuando hay empleadores y fechas pero no tareas suficientes',()=>{
  const a=classify(candidate({}, {experience:'EXPERIENCIA LABORAL Empresa Industrial 2023 - 2024. Empresa de Servicios 2025 - Actualidad.'}));
  assert.equal(a.classKey,'TRAYECTORIA');
  assert.equal(a.expertiseKey,'GENERAL');
  assert.equal(a.profileScore,null);
});

test('v8.0.1 no convierte aspiración ni texto generado en trayectoria',()=>{
  const a=classify(candidate({}, {experience:'CV generado con Talento PyME. Busco una primera oportunidad para adquirir experiencia y desarrollarme dentro de una empresa.'}));
  assert.equal(a.classKey,'APRENDIZ');
  assert.equal(a.expertiseKey,'GENERAL');
});

test('v8.0.1 mantiene primer empleo aunque haya fechas escolares',()=>{
  const a=classify(candidate({}, {experience:'SIN EXPERIENCIA LABORAL FORMAL. Escuela técnica 2018-2022. Busco mi primer empleo.'}));
  assert.equal(a.classKey,'APRENDIZ');
  assert.equal(a.profileScore,10);
});

test('v8.0.1 supervisor declarado puede ser clase supervisión sin seniority inventado',()=>{
  const a=classify(candidate({ultimoTrabajo:'Supervisor'}, {}));
  assert.equal(a.classKey,'SUPERVISION');
  assert.equal(a.seniorityKey,'NO_DETERMINADO');
  assert.equal(a.profileScore,null);
});

test('v8.0.1 gerente declarado puede ser clase gerencial sin seniority inventado',()=>{
  const a=classify(candidate({ultimoTrabajo:'Gerente de Procesos'}, {}));
  assert.equal(a.classKey,'GERENCIAL');
  assert.equal(a.seniorityKey,'NO_DETERMINADO');
  assert.equal(a.profileScore,null);
});

test('v8.0.1 un nombre de empresa aislado no acredita oficio ni trayectoria',()=>{
  const a=classify(candidate({ultimoTrabajo:'Empresa X'}, {}));
  assert.equal(a.classKey,'APRENDIZ');
  assert.equal(a.expertiseKey,'GENERAL');
});

test('v8.0.1 asistente administrativo conserva familia administrativa',()=>{
  const a=classify(candidate({ultimoTrabajo:'Asistente administrativo'}, {experience:'2024-2026 Asistente administrativo. Facturación y archivo.'}));
  assert.equal(a.expertiseKey,'ADMINISTRACION');
  assert.equal(a.classKey,'ADMINISTRATIVO');
  assert.match(a.seniorityLabel,/asistencia|provisional/);
});

test('v8.0.1 ignora una fecha educativa anterior al bloque de experiencia y usa fechas laborales completas',()=>{
  const y=years(['Escuela secundaria 2004 - 2024. EXPERIENCIA LABORAL Taller mecánico 10/01/2025 - 05/06/2025. Taller industrial 13/06/2025 - 22/02/2026.']);
  assert.ok(y.years>=1 && y.years<2,`años esperados entre 1 y 2, recibido ${y.years}`);
});

test('v8.0.1 interpreta meses en español y actualidad',()=>{
  const y=years(['Vendedor Noviembre 2022 - Actualidad'],new Date('2026-09-27'));
  assert.ok(y.years>=3.7 && y.years<=4,`años esperados ~3.8, recibido ${y.years}`);
});
