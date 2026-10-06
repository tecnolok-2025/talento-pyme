import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const api = fs.readFileSync(path.join(__dirname,'../src/index.js'),'utf8');
function extract(name,next){
  const a=api.indexOf(`function ${name}`); if(a<0) throw new Error(`missing ${name}`);
  const b=next?api.indexOf(`function ${next}`,a+1):-1;
  return api.slice(a,b>0?b:undefined);
}
const code = [
  extract('adminNormText','adminDynamicKey'),
  extract('adminSearchTextMatch','candidateEducationOrientation'),
  extract('candidateProfessionalSearchText','buildAdminComposition')
].join('\n');
const ctx={}; vm.createContext(ctx); vm.runInContext(code+'\nthis.f={adminNormText,adminSearchTextMatch,candidateProfessionalSearchText};',ctx);

test('v8.0.11 agrega título académico declarado al texto profesional de búsqueda',()=>{
  const candidate={
    email:'lucia@example.com',
    candidateBolsa:{nombre:'Lucia',apellido:'Prueba'},
    candidateProfile:{},
    resume:{education:'Ingeniería Industrial - Universidad X',certifications:''}
  };
  const classification={searchText:'Producción Senior'};
  const text=ctx.f.candidateProfessionalSearchText(candidate,classification);
  assert.equal(ctx.f.adminSearchTextMatch(text,'ingeniero'),true);
  assert.equal(ctx.f.adminSearchTextMatch(text,'ingeniera'),true);
  assert.equal(ctx.f.adminSearchTextMatch(text,'ingenieria'),true);
});

test('v8.0.11 no altera la clasificación: sólo expande el índice de búsqueda',()=>{
  const block=extract('candidateProfessionalSearchText','buildAdminComposition');
  assert.doesNotMatch(block,/profileScore\s*=/);
  assert.doesNotMatch(block,/classKey\s*=/);
  assert.doesNotMatch(block,/expertiseKey\s*=/);
});
