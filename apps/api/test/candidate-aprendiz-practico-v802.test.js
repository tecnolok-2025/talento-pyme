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
const buscar=fs.readFileSync(path.join(root,'apps/web/buscar.html'),'utf8');
const index=fs.readFileSync(path.join(root,'apps/web/index.html'),'utf8');
function fns(){
  const hs=api.indexOf('function professionalNorm');
  const he=api.indexOf('function inferLocalProfessionalTitle',hs);
  const s=api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
  const e=api.indexOf('const adminCompanyCategorySchema',s);
  const ctx={}; vm.createContext(ctx);
  vm.runInContext(api.slice(hs,he)+'\n'+api.slice(s,e)+';globalThis.__out={buildCandidateAdminClassification,adminSearchTextMatch};',ctx);
  return ctx.__out;
}
test('aprendiz sin estudios pero con cocina declarada se orienta y es buscable',()=>{
  const {buildCandidateAdminClassification,adminSearchTextMatch}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{voiceNarrativeRaw:'Sé cocinar, preparar comidas y hacer pizzas en casa, pero todavía no tuve un empleo formal.'},resume:{}});
  assert.equal(c.classKey,'APRENDIZ');
  assert.match(c.expertiseLabel,/Aprendiz cocina \/ gastronomía/i);
  assert.equal(adminSearchTextMatch(c.searchText,'aprendiz cocina'),true);
  assert.equal(adminSearchTextMatch(c.searchText,'gastronomia'),true);
});
test('aprendiz sin estudios con cuidado de chicos se orienta sin inventar experiencia',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{voiceNarrativeRaw:'Cuido chicos y también ayudé como niñera de familiares.'},resume:{}});
  assert.match(c.expertiseLabel,/Aprendiz cuidado de personas/i);
  assert.equal(c.classificationConfidence,'BAJA');
});
test('sin ningún saber declarado conserva aprendiz sin estudios declarados',()=>{
  const {buildCandidateAdminClassification}=fns();
  const c=buildCandidateAdminClassification({candidateBolsa:{},resume:{}});
  assert.match(c.expertiseLabel,/estudios secundarios no declarados/i);
});
test('búsqueda administrativa se posiciona en primer candidato',()=>{
  assert.match(admin,/focusFirstCandidateSearchResult/);
  assert.match(admin,/querySelector\('\.candidateAccordion'\)/);
  assert.match(admin,/scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
});
test('búsqueda empresa se posiciona en primer resultado',()=>{
  assert.match(buscar,/focusFirstCompanySearchResult/);
  assert.match(buscar,/querySelector\('\.talentCard'\)/);
  assert.match(buscar,/scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
});
test('acceso inicial elimina doble Ingresar visual',()=>{
  assert.match(index,/Ya tengo cuenta/);
  assert.match(index,/id="btnLogin"[^>]*>Ingresar<\/button>/);
});
test('capacidad operativa usa candidatos y capacidad segura estimada',()=>{
  assert.match(api,/estimatedCandidateCapacity/);
  assert.match(api,/candidateCapacityPct/);
  assert.match(api,/reserva del 20%/);
  assert.match(admin,/Capacidad estimada segura/);
});
