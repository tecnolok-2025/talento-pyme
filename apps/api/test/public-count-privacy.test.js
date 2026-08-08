import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('candidato no ve ni consulta el total global de candidatos', () => {
  const js = read('apps/web/bolsa-candidato.js');
  assert.doesNotMatch(js, /candidatos cargados/i);
  assert.doesNotMatch(js, /\/bolsa\/stats/);
});

test('empresa no ve conteos globales ni conteos por faceta', () => {
  const html = read('apps/web/buscar.html');
  assert.doesNotMatch(html, /CV registrados/i);
  assert.doesNotMatch(html, /statsTotal/);
  assert.doesNotMatch(html, /\$\{jobsItems\.length\}\s*resultado/i);
  assert.match(html, /Áreas disponibles/);
  assert.match(html, /Perfiles disponibles/);
});

test('API reserva totales al administrador y no expone conteos en jobs stats', () => {
  const api = read('apps/api/src/index.js');
  assert.match(api, /app\.get\("\/bolsa\/stats", authRequired, requireAnyRole\(\["ADMIN","SUPERADMIN"\]\)/);
  const start = api.indexOf("app.get('/jobs/stats'");
  const end = api.indexOf("app.get('/jobs/search'", start);
  assert.ok(start >= 0 && end > start, 'No se encontró el bloque /jobs/stats');
  const block = api.slice(start, end);
  assert.doesNotMatch(block, /candidateBolsa\.count\(/);
  assert.doesNotMatch(block, /\btotal\b\s*[,}]/);
  assert.match(block, /Object\.keys\(values \|\| \{\}\)/);
});
