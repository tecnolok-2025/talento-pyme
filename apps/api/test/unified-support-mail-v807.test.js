import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const api=fs.readFileSync(new URL('../src/index.js', import.meta.url),'utf8');
const schema=fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url),'utf8');
const web=fs.readFileSync(new URL('../../web/admin.html', import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../prisma/migrations/20261005_v807_unified_support_email/migration.sql', import.meta.url),'utf8');

test('v8.0.7 unifica consultas APP + EMAIL y clasifica origen',()=>{
  assert.match(api,/syncSupportMailbox/);
  assert.match(api,/source:'EMAIL'/);
  assert.match(schema,/source\s+String\s+@default\("APP"\)/);
  assert.match(web,/Bandeja unificada App \+ Email/);
  assert.match(web,/EMAIL':'APP/);
});

test('v8.0.7 separa rebotes definitivos y temporales',()=>{
  assert.match(api,/BOUNCE_PERMANENT/);
  assert.match(api,/BOUNCE_TEMPORARY/);
  assert.match(api,/extractBounceTargetEmail/);
  assert.match(web,/Rebotes definitivos/);
  assert.match(web,/Rebotes temporales/);
});

test('rebote definitivo genera supresion y se excluye de futuros envios',()=>{
  assert.match(schema,/model EmailSuppression/);
  assert.match(api,/emailSuppression\.upsert/);
  assert.match(api,/suppressedSet\.has\(r\.email\)/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS "EmailSuppression"/);
});

test('consultas email ingresan al mismo SupportThread y usan clasificacion cubierta\/nueva',()=>{
  assert.match(api,/getOrCreateSupportThreadForInboundEmail/);
  assert.match(api,/classifySupportConsultationStatus\(bodyText\|\|subject,matchedRole,knowledgeRows\)/);
  assert.match(api,/status:'WAITING_OPERATOR'/);
});

test('sincronizacion manual y automatica cada 30 minutos',()=>{
  assert.match(api,/\/admin\/mail\/sync/);
  assert.match(api,/30\*60\*1000/);
  assert.match(api,/startSupportMailboxScheduler\(\)/);
  assert.match(web,/Sincronizar correo/);
});
