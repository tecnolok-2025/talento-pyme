import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const apiRoot=path.resolve(here,'..');
const repo=path.resolve(apiRoot,'..');
const web=fs.readFileSync(path.join(repo,'web/bolsa-candidato.js'),'utf8');
const api=fs.readFileSync(path.join(apiRoot,'src/index.js'),'utf8');
const config=fs.readFileSync(path.join(repo,'web/config.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(apiRoot,'package.json'),'utf8'));

test('v7.9.13 elimina Recargar del perfil candidato',()=>{
  assert.doesNotMatch(web,/id="btnReloadBolsa"/);
  assert.doesNotMatch(web,/const btnReload = el\("btnReloadBolsa"\)/);
  assert.doesNotMatch(web,/<b>Recargar<\/b>/);
});

test('Descargar mi CV PDF no exige Corrección IA ni recarga previa',()=>{
  const start=web.indexOf('async function downloadCandidateCv()');
  const end=web.indexOf('async function viewCandidateSampleCv()',start);
  const block=web.slice(start,end);
  assert.match(block,/\/candidate\/cv\/pdf/);
  assert.doesNotMatch(block,/PRESENTATION_REQUIRED_ANALYSIS_VERSION/);
  assert.doesNotMatch(block,/saveAlta\(/);
  assert.doesNotMatch(block,/Antes de descargar el CV/);
  assert.match(block,/última información YA GUARDADA/);
});

test('descarga PDF incorpora apertura compatible con iPhone e iPad',()=>{
  assert.match(web,/function candidateNeedsIosPdfOpen/);
  assert.match(web,/iPad\|iPhone\|iPod/);
  assert.match(web,/window\.open\('about:blank','_blank'\)/);
  assert.match(web,/iosWindow\.location\.replace\(url\)/);
});

test('API mantiene generación directa y autenticada de CV para cualquier candidato',()=>{
  assert.match(api,/app\.get\('\/candidate\/cv\/pdf', auth, requireRole\('CANDIDATE'\)/);
  assert.match(api,/buildCandidateCvPdfBuffer/);
  assert.match(api,/Cache-Control','no-store/);
});

test('versión de despliegue v7.9.13',()=>{
  assert.equal(pkg.version,'7.9.13');
  assert.match(config,/TP_APP_VERSION = "7\.9\.13"/);
  assert.match(config,/TP_BUILD_ID = "20260810_03"/);
});
