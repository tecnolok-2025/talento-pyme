import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
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

test('v7.9.16 unifica version',()=>assert.equal(pkg.version,'7.9.16'));

test('DNI alto o bajo no cambia la clasificacion profesional',()=>{
  const {buildCandidateAdminClassification}=fns();
  const base={candidateBolsa:{areaTrabajo:'Ingeniería',especialidad:'Proyectos',ultimoTrabajo:'Ingeniero de proyectos'},resume:{summary:'Ingeniero de proyectos industriales.',experience:'Desarrollo documentación técnica, coordinación de contratistas, planificación y seguimiento de obra.'}};
  const a=buildCandidateAdminClassification({...base,dni:'30111222'});
  const b=buildCandidateAdminClassification({...base,dni:'95111222'});
  assert.equal(a.seniorityKey,b.seniorityKey);
  assert.equal(a.profileScore,b.profileScore);
  assert.equal(a.classKey,b.classKey);
});

test('rol empresarial explicito puede sostener al menos semi-senior aun sin años declarados',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Gestión',especialidad:'Dirección',ultimoTrabajo:'Empresario y socio gerente de empresa industrial'},resume:{summary:'Responsable de gestión comercial y operativa.',experience:'Coordino proveedores, clientes, operaciones y planificación de la empresa.'}});
  assert.ok(c.profileScore>=50,`score inesperado ${c.profileScore}`);
  assert.ok(['SEMI_SENIOR','SENIOR'].includes(c.seniorityKey),c.seniorityKey);
  assert.equal(c.classKey,'GERENCIAL');
});

test('perfil profesional insuficiente deja trayectoria no determinada fuera de primer empleo',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Producción',especialidad:'General',ultimoTrabajo:'Operaciones industriales'},resume:{}});
  assert.equal(c.seniorityKey,'NO_DETERMINADO');
  assert.equal(c.classKey,'TRAYECTORIA');
  assert.notEqual(c.expertiseLabel,'Primer empleo / Perfil general');
});

test('primer empleo solo se usa cuando hay evidencia explicita',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{areaTrabajo:'Administración',ultimoTrabajo:'Busco mi primer empleo y una pasantía',rangoExperiencia:'0–1'},resume:{}});
  assert.equal(c.seniorityKey,'APRENDIZ');
  assert.equal(c.classKey,'APRENDIZ');
});

test('la clasificacion no usa edad, nacionalidad, fecha de nacimiento ni DNI como proxy',()=>{
  const block=api.slice(api.indexOf('function candidateProfessionalMaturityEvidence'),api.indexOf('function buildCandidateAdminClassification'));
  assert.doesNotMatch(block,/candidate\.(dni|edad|nacionalidad|fechaNacimiento)|bolsa\.(dni|edad|nacionalidad|fechaNacimiento)|profile\.(dni|edad|nacionalidad|birthDate|fechaNacimiento)/i);
});
