import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const schema=fs.readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
const web=fs.readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const bolsa=fs.readFileSync(new URL('../../web/bolsa-candidato.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../../web/admin.html',import.meta.url),'utf8');

test('registro instrumentado sin PII',()=>{
  assert.match(schema,/model RegistrationAuditEvent/);
  assert.doesNotMatch(schema,/RegistrationAuditEvent[\s\S]{0,400}(email|dni|password)/i);
  assert.match(web,/auditRegistration\('STARTED'/);
  assert.match(api,/eventType:'RESULT', outcome:'SUCCESS'/);
  assert.match(api,/eventType:'RESULT', outcome:'REJECTED'/);
});

test('panel administrativo muestra diagnóstico de 72 h',()=>{
  assert.match(admin,/Auditoría de registro · últimas 72 h/);
  assert.match(admin,/Verificar alta de candidatos/);
  assert.match(api,/\/admin\/registration-audit'/);
  assert.match(api,/\/admin\/registration-audit\/check'/);
});

test('semaforo separa perfil laboral de experiencia y formación',()=>{
  assert.match(bolsa,/label: 'Perfil laboral'[\s\S]*?Área de trabajo y especialidad/);
  assert.match(bolsa,/label: 'Experiencia y formación'[\s\S]*?Experiencia declarada y nivel educativo/);
  assert.match(bolsa,/complete: hasMeaningfulValue\(candidate\.areaTrabajo\).*candidate\.especialidad/);
});
