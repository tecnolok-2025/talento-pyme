import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferResidence } from '../src/services/residence.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const schema=fs.readFileSync(path.join(root,'apps/api/prisma/schema.prisma'),'utf8');
const candidate=fs.readFileSync(path.join(root,'apps/web/bolsa-candidato.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'apps/web/admin.html'),'utf8');
const cv=fs.readFileSync(path.join(root,'apps/api/src/services/candidate-cv.js'),'utf8');

test('v7.9.12 infiere ciudad, provincia y país para localidades argentinas inequívocas',()=>{
  assert.deepEqual(inferResidence({locality:'Campana'}),{city:'Campana',province:'Buenos Aires',country:'Argentina',inferred:true});
  assert.equal(inferResidence({locality:'Rosario'}).province,'Santa Fe');
  assert.equal(inferResidence({locality:'CABA'}).country,'Argentina');
  assert.equal(inferResidence({locality:'San Nicolás'}).province,'Buenos Aires');
  assert.equal(inferResidence({locality:'General Rodríguez'}).country,'Argentina');
});

test('v7.9.12 guarda provincia de residencia y metadatos del análisis profesional',()=>{
  assert.match(schema,/provinciaResidencia\s+String\?/);
  assert.match(schema,/voiceNarrativeAnalysisVersion\s+String\?/);
  assert.match(schema,/voiceNarrativeAnalysisSource\s+String\?/);
  assert.match(schema,/voiceNarrativeYears\s+Int\?/);
  assert.match(schema,/voiceNarrativeProfessionalTitle\s+String\?/);
  assert.match(api,/inferResidence\(\{ locality:data\.localidad/);
});

test('presentación se corrige sólo por acción explícita del candidato y toma todo el relato',()=>{
  assert.doesNotMatch(candidate,/scheduleVoiceRefine/);
  assert.doesNotMatch(candidate,/setTimeout\([^)]*refineVoicePresentation/);
  assert.match(candidate,/Corrección IA profesional/);
  assert.match(candidate,/(?:leer|leyendo|analizar|analizando).*todo tu relato desde el principio/i);
  assert.match(candidate,/voiceNarrativeAnalysisVersion=''/);
  assert.match(candidate,/Presentación profesional desarrollada por IA/);
  assert.match(api,/persistedAsDefault/);
  assert.match(api,/voiceNarrativeSummary:analysis\.summary/);
  assert.match(api,/prisma\.candidateBolsa\.update/);
});

test('API puede usar IA generativa server-side y conserva un respaldo local',()=>{
  assert.match(api,/OPENAI_API_KEY/);
  assert.match(api,/https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(api,/store:false/);
  assert.match(api,/refineCandidatePresentationWithAI/);
  assert.match(api,/refineCandidatePresentationLocal/);
  assert.match(api,/fallbackUsed/);
});

test('años explícitos de trayectoria tienen prioridad sobre una etiqueta junior aislada',()=>{
  assert.match(api,/extractExplicitYearsFromText/);
  assert.match(api,/explicitYears >= 31/);
  assert.match(api,/La experiencia explícita tiene prioridad sobre palabras sueltas/);
  assert.match(api,/juniorHit && \(explicitYears === null \|\| explicitYears <= 5\)/);
});

test('candidatos antiguos quedan con la nueva presentación pendiente hasta reprocesarla',()=>{
  assert.match(candidate,/hasMeaningfulValue\(candidate\.voiceNarrativeAnalysisVersion\)/);
  assert.match(api,/presentación profesional'.*voiceNarrativeAnalysisVersion/s);
});

test('administración prioriza el resumen elaborado y no muestra la transcripción cruda como ficha principal',()=>{
  assert.match(admin,/Presentación profesional ampliada por Talento PyME/);
  assert.match(admin,/Años de experiencia detectados/);
  assert.doesNotMatch(admin,/candidateField\('Transcripción original'/);
});

test('CV usa residencia inferida y el título profesional detectado cuando corresponde',()=>{
  assert.match(cv,/inferResidence/);
  assert.match(cv,/voiceNarrativeProfessionalTitle/);
  assert.match(cv,/const location=\[city,province,country\]/);
});
