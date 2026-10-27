import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const api=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

test('arranque y build no ejecutan SQL ni sincronizan esquema',()=>{
  assert.equal(Object.hasOwn(pkg.scripts,'prestart'),false);
  assert.doesNotMatch(pkg.scripts.build,/db:|db push|db execute|migrate/i);
  assert.match(pkg.scripts.start,/node src\/index\.js/);
});

test('health de Render no consulta PostgreSQL y mantenimiento tiene reintento manual',()=>{
  const health=api.match(/app\.get\(\"\/health\"[\s\S]*?\);/);
  assert.ok(health,'health endpoint exists');
  assert.doesNotMatch(health[0],/prisma|queryRaw/i);
  assert.match(api,/app\.get\(\"\/status\"/);
  assert.match(api,/app\.post\(\"\/health\/recheck\"/);
});

test('trabajadores sin tareas no mantienen una consulta frecuente a la base',()=>{
  assert.match(api,/COMMUNICATION_WORKER_RECOVERY_HOURS[^\n]*\|\| 12/);
  assert.doesNotMatch(api,/COMMUNICATION_WORKER_TICK_MS/);
  assert.match(api,/SUPPORT_MAILBOX_SYNC_INTERVAL_MINUTES[^\n]*\|\| 720/);
  assert.match(api,/ADMIN_BACKUP_CHECK_MINUTES[^\n]*\|\| 360/);
  assert.match(api,/CANDIDATE_CLASSIFICATION_SCAN_SECONDS[^\n]*\|\| 43200/);
  assert.match(api,/scheduleAutomaticMailQueueKick\(COMMUNICATION_SEND_INTERVAL_MS\)/);
  assert.match(api,/ADMIN_BACKUP_CHECK_MINUTES[^\n]*\|\| 360/);
});

test('interfaz de mantenimiento se incluye en el PWA y no hace polling automático',()=>{
  const sw=fs.readFileSync(path.join(root,'../web/sw.js'),'utf8');
  const page=fs.readFileSync(path.join(root,'../web/maintenance.html'),'utf8');
  assert.match(sw,/\"\/maintenance\.html\"/);
  assert.match(page,/health\/recheck/);
  assert.doesNotMatch(page,/setInterval\s*\(/);
});
