import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSource = fs.readFileSync(path.join(here, '..', 'src', 'index.js'), 'utf8');
const schema = fs.readFileSync(path.join(here, '..', 'prisma', 'schema.prisma'), 'utf8');
const adminHtml = fs.readFileSync(path.join(here, '..', '..', 'web', 'admin.html'), 'utf8');

test('empresas se clasifican en Fabricación Logística Servicio con contador administrativo', () => {
  assert.match(apiSource, /FABRICACION:\s*'Fabricación'/);
  assert.match(apiSource, /LOGISTICA:\s*'Logística'/);
  assert.match(apiSource, /SERVICIO:\s*'Servicio'/);
  assert.match(apiSource, /companyDirectoryGroups/);
  assert.match(adminHtml, /renderCompanyDirectoryClassification/);
  assert.match(adminHtml, /adminClassCount/);
});

test('clasificación de empresa admite corrección manual persistente', () => {
  assert.match(schema, /adminCategory\s+String\?/);
  assert.match(apiSource, /app\.patch\('\/admin\/companies\/:companyId\/category'/);
  assert.match(adminHtml, /Guardar categoría/);
  assert.match(adminHtml, /sugerida automáticamente/);
});

test('candidatos se agrupan por seniority y expertise', () => {
  assert.match(apiSource, /OPERATIVO:\s*'Operativos \/ Oficios'/);
  assert.match(apiSource, /TECNICO:\s*'Técnicos \/ Especialistas'/);
  assert.match(apiSource, /SUPERVISION:\s*'Supervisión \/ Jefaturas'/);
  assert.match(apiSource, /PROFESIONAL:\s*'Profesionales \/ Ingeniería'/);
  assert.match(apiSource, /ADMINISTRATIVO:\s*'Administrativos \/ Gestión'/);
  assert.match(apiSource, /candidateDirectoryGroups/);
  assert.match(apiSource, /expertiseKey/);
  assert.match(adminHtml, /renderCandidateDirectoryClassification/);
});

test('clasificación administrativa no se agrega a pantallas públicas', () => {
  const publicFiles = ['index.html','buscar.html','empresa.html','perfil.html','mis-oportunidades.html'];
  for (const name of publicFiles) {
    const src = fs.readFileSync(path.join(here, '..', '..', 'web', name), 'utf8');
    assert.doesNotMatch(src, /adminCategory|candidateDirectoryGroups|companyDirectoryGroups/);
  }
});
