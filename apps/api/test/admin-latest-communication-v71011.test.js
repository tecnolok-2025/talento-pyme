import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = fs.readFileSync(path.resolve(here, '../src/index.js'), 'utf8');
const admin = fs.readFileSync(path.resolve(here, '../../web/admin.html'), 'utf8');
const auth = fs.readFileSync(path.resolve(here, '../../web/auth.js'), 'utf8');
const sw = fs.readFileSync(path.resolve(here, '../../web/sw.js'), 'utf8');
const config = fs.readFileSync(path.resolve(here, '../../web/config.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8'));

test('v7.10.15 discrimina último correo por candidatos y empresas', () => {
  assert.equal(pkg.version, '7.10.15');
  assert.match(api, /where:\{ audience, sentCount:\{ gt:0 \} \}/);
  assert.match(admin, /Cargar último correo enviado a empresas/);
  assert.match(admin, /Cargar último correo enviado a candidatos/);
  assert.match(admin, /latest-template\?audience=/);
});

test('v7.10.15 separa visualmente el historial por padrón', () => {
  assert.match(admin, /communicationHistoryTitle/);
  assert.match(admin, /filter\(\(it\) => String\(it\.audience \|\| ''\)\.toUpperCase\(\) === audience\)/);
});

test('v7.10.15 sincroniza versión visible con API y evita cache viejo', () => {
  assert.match(config, /TP_APP_VERSION = "7\.10\.15"/);
  assert.match(auth, /syncVersionFromApi/);
  assert.match(auth, /\/health/);
  assert.match(auth, /cache:'no-store'/);
  assert.match(sw, /Archivos críticos de versión/);
  assert.match(sw, /config\.js/);
});
