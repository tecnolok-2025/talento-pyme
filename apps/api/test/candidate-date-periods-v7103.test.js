import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const api=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
const ctx={};vm.createContext(ctx);
vm.runInContext(api.slice(api.indexOf('const ADMIN_COMPANY_CATEGORY_LABELS'),api.indexOf('const adminCompanyCategorySchema'))+';globalThis.f={buildCandidateAdminClassification,candidateEvidenceYears,candidateWorkPeriodPrefix};',ctx);
const {buildCandidateAdminClassification:classify,candidateEvidenceYears:years,candidateWorkPeriodPrefix:prefix}=ctx.f;
const candidate=(b={},r={})=>({candidateBolsa:b,resume:r});

const NOW=new Date('2026-09-27T12:00:00Z');

test('v7.10.4 reconoce períodos mes/año numéricos',()=>{
  const y=years(['Dibujante Proyectista CAD (01/2024 - 06/2026)','Administrativo Técnico (10/2023 - 01/2024)'],NOW);
  assert.ok(y.dated);
  assert.ok(y.years>=2.6 && y.years<=2.8,`esperado ~2.7 años, recibido ${y.years}`);
  assert.equal(prefix('Dibujante CAD (01/2024 - 06/2026)'),'01/2024 - 06/2026');
});

test('v7.10.4 reconoce mes/año de dos dígitos y actualidad',()=>{
  const y=years(['Técnico 04/24 - actualidad'],NOW);
  assert.ok(y.dated);
  assert.ok(y.years>=2.3 && y.years<=2.5,`esperado ~2.4 años, recibido ${y.years}`);
});

test('v7.10.4 conserva fechas completas sin doble conteo',()=>{
  const y=years(['Taller 10/01/2025 - 05/06/2025','Taller 13/06/2025 - 22/02/2026'],NOW);
  assert.ok(y.years>=1 && y.years<1.2,`esperado ~1.1 años, recibido ${y.years}`);
});

test('v7.10.4 Leonardo Dybiec obtiene duración relevante desde 01/2024 - 06/2026',()=>{
  const a=classify(candidate({}, {experience:'Estudiante de Ingeniería Mecánica. Experiencia Profesional Raybite SRL - Dibujante Proyectista CAD (01/2024 - 06/2026) Modelado 3D con AutoCAD y Plant 3D. Procesamiento de nubes de puntos mediante FARO. Constelmec S.A. - Administrativo Técnico (10/2023 - 01/2024) Elaboración de planos en AutoCAD y apoyo al área de calidad. Sertec - Operario Industrial (03/2024) Manejo de máquinas.'}));
  assert.equal(a.expertiseKey,'INGENIERIA');
  assert.ok(a.relevantYearsExperience>=2.6 && a.relevantYearsExperience<=2.8,`duración relevante ${a.relevantYearsExperience}`);
  assert.ok(a.explicitYearsExperience>=a.relevantYearsExperience,`total ${a.explicitYearsExperience} no puede ser menor que relevante ${a.relevantYearsExperience}`);
  assert.ok(!a.gaps.includes('Falta duración verificable en la especialidad.'));
});

test('v7.10.4 asocia fecha situada al final del bloque laboral sin arrastrar la fecha educativa posterior',()=>{
  const a=classify(candidate({ultimoTrabajo:'Auxiliar de RRHH'}, {experience:'EXPERIENCIA LABORAL AUXILIAR DE RECURSOS HUMANOS - FOTOGRÁFICA S.A. Gestión y organización de archivo y documentación del personal. Seguimiento y control de documentación mediante planillas de registro. Control de devolución de uniformes del personal. Gestión de planilla mensual de novedades y coordinación con el área contable para liquidación de sueldos. Comunicación permanente con encargados y contadores. Recolección y verificación de datos de empleados ingresantes. Apoyo ocasional en tareas de tesorería. Colaboración en diversas tareas administrativas generales. Mar 2025 - Jul 2026 2022 - 2025'}));
  assert.equal(a.expertiseKey,'RRHH');
  assert.ok(a.relevantYearsExperience>=1.2 && a.relevantYearsExperience<=1.5,`debe usar sólo Mar 2025-Jul 2026; recibido ${a.relevantYearsExperience}`);
  assert.ok(a.explicitYearsExperience>=a.relevantYearsExperience,`total ${a.explicitYearsExperience} no puede ser menor que relevante ${a.relevantYearsExperience}`);
  assert.ok(!a.gaps.includes('Falta duración verificable en la especialidad.'));
});
