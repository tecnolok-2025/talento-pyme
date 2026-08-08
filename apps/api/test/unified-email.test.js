import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSource = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');
const factoryHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'factory.html'), 'utf8');
const helpHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'asistencia.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'admin.html'), 'utf8');

test('una sola variable institucional gobierna soporte, recuperación y buzón', () => {
  assert.match(apiSource, /const FACTORY_SUPPORT_EMAIL/);
  assert.match(apiSource, /const GMAIL_USER = FACTORY_SUPPORT_EMAIL/);
  assert.match(apiSource, /supportEmail: FACTORY_SUPPORT_EMAIL/);
  assert.match(apiSource, /account:maskEmail\(FACTORY_SUPPORT_EMAIL\)/);
});

test('Factory ya no hardcodea factory@gmail.com', () => {
  assert.doesNotMatch(factoryHtml, /factory@gmail\.com/);
  assert.match(factoryHtml, /supportEmailLink/);
});

test('Ayuda IA expone el mismo correo institucional', () => {
  assert.match(apiSource, /suggested, supportEmail: FACTORY_SUPPORT_EMAIL/);
  assert.match(helpHtml, /supportEmailUnified/);
});

test('Administración instruye configurar la variable unificada', () => {
  assert.match(adminHtml, /FACTORY_SUPPORT_EMAIL/);
});
