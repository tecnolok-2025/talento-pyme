import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const schema=fs.readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../../web/admin.html',import.meta.url),'utf8');

test('v8.0.10 agrega flags de visibilidad con default false',()=>{
  const matches=schema.match(/hiddenFromSearch\s+Boolean\s+@default\(false\)/g)||[];
  assert.ok(matches.length>=2);
});

test('v8.0.10 excluye candidatos ocultos de Buscar Talento',()=>{
  assert.match(api,/candidateBolsa\.findMany\(\{\s*where:\{ user:\{ hiddenFromSearch:false \} \}/s);
  assert.match(api,/if\(!it \|\| it\.user\?\.hiddenFromSearch\) return res\.status\(404\)/);
});

test('v8.0.10 excluye oportunidades de empresas ocultas',()=>{
  assert.match(api,/company: \{ is: \{ hiddenFromSearch: false \} \}/);
});

test('v8.0.10 expone buscador y tilde reversible en trazabilidad',()=>{
  assert.match(admin,/Visibilidad en búsquedas/);
  assert.match(admin,/Ocultar de búsquedas/);
  assert.match(api,/app\.get\('\/admin\/search-visibility'/);
  assert.match(api,/app\.patch\('\/admin\/search-visibility\/:type\/:id'/);
});

test('v8.0.10 deduplica recuperador por asunto',()=>{
  assert.match(api,/const key=String\(row\.subject\|\|''\)\.trim\(\)\.toLowerCase\(\)\.replace/);
  assert.match(admin,/const key=String\(it\.subject\|\|''\)\.trim\(\)\.toLocaleLowerCase/);
});
