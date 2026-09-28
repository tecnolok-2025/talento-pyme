import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeResidenceForGrouping } from '../src/services/residence.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const api=fs.readFileSync(path.join(root,'apps/api/src/index.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'apps/web/admin.html'),'utf8');
const report=fs.readFileSync(path.join(root,'apps/api/src/services/traceability-report.js'),'utf8');

const r=(args)=>normalizeResidenceForGrouping(args);

test('v7.10.6 unifica variantes evidentes de Campana sin tocar el dato almacenado',()=>{
  for(const locality of ['Campana','Canpana','Campna','Csmpsna','GBA - Campana','Otamendi, Campana','(AR) CAMPANA (BUENOS AIRES)']){
    const out=r({locality,province:'Buenos Aires',country:'Argentina'});
    assert.equal(out.city,'Campana',locality);
    assert.equal(out.province,'Buenos Aires',locality);
    assert.equal(out.country,'Argentina',locality);
  }
});

test('v7.10.6 corrige campos desplazados y provincias no territoriales cuando la ciudad es inequívoca',()=>{
  for(const province of ['Soltero','SOLTERO/A','federal','Campana','Bueno aires','Buenos Aires (Provincia)']){
    const out=r({locality:'Campana',province,country:'Argentina'});
    assert.equal(out.city,'Campana',province);
    assert.equal(out.province,'Buenos Aires',province);
  }
  assert.deepEqual(r({locality:'San Cayetano',province:'Campana',country:'Argentina'}),{
    city:'Campana',province:'Buenos Aires',country:'Argentina',inferred:true,normalized:true,source:'misplaced-field'
  });
});

test('v7.10.6 unifica variantes evidentes de Zárate, Escobar y Tigre',()=>{
  for(const province of ['GBA Zona Norte','Buenos Aires Aires','Buenos Aires (provincia)','Buenos Aires/ Zarate / Zona norte']){
    const out=r({locality:'Zárate',province,country:'Argentina'});
    assert.equal(out.city,'Zárate',province);
    assert.equal(out.province,'Buenos Aires',province);
  }
  assert.equal(r({locality:'GBA - Zárate',province:'Buenos Aires',country:'Argentina'}).city,'Zárate');
  assert.equal(r({locality:'Escobar',province:'GBA Zona Norte',country:'Argentina'}).province,'Buenos Aires');
  assert.equal(r({locality:'Benavides tigre',province:'Buenos Aires',country:'Argentina'}).city,'Tigre');
});

test('v7.10.6 usa sólo señales territoriales de alta confianza para completar',()=>{
  assert.equal(r({locality:'2804',province:'Buenos Aires',country:'Argentina'}).city,'Campana');
  assert.equal(r({locality:'2046',province:'Buenos Aires',country:'Argentina'}).city,'Ciudad no informada');
  assert.equal(r({locality:'918',province:'Buenos Aires',country:'Argentina'}).city,'Ciudad no informada');
  assert.equal(r({locality:'Otra',address:'Zuviria 1295, San Miguel'}).city,'San Miguel');
  assert.equal(r({locality:'Buenos Aires',province:'Buenos Aires',country:'Argentina'}).city,'Ciudad no informada');
});

test('v7.10.6 preserva localidades válidas y canoniza sólo presentación',()=>{
  assert.equal(r({locality:'Rosario',province:'Santa Fe',country:'Argentina'}).city,'Rosario');
  assert.equal(r({locality:'Los cardales',province:'Buenos Aires',country:'Argentina'}).city,'Los Cardales');
  assert.equal(r({locality:'Grand boug',province:'Buenos Aires',country:'Argentina'}).city,'Grand Bourg');
  assert.equal(r({locality:'San cayetano',province:'Buenos Aires',country:'Argentina'}).city,'San Cayetano');
  assert.deepEqual(r({locality:'Almagro',province:'Ciudad Autónoma de Buenos Aires',country:'Argentina'}).city,'CABA');
});


test('v7.10.6 aplica la localidad normalizada también a filtros y búsqueda Empresa',()=>{
  assert.match(api,/localidadNormalizada:residence\.city/);
  assert.match(api,/localityMatches\(it\.localidadNormalizada \|\| it\.localidad,localidad\)/);
  assert.match(api,/localidad: it\.localidadNormalizada \|\| it\.localidad/);
  assert.match(api,/candidateProfessionalSearchText\(it\.candidate,c\)\} \${it\.localidadNormalizada/);
});

test('v7.10.6 aplica la normalización sólo en lectura agregada y reportes',()=>{
  assert.match(api,/normalizeResidenceForGrouping/);
  assert.match(api,/function candidateResidence\(candidate = \{\}\)/);
  assert.match(admin,/Candidatos por residencia normalizada/);
  assert.match(report,/agregada y normalizada/);
  assert.match(report,/sin modificar los datos originales del candidato/i);
});
