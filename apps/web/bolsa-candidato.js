/* Talento PyME - v4.0.4 (candidato) - Mi Perfil = Bolsa de Trabajo (gemela UIC) */

const AREA_TRABAJO = [
  "Eléctrica (Industrial)",
  "Mecánica (Industrial)",
  "Operaciones de planta y producción",
  "Mantenimiento industrial (general)",
  "Soldadura, cañerías y montaje",
  "Calderería y recipientes",
  "Climatización / Refrigeración industrial",
  "Mecanizado y fabricación (taller)",
  "Instrumentación, control y automatización (I&C)",
  "Construcción y obra civil industrial",
  "Proyectista / Oficina técnica / CAD-BIM",
  "Calculista / Ingeniería de detalle",
  "Supervisión / Capataz / Jefaturas operativas",
  "Planificación y control (Planificador / Programación / Control de costos)",
  "Calidad e inspección (QA/QC – Ensayos no destructivos)",
  "Seguridad, higiene y ambiente (HSE)",
  "Logística, depósito y abastecimiento",
  "Administrativo / RR.HH. / Finanzas / Comercial",
  "Sustentabilidad y Medio ambiente",
  // NUEVAS (v31.3)
  "Transporte y logística",
  "Comercio exterior",
  "IT / Software",
];

const NIVEL_ELECTRO_MEC = ["Ayudante / Auxiliar", "Medio oficial", "Oficial", "Oficial especializado / Senior", "Técnico", "Supervisor"];

const RANGO_EXP = ["0–1", "2–5", "6–10", "11–20", "21–30", "31+"];

const NIVEL_EDU = ["Primaria", "Secundaria", "Terciaria", "Universitaria", "Otros"];

const ESTADO_CIVIL = ["Soltero/a", "Casado/a", "Unión convivencial / Concubinato", "Separado/a", "Divorciado/a", "Viudo/a"];

const NACIONALIDAD = ["Argentina", "Uruguaya", "Paraguaya", "Boliviana", "Chilena", "Brasileña", "Peruana", "Colombiana", "Venezolana", "Otra"];

const LOCALIDADES = [
  "Campana", "Zárate", "Pilar", "Escobar", "Tigre", "Malvinas Argentinas", "San Fernando", "San Isidro", "Vicente López", "San Martín", "Hurlingham", "Morón",
  "CABA", "La Plata", "Mar del Plata", "Bahía Blanca", "Rosario", "Córdoba", "Mendoza", "San Juan", "Neuquén", "Comodoro Rivadavia", "Río Gallegos", "Salta", "Tucumán",
  "Otra",
];

const HERRAMIENTAS_MECANICA = [
  "Torno paralelo / torno a tornillo",
  "Torno CNC",
  "Fresadora universal",
  "Fresadora CNC / Centro de mecanizado",
  "Alesadora",
  "Rectificadora (plana/cilíndrica)",
  "Cortadora de cinta / sinfín",
  "Sierra circular industrial",
  "Tronzadora / sensitiva",
  "Prensa hidráulica",
  "Plegadora",
  "Guillotina",
  "Mandrinadora / roscadora",
  "Taladro de banco / radial",
  "Balanceadora",
  "Alineador láser (ejes)",
];

const INSTRUMENTOS_ELECTRICA = [
  "Megóhmetro / Megger (aislación)",
  "Telurímetro (puesta a tierra)",
  "Pinza amperométrica TRMS industrial",
  "Analizador de redes / calidad de energía (armónicos)",
  "Osciloscopio (formas de onda)",
  "Detector de tensión (alta/baja)",
  "Cámara termográfica",
  "Medidor de secuencia de fases",
];

