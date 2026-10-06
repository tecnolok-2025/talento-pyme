import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const api = fs.readFileSync(path.join(__dirname,'../src/index.js'),'utf8');
function slice(a,b){ const i=api.indexOf(a); if(i<0) throw new Error('missing '+a); const j=b?api.indexOf(b,i+1):-1; return api.slice(i,j>0?j:undefined); }
const code=[
  slice('function adminNormText','function adminTitleCase'),
  slice('function adminSearchTextMatch','const ADMIN_COMPANY_ACTIVITY_RULES'),
  slice('function candidateProfessionalSearchText','function buildAdminComposition')
].join('\n');
const ctx={}; vm.createContext(ctx); vm.runInContext(code+'\nthis.f={adminSearchTextMatch,candidateProfessionalSearchText,candidateProfessionalSearchScore,candidateSearchAliases};',ctx);
const f=ctx.f;
const candidate=(b={},r={},p={})=>({candidateBolsa:b,resume:r,candidateProfile:p,email:'x@example.com'});
const cls=(extra={})=>({profileTitle:'Producción y procesos',expertiseLabel:'Producción / Operaciones',seniorityLabel:'Junior provisional',searchText:'Producción procesos',...extra});

test('v9.0.0 encuentra títulos académicos aunque la clasificación principal sea otra',()=>{
  const c=candidate({observaciones:'Ingeniero Químico con experiencia en supply chain.'});
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'ingeniero')>0);
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'ingeniera')>0);
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'ingenieria quimica')>0);
});

test('v9.0.0 expande sinónimos profesionales frecuentes',()=>{
  const c=candidate({}, {education:'Analista de Recursos Humanos',experience:'Selección y liquidación de sueldos'});
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'rrhh')>0);
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'recursos humanos')>0);
});

test('v9.0.0 evita coincidencias de abreviaturas dentro de otras palabras',()=>{
  assert.equal(f.adminSearchTextMatch('capacidad de trabajo','cad'),false);
  const c=candidate({herramientasMecanica:'AutoCAD'});
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'cad')>0);
});

test('v9.0.0 exige todos los conceptos de una búsqueda compuesta',()=>{
  const c=candidate({}, {education:'Ingeniero Mecánico'});
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'ingeniero mecanico')>0);
  assert.equal(f.candidateProfessionalSearchScore(c,cls(),'ingeniero quimico'),0);
});

test('v9.0.0 no usa un resumen IA como única prueba para búsquedas profesionales',()=>{
  const c=candidate({voiceNarrativeSummary:'Instrumentista senior PLC SCADA'});
  assert.equal(f.candidateProfessionalSearchScore(c,cls(),'instrumentista'),0);
  assert.equal(f.adminSearchTextMatch(f.candidateProfessionalSearchText(c,cls()),'instrumentista'),false);
});

test('v9.0.0 indexa experiencia y formación reales aunque no estén en la etiqueta principal',()=>{
  const c=candidate({ultimoTrabajo:'Coordinador de catalogación',observaciones:'Ingeniero Químico. Compras y abastecimiento.'},{experience:'Supply chain y contratos',education:'Ingeniería Química'});
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'compras')>0);
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'abastecimiento')>0);
  assert.ok(f.candidateProfessionalSearchScore(c,cls(),'quimico')>0);
});
