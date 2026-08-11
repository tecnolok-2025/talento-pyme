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

function classificationFns(){
  const helperStart=api.indexOf('function professionalNorm');
  const helperEnd=api.indexOf('function inferLocalProfessionalTitle',helperStart);
  const helpers=api.slice(helperStart,helperEnd);
  const s=api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
  const e=api.indexOf('const adminCompanyCategorySchema',s);
  const block=helpers+'\n'+api.slice(s,e)+';globalThis.__out={buildCandidateAdminClassification,estimateExperienceYearsFromResumeDates};';
  const ctx={};
  vm.createContext(ctx);
  vm.runInContext(block,ctx);
  return ctx.__out;
}

test('v7.9.16 unifica versión y recalcula sin persistir una nota vieja',()=>{
  assert.equal(pkg.version,'7.9.16');
  assert.match(api,/Nunca se persiste una calificación vieja: cada llamada relee toda la información vigente/);
});

test('v7.9.16 estima trayectoria desde períodos laborales fechados del CV',()=>{
  const {estimateExperienceYearsFromResumeDates}=classificationFns();
  const r=estimateExperienceYearsFromResumeDates('1994-2004 Técnico eléctrico. 2004-2014 Supervisor. 2014-Presente Jefe de mantenimiento.');
  assert.ok(r.years>=30,`esperado >=30 años, recibido ${r.years}`);
  assert.ok(r.intervalsCount>=3);
});

test('CV senior corrige un rango 0-1 mal cargado y evita Aprendiz/Pasante',()=>{
  const {buildCandidateAdminClassification}=classificationFns();
  const c=buildCandidateAdminClassification({
    candidateBolsa:{
      areaTrabajo:'Producción', especialidad:'Operario', rangoExperiencia:'0–1', nivelEducativo:'Secundaria',
      ultimoTrabajo:'Operario industrial'
    },
    resume:{
      summary:'Profesional técnico con extensa trayectoria industrial en mantenimiento eléctrico y conducción de equipos.',
      experience:'1993-2003 Técnico electricista de mantenimiento. 2003-2014 Supervisor de mantenimiento eléctrico. 2014-Presente Jefe de mantenimiento, coordinación de equipos, planificación preventiva y correctiva.'
    }
  });
  assert.equal(c.seniorityLabel,'Senior');
  assert.ok(c.profileScore>=75,`score esperado >=75, recibido ${c.profileScore}`);
  assert.notEqual(c.classKey,'APRENDIZ');
  assert.ok(['SUPERVISION','GERENCIAL','TECNICO'].includes(c.classKey),`clase inesperada ${c.classKey}`);
  assert.equal(c.cvEvidenceUsed,true);
  assert.match(c.scoreBasis,/CV|antecedentes curriculares|período/i);
});

test('expertise usa CV completo con peso fuerte y no sólo campos básicos',()=>{
  const {buildCandidateAdminClassification}=classificationFns();
  const c=buildCandidateAdminClassification({
    candidateBolsa:{areaTrabajo:'Producción',especialidad:'General',rangoExperiencia:'11–20'},
    resume:{
      summary:'Especialista en mantenimiento y confiabilidad de equipos industriales.',
      experience:'2008-2014 Técnico de mantenimiento. 2014-2020 Supervisor de mantenimiento preventivo y correctivo. 2020-Presente Responsable de mantenimiento y confiabilidad.'
    }
  });
  assert.equal(c.expertiseKey,'MANTENIMIENTO');
  assert.ok(['CV_RECIENTE','CV_COMPLETO'].includes(c.expertiseSource));
});

test('primer empleo explícito puede conservar categoría inicial sin usar edad ni suposiciones',()=>{
  const {buildCandidateAdminClassification}=classificationFns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Administración',especialidad:'Administrativo',rangoExperiencia:'0–1',ultimoTrabajo:'Busco mi primer empleo'},resume:{}});
  assert.equal(c.seniorityLabel,'Aprendiz / Pasante / Primer empleo');
  assert.ok(c.profileScore<=24);
});

test('si faltan años pero el CV muestra múltiples roles y responsabilidades no cae automáticamente en aprendiz',()=>{
  const {buildCandidateAdminClassification}=classificationFns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Mantenimiento',especialidad:'Eléctrica',rangoExperiencia:'0–1'},resume:{summary:'Técnico especialista en mantenimiento eléctrico industrial con amplia experiencia en planta.',experience:'Técnico electricista en mantenimiento preventivo y correctivo. Supervisor de cuadrilla eléctrica, coordinación de personal, planificación de paradas, control de trabajos, tableros, motores y puesta en marcha. Responsable de seguridad operativa y seguimiento de contratistas.'}});
  assert.notEqual(c.seniorityKey,'APRENDIZ');
  assert.ok(['SEMI_SENIOR','SENIOR'].includes(c.seniorityKey),`seniority inesperado ${c.seniorityKey}`);
  assert.notEqual(c.classKey,'APRENDIZ');
});

test('sin evidencia suficiente no inventa junior ni aprendiz: deja trayectoria no determinada',()=>{
  const {buildCandidateAdminClassification}=classificationFns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Producción'},resume:{}});
  assert.equal(c.seniorityKey,'NO_DETERMINADO');
  assert.equal(c.profileScore,null);
  assert.equal(c.seniorityLabel,'Trayectoria no determinada');
});

test('la lógica de seniority no utiliza edad, fecha de nacimiento ni DNI como proxy de experiencia',()=>{
  const block=api.slice(api.indexOf('function candidateProfessionalMaturityEvidence'),api.indexOf('function inferAdminCandidateClass'));
  assert.doesNotMatch(block,/bolsa\.(edad|fechaNacimiento|dni)|profile\.(birth|birthDate|fechaNacimiento)/i);
});

test('administración muestra años, fuente y fuentes profesionales analizadas',()=>{
  assert.match(admin,/Años de experiencia detectados/);
  assert.match(admin,/Fuente principal de experiencia/);
  assert.match(admin,/Fuentes profesionales analizadas/);
});
