import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const candidate=fs.readFileSync(path.join(root,'apps/web/bolsa-candidato.js'),'utf8');
const cv=fs.readFileSync(path.join(root,'apps/api/src/services/candidate-cv.js'),'utf8');

function functionBlock(source,name,nextName){
  const a=source.indexOf(`function ${name}`);
  const b=nextName ? source.indexOf(`function ${nextName}`,a+1) : source.length;
  return source.slice(a,b>0?b:source.length);
}

test('v7.9.6 separa resumen breve izquierdo de presentación ampliada derecha',()=>{
  assert.match(cv,/function buildSidebarAbout/);
  assert.match(cv,/const sideAbout=buildSidebarAbout\(data,presentation\)/);
  assert.match(cv,/clampParagraphs\(b\.voiceNarrativeSummary/);
  assert.match(cv,/profileHeight=hasMoreSections \? 190 : 440/);
  assert.match(candidate,/Presentación profesional desarrollada por IA · editable/);
  assert.match(candidate,/franja azul mostrará un resumen breve/);
  assert.match(candidate,/parte blanca utilizará esta presentación ampliada/);
});

test('corrección IA pide desarrollo amplio sin inventar antecedentes',()=>{
  assert.match(api,/PRESENTACIÓN PROFESIONAL AMPLIADA/);
  assert.match(api,/2 a 4 párrafos/);
  assert.match(api,/160 a 320 palabras/);
  assert.match(api,/no inventes empleos, empresas, títulos, años, certificaciones, logros, responsabilidades/);
});

test('guardar no dispara corrección IA implícita',()=>{
  const save=functionBlock(candidate,'saveAlta','speechRecognitionCtor');
  assert.doesNotMatch(save,/await refineVoicePresentation\(\)/);
  assert.match(save,/Guardar nunca dispara IA automáticamente/);
  assert.match(candidate,/btnVoiceRefine/);
});

test('el usuario puede editar o borrar la propuesta IA antes de guardar',()=>{
  assert.match(candidate,/Podés borrar, corregir, acortar o ampliar cualquier parte/);
  assert.match(candidate,/c_voice_summary/);
});

test('nombre de archivo CV usa YYMMDD-HHmm + CV + nombre, sin sufijo redundante',()=>{
  assert.match(cv,/return `\$\{yy\}\$\{t\.month\}\$\{t\.day\}-\$\{t\.hour\}\$\{t\.minute\} CV-\$\{safeFilePart\(full\)\}\.pdf`/);
  assert.doesNotMatch(cv,/CV-\$\{safeFilePart\(full\)\}-Talento-PyME\.pdf/);
});
