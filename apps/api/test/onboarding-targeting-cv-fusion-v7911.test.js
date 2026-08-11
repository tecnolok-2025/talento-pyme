import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const apiRoot=path.resolve(here,'..');
const repo=path.resolve(apiRoot,'..');
const api=fs.readFileSync(path.join(apiRoot,'src/index.js'),'utf8');
const schema=fs.readFileSync(path.join(apiRoot,'prisma/schema.prisma'),'utf8');
const cv=fs.readFileSync(path.join(apiRoot,'src/services/candidate-cv.js'),'utf8');
const report=fs.readFileSync(path.join(apiRoot,'src/services/traceability-report.js'),'utf8');
const web=fs.readFileSync(path.join(repo,'web/bolsa-candidato.js'),'utf8');
const register=fs.readFileSync(path.join(repo,'web/index.html'),'utf8');
const admin=fs.readFileSync(path.join(repo,'web/admin.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(apiRoot,'package.json'),'utf8'));

test('v7.9.16 unifica versión',()=>assert.equal(pkg.version,'7.9.16'));
test('comunicación segura queda por defecto sólo para no informados',()=>{
  assert.match(admin,/communicationOnlyUnsent[^>]+checked/);
  assert.match(admin,/onlyUnsent:true/);
  assert.match(api,/onlyNotPreviouslySent:z\.boolean\(\)\.optional\(\)\.default\(true\)/);
  assert.match(api,/status:\{in:\['SENT','PENDING'\]\}/);
});
test('se puede destildar y enviar a todo el padrón elegible',()=>{
  assert.match(admin,/onlyNotPreviouslySent = document\.getElementById\('communicationOnlyUnsent'\)/);
  assert.match(api,/recipientMode:onlyNotPreviouslySent \? 'UNSENT_ONLY' : 'ALL_ELIGIBLE'/);
});
test('bienvenida queda en cola persistente y se envía sin intervención administrativa',()=>{
  assert.match(schema,/welcomeEmailQueuedAt\s+DateTime\?/);
  assert.match(schema,/welcomeEmailSentAt\s+DateTime\?/);
  assert.match(api,/welcomeEmailQueuedAt:new Date\(\)/);
  assert.match(api,/processWelcomeEmailQueueOnce/);
  assert.match(api,/Bienvenido a Talento PyME · Tu perfil ya está registrado/);
  assert.match(api,/“Presentación Personal”/);
  assert.match(api,/“Corrección IA profesional”/);
  assert.match(api,/“Descargar mi CV PDF”/);
});
test('bienvenida comparte el techo automático conservador de 450 en 24 horas',()=>{
  assert.match(api,/campaignCount, welcomeCount/);
  assert.match(api,/rolling\.count>=COMMUNICATION_DAILY_LIMIT/);
  assert.match(api,/Math\.min\(450/);
});
test('registro candidato exige provincia o región y país',()=>{
  assert.match(register,/Provincia \/ Estado \/ Región/);
  assert.match(register,/País de residencia/);
  assert.match(api,/Provincia \/ Estado \/ Región requerida/);
  assert.match(api,/País de residencia requerido/);
  assert.match(schema,/country\s+String\?/);
});
test('trazabilidad informa país provincia y ciudad',()=>{
  assert.match(report,/4\.1 País, provincia \/ región y ciudad de residencia/);
  assert.match(report,/Provincia \/ región/);
  assert.match(report,/Candidatos con provincia \/ región identificada/);
  assert.match(api,/candidatesWithResidenceProvince/);
});
test('Corrección IA fusiona presentación y CV completo sin duplicarlos',()=>{
  assert.match(api,/AI_V7_7\.9\.11_VOICE_CV_FUSION/);
  assert.match(api,/cv_education/);
  assert.match(api,/cv_certifications/);
  assert.match(api,/cv_observations/);
  assert.match(api,/No pegues ni repitas las dos fuentes una detrás de otra/);
  assert.match(api,/combinedSource=\[source,context\?\.resumeSummary,context\?\.resumeExperience/);
});
test('cargar un CV invalida sólo el análisis y obliga a corrección IA explícita',()=>{
  assert.match(api,/CV_UPDATED_REQUIRES_REFINEMENT/);
  assert.match(api,/voiceNarrativeAnalysisVersion:null/);
  assert.match(web,/CV leído y guardado\. Para fusionar estos antecedentes/);
  assert.match(web,/Corrección IA profesional/);
});
test('CV final evita repetir líneas ya integradas en la presentación',()=>{
  assert.match(cv,/function overlapsNarrative/);
  assert.match(cv,/experienceHighlights\(r\.experience,presentation\)/);
});
test('candidato dispone de CV tipo ficticio',()=>{
  assert.match(api,/\/candidate\/cv\/sample\.pdf/);
  assert.match(cv,/buildCandidateSampleCvData/);
  assert.match(cv,/EJEMPLO · DATOS FICTICIOS/);
  assert.match(web,/Ver CV tipo/);
  assert.match(web,/datos ficticios de un supervisor eléctrico/);
});
