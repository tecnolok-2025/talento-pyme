import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api=fs.readFileSync(new URL('../src/index.js', import.meta.url),'utf8');
const web=fs.readFileSync(new URL('../../web/admin.html', import.meta.url),'utf8');

test('v8.0.9 bandeja operativa muestra solo consultas pendientes',()=>{
  assert.match(api,/pendingInboundMailConsultations/);
  assert.match(api,/where:\{category:'CONSULTATION'\}/);
  assert.match(api,/receivedAt>cutoff|receivedAt>cutoff/);
  assert.match(web,/Los rebotes, mensajes automáticos y correos ya respondidos no se muestran/);
});

test('rebotes temporales se deduplican por correo y permiten reintento',()=>{
  assert.match(api,/activeTemporaryBounceRows/);
  assert.match(api,/grouped\.get\(email\)/);
  assert.match(api,/recipientMode:'BOUNCE_RETRY'/);
  assert.match(api,/temporary-bounces\/:id\/retry/);
  assert.match(web,/Correos temporales para reintentar/);
  assert.match(web,/>Reenviar</);
});

test('rebote definitivo no puede reintentarse',()=>{
  assert.match(api,/suppression\?\.active/);
  assert.match(api,/quedó suprimido por un rebote definitivo/);
});

test('recuperador de comunicaciones elimina duplicados',()=>{
  assert.match(api,/uniqueCommunicationTemplates/);
  assert.match(api,/duplicateCount/);
  assert.match(web,/Recuperar correo enviado/);
  assert.match(web,/Los correos repetidos se muestran una sola vez/);
});
