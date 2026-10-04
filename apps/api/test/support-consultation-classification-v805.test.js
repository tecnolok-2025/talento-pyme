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
const pkg=JSON.parse(fs.readFileSync(path.join(root,'apps/api/package.json'),'utf8'));

test('clasifica cada consulta como cubierta o nueva',()=>{
  assert.match(api,/classifySupportConsultationStatus/);
  assert.match(api,/key:'COVERED'/);
  assert.match(api,/Consulta nueva \/ requiere ampliar respuesta/);
  assert.match(api,/bestKnowledgeScore >= 3/);
});

test('Chat operador expone contadores separados y etiqueta cada consulta',()=>{
  assert.match(admin,/id="chatCoveredCount"/);
  assert.match(admin,/id="chatNewCount"/);
  assert.match(admin,/Tema ya cubierto/);
  assert.match(admin,/Consulta nueva \/ requiere ampliar respuesta/);
  assert.match(admin,/consultationClassification/);
});

test('API devuelve contadores globales y por hilo',()=>{
  assert.match(api,/consultationCounters:\{ covered:threadCoveredCount, new:threadNewCount/);
  assert.match(api,/consultationCounters:\{ covered:coveredCount, new:newCount/);
  assert.match(api,/lastConsultationClassification/);
});

test('Correo Consultas muestra desglose cubierto versus nuevo',()=>{
  assert.match(api,/coveredQuestionCount/);
  assert.match(api,/newQuestionCount/);
  assert.match(admin,/tema ya cubierto/);
  assert.match(admin,/consulta nueva \/ requiere ampliar/);
});

test('versión activa v8.0.5 sin migración nueva',()=>{
  assert.equal(pkg.version,'8.0.5');
  assert.match(config,/TP_APP_VERSION = "8\.0\.5"/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'apps/api/prisma/schema.prisma'),'utf8'),/consultationClassification/);
});