const ESPECIALIDADES = {
  "Eléctrica (Industrial)": [
    "Electricista industrial", "Oficial electricista", "Técnico electricista", "Tablerista", "Montador de bandejas / canalizaciones", "Instrumentista eléctrico", "Bobinador de motores", "Mantenimiento eléctrico", "Guardia eléctrica", "Protecciones / relés", "Media tensión", "Alta tensión", "Iluminación industrial", "Termografía eléctrica", "Líneas y subestaciones", "Otros",
  ],
  "Mecánica (Industrial)": [
    "Mecánico industrial", "Técnico mecánico", "Mecánico de mantenimiento", "Alineación y balanceo", "Bombas y válvulas", "Compresores", "Turbomáquinas", "Motores", "Hidráulica", "Neumática", "Reductores", "Rodamientos", "Lubricación", "Mecánico de planta", "Otros",
  ],
  "Operaciones de planta y producción": [
    "Operador de planta", "Operador de sala de control", "Operador de campo", "Operador de producción", "Operador de proceso", "Operador de tratamiento de agua", "Operador de caldera", "Operador de utilidades", "Operador Oil & Gas", "Operador de carga/descarga", "Otros",
  ],
  "Mantenimiento industrial (general)": [
    "Técnico de mantenimiento", "Mantenimiento general", "Mecánica y eléctrica", "Mantenimiento preventivo", "Mantenimiento correctivo", "Lubricador industrial", "Inspector de mantenimiento", "Supervisor de mantenimiento", "Otros",
  ],
  "Soldadura, cañerías y montaje": [
    "Soldador SMAW (electrodo)", "Soldador MIG/MAG", "Soldador TIG", "Soldador 6G", "Cañista / cañero", "Montador de cañerías", "Armador", "Montajista", "Gomería industrial (mangueras)", "Aislación térmica", "Otros",
  ],
  "Calderería y recipientes": [
    "Calderero", "Armador de calderería", "Trazador", "Soldador calderería", "Recipientes a presión", "Tanques", "Intercambiadores", "Otros",
  ],
  "Climatización / Refrigeración industrial": [
    "Técnico en refrigeración", "Frigorista", "Climatización VRV/VRF", "Chillers", "Cámaras frigoríficas", "HVAC industrial", "Otros",
  ],
  "Mecanizado y fabricación (taller)": [
    "Tornero", "Fresador", "Alesador", "CNC operador", "CNC programador", "Rectificador", "Afilador", "Ajustador", "Plegador", "Guillotinero", "Otros",
  ],
  "Instrumentación, control y automatización (I&C)": [
    "Instrumentista", "Técnico en instrumentación", "PLC / SCADA", "Automatista", "Calibración", "Válvulas de control", "Lazo de control", "DCS", "Redes industriales", "Otros",
  ],
  "Construcción y obra civil industrial": [
    "Albañil", "Oficial de obra", "Hormigonero", "Encofrador", "Fierrero", "Pintor industrial", "Andamiero", "Gruista", "Operador de excavadora", "Operador de retro", "Maquinista", "Otros",
  ],
  "Proyectista / Oficina técnica / CAD-BIM": [
    "Dibujante técnico", "Proyectista mecánico", "Proyectista eléctrico", "Proyectista piping", "CADista", "BIM modeler", "Documentación técnica", "Isométricos", "Otros",
  ],
  "Calculista / Ingeniería de detalle": [
    "Calculista estructuras", "Calculista piping", "Calculista recipientes", "Ingeniería de detalle", "Cálculo mecánico", "Cálculo eléctrico", "Memorias de cálculo", "Otros",
  ],
  "Supervisión / Capataz / Jefaturas operativas": [
    "Supervisor de obra", "Capataz", "Jefe de turno", "Jefe de mantenimiento", "Supervisor de montaje", "Supervisor de producción", "Inspector de campo", "Otros",
  ],
  "Planificación y control (Planificador / Programación / Control de costos)": [
    "Planificador", "Programador", "Control de costos", "Planner mantenimiento", "Planner obra", "MS Project", "Primavera P6", "Compras técnicas", "Otros",
  ],
  "Calidad e inspección (QA/QC – Ensayos no destructivos)": [
    "Inspector QA/QC", "Inspector soldadura", "Inspector piping", "Inspector estructuras", "END - VT", "END - PT", "END - MT", "END - UT", "END - RT", "Inspector dimensional", "Otros",
  ],
  "Seguridad, higiene y ambiente (HSE)": [
    "Técnico en seguridad e higiene", "Supervisor HSE", "Permisos de trabajo", "Auditor HSE", "Brigadista", "Gestión ambiental", "Otros",
  ],
  "Logística, depósito y abastecimiento": [
    "Operario de depósito", "Clarkista / autoelevador", "Picker", "Pańolero", "Abastecedor de línea", "Receptor", "Expedición", "Inventarios", "Compras", "Otros",
  ],
  "Administrativo / RR.HH. / Finanzas / Comercial": [
    "Administrativo", "Asistente", "RR.HH.", "Liquidación de sueldos", "Contabilidad", "Tesorería", "Facturación", "Comercial", "Atención al cliente", "Otros",
  ],
  "Sustentabilidad y Medio ambiente": [
    "Gestión ambiental", "Residuos", "Sustentabilidad", "Huella de carbono", "ISO 14001", "Reportes ESG", "Otros",
  ],
  "Transporte y logística": [
    "Chofer camión", "Chofer semi / batea", "Chofer hidrogrúa", "Chofer autoelevador (movimientos)", "Despachante / tráfico", "Coordinador de transporte", "Ruteador", "Operador de balanza", "Supervisor logística", "Otros",
  ],
  "Comercio exterior": [
    "Analista Comex", "Despachante de aduana", "Documentación de exportación", "Documentación de importación", "Clasificación arancelaria", "Logística internacional", "Forwarder", "Compras internacionales", "Otros",
  ],
  "IT / Software": [
    "Soporte técnico", "Helpdesk", "Administrador de sistemas", "Redes", "Ciberseguridad", "Desarrollador frontend", "Desarrollador backend", "Full stack", "QA / Testing", "DevOps", "Data / BI", "Otros",
  ],
};

