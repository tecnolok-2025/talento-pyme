import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../src/index.js', import.meta.url),'utf8');
const web=fs.readFileSync(new URL('../../web/admin.html', import.meta.url),'utf8');

test('v8.0.8 consolida consultas pendientes APP + EMAIL en una guia general',()=>{
  assert.match(api,/appQuestionCount/);
  assert.match(api,/emailQuestionCount/);
  assert.match(api,/pendingMessages/);
  assert.match(api,/Ayuda IA o del correo de Talento PyME/);
  assert.match(web,/Cargar guía general de respuestas · App \+ Email/);
});

test('la guia solo considera preguntas posteriores a la ultima guia del candidato',()=>{
  assert.match(api,/new Date\(row\.createdAt\)>coveredAt/);
  assert.match(api,/SUPPORT_DETAIL_RECIPIENT_MODES/);
});

test('chat operador muestra solo consultas pendientes',()=>{
  assert.match(api,/pendingUserMessages/);
  assert.match(api,/if\(!pendingUserMessages\.length\) continue/);
  assert.match(api,/pendingOnly:true/);
  assert.match(web,/Las respondidas, programadas y los rebotes no se muestran aquí/);
});

test('rebotes y automaticos de Gmail no reaparecen como consultas',()=>{
  assert.match(api,/category:'CONSULTATION'/);
  assert.match(api,/validInboundRefs/);
  assert.match(api,/String\(m\.source\|\|'APP'\)\.toUpperCase\(\)!=='EMAIL'/);
});

test('una nueva consulta posterior vuelve a abrir el hilo',()=>{
  assert.match(api,/new Date\(m\.createdAt\)>resolvedCutoff/);
});
