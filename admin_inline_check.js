requireAuth();
applyRoleVisibility();
requireRole('ADMIN');
document.getElementById('btnLogout').onclick = (e) => { e.preventDefault(); logout(); };

function esc(s){ return String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function money(n){ const v = Number(n || 0); return '$' + v.toLocaleString('es-AR'); }
function fd(v){ try{ return new Date(v).toLocaleString('es-AR'); }catch(_){ return v || ''; } }
function actorLabelEs(actor){ return ({USER:'Usuario',ASSISTANT:'Asistente',OPERATOR:'Operador',SYSTEM:'Sistema'}[actor] || actor || 'Sistema'); }
function traceTypeLabel(type){ return ({alta_candidato:'Alta',perfil_actualizado:'Perfil',postulacion:'Postulación',consulta_ia:'Ayuda IA',alta_empresa:'Alta',empresa_actualizada:'Empresa',documento:'Documento',apertura:'Apertura',busqueda:'Búsqueda'}[type] || 'Movimiento'); }
function monthLabelFromKey(key, format='short'){ const [y,m] = String(key || '').split('-').map(Number); if(!y || !m) return '—'; return new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: format, year: 'numeric' }); }

const state = {
  overview: null,
  backupVerification: null,
  backupRestorePreview: null,
  factory: null,
  threads: [],
  selectedThreadId: null,
  filters: {
    candidateDays: 'ALL', candidatePage: 1, candidatePerPage: 50,
    companyDays: 'ALL', companyPage: 1, companyPerPage: 50,
    billingDays: 'ALL', billingStatus: 'ALL', billingPage: 1, billingPerPage: 50,
  },
  traceabilityView: {
    monthlyOffset: null,
    annualYear: null,
    monthlyWindowSize: 4,
  },
};
const threadRoleLabel = { COMPANY:'Ayuda IA · lado empresa', CANDIDATE:'Ayuda IA · lado candidato', SUPERADMIN:'Ayuda IA · administración' };
let activeThreadRole = 'ALL';

