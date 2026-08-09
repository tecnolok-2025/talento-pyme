import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLUE = '#0B5EA8';
const NAVY = '#0B1220';
const LIGHT = '#EEF6FF';
const BORDER = '#D6E2EF';
const TEXT = '#172033';
const MUTED = '#5E6B7C';

const LEFT = 50;
const RIGHT = 50;
const CONTENT_BOTTOM = 62;
const ARG_TZ = 'America/Argentina/Buenos_Aires';

const UIC_LOGO = fileURLToPath(new URL('../assets/logo-uic.jpg', import.meta.url));
const TALENTO_LOGO = fileURLToPath(new URL('../assets/logo-talento-pyme.png', import.meta.url));

function n(value){ return Number(value || 0); }
function pct(part, total){ return total > 0 ? Math.round((n(part) / n(total)) * 100) : 0; }
function fmtNum(value){ return n(value).toLocaleString('es-AR'); }
function fmtPct(value){ return `${Math.round(n(value))}%`; }
function safeText(value){ return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim(); }
function contentWidth(doc){ return doc.page.width - LEFT - RIGHT; }

function argentinaParts(value = new Date()){
  const d = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARG_TZ,
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
    hourCycle:'h23',
  }).formatToParts(d);
  const out = {};
  for(const p of parts){ if(p.type !== 'literal') out[p.type] = p.value; }
  return out;
}

