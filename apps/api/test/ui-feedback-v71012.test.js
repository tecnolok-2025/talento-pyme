import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const web = resolve(process.cwd(), '../web');
const css = readFileSync(resolve(web,'styles.css'),'utf8');
const auth = readFileSync(resolve(web,'auth.js'),'utf8');
const admin = readFileSync(resolve(web,'admin.html'),'utf8');
const api = readFileSync(resolve(process.cwd(),'src/index.js'),'utf8');

test('v7.10.12 todos los controles tienen feedback de presión', ()=>{
  assert.match(css, /button\.tp-pressed/);
  assert.match(css, /transform:\s*translateY\(2px\) scale\(\.985\)/);
  assert.match(css, /:focus-visible/);
});

test('v7.10.12 bloquea clics repetidos accidentales', ()=>{
  assert.match(auth, /RAPID_REPEAT_MS\s*=\s*900/);
  assert.match(auth, /stopImmediatePropagation/);
  assert.match(auth, /tpSetButtonBusy/);
});

test('v7.10.12 comunicación administrativa queda bloqueada durante programación', ()=>{
  assert.match(admin, /tpSetButtonBusy\(btn, true, 'Programando…'\)/);
  assert.match(admin, /finally \{ tpSetButtonBusy\(btn, false\); \}/);
});

test('v7.10.12 no borra una búsqueda con postulaciones y preserva trazabilidad', ()=>{
  assert.match(api, /_count:\s*\{\s*select:\s*\{\s*applications:\s*true/);
  assert.match(api, /status:\s*"CLOSED",\s*visibleToCandidates:\s*false/);
  assert.match(api, /Application_jobId_fkey/);
});
