import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = fs.readFileSync(path.resolve(here, '../src/index.js'), 'utf8');
const admin = fs.readFileSync(path.resolve(here, '../../web/admin.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../package.json'), 'utf8'));

test('v7.10.14 recupera exactamente el último correo enviado por padrón', () => {
  assert.equal(pkg.version, '7.10.14');
  assert.match(api, /\/admin\/communications\/latest-template/);
  assert.match(api, /where:\{ audience, sentCount:\{ gt:0 \} \}/);
  assert.match(api, /subject:latest\.subject/);
  assert.match(api, /body:latest\.body/);
});

test('v7.10.14 calcula sólo quienes todavía no recibieron el último correo', () => {
  assert.match(api, /filterCommunicationRecipientsByHistory/);
  assert.match(api, /onlyNotPreviouslySent:true/);
  assert.match(api, /pendingRecipients:pending\.recipients\.length/);
});

test('v7.10.14 agrega botón para cargar último correo sin modificar asunto ni cuerpo', () => {
  assert.match(admin, /Cargar último correo enviado/);
  assert.match(admin, /latest-template\?audience=/);
  assert.match(admin, /communicationSubject'\)\.value = item\.subject/);
  assert.match(admin, /communicationBody'\)\.value = item\.body/);
  assert.match(admin, /onlyUnsent\.checked = true/);
});
