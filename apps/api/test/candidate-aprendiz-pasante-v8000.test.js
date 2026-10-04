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
  vm.runInContext(api.slice(hs,he)+'\n'+api.slice(s,e)+';globalThis.__out={buildCandidateAdminClassification,adminSearchTextMatch};',ctx);
  return ctx.__out;
}
test('v8.0.4 versión sincronizada',()=>assert.equal(pkg.version,'8.0.4'));
test('secundario técnico eléctrico sin experiencia => Aprendiz eléctrico y buscable',()=>{
  const {buildCandidateAdminClassification,adminSearchTextMatch}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{nivelEducativo:'Secundaria'},resume:{education:'Escuela Técnica. Técnico Electricista. Secundario completo.',experience:'Sin experiencia laboral formal.'}});
  assert.equal(c.classKey,'APRENDIZ');
  assert.match(c.expertiseLabel,/Aprendiz eléctrico/i);
  assert.equal(adminSearchTextMatch(c.searchText,'aprendiz'),true);
  assert.equal(adminSearchTextMatch(c.searchText,'aprendiz electrico'),true);
});
test('bachiller sin experiencia => Aprendiz administrativo',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{nivelEducativo:'Secundaria'},resume:{education:'Secundario completo. Bachiller en Economía y Gestión.',experience:'Sin experiencia laboral.'}});
  assert.equal(c.classKey,'APRENDIZ');
  assert.equal(c.expertiseKey,'ADMINISTRACION');
  assert.match(c.expertiseLabel,/Aprendiz administrativo/i);
});
test('sin estudios ni experiencia => Aprendiz con estudios secundarios no declarados',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{},resume:{}});
  assert.equal(c.classKey,'APRENDIZ');
  assert.match(c.expertiseLabel,/estudios secundarios no declarados/i);
});
test('universitario de ingeniería eléctrica sin experiencia => Pasante eléctrico y buscable',()=>{
  const {buildCandidateAdminClassification,adminSearchTextMatch}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{nivelEducativo:'Universitaria'},resume:{education:'Ingeniería Eléctrica - Universidad Tecnológica Nacional - cursando',experience:'Sin experiencia laboral previa.'}});
  assert.equal(c.classKey,'PASANTE');
  assert.match(c.expertiseLabel,/Pasante eléctrico/i);
  assert.equal(adminSearchTextMatch(c.searchText,'pasante'),true);
  assert.equal(adminSearchTextMatch(c.searchText,'pasante electrico'),true);
});
test('formación superior prevalece sobre título técnico secundario para Pasante',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{},resume:{education:'Técnico Electromecánico. Técnico Superior en Gestión Industrial actualmente.',experience:'Sin experiencia laboral formal.'}});
  assert.equal(c.classKey,'PASANTE');
  assert.equal(c.expertiseKey,'INDUSTRIAL');
});
test('experiencia real conserva clasificación profesional y no se degrada a aprendiz/pasante',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{nivelEducativo:'Universitaria',ultimoTrabajo:'Técnico electricista de mantenimiento'},resume:{education:'Ingeniería Eléctrica cursando',experience:'Técnico electricista de mantenimiento. Instalación de tableros eléctricos, cableado y motores. 2024 - actualidad.'}});
  assert.notEqual(c.classKey,'APRENDIZ');
  assert.notEqual(c.classKey,'PASANTE');
  assert.equal(c.expertiseKey,'ELECTRICA');
});
