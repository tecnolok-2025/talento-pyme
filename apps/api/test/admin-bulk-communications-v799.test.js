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

test('v7.9.13 separa comunicaciones a candidatos y empresas', () => {
  assert.equal(pkg.version, '7.9.13');
  assert.match(admin, /Comunicación a candidatos/);
  assert.match(admin, /Comunicación a empresas/);
  assert.match(admin, /Estimado candidato de Talento PyME/);
  assert.match(admin, /Estimada empresa de Talento PyME/);
  assert.match(api, /\/admin\/communications\/send/);
});

test('v7.9.13 respeta baja de comunicaciones informativas', () => {
  assert.match(schema, /bulkEmailOptOutAt\s+DateTime\?/);
  assert.match(api, /BULK_EMAIL_UNSUBSCRIBE/);
  assert.match(api, /app\.post\('\/communications\/unsubscribe'/);
  assert.match(api, /List-Unsubscribe/);
  assert.match(api, /skippedOptOutCount/);
  assert.match(admin, /No enviar \/ baja/);
});

test('v7.9.13 permite gestionar baja desde respuesta recibida', () => {
  assert.match(api, /\/admin\/communications\/preference/);
  assert.match(api, /fromAddress/);
  assert.match(admin, /No enviar más comunicaciones/);
  assert.match(admin, /Volver a habilitar comunicaciones/);
});

test('v7.9.13 agrega pie institucional y evita pedir credenciales', () => {
  assert.match(api, /nunca solicita contraseñas ni códigos de seguridad/);
  assert.match(api, /La baja sólo alcanza a comunicaciones generales/);
  assert.match(api, /FACTORY_SUPPORT_EMAIL/);
  assert.doesNotMatch(api, /talentopyme00@gmail\.com/);
});

test('v7.9.13 registra historial agregado de comunicaciones', () => {
  assert.match(schema, /model AdminCommunication/);
  assert.match(api, /prisma\.adminCommunication\.create/);
  assert.match(admin, /Últimos envíos/);
});
