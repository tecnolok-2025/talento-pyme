import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '..', '..', 'web');
const api = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');
const index = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const forgot = fs.readFileSync(path.join(web, 'forgot.html'), 'utf8');

test('portada transmite el rol a recuperación', () => {
  assert.match(index, /id="forgotLink"/);
  assert.match(index, /forgotLink\.href = `\/forgot\.html\?role=\$\{r\}`/);
});

test('recuperación toma role=COMPANY desde la URL', () => {
  assert.match(forgot, /queryParams\.get\('role'\)/);
  assert.match(forgot, /queryRole==='COMPANY'\?'COMPANY':'CANDIDATE'/);
});

test('CUIT de recuperación acepta sólo 11 números', () => {
  assert.match(forgot, /CUIT \(solo 11 números\)/);
  assert.match(forgot, /maxlength="11"/);
  assert.match(forgot, /slice\(0,11\)/);
});

test('SMTP tiene timeouts explícitos y diagnóstico de red', () => {
  assert.match(api, /connectionTimeout:10000/);
  assert.match(api, /greetingTimeout:10000/);
  assert.match(api, /socketTimeout:15000/);
  assert.match(api, /MAIL_TRANSPORT_UNAVAILABLE/);
});
