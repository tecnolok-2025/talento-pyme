import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const api = fs.readFileSync(path.join(root, 'apps/api/src/index.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'apps/web/admin.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'apps/web/config.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'apps/web/sw.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8'));

test('v7.9.16 unifica frontend, API y PWA', () => {
  assert.equal(pkg.version, '7.9.16');
  assert.match(config, /TP_APP_VERSION = "7\.9\.16"/);
  assert.match(config, /TP_BUILD_ID = "20260811_02"/);
  assert.match(sw, /v=7\.9\.16/);
});

test('Perfiles candidatos incorpora desplegable dinámico y palabra clave', () => {
  assert.match(admin, /id="candidateDirectoryProfileFilter"/);
  assert.match(admin, /Todos los perfiles/);
  assert.match(admin, /Palabra clave: nombre, expertise, CV, experiencia, estudios/);
  assert.match(admin, /populateCandidateProfileFilter/);
  assert.match(admin, /candidateProfile: f\.candidateProfile/);
});

test('Perfiles empresas incorpora desplegable dinámico y palabra clave', () => {
  assert.match(admin, /id="companyDirectoryProfileFilter"/);
  assert.match(admin, /Todos los perfiles de empresa/);
  assert.match(admin, /Palabra clave: empresa, actividad, búsqueda, ciudad, CUIT/);
  assert.match(admin, /populateCompanyProfileFilter/);
  assert.match(admin, /companyProfile: f\.companyProfile/);
});

test('API construye opciones desde los perfiles reales y conserva contadores', () => {
  assert.match(api, /function buildCandidateDirectoryFilterOptions/);
  assert.match(api, /profiles:\[\.\.\.profileMap\.values\(\)\]/);
  assert.match(api, /function buildCompanyDirectoryFilterOptions/);
  assert.match(api, /filterOptions:candidateDirectoryFilterOptions/);
  assert.match(api, /filterOptions:companyDirectoryFilterOptions/);
  assert.match(admin, /PROFILE::/);
});

test('filtro permite familia/categoría y subperfil específico', () => {
  assert.match(api, /parts\[0\] === 'CLASS'/);
  assert.match(api, /parts\[0\] === 'PROFILE'/);
  assert.match(api, /parts\[0\] === 'FAMILY'/);
  assert.match(admin, /CLASS::\$\{group\.key\}/);
  assert.match(admin, /PROFILE::\$\{group\.key\}::\$\{profile\.key\}/);
  assert.match(admin, /FAMILY::\$\{group\.key\}/);
});

test('palabra clave candidata busca también CV completo y clasificación calculada', () => {
  assert.match(api, /it\.resume\?\.experience/);
  assert.match(api, /it\.resume\?\.education/);
  assert.match(api, /it\.resume\?\.certifications/);
  assert.match(api, /classification\.expertiseLabel/);
  assert.match(api, /classification\.seniorityLabel/);
  assert.match(api, /adminSearchTextMatch\(item\._searchText, candidateSearch\)/);
});

test('palabra clave empresa incluye actividad inferida y búsquedas publicadas', () => {
  assert.match(api, /classification\.activityLabel/);
  assert.match(api, /job\.title, job\.description, job\.requirements, job\.location/);
  assert.match(api, /adminSearchTextMatch\(item\._searchText, companySearch\)/);
});

test('limpiar filtros devuelve buscador y desplegable a Todos', () => {
  assert.match(admin, /state\.filters\.candidateProfile = 'ALL'/);
  assert.match(admin, /state\.filters\.companyProfile = 'ALL'/);
  assert.match(admin, /Limpiar filtros/);
});


function filterFns(){
  const start = api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
  const end = api.indexOf('function adminNormText', start);
  const block = api.slice(start, end) + '\nglobalThis.__out={buildCandidateDirectoryFilterOptions,filterCandidateDirectoryItems,buildCompanyDirectoryFilterOptions,filterCompanyDirectoryItems};';
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return ctx.__out;
}

test('comportamiento: candidato puede filtrar una categoría completa o una expertise puntual', () => {
  const { buildCandidateDirectoryFilterOptions, filterCandidateDirectoryItems } = filterFns();
  const items = [
    { classKey:'SUPERVISION', classLabel:'Supervisión / Jefaturas', expertiseKey:'ELECTRICA', expertiseLabel:'Eléctrica' },
    { classKey:'SUPERVISION', classLabel:'Supervisión / Jefaturas', expertiseKey:'PRODUCCION', expertiseLabel:'Producción / Operaciones' },
    { classKey:'TECNICO', classLabel:'Técnicos / Especialistas', expertiseKey:'ELECTRICA', expertiseLabel:'Eléctrica' },
  ];
  const opts = buildCandidateDirectoryFilterOptions(items);
  assert.equal(opts.find((g)=>g.key==='SUPERVISION')?.count, 2);
  assert.equal(filterCandidateDirectoryItems(items,'CLASS::SUPERVISION').length,2);
  assert.equal(filterCandidateDirectoryItems(items,'PROFILE::SUPERVISION::ELECTRICA').length,1);
});

test('comportamiento: empresa puede filtrar familia completa o actividad puntual', () => {
  const { buildCompanyDirectoryFilterOptions, filterCompanyDirectoryItems } = filterFns();
  const items = [
    { categoryKey:'FABRICACION', categoryLabel:'Fabricación', activityKey:'METALURGIA', activityLabel:'Metalurgia / Mecanizado' },
    { categoryKey:'FABRICACION', categoryLabel:'Fabricación', activityKey:'AUTOMOTRIZ', activityLabel:'Automotriz / Autopartes' },
    { categoryKey:'SERVICIO', categoryLabel:'Servicio', activityKey:'INGENIERIA_PROYECTOS', activityLabel:'Ingeniería / Proyectos' },
  ];
  const opts = buildCompanyDirectoryFilterOptions(items);
  assert.equal(opts.find((g)=>g.key==='FABRICACION')?.count, 2);
  assert.equal(filterCompanyDirectoryItems(items,'FAMILY::FABRICACION').length,2);
  assert.equal(filterCompanyDirectoryItems(items,'PROFILE::FABRICACION::METALURGIA').length,1);
});
