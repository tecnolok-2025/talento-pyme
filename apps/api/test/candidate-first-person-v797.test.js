import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const cv=fs.readFileSync(path.join(root,'apps/api/src/services/candidate-cv.js'),'utf8');
const candidate=fs.readFileSync(path.join(root,'apps/web/bolsa-candidato.js'),'utf8');

const between=(src,a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)+a.length));

test('v7.9.11 obliga a redactar el CV en primera persona y prohíbe voz de evaluador',()=>{
  assert.match(api,/AL CANDIDATO A ESCRIBIR SU PROPIO CURRÍCULUM/);
  assert.match(api,/EN PRIMERA PERSONA/);
  assert.match(api,/Está prohibido redactar como evaluador externo/);
  assert.match(api,/“Soy…”.*“Cuento con…”.*“Me especializo…”.*“Desarrollo…”.*“Superviso…”/s);
});

test('enriquecimiento técnico contempla proyectista eléctrico y supervisión sin inventar logros',()=>{
  const hints=between(api,'function candidateRoleKnowledgeHints','function refineCandidatePresentationLocal');
  assert.match(hints,/esquemas unifilares y trifilares/);
  assert.match(hints,/planos de canalizaciones/);
  assert.match(hints,/dimensionamiento de conductores y protecciones/);
  assert.match(hints,/caída de tensión/);
  assert.match(hints,/seguimiento de ejecución/);
  assert.match(hints,/verificación contra planos\/especificaciones/);
  assert.match(hints,/No atribuir cantidad de personas, presupuesto, obras ni resultados no declarados/);
});

test('respaldo local también redacta en primera persona',()=>{
  const local=between(api,'function refineCandidatePresentationLocal','function responseOutputText');
  assert.match(local,/Soy ingeniero electromecánico y proyectista/);
  assert.match(local,/En mi actividad como proyectista desarrollo/);
  assert.match(local,/En funciones de supervisión realizo/);
  assert.doesNotMatch(local,/La experiencia declarada permite identificar/);
  assert.doesNotMatch(local,/Su experiencia se concentra/);
});

test('CV lateral también habla desde la voz del candidato',()=>{
  assert.match(cv,/function firstPersonTitle/);
  assert.match(cv,/Soy ingeniero electromecánico y proyectista/);
  assert.match(cv,/Me desempeño como proyectista/);
});

test('descarga conserva el nombre cronológico aun si CORS no entrega Content-Disposition',()=>{
  assert.match(api,/exposedHeaders:\['Content-Disposition'\]/);
  assert.match(candidate,/localCandidateCvFilename/);
  assert.match(candidate,/America\/Argentina\/Buenos_Aires/);
  assert.match(candidate,/CV \$\{full\}\.pdf/);
  assert.match(cv,/CV \$\{safeFilePart\(full\)\.replace\(\/-\/g,' '\)\}\.pdf/);
});
