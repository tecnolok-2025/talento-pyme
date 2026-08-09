import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = fs.readFileSync(path.resolve(here, '../src/index.js'), 'utf8');
const admin = fs.readFileSync(path.resolve(here, '../../web/admin.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8'));

test('v7.9.10 incorpora envio de respuesta de operador tambien por email', () => {
  assert.equal(pkg.version, '7.9.10');
  assert.match(api, /emailAlso/);
  assert.match(api, /sendSupportOperatorEmail/);
  assert.match(api, /clampMultilineText/);
  assert.match(api, /SUPPORT_EMAIL_SENT/);
  assert.match(admin, /Responder \+ enviar por email/);
});

test('v7.9.10 permite reenviar ultimo mensaje informado por email', () => {
  assert.match(api, /\/admin\/chat\/resend-last-email/);
  assert.match(api, /SUPPORT_EMAIL_RESENT/);
  assert.match(api, /actor === 'OPERATOR'/);
  assert.match(admin, /Reenviar último mensaje informado por email/);
});

test('v7.9.10 utiliza correo institucional existente y no agrega credenciales', () => {
  assert.match(api, /FACTORY_SUPPORT_EMAIL/);
  assert.match(api, /GMAIL_APP_PASSWORD/);
  assert.match(api, /from:`"\$\{MAIL_FROM_NAME\}" <\$\{GMAIL_USER\}>`/);
  assert.doesNotMatch(api, /talentopyme00@gmail\.com/);
});

test('v7.9.10 muestra el contenido real del chat operador', () => {
  assert.doesNotMatch(admin, /__KEEP__/);
  assert.match(admin, /esc\(m\.content \|\| ''\)/);
});

test('v7.9.10 no requiere cambio de schema para los envios', () => {
  const schema = fs.readFileSync(path.resolve(here, '../prisma/schema.prisma'), 'utf8');
  assert.match(schema, /model SupportMessage/);
  assert.doesNotMatch(schema, /SupportEmailLog/);
});
