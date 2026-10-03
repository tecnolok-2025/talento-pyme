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
const schema=fs.readFileSync(path.join(root,'apps/api/prisma/schema.prisma'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'apps/api/package.json'),'utf8'));

const s=api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
const e=api.indexOf('const adminCompanyCategorySchema',s);
const ctx={}; vm.createContext(ctx);
vm.runInContext(api.slice(s,e)+';globalThis.f={buildCandidateAdminClassification};',ctx);
const classify=ctx.f.buildCandidateAdminClassification;
const c=(ultimoTrabajo,experience='',summary='')=>({candidateBolsa:{ultimoTrabajo},resume:{experience,summary}});

test('v8.0.1 prioriza actividad actual frente a experiencia histórica no relacionada',()=>{
  const a=classify(c('Moza / bartender','2018 - 2020 Vendedora. Atención al cliente, caja y cobranzas. 2025 - Actualidad Moza. Servicio en salón y toma de pedidos.'));
  assert.equal(a.expertiseKey,'GASTRONOMIA');
  assert.equal(a.primaryFromRecent,true);
});

test('v8.0.1 producción reciente no queda clasificada por logística antigua',()=>{
  const a=classify(c('Operario especializado de producción','2014 - 2018 Operario de depósito. Picking y carga y descarga. 2024 - Actualidad Operario especializado de producción. Línea de producción y proceso productivo.'));
  assert.equal(a.expertiseKey,'PRODUCCION');
  assert.doesNotMatch(a.searchText,/Logística \/ Depósito/);
});

test('v8.0.1 seguridad reciente prevalece sobre mecánica histórica',()=>{
  const a=classify(c('Vigilador general sin arma','1994 - 1998 Mecánico. Bombas, rodamientos y alineación de equipos. 2024 - Actualidad Vigilador general. Control de acceso y rondas de vigilancia.'));
  assert.equal(a.expertiseKey,'SEGURIDAD');
  assert.doesNotMatch(a.searchText,/Mecánica/);
});

test('v8.0.1 experiencia complementaria exige evidencia fuerte y reciente',()=>{
  const a=classify(c('Electricista de mantenimiento','2022 - Actualidad Electricista de mantenimiento. Tableros eléctricos, motores y cableado. 2021 - 2023 Técnico de instrumentación. Calibración de transmisores, PLC y lazos de control.'));
  assert.equal(a.expertiseKey,'ELECTRICA');
  assert.ok(Array.isArray(a.secondaryProfiles));
  assert.ok(a.secondaryProfiles.some(x=>x.key==='INSTRUMENTACION'));
});

test('v8.0.1 experiencia remota no se usa como perfil complementario searchable',()=>{
  const a=classify(c('Supervisor de producción','1992 - 1995 Cocinero. Preparación de alimentos y cocina. 2024 - Actualidad Supervisor de producción. Línea de producción, manufactura y coordinación de equipo.'));
  assert.equal(a.expertiseKey,'PRODUCCION');
  assert.ok(!a.secondaryProfiles.some(x=>x.key==='GASTRONOMIA'));
  assert.doesNotMatch(a.searchText,/Gastronomía/);
});

test('v8.0.1 usa indicador conservador y separa expertise de empleabilidad',()=>{
  const a=classify(c('Project manager'));
  assert.ok(a.profileScore===null || a.profileScore<=25);
  assert.match(a.scoreBasis,/no mide empleabilidad/i);
});

test('v8.0.1 persiste perfiles complementarios y los muestra como secundarios',()=>{
  assert.equal(pkg.version,'8.0.1');
  assert.match(api,/CANDIDATE_CLASSIFICATION_VERSION = '8\.0\.0'/);
  assert.match(schema,/secondaryProfiles\s+Json\?/);
  assert.match(admin,/Perfiles complementarios/);
  assert.match(admin,/Actividad principal \/ expertise/);
});