function traceEventHtml(ev, fallbackActor){
  return `<div class="traceEvent"><div class="traceEventTop"><div class="traceEventTitle">${esc(ev.title || 'Movimiento')}</div><span class="traceBadge">${esc(traceTypeLabel(ev.type))}</span></div><div class="muted traceEventMeta">${esc(ev.actor || fallbackActor)} · ${esc(ev.context || '')} · ${fd(ev.createdAt)}</div></div>`;
}
function setTab(tab){
  document.querySelectorAll('#adminTabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tabPane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab));
}
document.querySelectorAll('#adminTabs [data-tab]').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
document.querySelectorAll('#chatRoleTabs [data-role-filter]').forEach((btn) => btn.onclick = () => {
  activeThreadRole = btn.dataset.roleFilter;
  document.querySelectorAll('#chatRoleTabs [data-role-filter]').forEach((x) => x.classList.toggle('active', x === btn));
  loadThreads();
});

function candidateRowHtml(it){
  const name = `${it.apellido || ''}${it.apellido && it.nombre ? ', ' : ''}${it.nombre || ''}`.trim() || 'Candidato';
  return `<div class="adminRow"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><b>${esc(name)}</b><span class="candidateProfileBadge">${esc(it.profileStatus || 'Registro')}</span></div><div class="muted">${esc(it.areaTrabajo || 'Perfil general')} ${it.especialidad ? '· ' + esc(it.especialidad) : ''} ${it.localidad ? '· ' + esc(it.localidad) : ''}</div><div class="muted">DNI: ${esc(it.dni || 'sin dato')} · ${esc(it.email || 'sin mail')}</div><div class="muted">Pretensión: ${esc(it.sueldoPretendido || 'No informada')} · ${fd(it.updatedAt)}</div></div>`;
}
function candidateName(it){
  const bolsa = it?.candidateBolsa || {};
  const profile = it?.candidateProfile || {};
  return `${bolsa.nombre || ''} ${bolsa.apellido || ''}`.trim() || String(profile.fullName || '').trim() || String(it?.email || '').trim() || 'Candidato';
}
function candidateDetailValue(value, fallback='No informado'){
  if(Array.isArray(value)) return value.length ? value.join(', ') : fallback;
  if(typeof value === 'boolean') return value ? 'Sí' : 'No';
  if(value === 0) return '0';
  const text = String(value ?? '').trim();
  return text || fallback;
}
function candidateDetailDate(value){
  if(!value) return 'No informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? candidateDetailValue(value) : date.toLocaleString('es-AR');
}
function candidateField(label, value){
  return `<div class="candidateField"><div class="candidateFieldLabel">${esc(label)}</div><div class="candidateFieldValue">${esc(candidateDetailValue(value))}</div></div>`;
}
function candidateSection(title, fields, wide=false){
  return `<section class="candidateDetailSection ${wide ? 'wide' : ''}"><h3>${esc(title)}</h3>${fields.join('')}</section>`;
}
function candidateDirectoryRowHtml(it){
  const name = `${it.nombre || ''} ${it.apellido || ''}`.trim() || it.email || 'Candidato';
  const checked = it.keepIndefinitely === false ? '' : 'checked';
  return `<article class="candidateAccordion" data-user-id="${esc(it.userId || it.id)}"><div class="candidateAccordionTop"><button class="candidateAccordionTrigger" type="button" aria-expanded="false"><span><span class="candidateAccordionName">${esc(name)}</span><span class="muted" style="display:block;margin-top:4px">${esc(it.areaTrabajo || 'Perfil todavía incompleto')} ${it.localidad ? '· ' + esc(it.localidad) : ''} · DNI ${esc(it.dni || 'sin dato')}</span><span class="candidateProfileBadge" style="margin-top:8px">${esc(it.profileStatus || 'Registro')}</span></span><span class="candidateAccordionIcon" aria-hidden="true">+</span></button><div><label class="candidateRetention"><input class="candidateRetentionInput" type="checkbox" ${checked}> Mantener indefinidamente</label><div class="candidateSaveMsg" aria-live="polite"></div></div></div><div class="candidateAccordionBody"><div class="muted">Cargando perfil completo…</div></div></article>`;
}
function renderCandidateDetail(it){
  const profile = it?.candidateProfile || {};
  const bolsa = it?.candidateBolsa || {};
  const resume = it?.resume || {};
  const skills = Array.isArray(profile.skills) ? profile.skills.map((skill) => `${skill.name || 'Habilidad'}${skill.level ? ` · nivel ${skill.level}/5` : ''}`) : [];
  const applications = Array.isArray(it?.applications) ? it.applications.map((application) => {
    const job = application.job || {};
    const company = job.company?.companyName || 'Empresa no informada';
    const where = [job.location, job.modality].filter(Boolean).join(' · ');
    return `${job.title || 'Búsqueda'} · ${company}${where ? ` · ${where}` : ''} · ${candidateDetailDate(application.createdAt)}${application.coverNote ? `\nPresentación: ${application.coverNote}` : ''}`;
  }) : [];
  const photo = String(bolsa.photoDataUrl || '');
  const photoHtml = /^data:image\/[a-z0-9.+-]+;base64,/i.test(photo)
    ? `<img class="candidatePhoto" src="${esc(photo)}" alt="Foto de ${esc(candidateName(it))}">`
    : '<div class="candidatePhotoPlaceholder">Sin foto cargada</div>';
  const header = `<div class="candidateDetailHero">${photoHtml}<div><span class="candidateProfileBadge">${esc(it.profileStatus || 'Registro')}</span><h2 style="margin:8px 0 4px">${esc(candidateName(it))}</h2><div class="muted">${esc(bolsa.areaTrabajo || profile.headline || 'Perfil laboral pendiente')} ${bolsa.especialidad ? '· ' + esc(bolsa.especialidad === 'Otros' ? (bolsa.especialidadOtro || 'Otros') : bolsa.especialidad) : ''}</div><div class="muted" style="margin-top:6px">Alta: ${esc(candidateDetailDate(it.createdAt))} · Última actualización: ${esc(candidateDetailDate(bolsa.updatedAt || profile.updatedAt || resume.updatedAt || it.createdAt))}</div></div></div>`;
  const sections = [
    candidateSection('Datos personales y de contacto', [
      candidateField('Nombre y apellido', candidateName(it)),
      candidateField('DNI', bolsa.dni || profile.dni),
      candidateField('Nacionalidad', bolsa.nacionalidad),
      candidateField('Estado civil', bolsa.estadoCivil),
      candidateField('Hijos', bolsa.hijos),
      candidateField('Teléfono', bolsa.telefono || profile.phone),
      candidateField('Correo', bolsa.correo || it.email),
      candidateField('Localidad', bolsa.localidad || profile.city),
      candidateField('Provincia', profile.province),
      candidateField('Dirección', bolsa.direccion || profile.address),
    ]),
    candidateSection('Perfil profesional', [
      candidateField('Titular profesional', profile.headline),
      candidateField('Sector', profile.sector),
      candidateField('Subsector', profile.subSector),
      candidateField('Área de trabajo', bolsa.areaTrabajo),
      candidateField('Nivel', bolsa.nivel),
      candidateField('Especialidad', bolsa.especialidad),
      candidateField('Otra especialidad', bolsa.especialidadOtro),
      candidateField('Habilidades', skills),
    ]),
    candidateSection('Experiencia, formación y preferencias', [
      candidateField('Rango de experiencia', bolsa.rangoExperiencia),
      candidateField('Nivel educativo', bolsa.nivelEducativo),
      candidateField('Tiene capacitación', bolsa.tieneCapacitacion),
      candidateField('Trabaja actualmente', bolsa.trabajaActualmente),
      candidateField('Sueldo pretendido', bolsa.sueldoPretendido),
      candidateField('Último trabajo', bolsa.ultimoTrabajo),
      candidateField('Herramientas de mecánica', bolsa.herramientasMecanica),
      candidateField('Instrumentos de electricidad', bolsa.instrumentosElectrica),
    ]),
    candidateSection('Resumen curricular cargado por el candidato', [
      candidateField('Observaciones del perfil', bolsa.observaciones),
      candidateField('Resumen extraído del CV', resume.summary),
      candidateField('Experiencia del CV', resume.experience),
      candidateField('Educación del CV', resume.education),
      candidateField('Certificaciones y cursos', resume.certifications),
      candidateField('Otras observaciones del CV', resume.observations),
    ], true),
    candidateSection('Postulaciones realizadas', [
      candidateField('Cantidad', applications.length),
      candidateField('Detalle', applications),
    ], true),
    candidateSection('Estado administrativo', [
      candidateField('Permanencia indefinida', it.keepIndefinitely !== false),
      candidateField('Estado del perfil', it.profileStatus),
      candidateField('Identificador interno', it.id),
    ], true),
  ];
  return header + `<div class="candidateDetailGrid">${sections.join('')}</div>`;
}
function wireCandidateDirectory(){
  const host = document.getElementById('candidateDirectoryList');
  if(!host) return;
  host.querySelectorAll('.candidateAccordionTrigger').forEach((trigger) => {
    trigger.onclick = async () => {
      const row = trigger.closest('.candidateAccordion');
      const body = row.querySelector('.candidateAccordionBody');
      const icon = row.querySelector('.candidateAccordionIcon');
      const willOpen = !row.classList.contains('open');
      row.classList.toggle('open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      icon.textContent = willOpen ? '−' : '+';
      if(!willOpen || body.dataset.loaded === 'true') return;
      body.innerHTML = '<div class="muted">Cargando perfil completo…</div>';
      try {
        const data = await apiFetch(`/admin/candidates/${encodeURIComponent(row.dataset.userId)}/detail`);
        body.innerHTML = renderCandidateDetail(data.item || {});
        body.dataset.loaded = 'true';
      } catch (err) {
        body.innerHTML = `<div class="muted">${esc(err?.message || 'No se pudo abrir el perfil completo.')}</div>`;
      }
    };
  });
  host.querySelectorAll('.candidateRetentionInput').forEach((input) => {
    input.onchange = async () => {
      const row = input.closest('.candidateAccordion');
      const msg = row.querySelector('.candidateSaveMsg');
      const keepIndefinitely = !!input.checked;
      input.disabled = true;
      msg.textContent = 'Guardando…';
      try {
        await apiFetch(`/admin/candidates/${encodeURIComponent(row.dataset.userId)}/retention`, { method:'PATCH', body:JSON.stringify({ keepIndefinitely }) });
        const item = (state.overview?.candidates || []).find((candidate) => String(candidate.userId || candidate.id) === String(row.dataset.userId));
        if(item) item.keepIndefinitely = keepIndefinitely;
        msg.textContent = keepIndefinitely ? 'Permanencia indefinida activa.' : 'Permanencia desactivada.';
        const detailBody = row.querySelector('.candidateAccordionBody');
        if(detailBody?.dataset.loaded === 'true') detailBody.dataset.loaded = 'false';
      } catch (err) {
        input.checked = !keepIndefinitely;
        msg.textContent = err?.message || 'No se pudo guardar.';
      } finally {
        input.disabled = false;
      }
    };
  });
}
function companyRowHtml(it){
  return `<div class="adminRow"><b>${esc(it.companyName || 'Empresa')}</b><div class="muted">${esc(it.city || '')} ${it.province ? '· ' + esc(it.province) : ''}</div><div class="muted">CUIT: ${esc(it.cuit || 'sin dato')} · ${esc(it.contactEmail || 'sin mail')}</div><div class="muted">${fd(it.updatedAt)}</div></div>`;
}
function billingRowHtml(it){
  return `<div class="adminRow"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><b>${esc(it.documentNo || 'Documento')}</b><span class="traceBadge">${esc(it.statusLabel || it.status || 'Estado')}</span></div><div class="muted">${esc(it.companyName || 'Empresa')} · ${money(it.total || 0)}</div><div class="muted">${esc(it.billingName || 'Sin razón social')} ${it.billingTaxId ? '· ' + esc(it.billingTaxId) : ''}</div><div class="muted">${esc(it.billingEmail || 'sin mail')} · ${fd(it.paidAt || it.createdAt)}</div><div class="muted">${esc(it.itemsSummary || 'Sin detalle cargado')}</div></div>`;
}

function buildChart(containerId, rows, emptyText){
  const host = document.getElementById(containerId);
  const series = Array.isArray(rows) ? rows : [];
  if(!host) return;
  if(!series.length){
    host.innerHTML = `<div class="muted">${esc(emptyText || 'Sin datos para graficar.')}</div>`;
    return;
  }
  const maxValue = Math.max(1, ...series.flatMap((it) => [Number(it.candidates || 0), Number(it.companies || 0), Number(it.billing || 0)]));
  const ticks = [maxValue, Math.ceil(maxValue * 0.75), Math.ceil(maxValue * 0.5), Math.ceil(maxValue * 0.25), 0];
  const groups = series.map((it) => {
    const bars = [
      { key:'candidates', cls:'series-candidates', value:Number(it.candidates || 0) },
      { key:'companies', cls:'series-companies', value:Number(it.companies || 0) },
      { key:'billing', cls:'series-billing', value:Number(it.billing || 0) },
    ].map((bar) => {
      const height = bar.value > 0 ? Math.max(16, Math.round((bar.value / maxValue) * 168)) : 2;
      return `<div class="traceBarWrap"><span class="traceBarValue">${bar.value}</span><div class="traceBar ${bar.cls}" style="height:${height}px"></div></div>`;
    }).join('');
    return `<div class="traceGroup"><div class="traceBars">${bars}</div><div class="traceGroupLabel">${esc(it.shortLabel || it.label || '—')}</div></div>`;
  }).join('');
  host.innerHTML = `<div class="traceChartLayout"><div class="traceAxisY">${ticks.map((t) => `<span>${t}</span>`).join('')}</div><div class="tracePlot"><div class="traceGroups" style="grid-template-columns:repeat(${series.length},minmax(0,1fr))">${groups}</div></div></div>`;
}

function sumTraceSeries(rows){
  return (rows || []).reduce((acc, it) => {
    acc.candidates += Number(it.candidates || 0);
    acc.companies += Number(it.companies || 0);
    acc.billing += Number(it.billing || 0);
    return acc;
  }, { candidates:0, companies:0, billing:0 });
}

function renderTraceability(){
  const charts = state.overview?.traceabilityCharts || {};
  const monthlySeries = Array.isArray(charts.monthlySeries) ? charts.monthlySeries : [];
  const monthlyWindowSize = Number(charts.monthlyWindowSize || state.traceabilityView.monthlyWindowSize || 4);
  state.traceabilityView.monthlyWindowSize = monthlyWindowSize;
  if(state.traceabilityView.monthlyOffset === null){
    state.traceabilityView.monthlyOffset = Math.max(0, monthlySeries.length - monthlyWindowSize);
  }
  const maxMonthlyOffset = Math.max(0, monthlySeries.length - monthlyWindowSize);
  state.traceabilityView.monthlyOffset = Math.max(0, Math.min(maxMonthlyOffset, Number(state.traceabilityView.monthlyOffset || 0)));
  const monthlyRows = monthlySeries.slice(state.traceabilityView.monthlyOffset, state.traceabilityView.monthlyOffset + monthlyWindowSize);
  buildChart('traceMonthlyChart', monthlyRows, 'Sin datos mensuales para graficar.');
  const monthlyRange = monthlyRows.length ? `${monthLabelFromKey(monthlyRows[0].key, 'long')} a ${monthLabelFromKey(monthlyRows[monthlyRows.length - 1].key, 'long')}` : 'Sin período';
  document.getElementById('traceMonthlyRange').textContent = monthlyRange;
  document.getElementById('btnTraceMonthlyPrev').disabled = state.traceabilityView.monthlyOffset <= 0;
  document.getElementById('btnTraceMonthlyNext').disabled = state.traceabilityView.monthlyOffset >= maxMonthlyOffset;
  const monthlyTotals = sumTraceSeries(monthlyRows);
  document.getElementById('traceMonthlyCandidatesTotal').textContent = String(monthlyTotals.candidates || 0);
  document.getElementById('traceMonthlyCompaniesTotal').textContent = String(monthlyTotals.companies || 0);
  document.getElementById('traceMonthlyBillingTotal').textContent = String(monthlyTotals.billing || 0);

  const availableYears = Array.isArray(charts.availableYears) && charts.availableYears.length ? charts.availableYears.map((y) => Number(y)) : [new Date().getFullYear()];
  if(!availableYears.includes(Number(state.traceabilityView.annualYear))){
    state.traceabilityView.annualYear = Number(charts.currentYear || availableYears[availableYears.length - 1]);
  }
  const yearKey = String(state.traceabilityView.annualYear);
  const annualRows = charts.annualSeriesByYear?.[yearKey] || [];
  buildChart('traceAnnualChart', annualRows, 'Sin datos anuales para graficar.');
  document.getElementById('traceAnnualRange').textContent = `Año ${yearKey}`;
  const yearIndex = availableYears.indexOf(Number(yearKey));
  document.getElementById('btnTraceYearPrev').disabled = yearIndex <= 0;
  document.getElementById('btnTraceYearNext').disabled = yearIndex === -1 || yearIndex >= availableYears.length - 1;
  const annualTotals = sumTraceSeries(annualRows);
  document.getElementById('traceAnnualCandidatesTotal').textContent = String(annualTotals.candidates || 0);
  document.getElementById('traceAnnualCompaniesTotal').textContent = String(annualTotals.companies || 0);
  document.getElementById('traceAnnualBillingTotal').textContent = String(annualTotals.billing || 0);
}

function renderOperationalStatus(){
  const ops = state.overview?.operationalStatus || {};
  const status = String(ops.status || 'UNKNOWN').toUpperCase();
  const statusClass = ({ OK:'ok', WARNING:'warning', CRITICAL:'critical', UNKNOWN:'unknown' }[status] || 'unknown');
  const lights = { OK:'ok', WARNING:'warning', CRITICAL:'critical' };
  document.querySelectorAll('#opsSemaphore [data-light]').forEach((el) => {
    const lightKey = String(el.dataset.light || '').toLowerCase();
    const active = lights[status] === lightKey;
    el.classList.toggle('active', active);
    el.classList.toggle('ok', active && lightKey === 'ok');
    el.classList.toggle('warning', active && lightKey === 'warning');
    el.classList.toggle('critical', active && lightKey === 'critical');
  });
  const pill = document.getElementById('opsStatusPill');
  pill.className = `opsHeadlinePill ${statusClass}`;
  pill.textContent = ops.statusLabel || 'Sin lectura';
  document.getElementById('opsHeadline').textContent = ops.headline || 'Sin diagnóstico operativo disponible.';
  document.getElementById('opsRecommendation').textContent = ops.recommendation || 'Revisá la capacidad y el proveedor de base de datos.';
  document.getElementById('opsDbName').textContent = `Base: ${ops.dbName || 'principal'} · ${ops.provider || 'PostgreSQL'}`;
  document.getElementById('opsProviderNote').textContent = ops.providerLoginNote || 'El enlace abre la consola del proveedor y puede pedir su propio acceso de infraestructura.';
  document.getElementById('opsSizeMb').textContent = `${Number(ops.sizeMb || 0).toLocaleString('es-AR')} MB`;
  document.getElementById('opsUsagePct').textContent = `${Number(ops.usagePct || 0).toLocaleString('es-AR')}% del umbral crítico`;
  document.getElementById('opsWarningMb').textContent = `${Number(ops.warningMb || 0).toLocaleString('es-AR')} MB`;
  document.getElementById('opsCriticalMb').textContent = `${Number(ops.criticalMb || 0).toLocaleString('es-AR')} MB`;
  document.getElementById('opsBackupMode').textContent = ops.backupLabel || 'Pendiente de configurar';
  document.getElementById('opsBackupSummary').textContent = ops.backupSummary || 'Sin política de backup visible todavía.';
  const capturedMonths = Number(ops.snapshotInfo?.capturedMonths || 0);
  document.getElementById('opsSnapshotCount').textContent = `${capturedMonths} mes(es) auditados`;
  document.getElementById('opsSnapshotPolicy').textContent = capturedMonths ? 'Consolidación histórica activa' : 'Esperando consolidación histórica';
  document.getElementById('opsLastClosedMonth').textContent = ops.snapshotInfo?.lastClosedMonth ? monthLabelFromKey(ops.snapshotInfo.lastClosedMonth, 'long') : 'Sin cierre';
  document.getElementById('opsCurrentMonth').textContent = ops.snapshotInfo?.currentMonthKey ? monthLabelFromKey(ops.snapshotInfo.currentMonthKey, 'long') : 'Sin dato';
  document.getElementById('opsBackupPolicyTitle').textContent = ops.backupMode === 'AUTOMATIC' ? 'Resguardo automático diario' : (ops.backupLabel || 'Política no definida');
  document.getElementById('opsBackupPolicyNote').textContent = ops.backupMode === 'AUTOMATIC'
    ? `Se conservan los últimos ${Number(ops.backupRetentionDays || 0).toLocaleString('es-AR')} día(s) y se considera respaldo ${String(ops.backupProviderLabel || 'Proveedor externo').toLowerCase()}.`
    : (ops.backupSummary || 'Todavía no se informó la política de backup.');
  const fillPct = Math.max(0, Math.min(100, Number(ops.usagePct || 0)));
  document.getElementById('opsProgressFill').style.width = `${fillPct}%`;
  document.getElementById('opsProgressLabel').textContent = `Uso estimado: ${fillPct.toLocaleString('es-AR')}% sobre el umbral crítico configurado.`;
  document.getElementById('opsExecutiveNote').textContent = status === 'CRITICAL'
    ? 'Alerta fuerte: conviene reforzar cuanto antes la capacidad o el plan de base de datos y revisar el esquema de backup.'
    : status === 'WARNING'
      ? 'Atención preventiva: el sistema está sano, pero el crecimiento ya amerita mirar capacidad y respaldo con criterio anticipado.'
      : status === 'OK'
        ? 'Estado saludable: la capacidad actual permite seguir creciendo, con trazabilidad y auditoría histórica bajo monitoreo.'
        : 'Lectura incompleta: revisá la conexión con PostgreSQL y configurá los umbrales del tablero para obtener una interpretación automática.';
  const upgrade = document.getElementById('btnUpgradeDb');
  const infra = document.getElementById('btnInfraConsole');
  const backup = document.getElementById('btnBackupConsole');
  upgrade.dataset.url = ops.upgradeUrl || '';
  upgrade.style.display = '';
  document.getElementById('opsUpgradeHint').textContent = ops.upgradeUrl
    ? 'Te pedirá tu clave personal antes de abrir la consola o el panel de ampliación.'
    : 'El botón queda visible y te validará la clave. Si no hay URL configurada, te lo informará para no abrir un destino incorrecto.';
  if(ops.infraUrl){ infra.href = ops.infraUrl; infra.style.display = ''; } else { infra.removeAttribute('href'); infra.style.display = 'none'; }
  if(ops.backupUrl){ backup.href = ops.backupUrl; backup.style.display = ''; } else { backup.removeAttribute('href'); backup.style.display = 'none'; }
}

function formatDateTime(value){
  if(!value) return '—';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', { dateStyle:'short', timeStyle:'short' });
}

function backupStatusClass(status){
  const key = String(status || '').toUpperCase();
  if(key === 'COMPLETED') return 'completed';
  if(key === 'RUNNING') return 'running';
  if(key === 'FAILED') return 'failed';
  if(key === 'BLOCKED') return 'pending';
  return 'pending';
}

function backupStatusLabel(status){
  return ({ COMPLETED:'Completado', RUNNING:'En curso', FAILED:'Fallido', BLOCKED:'Bloqueado por resguardo', PENDING:'Pendiente' }[String(status || '').toUpperCase()] || 'Pendiente');
}

function backupTriggerLabel(trigger){
  return ({ MANUAL_ADMIN:'Manual desde panel', MANUAL:'Manual', AUTO_BOOT:'Automático al iniciar', AUTO_INTERVAL:'Automático programado', AUTO_ADMIN:'Automático al abrir panel' }[String(trigger || '').toUpperCase()] || (trigger || 'Sistema'));
}

function backupIntegrityLabel(ok){
  return ok ? 'Íntegro y legible' : 'Requiere revisión';
}

function shortChecksum(value){
  const s = String(value || '');
  return s ? `${s.slice(0, 12)}…` : '—';
}

function renderBackupCenter(){
  const backup = state.overview?.backupStatus || {};
  document.getElementById('backupLastAt').textContent = formatDateTime(backup.lastBackupAt);
  document.getElementById('backupLastStatus').textContent = backup.lastBackupAt ? `${backupStatusLabel(backup.lastBackupStatus)} · ${backup.lastBackupFileName || 'archivo interno'}` : 'Sin ejecución registrada todavía.';
  document.getElementById('backupNextAt').textContent = formatDateTime(backup.nextBackupAt);
  document.getElementById('backupNextNote').textContent = backup.nextBackupAt ? 'El próximo respaldo se calcula sobre la ventana diaria configurada.' : 'Se generará en cuanto el sistema detecte que corresponde ejecutar el ciclo diario.';
  document.getElementById('backupLastSize').textContent = `${Number(backup.lastBackupSizeMb || 0).toLocaleString('es-AR')} MB`;
  document.getElementById('backupLastRecords').textContent = `${Number(backup.lastBackupRecordCount || 0).toLocaleString('es-AR')} registro(s) incluidos`;
  document.getElementById('backupRetained').textContent = `${Number(backup.retainedFiles || 0).toLocaleString('es-AR')} archivo(s)`;
  document.getElementById('backupRetentionNote').textContent = backup.localBackupEnabled === false ? 'El backup lógico local está desactivado por configuración.' : 'Se conserva la ventana definida de resguardo.';
  const verification = state.backupVerification;
  const integrityOk = verification ? (verification.integrityOk !== false && verification.checksumMatches !== false) : (backup.lastBackupIntegrityOk !== false);
  document.getElementById('backupIntegrityTitle').textContent = backupIntegrityLabel(integrityOk);
  document.getElementById('backupIntegrityNote').textContent = verification
    ? `Checksum ${shortChecksum(verification.checksumSha256)} · verificado ${formatDateTime(verification.verifiedAt)} · ${Number(verification.datasetCount || 0).toLocaleString('es-AR')} dataset(s).`
    : backup.lastBackupAt
      ? `Checksum ${shortChecksum(backup.lastBackupChecksum)} · verificado ${formatDateTime(backup.lastBackupVerifiedAt || backup.lastBackupAt)} · ${Number(backup.lastBackupDatasetCount || 0).toLocaleString('es-AR')} dataset(s).`
      : 'Todavía no se verificó ningún archivo.';
  const preview = state.backupRestorePreview;
  document.getElementById('backupRestoreTitle').textContent = preview?.integrityOk ? 'Archivo apto para revisión' : (preview ? 'Simulación con observaciones' : 'Pendiente');
  document.getElementById('backupRestoreNote').textContent = preview
    ? `${Number(preview.recordCount || 0).toLocaleString('es-AR')} registro(s) · ${Number(preview.datasetCount || 0).toLocaleString('es-AR')} dataset(s) · ${formatDateTime(preview.createdAt)}.`
    : 'Todavía no se ejecutó ninguna simulación.';
  document.getElementById('backupGuardTitle').textContent = backup.lastBlockedBackupAt ? 'Alerta de resguardo activa' : 'Protección activa';
  document.getElementById('backupGuardNote').textContent = backup.lastBlockedBackupAt
    ? `${backup.lastBlockedBackupReason || 'Se bloqueó el último backup.'} Último bloqueo: ${formatDateTime(backup.lastBlockedBackupAt)}.`
    : `Se bloquean respaldos que bajen de ${Math.round(Number(backup.backupGuardMinRatio || 0.8) * 100)}% del último backup confiable.`;
  document.getElementById('backupTrustedTitle').textContent = backup.trustedBackupAt ? formatDateTime(backup.trustedBackupAt) : 'Sin referencia todavía';
  document.getElementById('backupTrustedNote').textContent = backup.trustedBackupAt
    ? `${backup.trustedBackupFileName || backup.trustedBackupKey || 'Backup confiable'} permanece como base segura para continuidad histórica.`
    : 'Todavía no existe un backup confiable registrado.';
  const history = Array.isArray(backup.recentBackups) ? backup.recentBackups : [];
  document.getElementById('backupHistory').innerHTML = history.map((item) => `
    <div class="backupRow">
      <div class="backupRowTop">
        <div><b>${esc(item.fileName || item.backupKey || 'Backup')}</b><div class="muted small" style="margin-top:4px">${backupTriggerLabel(item.triggerSource)} · ${formatDateTime(item.completedAt || item.startedAt)}</div></div>
        <span class="backupBadge ${backupStatusClass(item.status)}">${backupStatusLabel(item.status)}</span>
      </div>
      <div class="muted">${Number(item.fileSizeMb || 0).toLocaleString('es-AR')} MB · ${Number(item.recordCount || 0).toLocaleString('es-AR')} registro(s)</div>
      <div class="muted">${item.failureReason ? esc(item.failureReason) : 'Sin observaciones. Backup listo para resguardo interno.'}</div>
    </div>
  `).join('') || '<div class="muted">Todavía no hay historial de backups para mostrar.</div>';
}

async function triggerManualBackup(){
  const msg = document.getElementById('backupActionMsg');
  msg.textContent = 'Generando backup lógico. Esto puede demorar unos segundos...';
  try {
    const data = await apiFetch('/admin/backup/run', { method:'POST' });
    msg.textContent = `Backup generado correctamente: ${data?.result?.fileName || 'archivo interno'}.`;
    await loadOverview();
  } catch (err) {
    msg.textContent = err?.message || 'No se pudo ejecutar el backup.';
    await loadOverview().catch(() => null);
  }
}

async function downloadLatestBackup(){
  const msg = document.getElementById('backupActionMsg');
  msg.textContent = 'Preparando descarga del último backup...';
  try {
    const token = localStorage.getItem('tp_token') || sessionStorage.getItem('tp_token') || '';
    const res = await fetch((window.API_BASE || '') + '/admin/backup/download/latest', { headers: token ? { Authorization:`Bearer ${token}` } : {} });
    if(!res.ok) throw new Error('No se pudo descargar el backup.');
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || 'talento-pyme-backup.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    msg.textContent = `Descarga lista: ${filename}.`;
  } catch (err) {
    msg.textContent = err?.message || 'No se pudo descargar el backup.';
  }
}

async function verifyLatestBackup(){
  const msg = document.getElementById('backupActionMsg');
  msg.textContent = 'Verificando integridad del último backup...';
  try {
    const data = await apiFetch('/admin/backup/verify/latest');
    state.backupVerification = data?.verification || null;
    const verification = state.backupVerification;
    document.getElementById('backupIntegrityTitle').textContent = backupIntegrityLabel(verification?.integrityOk !== false && verification?.checksumMatches !== false);
    document.getElementById('backupIntegrityNote').textContent = verification
      ? `Checksum ${shortChecksum(verification.checksumSha256)} · ${Number(verification.recordCount || 0).toLocaleString('es-AR')} registro(s) · ${Number(verification.datasetCount || 0).toLocaleString('es-AR')} dataset(s).`
      : 'No se pudo leer la verificación.';
    msg.textContent = verification?.integrityOk ? 'Verificación correcta. El backup es legible y consistente.' : 'La verificación detectó observaciones. Revisá el archivo.';
  } catch (err) {
    msg.textContent = err?.message || 'No se pudo verificar el último backup.';
  }
}

async function previewRestoreLatest(){
  const msg = document.getElementById('backupActionMsg');
  msg.textContent = 'Simulando restauración del último backup...';
  try {
    const data = await apiFetch('/admin/backup/restore/preview/latest');
    state.backupRestorePreview = data?.preview || null;
    renderBackupCenter();
    msg.textContent = state.backupRestorePreview?.integrityOk ? 'Simulación correcta. El archivo puede revisarse como base de restauración.' : 'Simulación con observaciones. Revisá integridad y estructura.';
  } catch (err) {
    msg.textContent = err?.message || 'No se pudo simular la restauración del último backup.';
  }
}

async function openUpgradeAccess(){
  const hint = document.getElementById('opsUpgradeHint');
  const password = window.prompt('Ingresá tu clave personal para abrir la ampliación de capacidad DB.');
  if(password === null) return;
  hint.textContent = 'Validando clave personal...';
  try {
    const data = await apiFetch('/admin/upgrade/access', { method:'POST', body: JSON.stringify({ password }) });
    if(!data?.url) throw new Error('No hay una URL de ampliación/configuración definida todavía.');
    window.open(data.url, '_blank', 'noopener');
    hint.textContent = data?.providerNote || 'Acceso validado. El proveedor puede pedir un segundo login propio.';
  } catch (err) {
    hint.textContent = err?.message || 'No se pudo validar el acceso a ampliación de capacidad.';
  }
}

async function loadOverview(){
  const f = state.filters || {};
  const qs = new URLSearchParams({
    candidateDays: f.candidateDays,
    candidatePage: String(f.candidatePage),
    candidatePerPage: String(f.candidatePerPage),
    companyDays: f.companyDays,
    companyPage: String(f.companyPage),
    companyPerPage: String(f.companyPerPage),
    billingDays: f.billingDays,
    billingStatus: f.billingStatus,
    billingPage: String(f.billingPage),
    billingPerPage: String(f.billingPerPage),
  });
  const data = await apiFetch('/admin/bootstrap?' + qs.toString());
  state.overview = data;
  document.getElementById('sumCandidates').textContent = String(data.summary?.candidateCount || 0);
  document.getElementById('sumCompanies').textContent = String(data.summary?.companyCount || 0);
  document.getElementById('sumJobs').textContent = String(data.summary?.jobsCount || 0);
  document.getElementById('sumBilling').textContent = money(data.summary?.paidTotal || 0);

  document.getElementById('candidateList').innerHTML = (data.candidates || []).map(candidateRowHtml).join('') || '<div class="muted">Sin candidatos en el período seleccionado.</div>';
  document.getElementById('candidateDirectoryList').innerHTML = (data.candidates || []).map(candidateDirectoryRowHtml).join('') || '<div class="muted">Sin candidatos en el período seleccionado.</div>';
  wireCandidateDirectory();
  document.getElementById('companyList').innerHTML = (data.companies || []).map(companyRowHtml).join('') || '<div class="muted">Sin empresas en el período seleccionado.</div>';
  document.getElementById('billingList').innerHTML = (data.billingOrders || []).map(billingRowHtml).join('') || '<div class="muted">Sin documentos en el período seleccionado.</div>';
  document.getElementById('candidatePreview').innerHTML = (data.candidates || []).slice(0, 5).map(candidateRowHtml).join('') || '<div class="muted">Todavía no hay candidatos visibles para este filtro.</div>';
  document.getElementById('companyPreview').innerHTML = (data.companies || []).slice(0, 5).map(companyRowHtml).join('') || '<div class="muted">Todavía no hay empresas visibles para este filtro.</div>';

  const cp = data.candidatePaging || {};
  const sp = data.companyPaging || {};
  const bp = data.billingPaging || {};
  document.getElementById('candidatePagingInfo').textContent = `Mostrando página ${cp.page || 1} de ${cp.totalPages || 1} · ${cp.total || 0} candidato(s)`;
  document.getElementById('candidateDirectoryPagingInfo').textContent = `Mostrando página ${cp.page || 1} de ${cp.totalPages || 1} · ${cp.total || 0} candidato(s)`;
  document.getElementById('companyPagingInfo').textContent = `Mostrando página ${sp.page || 1} de ${sp.totalPages || 1} · ${sp.total || 0} empresa(s)`;
  document.getElementById('billingPagingInfo').textContent = `Mostrando página ${bp.page || 1} de ${bp.totalPages || 1} · ${bp.total || 0} documento(s)`;
  document.getElementById('btnCandidatePrev').disabled = (cp.page || 1) <= 1;
  document.getElementById('btnCandidateNext').disabled = (cp.page || 1) >= (cp.totalPages || 1);
  document.getElementById('btnCandidateDirectoryPrev').disabled = (cp.page || 1) <= 1;
  document.getElementById('btnCandidateDirectoryNext').disabled = (cp.page || 1) >= (cp.totalPages || 1);
  document.getElementById('btnCompanyPrev').disabled = (sp.page || 1) <= 1;
  document.getElementById('btnCompanyNext').disabled = (sp.page || 1) >= (sp.totalPages || 1);
  document.getElementById('btnBillingPrev').disabled = (bp.page || 1) <= 1;
  document.getElementById('btnBillingNext').disabled = (bp.page || 1) >= (bp.totalPages || 1);
  document.getElementById('candidateDaysFilter').value = f.candidateDays;
  document.getElementById('candidateDirectoryDaysFilter').value = f.candidateDays;
  document.getElementById('candidatePerPage').value = String(f.candidatePerPage);
  document.getElementById('candidateDirectoryPerPage').value = String(f.candidatePerPage);

  const tc = data.traceability?.candidate || {};
  const te = data.traceability?.company || {};
  document.getElementById('traceCandidateTotal').textContent = String(tc.totalRegistered || 0);
  document.getElementById('traceCandidateUpdated').textContent = String(tc.updatedLast30 || 0);
  document.getElementById('traceCandidateApplications').textContent = String(tc.applicationsLast30 || 0);
  document.getElementById('traceCandidateChats').textContent = String(tc.chatsLast30 || 0);
  document.getElementById('traceCompanyTotal').textContent = String(te.totalRegistered || 0);
  document.getElementById('traceCompanyUpdated').textContent = String(te.updatedLast30 || 0);
  document.getElementById('traceCompanyJobs').textContent = String(te.jobsLast30 || 0);
  document.getElementById('traceCompanyChats').textContent = String(te.chatsLast30 || 0);
  document.getElementById('traceCompanyOpenings').textContent = String(te.openingsLast30 || 0);
  document.getElementById('billingOrdersTotal').textContent = String(data.summary?.orderCount || 0);
  document.getElementById('billingOrdersPaid').textContent = String(data.summary?.paidOrderCount || 0);
  document.getElementById('billingPaidTotal').textContent = money(data.summary?.paidTotal || 0);
  document.getElementById('billingPendingTotal').textContent = money(data.summary?.pendingTotal || 0);
  document.getElementById('candidateTraceList').innerHTML = (tc.recentEvents || []).map((ev) => traceEventHtml(ev, 'Candidato')).join('') || '<div class="muted">Sin eventos recientes del lado candidato.</div>';
  document.getElementById('companyTraceList').innerHTML = (te.recentEvents || []).map((ev) => traceEventHtml(ev, 'Empresa')).join('') || '<div class="muted">Sin eventos recientes del lado empresa.</div>';
  renderTraceability();
  renderOperationalStatus();
  renderBackupCenter();
}

function fillFactorySelects(companies){
  const opts = ['<option value="">Cualquier empresa</option>'].concat((companies || []).map((c) => `<option value="${c.id}">${esc(c.companyName)}</option>`)).join('');
  document.getElementById('couponCompanyAdmin').innerHTML = opts;
  document.getElementById('freeCompanyAdmin').innerHTML = opts.replace('Cualquier empresa', 'Seleccioná empresa');
  document.getElementById('freeCompanyAdmin').value = '';
}
function renderFactoryAdmin(){
  const data = state.factory || {};
  document.getElementById('matrixRows').innerHTML = (data.plans || []).map((p) => `<div class="matrixRow ${p.active === false ? 'is-off' : ''}" data-code="${p.code}"><div class="wide"><label>Plan</label><input class="input" data-f="name" value="${esc(p.name)}"></div><div><label>Días</label><input class="input" type="number" min="1" data-f="days" value="${p.days}"></div><div><label>Publicaciones</label><input class="input" type="number" min="0" data-f="publications" value="${p.publications || 0}"></div><div><label>Búsquedas</label><input class="input" type="number" min="0" data-f="searches" value="${p.searches || 0}"></div><div><label>Precio</label><input class="input" type="number" min="0" step="1000" data-f="price" value="${p.price}"></div><div class="toggleCell"><label class="toggleLabel"><input type="checkbox" data-f="active" ${p.active === false ? '' : 'checked'}> Plan encendido</label><div class="muted small">Apagalo para mostrarlo sin permitir su uso.</div></div></div>`).join('');
  fillFactorySelects(data.companies || []);
  document.getElementById('couponPctAdmin').innerHTML = Array.from({length:10}, (_,i) => { const pct = (i + 1) * 10; return `<option value="${pct}">${pct}%</option>`; }).join('');
  const monthSel = document.getElementById('freeMonthAdmin');
  const now = new Date();
  monthSel.innerHTML = '';
  for(let i = 0; i < 12; i += 1){
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
    const label = d.toLocaleDateString('es-AR', { month:'long', year:'numeric' });
    monthSel.innerHTML += `<option value="${value}">${label}</option>`;
  }
  document.getElementById('couponActiveList').innerHTML = (data.coupons || []).map((c) => `<div class="adminRow"><b>${esc(c.code)}</b><div class="muted">${c.grantsFullAccess ? 'Acceso total' : (c.discountPct || 0) + '%'} ${c.companyId ? '· empresa específica' : '· uso abierto'}</div></div>`).join('') || '<div class="muted">Sin códigos activos.</div>';
  document.getElementById('grantListAdmin').innerHTML = (data.grants || []).map((g) => `<div class="adminRow"><b>${esc(g.company?.companyName || 'Empresa')}</b><div class="muted">${esc(g.code)} · hasta ${fd(g.fullAccessUntil)}</div></div>`).join('') || '<div class="muted">Sin accesos especiales.</div>';
}
async function loadFactoryAdmin(){ state.factory = await apiFetch('/factory/admin/bootstrap'); renderFactoryAdmin(); }

async function loadThreads(){
  const data = await apiFetch('/admin/chat/threads');
  state.threads = data.items || [];
  const list = document.getElementById('threadList');
  const filtered = activeThreadRole === 'ALL' ? state.threads : state.threads.filter((t) => String(t.role || '').toUpperCase() === activeThreadRole);
  const order = ['COMPANY','CANDIDATE','SUPERADMIN'];
  const sections = order.map((role) => ({ role, items: filtered.filter((t) => String(t.role || '').toUpperCase() === role) })).filter((section) => section.items.length);
  list.innerHTML = sections.map((section) => `<div><div class="threadSectionTitle">${esc(threadRoleLabel[section.role] || section.role)}</div>${section.items.map((t) => `<div class="threadItem ${state.selectedThreadId === t.id ? 'active' : ''}" data-id="${t.id}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><b>${esc(t.company?.companyName || t.user?.email || t.subject || 'Conversación')}</b><span class="threadRoleBadge">${esc(threadRoleLabel[t.role] || t.role)}</span></div><div class="muted">${t.needsHuman ? 'requiere revisión' : 'seguimiento'} · ${fd(t.updatedAt)}</div><div class="muted">${esc(t.lastUserMessage || 'Sin mensaje inicial')}</div></div>`).join('')}</div>`).join('') || '<div class="muted">Sin conversaciones en esta categoría.</div>';
  list.querySelectorAll('.threadItem').forEach((el) => { el.onclick = () => { state.selectedThreadId = el.dataset.id; loadThreads().then(renderSelectedThread); }; });
  if(!state.selectedThreadId || !filtered.find((t) => t.id === state.selectedThreadId)) state.selectedThreadId = filtered[0]?.id || null;
  renderSelectedThread();
}
function renderSelectedThread(){
  const thread = state.threads.find((t) => t.id === state.selectedThreadId);
  const box = document.getElementById('threadMessages');
  const meta = document.getElementById('threadMeta');
  if(!thread){
    meta.textContent = 'Seleccioná una conversación.';
    box.innerHTML = '<div class="muted">Sin hilo seleccionado.</div>';
    return;
  }
  meta.textContent = `${threadRoleLabel[thread.role] || 'Ayuda IA'} · ${thread.company?.companyName || thread.user?.email || thread.subject || 'Conversación'} · ${thread.needsHuman ? 'pendiente de operador' : 'seguimiento'}`;
  box.innerHTML = (thread.messages || []).map((m) => `<div class="msgBubble ${m.actor}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><b>${esc(actorLabelEs(m.actor))}</b><span class="muted small">${esc(fd(m.createdAt))}</span></div><div style="margin-top:6px">__KEEP__</div></div>`).join('');
}

document.getElementById('btnSaveMatrix').onclick = async () => {
  const rows = Array.from(document.querySelectorAll('#matrixRows .matrixRow')).map((r) => {
    const get = (f) => r.querySelector(`[data-f="${f}"]`).value;
    const active = !!r.querySelector('[data-f="active"]')?.checked;
    return { code:r.dataset.code, name:get('name'), days:Number(get('days') || 0), publications:Number(get('publications') || 0), searches:Number(get('searches') || 0), price:Number(get('price') || 0), active };
  });
  const msg = document.getElementById('matrixMsg');
  msg.textContent = 'Guardando…';
  try{ await apiFetch('/factory/admin/plans', { method:'POST', body:JSON.stringify({ plans:rows }) }); msg.textContent = 'Matriz actualizada.'; await loadFactoryAdmin(); }catch(e){ msg.textContent = e.message; }
};
document.getElementById('btnCreateCouponAdmin').onclick = async () => {
  const msg = document.getElementById('couponAdminMsg');
  msg.textContent = 'Guardando…';
  try{ await apiFetch('/factory/admin/coupons', { method:'POST', body:JSON.stringify({ code:document.getElementById('couponCodeAdmin').value.trim(), discountPct:Number(document.getElementById('couponPctAdmin').value || 0), companyId:document.getElementById('couponCompanyAdmin').value || null }) }); msg.textContent = 'Código creado.'; document.getElementById('couponCodeAdmin').value = ''; await loadFactoryAdmin(); }catch(e){ msg.textContent = e.message; }
};
document.getElementById('btnCreateFreeAdmin').onclick = async () => {
  const msg = document.getElementById('freeAdminMsg');
  msg.textContent = 'Generando…';
  try{ await apiFetch('/factory/admin/full-access', { method:'POST', body:JSON.stringify({ code:document.getElementById('freeCodeAdmin').value.trim(), companyId:document.getElementById('freeCompanyAdmin').value, untilMonth:document.getElementById('freeMonthAdmin').value }) }); msg.textContent = 'Acceso creado.'; document.getElementById('freeCodeAdmin').value = ''; await loadFactoryAdmin(); }catch(e){ msg.textContent = e.message; }
};

document.getElementById('candidateDaysFilter').onchange = (e) => { state.filters.candidateDays = e.target.value; state.filters.candidatePage = 1; loadOverview(); };
document.getElementById('candidatePerPage').onchange = (e) => { state.filters.candidatePerPage = Number(e.target.value || 50); state.filters.candidatePage = 1; loadOverview(); };
document.getElementById('candidateDirectoryDaysFilter').onchange = (e) => { state.filters.candidateDays = e.target.value; state.filters.candidatePage = 1; loadOverview(); };
document.getElementById('candidateDirectoryPerPage').onchange = (e) => { state.filters.candidatePerPage = Number(e.target.value || 50); state.filters.candidatePage = 1; loadOverview(); };
document.getElementById('companyDaysFilter').onchange = (e) => { state.filters.companyDays = e.target.value; state.filters.companyPage = 1; loadOverview(); };
document.getElementById('companyPerPage').onchange = (e) => { state.filters.companyPerPage = Number(e.target.value || 50); state.filters.companyPage = 1; loadOverview(); };
document.getElementById('billingDaysFilter').onchange = (e) => { state.filters.billingDays = e.target.value; state.filters.billingPage = 1; loadOverview(); };
document.getElementById('billingStatusFilter').onchange = (e) => { state.filters.billingStatus = e.target.value; state.filters.billingPage = 1; loadOverview(); };
document.getElementById('billingPerPage').onchange = (e) => { state.filters.billingPerPage = Number(e.target.value || 50); state.filters.billingPage = 1; loadOverview(); };
document.getElementById('btnCandidatePrev').onclick = () => { if(state.filters.candidatePage > 1){ state.filters.candidatePage -= 1; loadOverview(); } };
document.getElementById('btnCandidateNext').onclick = () => { state.filters.candidatePage += 1; loadOverview(); };
document.getElementById('btnCandidateDirectoryPrev').onclick = () => { if(state.filters.candidatePage > 1){ state.filters.candidatePage -= 1; loadOverview(); } };
document.getElementById('btnCandidateDirectoryNext').onclick = () => { state.filters.candidatePage += 1; loadOverview(); };
document.getElementById('btnCompanyPrev').onclick = () => { if(state.filters.companyPage > 1){ state.filters.companyPage -= 1; loadOverview(); } };
document.getElementById('btnCompanyNext').onclick = () => { state.filters.companyPage += 1; loadOverview(); };
document.getElementById('btnBillingPrev').onclick = () => { if(state.filters.billingPage > 1){ state.filters.billingPage -= 1; loadOverview(); } };
document.getElementById('btnBillingNext').onclick = () => { state.filters.billingPage += 1; loadOverview(); };
document.getElementById('btnTraceMonthlyPrev').onclick = () => { state.traceabilityView.monthlyOffset = Math.max(0, Number(state.traceabilityView.monthlyOffset || 0) - state.traceabilityView.monthlyWindowSize); renderTraceability(); };
document.getElementById('btnTraceMonthlyNext').onclick = () => { const monthlySeries = state.overview?.traceabilityCharts?.monthlySeries || []; const maxOffset = Math.max(0, monthlySeries.length - state.traceabilityView.monthlyWindowSize); state.traceabilityView.monthlyOffset = Math.min(maxOffset, Number(state.traceabilityView.monthlyOffset || 0) + state.traceabilityView.monthlyWindowSize); renderTraceability(); };
document.getElementById('btnTraceYearPrev').onclick = () => { const years = (state.overview?.traceabilityCharts?.availableYears || []).map((y) => Number(y)); const idx = years.indexOf(Number(state.traceabilityView.annualYear)); if(idx > 0){ state.traceabilityView.annualYear = years[idx - 1]; renderTraceability(); } };
document.getElementById('btnTraceYearNext').onclick = () => { const years = (state.overview?.traceabilityCharts?.availableYears || []).map((y) => Number(y)); const idx = years.indexOf(Number(state.traceabilityView.annualYear)); if(idx >= 0 && idx < years.length - 1){ state.traceabilityView.annualYear = years[idx + 1]; renderTraceability(); } };

document.getElementById('btnRefreshThreads').onclick = () => loadThreads();
document.getElementById('btnRunBackup').onclick = () => triggerManualBackup();
document.getElementById('btnDownloadBackup').onclick = () => downloadLatestBackup();
document.getElementById('btnVerifyBackup').onclick = () => verifyLatestBackup();
document.getElementById('btnPreviewRestore').onclick = () => previewRestoreLatest();
document.getElementById('btnUpgradeDb').onclick = () => openUpgradeAccess();
document.getElementById('btnSendOperatorReply').onclick = async () => {
  const threadId = state.selectedThreadId;
  const content = document.getElementById('operatorReply').value.trim();
  const msg = document.getElementById('operatorReplyMsg');
  if(!threadId || !content){ msg.textContent = 'Seleccioná un hilo y escribí la respuesta.'; return; }
  msg.textContent = 'Enviando…';
  try{
    await apiFetch('/admin/chat/reply', { method:'POST', body:JSON.stringify({ threadId, content, reusable:document.getElementById('replyReusable').checked }) });
    document.getElementById('operatorReply').value = '';
    document.getElementById('replyReusable').checked = false;
    msg.textContent = 'Respuesta enviada.';
    await loadThreads();
  }catch(e){ msg.textContent = e.message; }
};

Promise.allSettled([loadOverview(), loadFactoryAdmin(), loadThreads()]).then((results) => {
  results.forEach((r) => { if(r.status === 'rejected') console.error(r.reason); });
  if(results[0]?.status === 'rejected'){
    document.getElementById('sumCandidates').textContent = '—';
    document.getElementById('sumCompanies').textContent = '—';
  }
});
