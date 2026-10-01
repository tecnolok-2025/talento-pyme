import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const schema=fs.readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../../web/admin.html',import.meta.url),'utf8');
const env=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

function block(start,end){
  const a=api.indexOf(start), b=api.indexOf(end,a);
  assert.ok(a>=0 && b>a,`No se encontró bloque ${start}`);
  return api.slice(a,b);
}

test('v7.10.9 incorpora cache persistente versionada sin tocar datos fuente',()=>{
  assert.equal(pkg.version,'7.10.9');
  assert.match(schema,/model CandidateClassification\s*\{/);
  assert.match(schema,/userId\s+String\s+@unique/);
  assert.match(schema,/classificationVersion\s+String/);
  assert.match(schema,/sourceFingerprint\s+String/);
  assert.match(schema,/classifiedAt\s+DateTime/);
  assert.match(schema,/candidateClassification\s+CandidateClassification\?/);
});

test('clasificador automático evita secretos y datos ajenos al perfil profesional',()=>{
  const b=block('function candidateClassificationSourcePayload','function candidateClassificationFingerprint');
  assert.doesNotMatch(b,/passHash|password|photoDataUrl|billing|payment|securityEvent/i);
  assert.match(b,/ultimoTrabajo/);
  assert.match(b,/voiceNarrativeRaw/);
  assert.doesNotMatch(b,/voiceNarrativeSummary|voiceNarrativeProfessionalTitle|voiceNarrativeStrengths|voiceNarrativeMotivation|voiceNarrativeClosing/);
  assert.match(b,/experience:r\.experience/);
  assert.match(b,/education:r\.education/);
});

test('mismo motor queda enganchado a todos los cambios profesionales principales',()=>{
  for(const trigger of ['REGISTRATION','REGISTRATION_UPGRADE','PROFILE_UPDATED','CV_PARSED','CV_UPDATED','PRESENTATION_REFINED','BOLSA_UPDATED']){
    assert.match(api,new RegExp(`queueCandidateClassification\\([^\\n]+['\"]${trigger}['\"]`));
  }
});

test('scheduler hace barrido inicial completo e incremental para captar importaciones externas',()=>{
  const b=block('async function processAutomaticCandidateClassificationsOnce','async function candidateClassificationStatusSummary');
  assert.match(b,/fullSweep/);
  assert.match(b,/where:\{ role:'CANDIDATE' \}/);
  assert.match(b,/candidateProfile:\{ is:\{ updatedAt:\{ gte:since \} \} \}/);
  assert.match(b,/candidateBolsa:\{ is:\{ updatedAt:\{ gte:since \} \} \}/);
  assert.match(b,/resume:\{ is:\{ updatedAt:\{ gte:since \} \} \}/);
  assert.match(b,/periodicFullSweepDue/);
  assert.match(b,/candidateClassificationLastFullSweepAt/);
  assert.match(api,/startCandidateClassificationScheduler\(\);/);
});

test('procesamiento masivo usa lotes y no deja caer los demás candidatos por una fila fallida',()=>{
  const b=block('async function persistCandidateClassificationRows','function queueCandidateClassification');
  assert.match(b,/CANDIDATE_CLASSIFICATION_BATCH_SIZE/);
  assert.match(b,/prisma\.\$transaction\(operations\)/);
  assert.match(b,/Un registro defectuoso no debe frenar los otros 499/);
  assert.match(b,/for\(const item of chunk\)/);
});

test('admin muestra versión, pendientes y permite recuperación manual',()=>{
  assert.match(api,/app\.get\('\/admin\/classification\/status'/);
  assert.match(api,/app\.post\('\/admin\/classification\/run'/);
  assert.match(admin,/Clasificación automática de candidatos/);
  assert.match(admin,/id="classAutoVersion"/);
  assert.match(admin,/id="classAutoPending"/);
  assert.match(admin,/id="btnRunClassification"/);
  assert.match(admin,/triggerManualClassification/);
});

test('backup lógico incluye la clasificación persistida',()=>{
  const b=block('async function collectLogicalBackupPayload','async function runLogicalBackup');
  assert.match(b,/candidateClassifications/);
  assert.match(b,/prisma\.candidateClassification\.findMany/);
});

test('configuración automática viene habilitada y acotada por defecto',()=>{
  assert.match(env,/CANDIDATE_CLASSIFICATION_AUTO_ENABLED="true"/);
  assert.match(env,/CANDIDATE_CLASSIFICATION_SCAN_SECONDS="60"/);
  assert.match(env,/CANDIDATE_CLASSIFICATION_BATCH_SIZE="100"/);
  assert.match(env,/CANDIDATE_CLASSIFICATION_FULL_SWEEP_HOURS="6"/);
  assert.match(api,/Math\.max\(20, Math\.min\(200/);
});