const YES_NO = [
  { value: "si", label: "Sí" },
  { value: "no", label: "No" },
];

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

function toBoolYesNo(v){
  if(v===true || v==="true") return true;
  if(v===false || v==="false") return false;
  return String(v||"").toLowerCase()==="si";
}
function fromBoolYesNo(b){ return b ? "si" : "no"; }

function splitFullName(fullName){
  const s = String(fullName||"").trim();
  if(!s) return { nombre:"", apellido:"" };
  const parts = s.split(/\s+/);
  if(parts.length===1) return { nombre: parts[0], apellido:"" };
  return { nombre: parts.slice(0,-1).join(" "), apellido: parts.slice(-1).join(" ") };
}

function getEspecialidades(area){
  const arr = ESPECIALIDADES[area] || [];
  return [...arr, "Otros"];
}

function renderSelectOptions(options, selected){
  return options.map(o=> {
    if(typeof o === "string"){
      const v=o;
      return `<option value="${esc(v)}" ${v===selected?"selected":""}>${esc(v)}</option>`;
    }
    return `<option value="${esc(o.value)}" ${o.value===selected?"selected":""}>${esc(o.label)}</option>`;
  }).join("");
}

function renderCheckboxList({ items, selectedSet, name }){
  return `
    <div class="tp-check-grid">
      ${items.map(item=>{
        const checked = selectedSet.has(item) ? "checked" : "";
        const id = `${name}_${item.replace(/[^a-z0-9]+/gi,"_")}`;
        return `
          <label class="tp-check">
            <input type="checkbox" data-cb-group="${name}" value="${esc(item)}" ${checked}>
            <span>${esc(item)}</span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function getGroupValues(group){
  const inputs = Array.from(document.querySelectorAll(`input[type="checkbox"][data-cb-group="${group}"]`));
  return inputs.filter(i=>i.checked).map(i=>i.value);
}

async function initBolsaCandidato(){
  requireAuth();
  applyRoleVisibility();
  applyVersionBadges();

  const root = el("bolsaRoot");
  if(!root) return;

  const role = getRole();
  if(role !== "CANDIDATE"){
    root.innerHTML = `<div class="card"><p>Este panel está disponible por ahora solo para <b>Candidatos</b>.</p></div>`;
    return;
  }

  let mode = "alta";

  const empty = {
    nombre:"",
    apellido:"",
    dni:"",
    nacionalidad:"Argentino/a",
    estadoCivil:"",
    hijos:"",
    telefono:"",
    correo:"",
    localidad:"",
    direccion:"",
    areaTrabajo:"",
    nivel:"",
    especialidad:"",
    especialidadOtro:"",
    rangoExperiencia:"",
    nivelEducativo:"",
    tieneCapacitacion:false,
    trabajaActualmente:false,
    sueldoPretendido:"",
    ultimoTrabajo:"",
    observaciones:"",
    herramientasMecanica:[],
    instrumentosElectrica:[]
  };

  let cand = { ...empty };
  let me = null;
  let bolsaLoaded = false;

  let busy = false;
  let okMsg = "";
  let errMsg = "";

  let searchBusy = false;
  let searchErr = "";
  let searchItems = [];
  let statsTotal = null;

  let jobs = {
    q:"",
    area:"",
    nivel:"",
    especialidad:"",
    localidad:"",
    herr:[],
    instr:[]
  };

  function render(){
    const especialidades = cand.areaTrabajo ? getEspecialidades(cand.areaTrabajo) : [];
    const showNivel = (cand.areaTrabajo === "Eléctrica (Industrial)" || cand.areaTrabajo === "Mecánica (Industrial)");
    const showHerr = cand.areaTrabajo === "Mecánica (Industrial)";
    const showInstr = cand.areaTrabajo === "Eléctrica (Industrial)";
    const especIsOtros = cand.especialidad === "Otros";

    const jobsEspecialidades = jobs.area ? getEspecialidades(jobs.area) : [];
    const jobsShowNivel = (jobs.area === "Eléctrica (Industrial)" || jobs.area === "Mecánica (Industrial)");
    const jobsShowHerr = jobs.area === "Mecánica (Industrial)";
    const jobsShowInstr = jobs.area === "Eléctrica (Industrial)";

    root.innerHTML = `
      <div class="tp-bolsa-head">
        <div>
          <h2 style="margin:0;">Mi Perfil</h2>
          <div class="muted">Bolsa de Trabajo (copia gemela estilo UIC) • v${esc(TP_APP_VERSION)}</div>
        </div>
        <div class="tp-chip-row">
          <button class="chip ${mode==="alta"?"on":""}" data-mode="alta">Alta / Mi perfil</button>
          
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        ${mode==="alta" ? `
          <div class="rowBetween" style="margin-bottom:10px;">
            <div class="muted">Completá tu perfil. Los datos del registro se usan como base.</div>
            <div>
              <button class="btn secondary" id="btnReloadBolsa" type="button">Recargar</button>
            </div>
          </div>

          <details open class="tp-details">
            <summary><b>1) Datos personales</b></summary>
            <div class="formGrid">
              <label>Nombre
                <input id="c_nombre" value="${esc(cand.nombre)}" placeholder="Ej: Juan" />
              </label>
              <label>Apellido
                <input id="c_apellido" value="${esc(cand.apellido)}" placeholder="Ej: Pérez" />
              </label>
              <label>DNI
                <input id="c_dni" value="${esc(cand.dni)}" placeholder="Ej: 12345678" />
              </label>
              <label>Nacionalidad
                <select id="c_nacionalidad">
                  <option value="">(seleccionar)</option>
                  ${renderSelectOptions(NACIONALIDAD, cand.nacionalidad)}
                </select>
              </label>
              <label>Estado civil
                <select id="c_estadoCivil">
                  <option value="">(seleccionar)</option>
                  ${renderSelectOptions(ESTADO_CIVIL, cand.estadoCivil)}
                </select>
              </label>
              <label>Hijos (cantidad)
                <input id="c_hijos" value="${esc(cand.hijos)}" placeholder="Ej: 0 / 1 / 2" />
              </label>
              <label>Teléfono
                <input id="c_telefono" value="${esc(cand.telefono)}" placeholder="Ej: 11..." />
              </label>
              <label>Email
                <input id="c_correo" value="${esc(cand.correo)}" placeholder="Ej: correo@..." />
              </label>
              <label>Localidad
                <select id="c_localidad">
                  <option value="">(seleccionar)</option>
                  ${renderSelectOptions(LOCALIDADES, cand.localidad)}
                </select>
              </label>
              <label>Dirección (opcional)
                <input id="c_direccion" value="${esc(cand.direccion)}" placeholder="Calle y número" />
              </label>
            </div>
          </details>

          <details open class="tp-details">
            <summary><b>2) Perfil laboral</b></summary>
            <div class="formGrid">
              <label>Área de trabajo
                <select id="c_areaTrabajo">
                  <option value="">(seleccionar)</option>
                  ${renderSelectOptions(AREA_TRABAJO, cand.areaTrabajo)}
                </select>
              </label>

              ${showNivel ? `
                <label>Nivel (solo para Mecánica/Eléctrica Industrial)
                  <select id="c_nivel">
                    <option value="">(seleccionar)</option>
                    ${renderSelectOptions(NIVEL_ELECTRO_MEC, cand.nivel)}
                  </select>
                </label>
              ` : `
                <label style="opacity:.6;">Nivel
                  <select id="c_nivel" disabled>
                    <option value="">(no aplica)</option>
                  </select>
                </label>
              `}

              <label>Especialidad
                <select id="c_especialidad" ${cand.areaTrabajo ? "" : "disabled"}>
                  <option value="">(seleccionar)</option>
                  ${renderSelectOptions(especialidades, cand.especialidad)}
                </select>
              </label>

              ${especIsOtros ? `
                <label>Si elegiste "Otros", especificá
                  <input id="c_especialidadOtro" value="${esc(cand.especialidadOtro)}" placeholder="Especificá tu especialidad" />
                </label>
              ` : `
                <label style="opacity:.6;">Especialidad (otros)
                  <input id="c_especialidadOtro" value="${esc(cand.especialidadOtro)}" placeholder="(solo si elegís Otros)" disabled />
                </label>
              `}
            </div>

            ${showHerr ? `
              <div style="margin-top:10px;">
                <div class="muted" style="margin-bottom:6px;"><b>Herramientas / Máquina-herramienta (Mecánica)</b></div>
                ${renderCheckboxList({ items: HERRAMIENTAS_MECANICA, selectedSet: new Set(cand.herramientasMecanica), name:"herrMec" })}
              </div>
            ` : ""}

            ${showInstr ? `
              <div style="margin-top:10px;">
                <div class="muted" style="margin-bottom:6px;"><b>Instrumentos / Electricidad</b></div>
                ${renderCheckboxList({ items: INSTRUMENTOS_ELECTRICA, selectedSet: new Set(cand.instrumentosElectrica), name:"instrElec" })}
              </div>
            ` : ""}
          </details>

          <details open class="tp-details">
            <summary><b>3) Experiencia y formación</b></summary>
            <div class="formGrid">
              <label>Rango de experiencia
                <select id="c_rangoExp">
                  <option value="">(seleccionar)</option>
                  ${renderSelectOptions(RANGO_EXP, cand.rangoExperiencia)}
                </select>
              </label>
              <label>Nivel educativo
                <select id="c_nivelEdu">
                  <option value="">(seleccionar)</option>
                  ${renderSelectOptions(NIVEL_EDU, cand.nivelEducativo)}
                </select>
              </label>
              <label>¿Tenés capacitación/cursos?
                <select id="c_cap">
                  <option value="no" ${!cand.tieneCapacitacion?"selected":""}>No</option>
                  <option value="si" ${cand.tieneCapacitacion?"selected":""}>Sí</option>
                </select>
              </label>
            </div>
          </details>

          <details open class="tp-details">
            <summary><b>4) Situación y preferencias</b></summary>
            <div class="formGrid">
              <label>¿Trabajás actualmente?
                <select id="c_trabaja">
                  <option value="no" ${!cand.trabajaActualmente?"selected":""}>No</option>
                  <option value="si" ${cand.trabajaActualmente?"selected":""}>Sí</option>
                </select>
              </label>
              <label>Sueldo pretendido (opcional)
                <input id="c_sueldo" value="${esc(cand.sueldoPretendido)}" placeholder="Ej: A convenir / $..." />
              </label>
              <label>Último trabajo / puesto (opcional)
                <input id="c_ultimo" value="${esc(cand.ultimoTrabajo)}" placeholder="Ej: Técnico..." />
              </label>
            </div>
          </details>

          <details open class="tp-details">
            <summary><b>5) Observaciones</b></summary>
            <label style="display:block; margin-top:8px;">
              <textarea id="c_obs" rows="4" placeholder="Información adicional...">${esc(cand.observaciones)}</textarea>
            </label>
          </details>

          <div class="rowBetween" style="margin-top:14px; gap:12px;">
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <button class="btn" id="btnSaveBolsa" type="button" ${busy?"disabled":""}>${busy?"Guardando...":"Guardar"}</button>
              <span class="ok">${esc(okMsg)}</span>
              <span class="error">${esc(errMsg)}</span>
            </div>
            <div class="muted">${bolsaLoaded ? "Perfil cargado" : "Cargando..."}</div>
          </div>
        ` : `
          <div class="rowBetween" style="margin-bottom:10px;">
            <div>
              <h3 style="margin:0 0 4px 0;">Buscar CV</h3>
              <div class="muted">${statsTotal!==null ? `${statsTotal} candidatos cargados` : ""}</div>
            </div>
            <button class="btn secondary" id="btnStats" type="button">Actualizar estadísticas</button>
          </div>

          <div class="formGrid">
            <label>Palabra clave (nombre, especialidad, etc.)
              <input id="j_q" value="${esc(jobs.q)}" placeholder="Ej: mantenimiento, plc, torno..." />
            </label>
            <label>Área
              <select id="j_area">
                <option value="">(todas)</option>
                ${renderSelectOptions(AREA_TRABAJO, jobs.area)}
              </select>
            </label>

            ${jobsShowNivel ? `
              <label>Nivel
                <select id="j_nivel">
                  <option value="">(todos)</option>
                  ${renderSelectOptions(NIVEL_ELECTRO_MEC, jobs.nivel)}
                </select>
              </label>
            ` : `
              <label style="opacity:.6;">Nivel
                <select id="j_nivel" disabled>
                  <option value="">(no aplica)</option>
                </select>
              </label>
            `}

            <label>Especialidad
              <select id="j_especialidad" ${jobs.area ? "" : "disabled"}>
                <option value="">(todas)</option>
                ${renderSelectOptions(jobsEspecialidades, jobs.especialidad)}
              </select>
            </label>

            <label>Localidad
              <select id="j_localidad">
                <option value="">(todas)</option>
                ${renderSelectOptions(LOCALIDADES, jobs.localidad)}
              </select>
            </label>
          </div>

          ${jobsShowHerr ? `
            <div style="margin-top:10px;">
              <div class="muted" style="margin-bottom:6px;"><b>Herramientas (filtro)</b></div>
              ${renderCheckboxList({ items: HERRAMIENTAS_MECANICA, selectedSet: new Set(jobs.herr), name:"jobsHerr" })}
            </div>
          ` : ""}

          ${jobsShowInstr ? `
            <div style="margin-top:10px;">
              <div class="muted" style="margin-bottom:6px;"><b>Instrumentos (filtro)</b></div>
              ${renderCheckboxList({ items: INSTRUMENTOS_ELECTRICA, selectedSet: new Set(jobs.instr), name:"jobsInstr" })}
            </div>
          ` : ""}

          <div class="rowBetween" style="margin-top:14px; gap:12px;">
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
              <button class="btn" id="btnSearch" type="button" ${searchBusy?"disabled":""}>${searchBusy?"Buscando...":"Buscar"}</button>
              <span class="error">${esc(searchErr)}</span>
            </div>
            <div class="muted">${searchItems.length ? `${searchItems.length} resultados` : ""}</div>
          </div>

          <div style="margin-top:12px;">
            ${searchItems.map(it=>`
              <div class="tp-result">
                <div class="rowBetween" style="gap:12px;">
                  <div>
                    <div style="font-weight:700;">${esc(it.nombre)} ${esc(it.apellido)} <span class="muted">• ${esc(it.localidad||"")}</span></div>
                    <div class="muted">${esc(it.areaTrabajo)}${it.nivel?` • Nivel: ${esc(it.nivel)}`:""} • ${esc(it.especialidad)}${it.especialidadOtro?` (${esc(it.especialidadOtro)})`:""}</div>
                  </div>
                  <div class="muted" style="white-space:nowrap;">Actualizado: ${new Date(it.updatedAt).toLocaleDateString()}</div>
                </div>
                <details style="margin-top:8px;">
                  <summary>Ver detalle</summary>
                  <div class="formGrid" style="margin-top:8px;">
                    <div><b>Tel:</b> ${esc(it.telefono||"")}</div>
                    <div><b>Email:</b> ${esc(it.correo||"")}</div>
                    <div><b>Experiencia:</b> ${esc(it.rangoExperiencia||"")}</div>
                    <div><b>Educación:</b> ${esc(it.nivelEducativo||"")}</div>
                    <div><b>Capacitación:</b> ${it.tieneCapacitacion ? "Sí" : "No"}</div>
                    <div><b>Trabaja:</b> ${it.trabajaActualmente ? "Sí" : "No"}</div>
                    <div><b>Sueldo:</b> ${esc(it.sueldoPretendido||"")}</div>
                    <div><b>Último:</b> ${esc(it.ultimoTrabajo||"")}</div>
                  </div>
                  ${(it.herramientasMecanica?.length) ? `<div style="margin-top:8px;"><b>Herramientas:</b> ${esc(it.herramientasMecanica.join(", "))}</div>` : ""}
                  ${(it.instrumentosElectrica?.length) ? `<div style="margin-top:8px;"><b>Instrumentos:</b> ${esc(it.instrumentosElectrica.join(", "))}</div>` : ""}
                  ${it.observaciones ? `<div style="margin-top:8px;"><b>Observaciones:</b><br>${esc(it.observaciones)}</div>` : ""}
                </details>
              </div>
            `).join("")}
          </div>
        `}
      </div>
    `;

    // bind mode chips
    root.querySelectorAll("[data-mode]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        mode = "alta";
        localStorage.setItem("tpBolsaMode", "alta");
        okMsg=""; errMsg=""; searchErr="";
        render();
      });
    });

    if(mode==="alta") bindAlta();
    else bindBuscar();
  }

  function readAltaFromDom(){
    cand.nombre = el("c_nombre").value.trim();
    cand.apellido = el("c_apellido").value.trim();
    cand.dni = el("c_dni").value.trim();
    cand.nacionalidad = el("c_nacionalidad").value;
    cand.estadoCivil = el("c_estadoCivil").value;
    cand.hijos = el("c_hijos").value.trim();
    cand.telefono = el("c_telefono").value.trim();
    cand.correo = el("c_correo").value.trim();
    cand.localidad = el("c_localidad").value;
    cand.direccion = el("c_direccion").value.trim();

    cand.areaTrabajo = el("c_areaTrabajo").value;
    cand.nivel = el("c_nivel").disabled ? "" : el("c_nivel").value;
    cand.especialidad = el("c_especialidad").disabled ? "" : el("c_especialidad").value;
    cand.especialidadOtro = (cand.especialidad==="Otros") ? el("c_especialidadOtro").value.trim() : "";

    cand.rangoExperiencia = el("c_rangoExp").value;
    cand.nivelEducativo = el("c_nivelEdu").value;
    cand.tieneCapacitacion = toBoolYesNo(el("c_cap").value);

    cand.trabajaActualmente = toBoolYesNo(el("c_trabaja").value);
    cand.sueldoPretendido = el("c_sueldo").value.trim();
    cand.ultimoTrabajo = el("c_ultimo").value.trim();
    cand.observaciones = el("c_obs").value.trim();

    // checkboxes
    if(cand.areaTrabajo==="Mecánica (Industrial)") cand.herramientasMecanica = getGroupValues("herrMec");
    else cand.herramientasMecanica = [];

    if(cand.areaTrabajo==="Eléctrica (Industrial)") cand.instrumentosElectrica = getGroupValues("instrElec");
    else cand.instrumentosElectrica = [];
  }

  function bindAlta(){
    // re-render if selects change
    const reRenderIds = ["c_areaTrabajo","c_especialidad"];
    reRenderIds.forEach(id=>{
      const e = el(id);
      if(e) e.addEventListener("change", ()=>{ readAltaFromDom(); render(); });
    });

    // update state on inputs without rerender
    ["c_nombre","c_apellido","c_dni","c_nacionalidad","c_estadoCivil","c_hijos","c_telefono","c_correo","c_localidad","c_direccion","c_nivel","c_especialidadOtro","c_rangoExp","c_nivelEdu","c_cap","c_trabaja","c_sueldo","c_ultimo","c_obs"].forEach(id=>{
      const e=el(id);
      if(e) e.addEventListener("input", ()=>{ readAltaFromDom(); });
      if(e) e.addEventListener("change", ()=>{ readAltaFromDom(); });
    });

    // checkbox change
    root.querySelectorAll('input[type="checkbox"][data-cb-group]').forEach(i=>{
      i.addEventListener("change", ()=>{ readAltaFromDom(); });
    });

    el("btnSaveBolsa").addEventListener("click", saveAlta);
    el("btnReloadBolsa").addEventListener("click", loadBolsa);
  }

  function bindBuscar(){
    ["j_q","j_area","j_nivel","j_especialidad","j_localidad"].forEach(id=>{
      const e=el(id);
      if(!e) return;
      e.addEventListener("input", ()=>{ jobs[id.replace("j_","")] = e.value; });
      e.addEventListener("change", ()=>{
        jobs[id.replace("j_","")] = e.value;
        if(id==="j_area"){ jobs.nivel=""; jobs.especialidad=""; jobs.herr=[]; jobs.instr=[]; render(); }
      });
    });

    // checkbox filters
    root.querySelectorAll('input[type="checkbox"][data-cb-group="jobsHerr"]').forEach(i=>{
      i.addEventListener("change", ()=>{ jobs.herr = getGroupValues("jobsHerr"); });
    });
    root.querySelectorAll('input[type="checkbox"][data-cb-group="jobsInstr"]').forEach(i=>{
      i.addEventListener("change", ()=>{ jobs.instr = getGroupValues("jobsInstr"); });
    });

    el("btnSearch").addEventListener("click", doSearch);
    el("btnStats").addEventListener("click", loadStats);
  }

  async function loadMe(){
    try{
      const r = await apiFetch("/me");
      if(r.ok){
        me = r;
        const fullName = r.profile?.fullName || "";
        const sp = splitFullName(fullName);
        cand.nombre = cand.nombre || sp.nombre;
        cand.apellido = cand.apellido || sp.apellido;
        cand.dni = cand.dni || (r.profile?.dni || "");
        cand.telefono = cand.telefono || (r.profile?.phone || "");
        cand.localidad = cand.localidad || (r.profile?.city || "");
        cand.correo = cand.correo || (r.user?.email || "");
      }
    }catch(e){}
  }

  async function loadBolsa(){
    okMsg=""; errMsg="";
    try{
      const r = await apiFetch("/bolsa/me");
      if(r.ok && r.bolsa){
        cand = {
          ...cand,
          ...r.bolsa,
          // normalize arrays
          herramientasMecanica: r.bolsa.herramientasMecanica || [],
          instrumentosElectrica: r.bolsa.instrumentosElectrica || [],
        };
      }
      bolsaLoaded = true;
      render();
    }catch(err){
      bolsaLoaded = true;
      errMsg = "No se pudo cargar tu perfil.";
      render();
    }
  }

  async function saveAlta(){
    readAltaFromDom();
    okMsg=""; errMsg="";
    // basic validation
    if(!cand.nombre || !cand.apellido || !cand.dni || !cand.correo || !cand.telefono || !cand.localidad){
      errMsg = "Completá: Nombre, Apellido, DNI, Email, Teléfono y Localidad.";
      render();
      return;
    }
    if(!cand.areaTrabajo || !cand.especialidad || !cand.rangoExperiencia || !cand.nivelEducativo){
      errMsg = "Completá: Área de trabajo, Especialidad, Rango de experiencia y Nivel educativo.";
      render();
      return;
    }
    if(cand.especialidad==="Otros" && !cand.especialidadOtro){
      errMsg = "Especificá la especialidad (Otros).";
      render();
      return;
    }

    busy = true; render();
    try{
      const payload = {
        nombre: cand.nombre,
        apellido: cand.apellido,
        dni: cand.dni,
        nacionalidad: cand.nacionalidad || "Argentino/a",
        estadoCivil: cand.estadoCivil || "",
        hijos: cand.hijos || "",
        telefono: cand.telefono || "",
        correo: cand.correo || "",
        localidad: cand.localidad || "",
        direccion: cand.direccion || null,

        areaTrabajo: cand.areaTrabajo,
        nivel: cand.nivel || null,
        especialidad: cand.especialidad,
        especialidadOtro: cand.especialidad==="Otros" ? (cand.especialidadOtro || "") : null,

        rangoExperiencia: cand.rangoExperiencia,
        nivelEducativo: cand.nivelEducativo,
        tieneCapacitacion: !!cand.tieneCapacitacion,

        trabajaActualmente: !!cand.trabajaActualmente,
        sueldoPretendido: cand.sueldoPretendido || null,
        ultimoTrabajo: cand.ultimoTrabajo || null,
        observaciones: cand.observaciones || null,

        herramientasMecanica: cand.herramientasMecanica || [],
        instrumentosElectrica: cand.instrumentosElectrica || []
      };

      const r = await apiFetch("/bolsa/me", {
        method:"POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });

      if(r.ok){
        okMsg = "Guardado.";
        errMsg = "";
        // update local state from server
        if(r.bolsa) cand = { ...cand, ...r.bolsa };
      }else{
        errMsg = r.error === "DNI_MISMATCH_WITH_PROFILE"
          ? "El DNI no coincide con el DNI registrado."
          : "No se pudo guardar. Verificá los datos.";
      }
    }catch(err){
      errMsg = "Error de conexión (Failed to fetch). Revisá la API y el deploy.";
    }finally{
      busy = false;
      render();
    }
  }

  async function loadStats(){
    try{
      const r = await apiFetch("/bolsa/stats");
      if(r.ok) statsTotal = r.total;
      else statsTotal = null;
      render();
    }catch(e){ statsTotal=null; render(); }
  }

  async function doSearch(){
    searchErr="";
    searchBusy=true;
    searchItems=[];
    render();
    try{
      const params = new URLSearchParams();
      if(jobs.q) params.set("q", jobs.q);
      if(jobs.area) params.set("area", jobs.area);
      if(jobs.nivel) params.set("nivel", jobs.nivel);
      if(jobs.especialidad) params.set("especialidad", jobs.especialidad);
      if(jobs.localidad) params.set("localidad", jobs.localidad);
      if(jobs.herr && jobs.herr.length) params.set("herr", jobs.herr.join(","));
      if(jobs.instr && jobs.instr.length) params.set("instr", jobs.instr.join(","));

      const r = await apiFetch("/bolsa/search?" + params.toString());
      if(r.ok) {
        searchItems = r.items || [];
      } else {
        searchErr = "No se pudo buscar.";
      }
    }catch(err){
      searchErr = "Error de conexión (Failed to fetch).";
    }finally{
      searchBusy=false;
      render();
    }
  }

  // Styles: augment existing stylesheet (only once)
  if(!document.getElementById("tpBolsaStyles")){
    const st = document.createElement("style");
    st.id = "tpBolsaStyles";
    st.textContent = `
      .tp-bolsa-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; }
      .tp-chip-row{ display:flex; gap:8px; flex-wrap:wrap; }
      .chip{ border:1px solid var(--border, #d0d7e2); background:#fff; padding:8px 12px; border-radius:999px; cursor:pointer; font-weight:600; }
      .chip.on{ background:#e7f0ff; border-color:#8bb6ff; }
      .tp-details{ border:1px solid var(--border, #e5e7eb); border-radius:12px; padding:10px 12px; margin:10px 0; background:#fff; }
      .tp-details summary{ cursor:pointer; }
      .tp-check-grid{ display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:6px 10px; }
      .tp-check{ display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--border, #eef0f3); border-radius:10px; }
      .tp-check input{ transform: translateY(1px); }
      .tp-result{ border:1px solid var(--border, #e5e7eb); border-radius:12px; padding:12px; margin:10px 0; background:#fff; }
    `;
    document.head.appendChild(st);
  }

  // first load
  await loadMe();
  await loadBolsa();
  // also load stats lazily
  loadStats();
  render();
}

document.addEventListener("DOMContentLoaded", initBolsaCandidato);
