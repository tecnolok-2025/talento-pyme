import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const api = fs.readFileSync(path.join(root, 'apps/api/src/index.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'apps/web/config.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'apps/web/sw.js'), 'utf8');

function between(start,end){
  const a=api.indexOf(start); const b=api.indexOf(end,a+start.length);
  return (a>=0 && b>a) ? api.slice(a,b) : '';
}

test('v9.1.0 restringe CORS al origen oficial y lista adicional',()=>{
  assert.match(api,/SECURITY_ALLOWED_ORIGINS/);
  assert.match(api,/WEB_BASE_URL \|\| "https:\/\/talento-pyme\.onrender\.com"/);
  assert.match(api,/origin: securityCorsOrigin/);
});

test('v9.1.0 oculta firma Express y agrega cabeceras defensivas',()=>{
  assert.match(api,/app\.disable\("x-powered-by"\)/);
  assert.match(api,/X-Content-Type-Options/);
  assert.match(api,/X-Frame-Options/);
  assert.match(api,/Strict-Transport-Security/);
  assert.match(api,/Permissions-Policy/);
});

test('v9.1.0 agrega no-store a superficies sensibles',()=>{
  assert.match(api,/Cache-Control", "no-store"/);
  assert.match(api,/Pragma", "no-cache"/);
});

test('v9.1.0 agrega límite amplio anti-abuso a auth sin reemplazar límite de login',()=>{
  assert.match(api,/app\.use\("\/auth", makeIpRateLimiter/);
  assert.match(api,/function loginThrottle710/);
  assert.match(api,/app\.post\("\/auth\/login", loginThrottle710/);
});

test('uploads conserva funcionalidad y niega dotfiles/índices',()=>{
  assert.match(api,/express\.static\(UPLOADS_DIR, \{ maxAge: "7d", dotfiles:"deny", index:false \}\)/);
});

test('versión visible y cache PWA son 9.1.0',()=>{
  assert.match(config,/TP_APP_VERSION = "9\.1\.0"/);
  assert.match(sw,/service worker \(v9\.1\.0\)/);
  assert.match(sw,/config\.js\?v=9\.1\.0/);
});

test('motor de clasificación conserva identificador 8.0.4 y motor de búsqueda v9.0.0 sigue presente',()=>{
  assert.match(api,/CANDIDATE_CLASSIFICATION_VERSION = '8\.0\.4'/);
  assert.match(api,/function candidateProfessionalSearchScore/);
  assert.match(api,/function candidateProfessionalSearchText/);
});
