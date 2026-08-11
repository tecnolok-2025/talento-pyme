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

test('administración deriva la recuperación de clave al correo registrado', () => {
  assert.match(apiSource, /app\.post\('\/admin\/users\/:userId\/send-password-recovery'/);
  assert.match(apiSource, /Por seguridad, la contraseña sólo puede restablecerse mediante verificación por correo/);
  assert.match(adminHtml, /Enviar recuperación por correo/);
  assert.match(adminHtml, /Administración ya no puede ver ni asignar contraseñas/);
});

test('administración puede buscar candidatos y empresas por identidad', () => {
  assert.match(apiSource, /candidateSearch/);
  assert.match(apiSource, /companySearch/);
  assert.match(adminHtml, /Palabra clave: nombre, expertise, CV, experiencia, estudios/);
  assert.match(adminHtml, /Palabra clave: empresa, actividad, búsqueda, ciudad, CUIT/);
});
