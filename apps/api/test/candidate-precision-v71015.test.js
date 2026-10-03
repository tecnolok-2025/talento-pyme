import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'apps/api/package.json'),'utf8'));
const s=api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS');
const e=api.indexOf('const adminCompanyCategorySchema',s);
const ctx={}; vm.createContext(ctx);
vm.runInContext(api.slice(s,e)+';globalThis.f={buildCandidateAdminClassification};',ctx);
const classify=ctx.f.buildCandidateAdminClassification;
const c=(ultimoTrabajo,experience='',summary='',education='',certifications='')=>({candidateBolsa:{ultimoTrabajo},resume:{experience,summary,education,certifications}});

test('v7.10.15 peón de cocina reciente prevalece sobre atención al cliente histórica',()=>{
  const a=classify(c('', 'Enero 2021 - Diciembre 2021 Peón de logística. Carga y descarga, picking y packing. Enero 2022 - Diciembre 2022 Operario. Atención al cliente. Enero 2026 - Junio 2026 Peón de Cocina. Producción y preparación de alimentos, limpieza y orden del sector.'));
  assert.equal(a.expertiseKey,'GASTRONOMIA');
  assert.match(a.reason,/Pe[oó]n de Cocina/i);
});

test('v7.10.15 versión activa sincronizada',()=>{
  assert.equal(pkg.version,'7.10.15');
  assert.match(api,/CANDIDATE_CLASSIFICATION_VERSION = '7\.10\.15'/);
});
