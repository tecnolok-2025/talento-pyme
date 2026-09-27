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

test('aptitudes limitadas a evidencia, sin obligación de llenar diez',()=>{
assert.match(api,/hasta 10 aptitudes/);assert.match(api,/minItems:0,maxItems:10/);
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

test('la redacción IA no atribuye tareas típicas no declaradas',()=>{
assert.match(api,/No atribuyas tareas típicas del oficio/);
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
  assert.match(admin,/Aptitudes declaradas/);
  assert.match(admin,/Motivación y objetivo profesional/);
  assert.match(admin,/Cierre y proyección profesional/);
});

test('candidatos con versión vieja vuelven a tener pendiente la nueva presentación enriquecida',()=>{
  assert.match(api,/AI_V710_EVIDENCE_ONLY/);
  assert.match(api,/voiceNarrativeAnalysisVersion[^\n]+PRESENTATION_ANALYSIS_VERSION/);
  assert.match(api,/AI_V710_EVIDENCE_ONLY/);
});
