import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const src=fs.readFileSync(path.join(root,'src/index.js'),'utf8');
const web=fs.readFileSync(path.resolve(root,'../web/buscar.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'prisma/migrations/20260927_v7104_additive/migration.sql'),'utf8');

test('Profile, Resume y Bolsa propios exigen rol CANDIDATE',()=>{
  const patterns=[
    /app\.get\("\/profile\/me", auth, requireRole\("CANDIDATE"\)/,
    /app\.put\("\/profile\/me", auth, requireRole\("CANDIDATE"\)/,
    /app\.post\("\/resume\/parse", auth, requireRole\("CANDIDATE"\)/,
    /app\.get\("\/resume\/me", auth, requireRole\("CANDIDATE"\)/,
    /app\.put\("\/resume\/me", auth, requireRole\("CANDIDATE"\)/,
    /app\.get\("\/bolsa\/me", authRequired, requireRole\("CANDIDATE"\)/,
    /app\.post\("\/bolsa\/me", authRequired, requireRole\("CANDIDATE"\)/,
    /app\.post\("\/bolsa\/photo", authRequired, requireRole\("CANDIDATE"\)/,
    /app\.delete\("\/bolsa\/photo", authRequired, requireRole\("CANDIDATE"\)/,
  ];
  for(const rx of patterns) assert.match(src,rx);
});

test('Empresa recibe lectura profesional ampliada sin metadatos técnicos',()=>{
  for(const key of ['experiencia_relevante_anios','fundamento','evidencias','informacion_a_confirmar','fuentes_profesionales']) assert.ok(src.includes(key));
  assert.match(web,/Lectura profesional Talento PyME/);
  assert.match(web,/Experiencia relevante/);
  assert.match(web,/Información a confirmar en entrevista/);
  // No exponer fingerprint ni versión interna en la ficha Empresa.
  const detailBlock=src.slice(src.indexOf("app.get('/jobs/candidate/:id/detail'"),src.indexOf('function isPrivateNetworkAddress'));
  assert.ok(!detailBlock.includes('sourceFingerprint'));
  assert.ok(!detailBlock.includes('classificationVersion'));
});

test('Migración v7.10.13 es aditiva e idempotente',()=>{
  const upper=migration.toUpperCase();
  assert.ok(upper.includes('ADD COLUMN IF NOT EXISTS'));
  assert.ok(upper.includes('CREATE TABLE IF NOT EXISTS'));
  assert.ok(upper.includes('CREATE INDEX IF NOT EXISTS'));
  for(const forbidden of ['DROP TABLE','DROP COLUMN','TRUNCATE TABLE','ALTER COLUMN','RENAME COLUMN','DELETE FROM']) assert.ok(!upper.includes(forbidden),forbidden);
});

test('Recuperación segura por correo permanece presente',()=>{
  assert.match(src,/app\.post\("\/auth\/password-recovery\/start"/);
  assert.match(src,/createPasswordRecoveryChallenge/);
  assert.match(src,/maskedEmail/);
  assert.match(src,/app\.post\("\/auth\/password-recovery\/verify"/);
  assert.match(src,/app\.post\("\/auth\/password-recovery\/complete"/);
});
