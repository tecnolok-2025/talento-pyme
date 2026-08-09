import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const api = fs.readFileSync(path.join(root, 'apps/api/src/index.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
const candidate = fs.readFileSync(path.join(root, 'apps/web/bolsa-candidato.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'apps/web/admin.html'), 'utf8');
const report = fs.readFileSync(path.join(root, 'apps/api/src/services/traceability-report.js'), 'utf8');
const cv = fs.readFileSync(path.join(root, 'apps/api/src/services/candidate-cv.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'apps/web/config.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8'));

test('v7.9.6 agrega residencia y presentación por voz/texto al perfil candidato', () => {
  assert.match(schema, /paisResidencia\s+String\?/);
  assert.match(schema, /voiceNarrativeRaw\s+String\?/);
  assert.match(schema, /voiceNarrativeSummary\s+String\?/);
  assert.match(candidate, /2\) Contanos con tus palabras · voz o texto/);
  assert.match(candidate, /btnVoiceStart/);
  assert.match(candidate, /btnQuickSaveVoice/);
  assert.match(candidate, /no conserva el audio original/i);
  assert.match(api, /app\.post\('\/candidate\/presentation\/refine'/);
});

test('registro rápido permite guardar datos base y presentación para continuar después', () => {
  assert.match(candidate, /saveAlta\(\{ stayEditing=false, allowPartial=false \} = \{\}\)/);
  assert.doesNotMatch(candidate, /Completá: Área de trabajo, Especialidad, Rango de experiencia y Nivel educativo/);
  assert.match(candidate, /Tu perfil queda esperando para que vuelvas cuando quieras/);
  assert.match(candidate, /voiceNarrativeSummary:/);
  assert.match(candidate, /paisResidencia:/);
});

test('administración muestra presentación personal y trazabilidad geográfica', () => {
  assert.match(admin, /Presentación profesional ampliada por Talento PyME/);
  assert.match(admin, /Texto profesional principal/);
  assert.match(admin, /Candidatos por país de residencia y ciudad/);
  assert.match(admin, /traceCandidateResidenceComposition/);
  assert.match(api, /candidatesByResidence/);
});

test('reporte agrega país y ciudad y reemplaza Actividad general por actividad no especificada', () => {
  assert.match(report, /4\.1 País de residencia y ciudad/);
  assert.match(report, /País de residencia','Ciudad','Cantidad','Participación/);
  assert.doesNotMatch(api, /Actividad general/);
  assert.doesNotMatch(report, /Actividad general/);
  assert.match(api, /Actividad principal no especificada/);
});

test('candidato puede descargar un CV PDF profesional regenerado con datos vigentes', () => {
  assert.match(api, /app\.get\('\/candidate\/cv\/pdf'/);
  assert.match(candidate, /Descargar mi CV PDF/);
  assert.match(candidate, /\/candidate\/cv\/pdf/);
  assert.match(cv, /drawPlaceholder/);
  assert.match(cv, /drawPhoto/);
  assert.match(cv, /voiceNarrativeSummary/);
  assert.match(cv, /Experiencia y trayectoria/);
  assert.match(cv, /Certificaciones y capacitación/);
  assert.match(cv, /CV generado con Talento PyME/);
});

test('presentación aprobada enriquece búsqueda profesional sin exponer transcripción cruda a empresa', () => {
  assert.match(api, /voiceNarrativeSummary:true/);
  assert.match(api, /presentacion_profesional: it\.voiceNarrativeSummary/);
  // La transcripción original está reservada al candidato/admin y no forma parte del payload público de búsqueda.
  const jobsBlock = api.slice(api.indexOf("app.get('/jobs/search'"), api.indexOf("app.get('/jobs/candidate/:id/detail'"));
  assert.doesNotMatch(jobsBlock, /voiceNarrativeRaw/);
});

test('versión unificada 7.9.6', () => {
  assert.equal(pkg.version, '7.9.6');
  assert.match(config, /TP_APP_VERSION = "7\.9\.6"/);
});
