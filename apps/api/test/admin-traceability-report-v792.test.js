import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const api = fs.readFileSync(path.join(root, 'apps/api/src/index.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'apps/web/admin.html'), 'utf8');
const report = fs.readFileSync(path.join(root, 'apps/api/src/services/traceability-report.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/api/package.json'), 'utf8'));
const config = fs.readFileSync(path.join(root, 'apps/web/config.js'), 'utf8');

test('v7.9.16 incorpora pestaña administrativa Reportes con descarga y envío', () => {
  assert.match(admin, /data-tab="reports"/);
  assert.match(admin, /id="tab-reports"/);
  assert.match(admin, /btnTraceReportDownload/);
  assert.match(admin, /btnTraceReportEmail/);
  assert.match(admin, /Informe Ejecutivo de Trazabilidad, Evolución y Composición del Portal/);
});

test('endpoints de reporte quedan restringidos a administración', () => {
  assert.match(api, /app\.get\('\/admin\/reports\/traceability\/pdf', auth, requireAnyRole\(\['ADMIN','SUPERADMIN'\]\)/);
  assert.match(api, /app\.post\('\/admin\/reports\/traceability\/email', auth, requireAnyRole\(\['ADMIN','SUPERADMIN'\]\)/);
});

test('reporte se genera en tiempo real desde agregados de la base', () => {
  assert.match(api, /async function buildTraceabilityReportSnapshot/);
  assert.match(api, /candidatesLast30/);
  assert.match(api, /candidatesPrevious30/);
  assert.match(api, /companiesLast30/);
  assert.match(api, /jobsLast30/);
  assert.match(api, /applicationsLast30/);
  assert.match(api, /candidatesByClass/);
  assert.match(api, /candidatesByExpertise/);
  assert.match(api, /companiesByFamily/);
  assert.match(api, /companiesByActivity/);
  assert.match(api, /monthlySeries/);
});

test('PDF contiene objetivos, tablas, conclusiones y sugerencias', () => {
  assert.match(report, /1\. Objetivo y alcance/);
  assert.match(report, /2\. Resumen ejecutivo/);
  assert.match(report, /Evolución de los últimos seis meses/);
  assert.match(report, /Composición de candidatos/);
  assert.match(report, /Composición de empresas/);
  assert.match(report, /Conclusiones de gestión/);
  assert.match(report, /Sugerencias de mejora/);
  assert.match(report, /Cierre institucional/);
});

test('reporte no consume identificadores individuales', () => {
  assert.doesNotMatch(report, /\.dni\b|\.cuit\b|\.email\b|\.phone\b|\.nombre\b|\.apellido\b/);
  assert.match(report, /información agregada/i);
  assert.match(admin, /No incorpora nombres, apellidos, DNI, CUIT, correos, teléfonos/i);
});

test('envío usa el correo institucional ya configurado y adjunta PDF', () => {
  assert.match(api, /from:`"\$\{MAIL_FROM_NAME\}" <\$\{GMAIL_USER\}>`/);
  assert.match(api, /attachments:\[\{ filename, content:pdf, contentType:'application\/pdf' \}\]/);
  assert.match(api, /TRACEABILITY_REPORT_RECIPIENT/);
  assert.doesNotMatch(api, /TALENTO_PYME_EMAIL/);
});

test('descarga PDF usa contenido binario autenticado', () => {
  assert.match(admin, /fetch\(`\$\{window\.TP_API_URL\}\/admin\/reports\/traceability\/pdf`/);
  assert.match(admin, /Authorization', 'Bearer ' \+ token/);
  assert.match(admin, /await res\.blob\(\)/);
});

test('API declara dependencia PDFKit y frontend v7.9.16', () => {
  assert.ok(pkg.dependencies?.pdfkit);
  assert.equal(pkg.version, '7.9.16');
  assert.match(config, /TP_APP_VERSION = "7\.9\.16"/);
});


test('v7.9.16 usa logos institucionales y flujo PDF anclado al margen izquierdo', () => {
  assert.match(report, /logo-uic\.jpg/);
  assert.match(report, /logo-talento-pyme\.png/);
  assert.match(report, /function resetFlow\(doc\)/);
  assert.match(report, /text\(title,LEFT/);
  assert.match(report, /text\(safeText\(text\),LEFT/);
  assert.match(report, /drawFooter\(doc,i\+1,range\.count\)/);
});

test('v7.9.16 contabiliza altas de empresa por la cuenta COMPANY y no por edición del perfil', () => {
  assert.match(api, /prisma\.user\.count\(\{ where:\{ role:'COMPANY', createdAt:\{ gte:since30 \} \} \}\)/);
  assert.match(api, /prisma\.user\.findMany\(\{ where:\{ role:'COMPANY', createdAt:\{ gte:since6Months \} \}, select:\{ createdAt:true \} \}\)/);
  assert.match(report, /fecha de alta de la cuenta empresa/);
});

test('v7.9.16 nombre de archivo comienza con YYMMDD-HHmm para orden cronológico', () => {
  assert.match(report, /return `\$\{stamp\.prefix\} Talento-PyME-Informe-Trazabilidad-\$\{stamp\.long\}\.pdf`/);
  assert.match(report, /timeZone: ARG_TZ/);
});
