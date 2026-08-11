import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const api = fs.readFileSync(path.join(root, 'apps/api/src/index.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'apps/web/admin.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'apps/web/config.js'), 'utf8');

function functionBlock(name, nextName){
  const s = api.indexOf(`function ${name}`);
  const e = nextName ? api.indexOf(`function ${nextName}`, s + 1) : s + 8000;
  return api.slice(s, e > s ? e : s + 8000);
}

test('v7.9.15 reserva aprendiz para evidencia explícita y agrega perfil inicial neutral', () => {
  assert.match(api, /APRENDIZ:\s*'Aprendices \/ Pasantes \/ Primer empleo'/);
  assert.match(api, /GERENCIAL:\s*'Gerencia \/ Dirección'/);
  assert.doesNotMatch(api, /PENDIENTE:\s*'Pendientes de clasificar'/);
  assert.match(api, /INICIAL:\s*'Información profesional por completar'/);
  assert.match(api, /No se presume que sea aprendiz, pasante ni primer empleo/);
});

test('expertise puede crear subcategoría dinámica cuando no coincide con catálogo', () => {
  assert.match(api, /adminDynamicKey\('EXP', label\)/);
  assert.match(api, /source:'DINAMICA'/);
  assert.match(api, /expertiseMap = new Map\(\)/);
});

test('clasificación prioriza actividad profesional reciente del candidato', () => {
  const current = functionBlock('candidateCurrentProfessionalText', 'candidateRecentProfessionalText');
  const recent = functionBlock('candidateRecentProfessionalText', 'candidateAllProfessionalText');
  assert.match(current, /bolsa\.ultimoTrabajo/);
  assert.match(recent, /resume\.experience/);
  assert.match(api, /currentHits \* 14/);
  assert.match(api, /cvRecentHits \* 5/);
  assert.match(api, /candidateRecentRoleLabel/);
});

test('índice 0-100 es profesional, dinámico y no usa atributos personales sensibles', () => {
  const b = functionBlock('scoreCandidateProfessionalProfile', 'buildCandidateAdminClassification');
  assert.match(b, /profileScore:score/);
  assert.match(b, /rangoExperiencia/);
  assert.match(b, /trabajaActualmente/);
  assert.match(b, /resume\.experience/);
  assert.doesNotMatch(b, /bolsa\.(nacionalidad|estadoCivil|hijos|photoDataUrl|sueldoPretendido|direccion)/);
  assert.match(admin, /candidateScoreBadge/);
  assert.match(admin, /Índice de trayectoria/);
  assert.match(admin, /no constituye una recomendación automática de contratación/i);
});

test('empresas tienen una actividad principal dentro de Fabricación Logística o Servicio', () => {
  assert.match(api, /ADMIN_COMPANY_ACTIVITY_RULES/);
  assert.match(api, /activityKey:classification\.activityKey/);
  assert.match(api, /activityMap = new Map\(\)/);
  assert.match(admin, /Actividad principal:/);
  assert.match(admin, /Abrir actividades/);
  assert.doesNotMatch(admin, /Requiere revisión administrativa/);
});

test('trazabilidad muestra composición por expertise y actividad principal', () => {
  assert.match(api, /buildAdminComposition/);
  assert.match(api, /candidatesByExpertise/);
  assert.match(api, /companiesByActivity/);
  assert.match(api, /companiesByFamily/);
  assert.match(admin, /Composición actual del padrón/);
  assert.match(admin, /traceCandidateComposition/);
  assert.match(admin, /traceCompanyFamilyComposition/);
  assert.match(admin, /traceCompanyComposition/);
});

test('clasificación avanzada permanece sólo en administración', () => {
  const publicFiles = ['index.html','buscar.html','empresa.html','perfil.html','mis-oportunidades.html'];
  for(const name of publicFiles){
    const src = fs.readFileSync(path.join(root,'apps/web',name),'utf8');
    assert.doesNotMatch(src, /profileScore|classificationComposition|activityLabel|candidateScoreBadge/);
  }
});

test('frontend declara v7.9.15', () => {
  assert.match(config, /TP_APP_VERSION = "7\.9\.15"/);
});

import vm from 'node:vm';
function classificationFns(){
  const helperStart = api.indexOf('function professionalNorm');
  const helperEnd = api.indexOf('function inferLocalProfessionalTitle', helperStart);
  const helpers = api.slice(helperStart, helperEnd);
  const s = api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
  const e = api.indexOf('const adminCompanyCategorySchema', s);
  const block = helpers + '\n' + api.slice(s,e) + ';globalThis.__out={buildCandidateAdminClassification,inferAdminCompanyCategory};';
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return ctx.__out;
}

