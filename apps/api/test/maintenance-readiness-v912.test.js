import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const api=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const web=path.resolve(root,'../web');
const auth=fs.readFileSync(path.join(web,'auth.js'),'utf8');
const login=fs.readFileSync(path.join(web,'index.html'),'utf8');
const maintenance=fs.readFileSync(path.join(web,'maintenance.html'),'utf8');
const sw=fs.readFileSync(path.join(web,'sw.js'),'utf8');

test('errores de conexión y agotamiento del pool activan estado de mantenimiento',()=>{
  assert.match(api,/P2024/);
  assert.match(api,/EHOSTUNREACH/);
  assert.match(api,/ENETUNREACH/);
  assert.match(api,/noteDatabaseFailure\(error\)/);
});

test('reintento solo comprueba PostgreSQL, no dispara correos, y limita intentos repetidos',()=>{
  const start=api.indexOf('app.post("/health/recheck"');
  const end=api.indexOf('});',start)+3;
  const route=api.slice(start,end);
  assert.match(route,/makeIpRateLimiter/);
  assert.match(route,/prisma\.\$queryRaw`SELECT 1`/);
  assert.doesNotMatch(route,/scheduleAutomaticMailQueueKick/);
});

test('login lleva a mantenimiento ante caída de red o error 5xx',()=>{
  assert.match(login,/window\.location\.replace\('\/maintenance\.html'\)/);
  assert.match(login,/\[502,503,504\]/);
  assert.match(auth,/catch\(_\)\{ showMaintenance\(\); \}/);
  assert.match(auth,/syncVersionFromApi\(false\),2500/);
});

test('pantalla de mantenimiento ofrece reintento manual sin sondeo periódico',()=>{
  assert.match(maintenance,/health\/recheck/);
  assert.doesNotMatch(maintenance,/setInterval\s*\(/);
  assert.match(sw,/return cachedMaintenance \|\|/);
});
