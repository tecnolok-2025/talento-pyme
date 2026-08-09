import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const cv=fs.readFileSync(path.join(root,'apps/api/src/services/candidate-cv.js'),'utf8');
const web=fs.readFileSync(path.join(root,'apps/web/bolsa-candidato.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'apps/web/admin.html'),'utf8');
const schema=fs.readFileSync(path.join(root,'apps/api/prisma/schema.prisma'),'utf8');

const between=(src,a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));

test('v7.9.7 genera diez aptitudes profesionales editables, no opiniones de un tercero',()=>{
  const prompt=between(api,"{ role:'system'","{ role:'user'");
  assert.match(prompt,/EXACTAMENTE 10 aptitudes\/competencias/);
  assert.match(prompt,/no opiniones de un tercero/);
  assert.match(prompt,/primera persona/i);
  assert.match(api,/minItems:10,maxItems:10/);
  assert.match(web,/10 aptitudes y fortalezas profesionales sugeridas · editables/);
  assert.match(web,/c_voice_strengths/);
});

test('la motivación cambia según seniority y contempla candidato que ya trabaja',()=>{
  const local=between(api,'function buildProfessionalMotivationLocal','function buildProfessionalClosingLocal');
  assert.match(local,/SENIOR/);
  assert.match(local,/SEMI_SENIOR/);
  assert.match(local,/JUNIOR/);
  assert.match(local,/primera oportunidad/);
  assert.match(local,/nuevos desafíos/);
  assert.match(api,/currently_working/);
  assert.match(api,/Si currently_working es true, no escribir como si estuviera desempleado/);
});

test('proyectista eléctrico recibe vocabulario técnico útil para expresar su expertise',()=>{
  const strengths=between(api,'function inferProfessionalStrengthsLocal','function buildProfessionalMotivationLocal');
  assert.match(strengths,/esquemas unifilares y trifilares/);
  assert.match(strengths,/canalizaciones, tendidos y distribución eléctrica/);
  assert.match(strengths,/Cálculo de cargas, demanda y dimensionamiento eléctrico/);
  assert.match(strengths,/Dimensionamiento de conductores y protecciones/);
  assert.match(strengths,/Supervisión técnica de trabajos y obras/);
  assert.match(strengths,/Control de avance, calidad y cumplimiento técnico/);
});

test('CV incorpora fortalezas y un cierre profesional en primera persona',()=>{
  assert.match(cv,/Aptitudes y fortalezas profesionales/);
  assert.match(cv,/Motivación y proyección profesional/);
  assert.match(cv,/voiceNarrativeStrengths/);
  assert.match(cv,/voiceNarrativeMotivation/);
  assert.match(cv,/voiceNarrativeClosing/);
  assert.match(cv,/CV preparado por el candidato con asistencia de Talento PyME/);
});

test('campos nuevos se guardan, quedan editables y Administración los puede leer',()=>{
  assert.match(schema,/voiceNarrativeStrengths String\[\]/);
  assert.match(schema,/voiceNarrativeMotivation String\?/);
  assert.match(schema,/voiceNarrativeClosing String\?/);
  assert.match(web,/voiceNarrativeStrengths:/);
  assert.match(web,/voiceNarrativeMotivation:/);
  assert.match(web,/voiceNarrativeClosing:/);
  assert.match(admin,/10 aptitudes \/ fortalezas profesionales/);
  assert.match(admin,/Motivación y objetivo profesional/);
  assert.match(admin,/Cierre y proyección profesional/);
});

test('candidatos con versión vieja vuelven a tener pendiente la nueva presentación enriquecida',()=>{
  assert.match(api,/AI_V6_7\.9\.7_STRENGTHS_MOTIVATION/);
  assert.match(api,/voiceNarrativeAnalysisVersion[^\n]+PRESENTATION_ANALYSIS_VERSION/);
  assert.match(api,/String\(candidate\.voiceNarrativeMotivation/);
});
