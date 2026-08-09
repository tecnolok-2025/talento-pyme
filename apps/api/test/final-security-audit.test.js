import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const api = fs.readFileSync(path.join(root, 'apps/api/src/index.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'apps/web/index.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'apps/web/config.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'apps/web/sw.js'), 'utf8');
const env = fs.readFileSync(path.join(root, 'apps/api/.env.example'), 'utf8');

function registrationBlock(){
  const s=api.indexOf('app.post("/auth/register"');
  const e=api.indexOf('app.post("/auth/login"',s);
  return api.slice(s,e);
}

test('registro y recuperación usan mínimo 10 caracteres', () => {
  assert.match(api, /password: z\.string\(\)\.min\(10\)\.max\(200\)/);
  assert.match(api, /newPassword: z\.string\(\)\.min\(10\)\.max\(200\)/);
  assert.match(indexHtml, /mínimo 10 caracteres/);
});

test('registro legado incompleto no puede reemplazar passHash', () => {
  const b=registrationBlock();
  assert.match(b, /bcrypt\.compare\(password, existingUser\.passHash\)/);
  const existingStart=b.indexOf('if \(existingUser\)');
  const normalStart=b.indexOf('// Alta normal');
  const legacy=b.slice(existingStart,normalStart);
  assert.doesNotMatch(legacy, /\bpassHash\s*,/);
});

test('DNI nuevo se comprueba también contra CandidateBolsa histórica', () => {
  const b=registrationBlock();
  assert.match(b, /candidateBolsa\.findFirst\(\{ where: \{ dni: dniNorm \}/);
});

test('sólo el código de recuperación más reciente queda activo', () => {
  assert.match(api, /id: \{ not: challengeId \}, consumedAt: null/);
  assert.match(api, /passwordResetChallenge\.deleteMany/);
});

test('correo institucional sigue unificado sin segunda dirección', () => {
  assert.match(api, /const GMAIL_USER = FACTORY_SUPPORT_EMAIL/);
  assert.match(env, /FACTORY_SUPPORT_EMAIL="talentopyme00@gmail\.com"/);
  assert.match(env, /GMAIL_APP_PASSWORD=""/);
  assert.doesNotMatch(api, /TALENTO_PYME_EMAIL/);
});

test('frontend y cache declaran 7.9.8', () => {
  assert.match(config, /TP_APP_VERSION = "7\.9\.8"/);
  assert.match(sw, /service worker \(v7\.9\.8\)/);
  assert.match(sw, /config\.js\?v=7\.9\.8/);
});


test('buscadores legados no exponen perfiles ni permiten bypass de capacidad', () => {
  assert.match(api, /app\.get\("\/bolsa\/search", authRequired, \(_req, res\) => res\.status\(410\)/);
  assert.match(api, /app\.get\("\/search", \(_req, res\) => res\.status\(410\)/);
});


test('analizar web bloquea destinos privados y limita la descarga', () => {
  assert.match(api, /function isPrivateNetworkAddress/);
  assert.match(api, /assertPublicWebsiteUrl/);
  assert.match(api, /AbortSignal\.timeout\(10000\)/);
  assert.match(api, /readTextLimited\(response\)/);
});

test('CV rechaza formatos no soportados y UI sólo ofrece PDF DOCX TXT', () => {
  const bolsa = fs.readFileSync(path.join(root, 'apps/web/bolsa-candidato.js'), 'utf8');
  assert.match(api, /UNSUPPORTED_RESUME_FORMAT/);
  assert.match(api, /res\.status\(415\)/);
  assert.match(bolsa, /accept="\.pdf,\.docx,\.txt"/);
  assert.doesNotMatch(bolsa, /accept="[^"]*\.png/);
});
