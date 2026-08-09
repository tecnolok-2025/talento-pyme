import PDFDocument from 'pdfkit';

const BLUE = '#0B5EA8';
const NAVY = '#0B1220';
const LIGHT = '#EEF6FF';
const BORDER = '#D6E2EF';
const TEXT = '#172033';
const MUTED = '#5E6B7C';
const GREEN = '#166534';
const ORANGE = '#9A3412';

function n(value){ return Number(value || 0); }
function pct(part, total){ return total > 0 ? Math.round((n(part) / n(total)) * 100) : 0; }
function fmtNum(value){ return n(value).toLocaleString('es-AR'); }
function fmtPct(value){ return `${Math.round(n(value))}%`; }
function safeText(value){ return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim(); }
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

function addFooter(doc){
  const pageNo = doc.bufferedPageRange().count;
  doc.fontSize(8).fillColor(MUTED).text(`Talento PyME · Informe de trazabilidad · Página ${pageNo}`, 50, doc.page.height - 36, { width:doc.page.width-100, align:'center' });
}

function sectionTitle(doc, title, subtitle=''){
  if(doc.y > doc.page.height - 125) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(15).text(title);
  if(subtitle) doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(subtitle, { lineGap:2 });
  doc.moveDown(0.45);
}

function paragraph(doc, text){
  if(doc.y > doc.page.height - 100) doc.addPage();
  doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(safeText(text), { align:'justify', lineGap:3 });
  doc.moveDown(0.55);
}

function table(doc, columns, rows, { widths=null }={}){
  const x=50;
  const totalWidth=doc.page.width-100;
  const ws=widths || columns.map(()=> totalWidth/columns.length);
  const rowPad=6;
  const headerH=28;
  const drawHeader=()=>{
    if(doc.y > doc.page.height - 90) doc.addPage();
    const y=doc.y;
    doc.save().fillColor(NAVY).rect(x,y,totalWidth,headerH).fill().restore();
    let cx=x;
    columns.forEach((col,i)=>{
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5).text(col,cx+rowPad,y+8,{width:ws[i]-rowPad*2,ellipsis:true});
      cx+=ws[i];
    });
    doc.y=y+headerH;
  };
  drawHeader();
  const safeRows = Array.isArray(rows) && rows.length ? rows : [columns.map((_,i) => i === 0 ? 'Sin datos disponibles' : '—')];
  safeRows.forEach((row,ri)=>{
    const values=row.map(safeText);
    doc.font('Helvetica').fontSize(8.5);
    const heights=values.map((value,i)=>doc.heightOfString(value,{width:ws[i]-rowPad*2,lineGap:1}));
    const h=Math.max(26,...heights.map(v=>v+rowPad*2));
    if(doc.y + h > doc.page.height - 55){ doc.addPage(); drawHeader(); }
    const y=doc.y;
    if(ri%2===0) doc.save().fillColor('#F8FBFF').rect(x,y,totalWidth,h).fill().restore();
    doc.save().strokeColor(BORDER).lineWidth(0.5).rect(x,y,totalWidth,h).stroke().restore();
    let cx=x;
    values.forEach((value,i)=>{
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.5).text(value,cx+rowPad,y+rowPad,{width:ws[i]-rowPad*2,lineGap:1});
      cx+=ws[i];
    });
    doc.y=y+h;
  });
  doc.moveDown(0.8);
}

function kpiGrid(doc, items){
  const x=50, gap=8, cols=4;
  const total=doc.page.width-100;
  const w=(total-gap*(cols-1))/cols;
  const h=58;
  let rowY=doc.y;
  items.forEach((it,i)=>{
    if(i && i%cols===0){ rowY += h+gap; }
    if(rowY+h > doc.page.height-70){ doc.addPage(); rowY=doc.y; }
    const col=i%cols;
    const bx=x+col*(w+gap);
    doc.save().fillColor(LIGHT).strokeColor('#BDD9F5').roundedRect(bx,rowY,w,h,8).fillAndStroke().restore();
    doc.fillColor(MUTED).font('Helvetica').fontSize(7.8).text(it.label,bx+8,rowY+9,{width:w-16});
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(17).text(it.value,bx+8,rowY+27,{width:w-16});
  });
  const rows=Math.ceil(items.length/cols);
  doc.y=rowY+h+(rows>0?8:0);
}

export function buildTraceabilityReportFilename(generatedAt=new Date()){
  const d=generatedAt instanceof Date?generatedAt:new Date(generatedAt);
  const stamp=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
  return `Talento-PyME-Informe-Trazabilidad-${stamp}.pdf`;
}

export function buildTraceabilityEmailSubject(generatedAt=new Date()){
  const d=generatedAt instanceof Date?generatedAt:new Date(generatedAt);
  return `Talento PyME · Informe Ejecutivo de Trazabilidad · ${d.toLocaleDateString('es-AR')}`;
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

  const doc=new PDFDocument({ size:'A4', margins:{top:46,bottom:50,left:50,right:50}, bufferPages:true, info:{Title:'Talento PyME - Informe Ejecutivo de Trazabilidad y Evolución del Portal',Author:'Talento PyME'} });
  const chunks=[];
  doc.on('data',c=>chunks.push(c));
  const done=new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});

  doc.fillColor(NAVY).rect(0,0,doc.page.width,112).fill();
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('TALENTO PyME',50,38);
  doc.fillColor('#B9D9F4').font('Helvetica').fontSize(10).text('Conectando experiencia con producción.',50,68);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13).text('Informe Ejecutivo de Trazabilidad, Evolución y Composición del Portal',50,88,{width:doc.page.width-100});
  doc.y=132;
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Corte de información: ${generatedAt.toLocaleString('es-AR')} · Documento agregado y anonimizado.`,50,doc.y,{width:doc.page.width-100,align:'right'});
  doc.moveDown(1.4);

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
    sectionTitle(doc,'3.1 Evolución de los últimos seis meses','Serie mensual de altas y movimientos principales del portal.');
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
    doc.fontSize(8).fillColor(MUTED).text(`Talento PyME · Informe de trazabilidad · Página ${i+1} de ${range.count}`,50,doc.page.height-34,{width:doc.page.width-100,align:'center'});
  }
  doc.end();
  return done;
}
