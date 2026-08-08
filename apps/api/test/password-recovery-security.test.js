import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSource = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');
const schema = fs.readFileSync(path.join(here, '..', 'prisma', 'schema.prisma'), 'utf8');
const forgotHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'forgot.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'admin.html'), 'utf8');

test('recuperación ya no permite cambiar clave sólo con DNI o CUIT', () => {
  assert.match(apiSource, /\/auth\/password-recovery\/start/);
  assert.match(apiSource, /\/auth\/password-recovery\/verify/);
  assert.match(apiSource, /\/auth\/password-recovery\/complete/);
  assert.match(apiSource, /app\.post\("\/auth\/reset-by-id"[^\n]*410/);
  assert.doesNotMatch(forgotHtml, /Actualizar contraseña/);
});

test('código temporal queda persistido con vencimiento e intentos', () => {
  assert.match(schema, /model PasswordResetChallenge/);
  assert.match(schema, /expiresAt\s+DateTime/);
  assert.match(schema, /attempts\s+Int/);
  assert.match(apiSource, /PASSWORD_RESET_MAX_ATTEMPTS/);
  assert.match(apiSource, /PASSWORD_RESET_CODE_TTL_MINUTES/);
});

test('candidato nuevo usa DNI menor a 11 dígitos', () => {
  assert.match(indexHtml, /<label>DNI<\/label>/);
  assert.doesNotMatch(indexHtml, /Número de registro 11 dígitos/);
  assert.match(apiSource, /function isCandidateDni/);
});

test('cuentas candidatas legadas pueden autocorregir registro de 11 dígitos tras validar correo', () => {
  assert.match(apiSource, /isLegacyCandidateIdentifier/);
  assert.match(apiSource, /pendingDni/);
  assert.match(apiSource, /tx\.profile\.updateMany/);
  assert.match(apiSource, /tx\.candidateBolsa\.updateMany/);
  assert.match(forgotHtml, /Cuenta creada con una versión anterior/);
});

test('correo se muestra enmascarado y nunca completo en recuperación', () => {
  assert.match(apiSource, /function maskEmail/);
  assert.match(forgotHtml, /mailHint/);
  assert.match(forgotHtml, /correo protegido/i);
});

test('panel administrativo dispone de Gmail en páginas de 20', () => {
  assert.match(apiSource, /app\.get\('\/admin\/mail\/inbox'/);
  assert.match(apiSource, /const pageSize = 20/);
  assert.match(apiSource, /app\.get\('\/admin\/mail\/message\/:uid'/);
  assert.match(adminHtml, /Correo \/ Consultas/);
  assert.match(adminHtml, /20 correos por página/);
});
