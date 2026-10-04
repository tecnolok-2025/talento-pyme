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

test('v8.0.4 agrega grupo dinámico de candidatos con consultas pendientes de respuesta ampliada',()=>{
  assert.match(api,/SUPPORT_DETAIL_SEGMENT_KEY = 'SUPPORT_DETAIL_PENDING'/);
  assert.match(api,/listSupportDetailRecipients/);
  assert.match(api,/actor:'USER'/);
  assert.match(api,/SUPPORT_DETAIL_RECIPIENT_MODES/);
  assert.match(api,/lastQuestionAt>coveredAtByUser\.get\(userId\)/);
});

test('la guía ampliada se arma desde temas realmente consultados',()=>{
  assert.match(api,/buildSupportDetailGuide/);
  assert.match(api,/supportDetailTopicKey/);
  assert.match(api,/Cómo cargar o sacar tu foto/);
  assert.match(api,/Cómo cargar el CV y qué formatos acepta/);
  assert.match(api,/Cómo mejorar tu visibilidad para las empresas/);
  assert.match(api,/Cómo postularte a una oportunidad/);
});

test('Correo Consultas permite seleccionar el grupo y cargar la guía',()=>{
  assert.match(admin,/Detalles de respuestas solicitadas por candidatos|SUPPORT_DETAIL_PENDING/);
  assert.match(admin,/Cargar guía ampliada de respuestas/);
  assert.match(admin,/support-detail-template/);
  assert.match(admin,/reaparecerán automáticamente en este grupo/);
});

test('las campañas especiales quedan trazables sin migración nueva',()=>{
  assert.match(api,/SUPPORT_DETAIL_UNSENT_ONLY/);
  assert.match(api,/SUPPORT_DETAIL_ALL_ELIGIBLE/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'apps/api/prisma/schema.prisma'),'utf8'),/supportDetailRespondedAt/);
});

test('versión web v8.0.4',()=>assert.match(config,/TP_APP_VERSION = "8\.0\.4"/));
