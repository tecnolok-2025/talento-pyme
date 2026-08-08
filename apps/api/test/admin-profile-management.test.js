import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSource = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'admin.html'), 'utf8');

test('administración dispone de perfil completo de empresas', () => {
  assert.match(apiSource, /app\.get\('\/admin\/companies\/:companyId\/detail'/);
  assert.match(adminHtml, /data-tab="company-records"/);
  assert.match(adminHtml, /id="companyDirectoryList"/);
  assert.match(adminHtml, /renderCompanyDetail/);
});

test('administración puede restablecer clave de candidatos y empresas sin verla', () => {
  assert.match(apiSource, /app\.post\('\/admin\/users\/:userId\/reset-password'/);
  assert.match(apiSource, /bcrypt\.hash\(parsed\.data\.newPassword, 10\)/);
  assert.match(adminHtml, /Asignar nueva clave/);
  assert.match(adminHtml, /La contraseña actual no puede visualizarse/);
});

test('administración puede buscar candidatos y empresas por identidad', () => {
  assert.match(apiSource, /candidateSearch/);
  assert.match(apiSource, /companySearch/);
  assert.match(adminHtml, /Buscar por nombre, DNI o mail/);
  assert.match(adminHtml, /Buscar por empresa, contacto, CUIT o mail/);
});
