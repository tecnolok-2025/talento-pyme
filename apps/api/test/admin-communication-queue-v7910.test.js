import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = fs.readFileSync(path.resolve(here, '../src/index.js'), 'utf8');
const admin = fs.readFileSync(path.resolve(here, '../../web/admin.html'), 'utf8');
const schema = fs.readFileSync(path.resolve(here, '../prisma/schema.prisma'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8'));

test('v7.9.12 usa cola persistente y no SMTP sincrónico desde el botón', () => {
  assert.equal(pkg.version, '7.9.12');
  assert.match(schema, /model AdminCommunicationRecipient/);
  assert.match(schema, /status\s+String\s+@default\("QUEUED"\)/);
  assert.match(api, /adminCommunicationRecipient\.createMany/);
  assert.match(api, /processCommunicationQueueOnce/);
});

test('v7.9.12 fija límite conservador máximo de 450 comunicaciones por día', () => {
  assert.match(api, /COMMUNICATION_DAILY_LIMIT[\s\S]*Math\.min\(450/);
  assert.match(api, /communicationRolling24hUsage/);
  assert.match(api, /rolling\.count >= COMMUNICATION_DAILY_LIMIT/);
  assert.match(admin, /Máximo 450 comunicaciones en cualquier período móvil de 24 horas/);
});

test('v7.9.12 continúa automáticamente al día siguiente', () => {
  assert.match(api, /WAITING_DAILY_LIMIT/);
  assert.match(api, /nextAvailableAt/);
  assert.match(api, /buenosAiresDayKey/);
  assert.match(admin, /continúan automáticamente cuando se libera cupo/);
});

test('v7.9.12 procesa una sola campaña por vez y respeta orden FIFO', () => {
  assert.match(api, /orderBy:\{ createdAt:'asc' \}/);
  assert.match(api, /Una campaña por vez/);
  assert.match(admin, /Una nueva comunicación espera hasta que termine la anterior/);
});

test('v7.9.12 separa envíos con pacing persistente', () => {
  assert.match(api, /COMMUNICATION_SEND_INTERVAL_MS/);
  assert.match(api, /lastSent/);
  assert.match(api, /sentAt:'desc'/);
  assert.match(admin, /Ritmo: 1 correo cada/);
});

test('v7.9.12 reintenta errores temporales sin depender del administrador', () => {
  assert.match(api, /WAITING_RETRY/);
  assert.match(api, /COMMUNICATION_RETRY_MINUTES/);
  assert.match(api, /reintentará automáticamente/);
  assert.match(api, /startCommunicationQueueScheduler\(\)/);
});

test('v7.9.12 vuelve a comprobar la baja antes de cada envío', () => {
  assert.match(api, /resolveCommunicationRecipient/);
  assert.match(api, /bulkEmailOptOutAt/);
  assert.match(api, /SKIPPED_OPTOUT/);
});

test('v7.9.12 panel muestra progreso, límite diario y cantidad en cola', () => {
  assert.match(admin, /commSentToday/);
  assert.match(admin, /commRemainingToday/);
  assert.match(admin, /commQueueCount/);
  assert.match(admin, /commActiveProgress/);
  assert.match(admin, /Programar comunicación/);
});


test('v7.9.12 incorpora cancelación de emergencia de pendientes', () => {
  assert.match(api, /\/admin\/communications\/:communicationId\/cancel/);
  assert.match(api, /status:'CANCELLED'/);
  assert.match(admin, /Cancelar pendientes de esta comunicación/);
  assert.match(admin, /Los ya enviados no pueden retirarse/);
});
