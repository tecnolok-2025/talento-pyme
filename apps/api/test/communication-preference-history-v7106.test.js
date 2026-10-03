import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const api=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
const admin=fs.readFileSync(path.resolve(root,'../web/admin.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'prisma/migrations/20260928_v7106_communication_history/migration.sql'),'utf8');
const simulate=fs.readFileSync(path.join(root,'scripts/simulate_communication_history_v7106.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'scripts/rollback_communication_history_v7106.sql'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

test('v7.10.12 agrega historial append-only sin reemplazar el estado vigente de User',()=>{
  assert.equal(pkg.version,'7.10.12');
  assert.match(schema,/model CommunicationPreferenceEvent/);
  assert.match(schema,/bulkEmailOptOutAt\s+DateTime\?/);
  assert.match(schema,/LEGACY_OPT_OUT_SNAPSHOT/);
  assert.match(migration,/prevent_communication_preference_history_mutation/);
  assert.match(migration,/BEFORE UPDATE OR DELETE/);
});

test('migración histórica conserva sólo datos comprobables y es idempotente',()=>{
  assert.match(migration,/legacy-optout:/);
  assert.match(migration,/historicalActorKnown',FALSE/);
  assert.match(migration,/historicalSourceVerified',FALSE/);
  assert.match(migration,/NOT EXISTS[\s\S]*idempotencyKey/);
  assert.doesNotMatch(migration,/UPDATE "User"/);
  assert.doesNotMatch(migration,/DELETE FROM "User"/);
});

test('simulación es sólo lectura y rollback no toca User',()=>{
  assert.match(simulate,/SIMULACION — SIN CAMBIOS/);
  assert.doesNotMatch(simulate,/INSERT INTO "CommunicationPreferenceEvent"/);
  assert.doesNotMatch(simulate,/UPDATE "User"/);
  assert.match(rollback,/DELETE FROM "CommunicationPreferenceEvent"/);
  assert.match(rollback,/legacy-optout-backfill-v7\.10\.6/);
  assert.doesNotMatch(rollback,/UPDATE "User"/);
  assert.doesNotMatch(rollback,/DELETE FROM "User"/);
});

test('nuevas bajas y rehabilitaciones se registran en una misma transacción',()=>{
  assert.match(api,/async function changeCommunicationPreference/);
  assert.match(api,/prisma\.\$transaction\(async \(tx\)=>/);
  assert.match(api,/tx\.communicationPreferenceEvent\.create/);
  assert.match(api,/tx\.user\.update/);
  assert.match(api,/SELF_SERVICE_LINK/);
  assert.match(api,/EMAIL_PROVIDER_ONE_CLICK/);
  assert.match(api,/ADMIN_MAIL_REPLY/);
});

test('Administración puede ver quién está de baja, desde cuándo y su historial',()=>{
  assert.match(api,/\/admin\/communications\/opt-outs/);
  assert.match(admin,/Ver quiénes y desde cuándo/);
  assert.match(admin,/Ver historial/);
  assert.match(admin,/Baja vigente desde/);
  assert.match(admin,/Historial de preferencia/);
});

test('rehabilitación administrativa exige motivo y conserva administrador',()=>{
  assert.match(api,/reason:z\.string\(\)\.trim\(\)\.min\(5\)/);
  assert.match(api,/actorUserId:req\.user\?\.id/);
  assert.match(api,/actorNameSnapshot/);
  assert.match(admin,/Indicá brevemente por qué se rehabilitan las comunicaciones/);
});
