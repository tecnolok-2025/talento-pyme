import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'apps/web/admin.html'),'utf8');
const config=fs.readFileSync(path.join(root,'apps/web/config.js'),'utf8');

test('v8.0.4 expone selector de grupo general en Correo / Consultas',()=>{
  assert.match(admin,/id="communicationCandidateClass"/);
  assert.match(admin,/Grupo general de candidatos/);
  assert.match(admin,/Todos los candidatos/);
});

test('API segmenta candidatos por CandidateClassification.classKey',()=>{
  assert.match(api,/async function listBulkCommunicationRecipients\(audience, \{classKey='ALL'\}=\{\}\)/);
  assert.match(api,/candidateClassification:\{ is:\{ classKey:normalizedClassKey \} \}/);
  assert.match(api,/candidateSegments=classKeys\.map/);
});

test('último correo y correo nuevo respetan el grupo elegido',()=>{
  assert.match(admin,/latest-template\?audience=.*classKey=/s);
  assert.match(admin,/JSON\.stringify\(\{ audience, classKey, subject, body, onlyNotPreviouslySent \}\)/);
  assert.match(api,/Grupo de candidatos inválido/);
  assert.match(api,/listBulkCommunicationRecipients\(audience,\{classKey:audience==='CANDIDATE'\?normalizedClassKey:'ALL'\}\)/);
});

test('versión web v8.0.5',()=>assert.match(config,/TP_APP_VERSION = "8\.0\.5"/));
