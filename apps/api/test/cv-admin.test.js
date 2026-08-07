import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');

test('resume/parse persiste el contenido útil del CV', async () => {
  const api = await fs.readFile(path.join(root, 'apps/api/src/index.js'), 'utf8');
  const parseStart = api.indexOf('app.post("/resume/parse"');
  const parseEnd = api.indexOf('app.get("/resume/me"', parseStart);
  const block = api.slice(parseStart, parseEnd);
  assert.ok(block.includes('prisma.resume.upsert'));
  assert.ok(block.includes('summary: clampText(summaryText'));
  assert.ok(block.includes('experience: clampText(sections?.experience'));
  assert.ok(block.includes('education: clampText(sections?.education'));
  assert.ok(block.includes('certifications: clampText(sections?.certifications'));
});

test('detalle administrativo usa resumen legado como respaldo', async () => {
  const api = await fs.readFile(path.join(root, 'apps/api/src/index.js'), 'utf8');
  assert.ok(api.includes("const legacyCvSummary = String(candidate.candidateBolsa?.observaciones || '').trim();"));
  assert.ok(api.includes('resume: resumeForAdmin'));
  assert.ok(api.includes("profileStatus: cvContentAvailable ? 'CV / resumen cargado'"));
});

test('administración muestra bloque específico de CV', async () => {
  const html = await fs.readFile(path.join(root, 'apps/web/admin.html'), 'utf8');
  assert.ok(html.includes('CV cargado · contenido disponible para Administración'));
  assert.ok(html.includes('Resumen generado automáticamente'));
  assert.ok(html.includes('Experiencia extraída del CV'));
  assert.ok(html.includes('Educación / formación extraída'));
});