function formatArgentinaDateTime(value = new Date()){
  const p = argentinaParts(value);
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}:${p.second}`;
}

function argentinaStamp(value = new Date()){
  const p = argentinaParts(value);
  const yy = String(p.year).slice(-2);
  return {
    prefix:`${yy}${p.month}${p.day}-${p.hour}${p.minute}`,
    long:`${p.year}${p.month}${p.day}-${p.hour}${p.minute}`,
  };
}

function trend(current, previous){
  const c=n(current), p=n(previous);
  if(p === 0) return c === 0 ? { pct:0, label:'sin variación', direction:'flat' } : { pct:null, label:'inicio de actividad', direction:'up' };
  const v=Math.round(((c-p)/p)*100);
  return { pct:v, label:`${v >= 0 ? '+' : ''}${v}%`, direction:v>0?'up':v<0?'down':'flat' };
}

function buildConclusions(data){
  const s=data.summary || {};
  const a=data.activity || {};
  const q=data.quality || {};
  const comp=data.composition || {};
  const conclusions=[];
  const recommendations=[];

  const candidateTrend=trend(a.candidatesLast30,a.candidatesPrevious30);
  const companyTrend=trend(a.companiesLast30,a.companiesPrevious30);
  const jobsTrend=trend(a.jobsLast30,a.jobsPrevious30);
  const applicationsTrend=trend(a.applicationsLast30,a.applicationsPrevious30);

  conclusions.push(`El portal registra ${fmtNum(s.candidateCount)} candidato(s) y ${fmtNum(s.companyCount)} empresa(s), con una relación aproximada de ${s.companyCount ? (s.candidateCount/s.companyCount).toFixed(1).replace('.', ',') : '0'} candidato(s) por empresa.`);
  conclusions.push(`En los últimos 30 días se incorporaron ${fmtNum(a.candidatesLast30)} candidato(s) y ${fmtNum(a.companiesLast30)} empresa(s). Frente a los 30 días anteriores, la tendencia de altas es ${candidateTrend.label} en candidatos y ${companyTrend.label} en empresas.`);
  conclusions.push(`La actividad laboral reciente registra ${fmtNum(a.jobsLast30)} búsqueda(s) y ${fmtNum(a.applicationsLast30)} postulación(es) en 30 días; las búsquedas muestran ${jobsTrend.label} y las postulaciones ${applicationsTrend.label} respecto del período anterior.`);
  conclusions.push(`${fmtPct(q.cvCoveragePct)} de los candidatos cuentan con CV/resumen curricular disponible y ${fmtPct(q.profileCoveragePct)} presentan información profesional suficiente para una lectura administrativa más completa.`);

  const topExpertise=(comp.candidatesByExpertise || [])[0];
  if(topExpertise && s.candidateCount){
    conclusions.push(`La expertise con mayor presencia es “${safeText(topExpertise.label)}”, con ${fmtNum(topExpertise.count)} perfil(es), equivalente a ${fmtPct(pct(topExpertise.count,s.candidateCount))} del padrón candidato.`);
  }
  const topFamily=(comp.companiesByFamily || [])[0];
  if(topFamily && s.companyCount){
    conclusions.push(`Entre las empresas, la familia con mayor participación es “${safeText(topFamily.label)}”, con ${fmtNum(topFamily.count)} registro(s), equivalente a ${fmtPct(pct(topFamily.count,s.companyCount))}.`);
  }

  if(q.cvCoveragePct < 70) recommendations.push('Impulsar una campaña de actualización de CV y perfil para elevar la calidad de lectura del padrón sin excluir a quienes todavía tienen información parcial.');
  if(a.jobsLast30 < Math.max(1, s.companyCount * 0.35)) recommendations.push('Trabajar la activación de empresas registradas para transformar cuentas en búsquedas concretas y aumentar la demanda visible de talento.');
  if(a.applicationsLast30 < Math.max(1, a.jobsLast30 * 1.5)) recommendations.push('Reforzar la difusión de oportunidades y la comunicación hacia candidatos para aumentar la interacción con las búsquedas existentes.');
  if(topExpertise && pct(topExpertise.count,s.candidateCount) >= 35) recommendations.push(`Diversificar la captación de perfiles: hoy existe una concentración relevante en “${safeText(topExpertise.label)}”.`);
  if(topFamily && pct(topFamily.count,s.companyCount) >= 60) recommendations.push(`Ampliar la captación empresarial fuera de “${safeText(topFamily.label)}” para equilibrar la representación sectorial del portal.`);
  if(candidateTrend.direction === 'down') recommendations.push('Revisar la estrategia de convocatoria de candidatos, dado que las altas de los últimos 30 días son inferiores al período anterior.');
  if(companyTrend.direction === 'down') recommendations.push('Reforzar la incorporación y reactivación de empresas para sostener el crecimiento de la oferta de oportunidades.');
  if(!recommendations.length) recommendations.push('Mantener el seguimiento mensual de composición y actividad, priorizando el crecimiento equilibrado entre candidatos, empresas y búsquedas publicadas.');

  recommendations.push('Conservar este reporte como fotografía periódica de gestión para comparar tendencias mensuales y fundamentar decisiones de difusión, capacitación y vinculación empresaria.');
  return { conclusions, recommendations };
}

function resetFlow(doc){
  doc.x = LEFT;
}

function drawLogoBox(doc, path, x, y, width, height){
  doc.save();
  doc.fillColor('#FFFFFF').roundedRect(x, y, width, height, 5).fill();
  doc.restore();
  try {
    if(fs.existsSync(path)) doc.image(path, x+5, y+4, { fit:[width-10,height-8], align:'center', valign:'center' });
  } catch {}
}

function drawTitleHeader(doc){
  doc.save();
  doc.fillColor(NAVY).rect(0,0,doc.page.width,126).fill();
  drawLogoBox(doc, UIC_LOGO, LEFT, 18, 132, 34);
  drawLogoBox(doc, TALENTO_LOGO, doc.page.width-RIGHT-160, 15, 160, 40);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14)
    .text('Informe Ejecutivo de Trazabilidad, Evolución y Composición del Portal', LEFT, 78, { width:contentWidth(doc), align:'left', lineBreak:false });
  doc.fillColor('#B9D9F4').font('Helvetica').fontSize(9.5)
    .text('Talento PyME · Conectando experiencia con producción.', LEFT, 101, { width:contentWidth(doc), align:'left', lineBreak:false });
  doc.restore();
  doc.y = 144;
  resetFlow(doc);
}

function drawSecondaryHeader(doc){
  doc.save();
  drawLogoBox(doc, UIC_LOGO, LEFT, 14, 98, 26);
  drawLogoBox(doc, TALENTO_LOGO, doc.page.width-RIGHT-118, 11, 118, 30);
  doc.strokeColor(BORDER).lineWidth(0.7).moveTo(LEFT,50).lineTo(doc.page.width-RIGHT,50).stroke();
  doc.restore();
  doc.y = 66;
  resetFlow(doc);
}

function addContentPage(doc){
  doc.addPage();
  drawSecondaryHeader(doc);
}

function ensureSpace(doc, needed=70){
  if(doc.y + needed > doc.page.height - CONTENT_BOTTOM){
    addContentPage(doc);
    return true;
  }
  return false;
}

function sectionTitle(doc, title, subtitle=''){
  ensureSpace(doc, subtitle ? 58 : 42);
  doc.y += 8;
  resetFlow(doc);
  const y=doc.y;
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(15).text(title,LEFT,y,{width:contentWidth(doc),lineGap:1});
  doc.y += 2;
  if(subtitle){
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(subtitle,LEFT,doc.y,{width:contentWidth(doc),lineGap:2});
  }
  doc.y += 8;
  resetFlow(doc);
}

function paragraph(doc, text){
  ensureSpace(doc, 70);
  resetFlow(doc);
  doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(safeText(text),LEFT,doc.y,{width:contentWidth(doc),align:'justify',lineGap:3});
  doc.y += 8;
  resetFlow(doc);
}

function table(doc, columns, rows, { widths=null }={}){
  const x=LEFT;
  const totalWidth=contentWidth(doc);
  const ws=widths || columns.map(()=> totalWidth/columns.length);
  const rowPad=6;
  const headerH=28;
  const drawHeader=()=>{
    ensureSpace(doc, headerH+30);
    resetFlow(doc);
    const y=doc.y;
    doc.save().fillColor(NAVY).rect(x,y,totalWidth,headerH).fill().restore();
    let cx=x;
    columns.forEach((col,i)=>{
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5).text(col,cx+rowPad,y+8,{width:ws[i]-rowPad*2,ellipsis:true,lineBreak:false});
      cx+=ws[i];
    });
    doc.y=y+headerH;
    resetFlow(doc);
  };
  drawHeader();
  const safeRows = Array.isArray(rows) && rows.length ? rows : [columns.map((_,i) => i === 0 ? 'Sin datos disponibles' : '—')];
  safeRows.forEach((row,ri)=>{
    const values=row.map(safeText);
    doc.font('Helvetica').fontSize(8.5);
    const heights=values.map((value,i)=>doc.heightOfString(value,{width:ws[i]-rowPad*2,lineGap:1}));
    const h=Math.max(26,...heights.map(v=>v+rowPad*2));
    if(doc.y + h > doc.page.height - CONTENT_BOTTOM){ addContentPage(doc); drawHeader(); }
    const y=doc.y;
    if(ri%2===0) doc.save().fillColor('#F8FBFF').rect(x,y,totalWidth,h).fill().restore();
    doc.save().strokeColor(BORDER).lineWidth(0.5).rect(x,y,totalWidth,h).stroke().restore();
    let cx=x;
    values.forEach((value,i)=>{
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5).text(value,cx+rowPad,y+rowPad,{width:ws[i]-rowPad*2,lineGap:1});
      cx+=ws[i];
    });
    doc.y=y+h;
    resetFlow(doc);
  });
  doc.y += 12;
  resetFlow(doc);
}

function kpiGrid(doc, items){
  const x=LEFT, gap=8, cols=4;
  const total=contentWidth(doc);
  const w=(total-gap*(cols-1))/cols;
  const h=58;
  let rowY=doc.y;
  items.forEach((it,i)=>{
    if(i && i%cols===0){ rowY += h+gap; }
    if(rowY+h > doc.page.height-CONTENT_BOTTOM){ addContentPage(doc); rowY=doc.y; }
    const col=i%cols;
    const bx=x+col*(w+gap);
    doc.save().fillColor(LIGHT).strokeColor('#BDD9F5').roundedRect(bx,rowY,w,h,8).fillAndStroke().restore();
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.8).text(it.label,bx+8,rowY+9,{width:w-16});
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(17).text(it.value,bx+8,rowY+27,{width:w-16,lineBreak:false});
  });
  const rows=Math.ceil(items.length/cols);
  doc.y=rowY+h+(rows>0?8:0);
  resetFlow(doc);
}

function drawFooter(doc, pageNumber, totalPages){
  const oldBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const y = doc.page.height - 34;
  doc.save();
  doc.strokeColor(BORDER).lineWidth(0.6).moveTo(LEFT,y-7).lineTo(doc.page.width-RIGHT,y-7).stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text(`Talento PyME · Informe Ejecutivo de Trazabilidad · Página ${pageNumber} de ${totalPages}`, LEFT, y, { width:contentWidth(doc), align:'center', lineBreak:false });
  doc.restore();
  doc.page.margins.bottom = oldBottom;
}

export function buildTraceabilityReportFilename(generatedAt=new Date()){
  const d=generatedAt instanceof Date?generatedAt:new Date(generatedAt);
  const stamp=argentinaStamp(d);
  return `${stamp.prefix} Talento-PyME-Informe-Trazabilidad-${stamp.long}.pdf`;
}

export function buildTraceabilityEmailSubject(generatedAt=new Date()){
  const d=generatedAt instanceof Date?generatedAt:new Date(generatedAt);
  const p=argentinaParts(d);
  return `Talento PyME · Informe Ejecutivo de Trazabilidad · ${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export function buildTraceabilityNarrative(data){ return buildConclusions(data); }

export async function buildTraceabilityPdfBuffer(data){
  const generatedAt=new Date(data.generatedAt || Date.now());
  const { conclusions, recommendations }=buildConclusions(data);
  const s=data.summary || {}, a=data.activity || {}, q=data.quality || {}, comp=data.composition || {};
  const candidateTrend=trend(a.candidatesLast30,a.candidatesPrevious30);
  const companyTrend=trend(a.companiesLast30,a.companiesPrevious30);
  const jobsTrend=trend(a.jobsLast30,a.jobsPrevious30);
  const applicationsTrend=trend(a.applicationsLast30,a.applicationsPrevious30);

  const doc=new PDFDocument({ size:'A4', margins:{top:56,bottom:54,left:LEFT,right:RIGHT}, bufferPages:true, autoFirstPage:true, info:{Title:'Talento PyME - Informe Ejecutivo de Trazabilidad y Evolución del Portal',Author:'Talento PyME / Unión Industrial de Campana'} });
  const chunks=[];
  doc.on('data',c=>chunks.push(c));
  const done=new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});

  drawTitleHeader(doc);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Corte de información: ${formatArgentinaDateTime(generatedAt)} · Documento agregado y anonimizado.`,LEFT,doc.y,{width:contentWidth(doc),align:'right'});
  doc.y += 12;
  resetFlow(doc);

  sectionTitle(doc,'1. Objetivo y alcance');
  paragraph(doc,'Este informe presenta una fotografía ejecutiva del estado de Talento PyME en el momento de su generación. Su objetivo es facilitar el seguimiento de la evolución del portal, identificar tendencias de incorporación y uso, comprender la composición general de candidatos y empresas, y aportar elementos para orientar decisiones de mejora, difusión, capacitación y vinculación.');
  paragraph(doc,'El documento utiliza exclusivamente información agregada. No incluye nombres, apellidos, DNI, CUIT, correos electrónicos ni otros datos que permitan identificar individualmente a candidatos o empresas.');

  sectionTitle(doc,'2. Resumen ejecutivo','Indicadores generales del portal al momento del corte.');
  kpiGrid(doc,[
    {label:'Candidatos registrados',value:fmtNum(s.candidateCount)},
    {label:'Empresas registradas',value:fmtNum(s.companyCount)},
    {label:'Búsquedas totales',value:fmtNum(s.jobsCount)},
    {label:'Postulaciones totales',value:fmtNum(s.applicationCount)},
    {label:'CV / resumen disponible',value:fmtPct(q.cvCoveragePct)},
    {label:'Perfil profesional disponible',value:fmtPct(q.profileCoveragePct)},
    {label:'Búsquedas últimos 30 días',value:fmtNum(a.jobsLast30)},
    {label:'Postulaciones últimos 30 días',value:fmtNum(a.applicationsLast30)},
  ]);

  sectionTitle(doc,'3. Evolución reciente','Comparación de los últimos 30 días contra los 30 días inmediatamente anteriores.');
  table(doc,['Indicador','Últimos 30 días','30 días anteriores','Tendencia'],[
    ['Altas de candidatos',fmtNum(a.candidatesLast30),fmtNum(a.candidatesPrevious30),candidateTrend.label],
    ['Altas de empresas',fmtNum(a.companiesLast30),fmtNum(a.companiesPrevious30),companyTrend.label],
    ['Búsquedas creadas',fmtNum(a.jobsLast30),fmtNum(a.jobsPrevious30),jobsTrend.label],
    ['Postulaciones',fmtNum(a.applicationsLast30),fmtNum(a.applicationsPrevious30),applicationsTrend.label],
    ['Aperturas de perfiles',fmtNum(a.openingsLast30),fmtNum(a.openingsPrevious30),trend(a.openingsLast30,a.openingsPrevious30).label],
    ['Consultas IA candidato',fmtNum(a.candidateChatsLast30),fmtNum(a.candidateChatsPrevious30),trend(a.candidateChatsLast30,a.candidateChatsPrevious30).label],
    ['Consultas IA empresa',fmtNum(a.companyChatsLast30),fmtNum(a.companyChatsPrevious30),trend(a.companyChatsLast30,a.companyChatsPrevious30).label],
  ],{widths:[190,105,105,95]});
  if((data.monthlySeries || []).length){
    sectionTitle(doc,'3.1 Evolución de los últimos seis meses','Serie mensual de altas y movimientos principales del portal. Las altas de empresas se contabilizan por la fecha de alta de la cuenta empresa.');
    table(doc,['Mes','Candidatos','Empresas','Búsquedas','Postulaciones'],(data.monthlySeries || []).map(x=>[x.label,fmtNum(x.candidates),fmtNum(x.companies),fmtNum(x.jobs),fmtNum(x.applications)]),{widths:[175,80,80,80,80]});
  }

  sectionTitle(doc,'4. Composición de candidatos','Lectura agregada por tipo de perfil y expertise. No se incluyen niveles Junior, Semi-senior o Senior en esta trazabilidad general.');
  table(doc,['Tipo de perfil','Cantidad','Participación'],(comp.candidatesByClass || []).map(x=>[x.label,fmtNum(x.count),fmtPct(pct(x.count,s.candidateCount))]),{widths:[285,100,110]});
  table(doc,['Expertise principal','Cantidad','Participación'],(comp.candidatesByExpertise || []).map(x=>[x.label,fmtNum(x.count),fmtPct(pct(x.count,s.candidateCount))]),{widths:[285,100,110]});

  sectionTitle(doc,'5. Composición de empresas','Clasificación por familia y actividad principal declarada o inferida administrativamente.');
  table(doc,['Familia','Cantidad','Participación'],(comp.companiesByFamily || []).map(x=>[x.label,fmtNum(x.count),fmtPct(pct(x.count,s.companyCount))]),{widths:[285,100,110]});
  table(doc,['Actividad principal','Cantidad','Participación'],(comp.companiesByActivity || []).map(x=>[x.label,fmtNum(x.count),fmtPct(pct(x.count,s.companyCount))]),{widths:[285,100,110]});

  sectionTitle(doc,'6. Calidad y disponibilidad de información');
  table(doc,['Indicador','Cantidad','Porcentaje'],[
    ['Candidatos con CV o resumen curricular',fmtNum(q.candidatesWithCv),fmtPct(q.cvCoveragePct)],
    ['Candidatos con perfil profesional / laboral',fmtNum(q.candidatesWithProfessionalProfile),fmtPct(q.profileCoveragePct)],
    ['Candidatos actualizados en los últimos 30 días',fmtNum(a.candidatesUpdatedLast30),fmtPct(pct(a.candidatesUpdatedLast30,s.candidateCount))],
    ['Empresas activas o actualizadas en los últimos 30 días',fmtNum(a.companiesUpdatedLast30),fmtPct(pct(a.companiesUpdatedLast30,s.companyCount))],
  ],{widths:[295,100,100]});

  sectionTitle(doc,'7. Conclusiones de gestión');
  conclusions.forEach((item,i)=>paragraph(doc,`${i+1}. ${item}`));

  sectionTitle(doc,'8. Sugerencias de mejora','Recomendaciones automáticas de gestión basadas en indicadores agregados del corte actual.');
  recommendations.forEach((item,i)=>paragraph(doc,`${i+1}. ${item}`));

  sectionTitle(doc,'9. Cierre institucional');
  paragraph(doc,'Talento PyME debe interpretarse como una herramienta dinámica de vinculación y aprendizaje. La trazabilidad permite observar qué perfiles se incorporan, qué tipo de empresas participan, cuánto se transforma el registro en actividad concreta y dónde conviene reforzar la estrategia. La comparación periódica de estos reportes permitirá medir evolución, detectar desequilibrios y comunicar resultados con evidencia objetiva.');
  paragraph(doc,'Este documento es una fotografía del momento de generación. Las cifras y conclusiones pueden variar a medida que se incorporan nuevos registros, se actualizan currículums, se publican búsquedas y aumenta la interacción entre candidatos y empresas.');

  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
    doc.switchToPage(range.start+i);
    drawFooter(doc,i+1,range.count);
  }
  doc.end();
  return done;
}