test('comportamiento: supervisor de producción reciente queda clasificado y puntuado', () => {
  const { buildCandidateAdminClassification } = classificationFns();
  const c = buildCandidateAdminClassification({ candidateBolsa:{ ultimoTrabajo:'Supervisor de Producción', areaTrabajo:'Producción', rangoExperiencia:'11–20', nivelEducativo:'Secundaria', trabajaActualmente:true }, resume:{ experience:'Supervisor de turno coordinando equipos y producción de planta.' } });
  assert.equal(c.classKey, 'SUPERVISION');
  assert.equal(c.expertiseKey, 'PRODUCCION');
  assert.equal(c.seniorityLabel, 'Senior');
  assert.ok(c.profileScore >= 75 && c.profileScore <= 100);
});

test('comportamiento: estudiante administrativo escaso no queda pendiente', () => {
  const { buildCandidateAdminClassification } = classificationFns();
  const c = buildCandidateAdminClassification({ candidateBolsa:{ areaTrabajo:'Administración', especialidad:'Administrativo', rangoExperiencia:'0–1', nivelEducativo:'Universitaria', ultimoTrabajo:'Estudiante buscando pasantía administrativa' }, resume:{} });
  assert.equal(c.classKey, 'APRENDIZ');
  assert.equal(c.seniorityKey, 'APRENDIZ');
  assert.equal(c.expertiseKey, 'ADMINISTRACION');
  assert.ok(c.profileScore <= 24);
});

test('comportamiento: la función administrativa reciente prevalece sobre un título universitario genérico', () => {
  const { buildCandidateAdminClassification } = classificationFns();
  const c = buildCandidateAdminClassification({ candidateBolsa:{ ultimoTrabajo:'Administrativo de facturación', areaTrabajo:'Administrativo / RR.HH. / Finanzas / Comercial', especialidad:'Administrativo', rangoExperiencia:'6–10', nivelEducativo:'Universitaria' }, resume:{} });
  assert.equal(c.classKey, 'ADMINISTRATIVO');
  assert.equal(c.expertiseKey, 'FINANZAS');
});

test('comportamiento: expertise desconocido crea etiqueta propia', () => {
  const { buildCandidateAdminClassification } = classificationFns();
  const c = buildCandidateAdminClassification({ candidateBolsa:{ areaTrabajo:'Arte gráfico industrial', especialidadOtro:'Rotulación técnica industrial', rangoExperiencia:'2–5' }, resume:{} });
  assert.match(c.expertiseKey, /^EXP_/);
  assert.match(c.expertiseLabel, /Rotulación Técnica Industrial/);
});

test('comportamiento: la actividad más reciente pesa más que experiencia histórica de otra expertise', () => {
  const { buildCandidateAdminClassification } = classificationFns();
  const c = buildCandidateAdminClassification({
    candidateBolsa:{ ultimoTrabajo:'Supervisor de Producción', areaTrabajo:'Operaciones de planta y producción', especialidad:'Supervisor de producción', rangoExperiencia:'11–20', nivelEducativo:'Secundaria' },
    resume:{ experience:'Anteriormente trabajó varios años en logística, transporte y depósito. Luego asumió supervisión de producción.' }
  });
  assert.equal(c.expertiseKey, 'PRODUCCION');
  assert.match(c.recentRole, /Supervisor de Producción/);
});

test('comportamiento: empresa de transporte se clasifica por actividad principal', () => {
  const { inferAdminCompanyCategory } = classificationFns();
  const c = inferAdminCompanyCategory({ companyName:'Transporte Norte', companySummary:'Empresa dedicada al transporte y distribución de cargas industriales.', jobs:[] });
  assert.equal(c.key, 'LOGISTICA');
  assert.equal(c.activityLabel, 'Transporte / Distribución');
});

test('comportamiento: 40 años explícitos de experiencia nunca quedan como Junior', () => {
  const { buildCandidateAdminClassification } = classificationFns();
  const c = buildCandidateAdminClassification({
    candidateBolsa:{
      ultimoTrabajo:'Supervisor y proyectista de ingeniería electromecánica',
      areaTrabajo:'Ingeniería / Oficina técnica',
      especialidad:'Ingeniería electromecánica',
      rangoExperiencia:'',
      nivelEducativo:'Universitaria',
      voiceNarrativeRaw:'Soy ingeniero electromecánico y proyectista. Tengo alrededor de 40 años de experiencia en el rubro, con trayectoria en supervisión, proyectos de ingeniería, área eléctrica, aire acondicionado e instalaciones termomecánicas.'
    },
    resume:{}
  });
  assert.equal(c.seniorityLabel, 'Senior');
  assert.ok(c.profileScore >= 90, `score esperado >= 90, recibido ${c.profileScore}`);
  assert.equal(c.expertiseKey, 'INGENIERIA');
});
