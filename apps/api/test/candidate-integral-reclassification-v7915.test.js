import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'apps/web/admin.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'apps/api/package.json'),'utf8'));

function fns(){
  const hs=api.indexOf('function professionalNorm');
  const he=api.indexOf('function inferLocalProfessionalTitle',hs);
  const s=api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
  const e=api.indexOf('const adminCompanyCategorySchema',s);
  const ctx={}; vm.createContext(ctx);
  vm.runInContext(api.slice(hs,he)+'\n'+api.slice(s,e)+';globalThis.__out={buildCandidateAdminClassification};',ctx);
  return ctx.__out;
}

test('v7.9.16 unifica versión y build',()=>{
  assert.equal(pkg.version,'7.9.16');
  assert.match(fs.readFileSync(path.join(root,'apps/web/config.js'),'utf8'),/TP_BUILD_ID = "20260811_02"/);
});

test('CV con cargos sucesivos y conducción prevalece sobre rango inicial mal cargado',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({
    candidateBolsa:{areaTrabajo:'Mantenimiento',especialidad:'Eléctrica',rangoExperiencia:'0–1',nivelEducativo:'Secundaria'},
    resume:{summary:'Técnico de mantenimiento eléctrico con sólida trayectoria industrial.',experience:'Técnico electricista. Luego supervisor de mantenimiento, coordinando cuadrillas, planificación preventiva y correctiva, contratistas y paradas de planta. Actualmente responsable de mantenimiento eléctrico y puesta en marcha.'}
  });
  assert.notEqual(c.seniorityKey,'APRENDIZ');
  assert.ok(c.profileScore>=50,`score inesperado ${c.profileScore}`);
  assert.ok(['SUPERVISION','TECNICO'].includes(c.classKey));
  assert.match(c.scoreBasis,/rango inicial 0–1 no se usa como techo|múltiples roles|supervisión/i);
});

test('presentación personal detallada puede elevar una evaluación aun sin años explícitos',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Ingeniería',especialidad:'Proyectos',voiceNarrativeSummary:'Trabajo en proyectos industriales eléctricos. Desarrollo ingeniería, coordino documentación, reviso planos, realizo cálculos, planifico tareas, coordino contratistas, superviso avances, verifico seguridad y participo de puestas en marcha. También acompaño a técnicos y resuelvo desvíos durante la ejecución.',voiceNarrativeProfessionalTitle:'Supervisor de proyectos eléctricos'},resume:{}});
  assert.notEqual(c.seniorityKey,'APRENDIZ');
  assert.ok(c.profileScore>=50);
  assert.equal(c.classKey,'SUPERVISION');
});

test('falta de años no equivale a falta de experiencia',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Logística',especialidad:'Depósito'},resume:{summary:'Perfil logístico.',experience:''}});
  assert.equal(c.seniorityKey,'NO_DETERMINADO');
  assert.equal(c.profileScore,null);
});

test('aprendiz/pasante exige señal profesional explícita y ausencia de evidencia contradictoria',()=>{
  const {buildCandidateAdminClassification}=fns();
  const a=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Calidad',ultimoTrabajo:'Busco mi primer empleo y una pasantía',rangoExperiencia:'0–1'},resume:{}});
  assert.equal(a.seniorityKey,'APRENDIZ');
  const b=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Calidad',ultimoTrabajo:'Busco una nueva oportunidad',rangoExperiencia:'0–1'},resume:{summary:'Especialista de calidad con amplia experiencia.',experience:'Inspector de calidad. Coordinador QA/QC, auditorías, gestión documental, supervisión de inspectores, control de proveedores y liberación de equipos.'}});
  assert.notEqual(b.seniorityKey,'APRENDIZ');
});

test('administración muestra N/D y confianza cuando no hay evidencia suficiente',()=>{
  assert.match(admin,/N\/D ·/);
  assert.match(admin,/Confianza de la clasificación/);
  assert.match(admin,/No determinado por falta de evidencia suficiente/);
});

test('clasificación laboral no usa atributos personales sensibles o edad',()=>{
  const block=api.slice(api.indexOf('function candidateProfessionalMaturityEvidence'),api.indexOf('function buildCandidateAdminClassification'));
  assert.doesNotMatch(block,/bolsa\.(fechaNacimiento|nacionalidad|estadoCivil|hijos|sueldoPretendido|direccion|photoDataUrl)|profile\.(birthDate|fechaNacimiento)/i);
});
