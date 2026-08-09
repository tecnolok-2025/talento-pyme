import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inferResidence } from './residence.js';

const NAVY='#0B1730';
const BLUE='#0B5EA8';
const TEXT='#263241';
const MUTED='#697586';
const LIGHT='#EEF4FA';
const WHITE='#FFFFFF';
const ARG_TZ='America/Argentina/Buenos_Aires';
const TALENTO_LOGO=fileURLToPath(new URL('../assets/logo-talento-pyme.png', import.meta.url));

function clean(v=''){ return String(v || '').replace(/[\u0000-\u001F]/g,' ').replace(/\s+/g,' ').trim(); }
function clamp(v='', n=1200){ const s=clean(v); return s.length>n ? `${s.slice(0,n-1).trim()}…` : s; }
function cleanParagraphs(v=''){ return String(v || '').replace(/\r/g,'').split(/\n{2,}/).map((p)=>clean(p)).filter(Boolean).join('\n\n'); }
function clampParagraphs(v='', n=2400){ const s=cleanParagraphs(v); return s.length>n ? `${s.slice(0,n-1).trim()}…` : s; }
function lines(v=''){ return String(v || '').split(/\r?\n|•/).map(clean).filter(Boolean); }
function uniq(arr=[]){ return [...new Set(arr.map(clean).filter(Boolean))]; }
function safeFilePart(v=''){ return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50) || 'Candidato'; }
function argParts(value=new Date()){
  const d=value instanceof Date?value:new Date(value);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:ARG_TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
  const out={}; for(const p of parts){ if(p.type!=='literal') out[p.type]=p.value; } return out;
}
function dataUrlToBuffer(dataUrl=''){
  const m=String(dataUrl || '').match(/^data:(image\/(?:png|jpe?g));base64,(.+)$/i);
  if(!m) return null;
  try { return Buffer.from(m[2],'base64'); } catch { return null; }
}
function textBlock(doc,text,x,y,w,{font='Helvetica',size=8.5,color=TEXT,lineGap=2,maxHeight=null}={}){
  const safe=clean(text); if(!safe) return y;
  doc.fillColor(color).font(font).fontSize(size);
  const opts={width:w,lineGap}; if(maxHeight) opts.height=maxHeight; 
  doc.text(safe,x,y,opts);
  return doc.y;
}
function sidebarHeading(doc,label,y){
  doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(11).text(label.toUpperCase(),28,y,{width:125,lineBreak:false});
  return y+21;
}
function mainHeading(doc,label,y,x=190,w=355){
  doc.fillColor(TEXT).font('Helvetica').fontSize(14).text(label.toUpperCase(),x,y,{width:w,lineBreak:false});
  doc.fillColor(NAVY).rect(x,y+22,26,4).fill();
  return y+34;
}
function drawPlaceholder(doc,cx,cy,r){
  doc.save().circle(cx,cy,r).fill('#E6EDF5');
  doc.fillColor('#8EA1B5').circle(cx,cy-r*0.18,r*0.28).fill();
  doc.fillColor('#8EA1B5').ellipse(cx,cy+r*0.45,r*0.58,r*0.42).fill();
  doc.restore();
}
function drawPhoto(doc,dataUrl,cx,cy,r){
  const buf=dataUrlToBuffer(dataUrl);
  if(!buf){ drawPlaceholder(doc,cx,cy,r); return; }
  try{
    doc.save(); doc.circle(cx,cy,r).clip();
    doc.image(buf,cx-r,cy-r,{fit:[r*2,r*2],align:'center',valign:'center'});
    doc.restore();
  }catch{ try{doc.restore();}catch{} drawPlaceholder(doc,cx,cy,r); }
}
function bulletList(doc,items,x,y,w,maxItems=7){
  const rows=uniq(items).slice(0,maxItems);
  for(const item of rows){
    doc.fillColor(TEXT).font('Helvetica').fontSize(8.3).text('•',x,y,{width:9,lineBreak:false});
    doc.text(clamp(item,280),x+11,y,{width:w-11,lineGap:1});
    y=doc.y+3;
  }
  return y;
}
function titleFromData(data){
  const b=data.bolsa||{}, p=data.profile||{}, c=data.classification||{};
  const recent=clean(b.ultimoTrabajo);
  if(recent && recent.length <= 70) return recent;
  return clean(p.headline || b.voiceNarrativeProfessionalTitle || b.especialidadOtro || b.especialidad || c.expertiseLabel || b.areaTrabajo || recent || 'Perfil profesional');
}

function firstPersonTitle(title=''){
  const n=clean(title).toLowerCase();
  if(/ingenier[ií]a electromec[aá]nica/.test(n) && /proyectista/.test(n)) return 'Soy ingeniero electromecánico y proyectista';
  if(/ingenier[ií]a electromec[aá]nica/.test(n)) return 'Soy ingeniero electromecánico';
  if(/ingenier[ií]a el[eé]ctrica/.test(n) && /proyectista/.test(n)) return 'Soy ingeniero eléctrico y proyectista';
  if(/ingenier[ií]a el[eé]ctrica/.test(n)) return 'Soy ingeniero eléctrico';
  if(/ingenier[ií]a mec[aá]nica/.test(n)) return 'Soy ingeniero mecánico';
  if(/proyectista/.test(n)) return 'Me desempeño como proyectista';
  if(/supervisi[oó]n/.test(n)) return 'Me desempeño en supervisión técnica';
  if(/jefatura/.test(n)) return 'Me desempeño en funciones de jefatura';
  if(/administraci[oó]n/.test(n)) return 'Me desempeño en el área administrativa';
  return n ? `Mi perfil profesional se orienta a ${clean(title)}` : 'Presento mi experiencia y capacidades profesionales';
}

function buildSidebarAbout(data={}, presentation=''){
  const b=data.bolsa||{}, c=data.classification||{};
  const title=titleFromData(data);
  const years=Number.isFinite(Number(b.voiceNarrativeYears)) ? Number(b.voiceNarrativeYears) : null;
  const expertise=clean(c.expertiseLabel || b.especialidadOtro || b.especialidad || b.areaTrabajo);
  let text=firstPersonTitle(title);
  if(years!==null) text += years>=30 ? ', con más de 30 años de trayectoria' : years>=1 ? `, con ${years} años de experiencia` : '';
  if(expertise && !text.toLowerCase().includes(expertise.toLowerCase())) text += `, con especialización en ${expertise.toLowerCase()}`;
  text += '.';
  const recent=clean(b.ultimoTrabajo);
  if(recent && !text.toLowerCase().includes(recent.toLowerCase())) text += ` Mi actividad más reciente se vincula con ${recent}.`;
  return clamp(text,300);
}

function cleanStrengths(value=[]){
  const rows=Array.isArray(value) ? value : lines(value);
  return uniq(rows.map((row)=>clean(row).replace(/[.;]+$/,''))).slice(0,10);
}

function addContinuationPage(doc,fullName,title){
  doc.addPage({size:'A4',margins:{top:0,bottom:0,left:0,right:0}});
  const W=doc.page.width;
  doc.fillColor(NAVY).rect(0,0,W,11).fill();
  doc.fillColor(TEXT).font('Helvetica').fontSize(16).text(fullName,42,28,{width:W-84,lineBreak:false});
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(clean(title).toUpperCase(),42,51,{width:W-84,lineBreak:false});
  doc.fillColor(NAVY).rect(42,66,26,4).fill();
  return 82;
}

export function buildCandidateCvFilename(data={},generatedAt=new Date()){
  const b=data.bolsa||{}, p=data.profile||{};
  const full=clean(`${b.nombre||''} ${b.apellido||''}`) || clean(p.fullName) || 'Candidato';
  const t=argParts(generatedAt); const yy=String(t.year).slice(-2);
  return `${yy}${t.month}${t.day}-${t.hour}${t.minute} CV ${safeFilePart(full).replace(/-/g,' ')}.pdf`;
}

export async function buildCandidateCvPdfBuffer(data={}){
  const b=data.bolsa||{}, p=data.profile||{}, r=data.resume||{}, c=data.classification||{}, user=data.user||{};
  const fullName=(clean(`${b.nombre||''} ${b.apellido||''}`) || clean(p.fullName) || 'Candidato').toUpperCase();
  const title=titleFromData(data);
  const residence=inferResidence({ locality:b.localidad || p.city, province:b.provinciaResidencia || p.province, country:b.paisResidencia });
  const country=clean(residence.country) || 'País de residencia no informado';
  const province=clean(residence.province);
  const city=clean(residence.city || b.localidad || p.city);
  const location=[city,province,country].filter(Boolean).join(', ');
  const presentation=clampParagraphs(b.voiceNarrativeSummary || b.voiceNarrativeRaw || r.summary || b.observaciones || '',4200);
  const strengths=cleanStrengths(b.voiceNarrativeStrengths || []);
  const motivation=clampParagraphs(b.voiceNarrativeMotivation || '',1600);
  const closing=clampParagraphs(b.voiceNarrativeClosing || '',2400);
  const experienceLines=uniq([
    b.ultimoTrabajo ? `Actividad reciente: ${b.ultimoTrabajo}` : '',
    ...lines(r.experience).slice(0,7),
  ]);
  const educationLines=uniq([
    b.nivelEducativo ? `Nivel educativo: ${b.nivelEducativo}` : '',
    ...lines(r.education).slice(0,5),
  ]);
  const certLines=uniq([
    b.tieneCapacitacion ? 'Capacitaciones / cursos informados en Talento PyME' : '',
    ...lines(r.certifications).slice(0,5),
  ]);
  const skills=uniq([
    b.areaTrabajo, b.especialidadOtro || b.especialidad,
    ...(b.herramientasMecanica||[]), ...(b.instrumentosElectrica||[]),
  ]).filter((v)=>!/^otros?$/i.test(v));

  const doc=new PDFDocument({size:'A4',margins:{top:0,bottom:0,left:0,right:0},bufferPages:true,info:{Title:`CV - ${fullName}`,Author:'Talento PyME'}});
  const chunks=[]; doc.on('data',(cbuf)=>chunks.push(cbuf));
  const done=new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const W=doc.page.width,H=doc.page.height,sideW=172;
  let mainX=196, mainW=W-mainX-34;
  doc.fillColor(NAVY).rect(0,0,sideW,H).fill();
  drawPhoto(doc,b.photoDataUrl,86,82,53);

  let sy=153;
  sy=sidebarHeading(doc,'Sobre mí',sy);
  const sideAbout=buildSidebarAbout(data,presentation) || clamp(c.seniorityLabel ? `${c.seniorityLabel}. ${c.expertiseLabel||''}` : title,360);
  doc.fillColor('#E6EDF5').font('Helvetica').fontSize(8.2).text(sideAbout,28,sy,{width:125,lineGap:2}); sy=doc.y+20;
  sy=sidebarHeading(doc,'Contacto',sy);
  const contact=[
    b.telefono ? `Tel: ${b.telefono}` : '',
    b.correo || user.email ? `Email: ${b.correo || user.email}` : '',
    location ? `Residencia: ${location}` : '',
  ].filter(Boolean);
  for(const row of contact){ doc.fillColor('#E6EDF5').font('Helvetica').fontSize(7.8).text(row,28,sy,{width:125,lineGap:1}); sy=doc.y+8; }
  sy+=8;
  sy=sidebarHeading(doc,'Perfil',sy);
  const profileRows=[c.expertiseLabel,c.seniorityLabel,b.rangoExperiencia?`Experiencia: ${b.rangoExperiencia}`:''].filter(Boolean);
  for(const row of profileRows){doc.fillColor('#E6EDF5').font('Helvetica').fontSize(8).text(row,28,sy,{width:125,lineGap:1});sy=doc.y+7;}
  if(skills.length && sy<650){ sy+=10; sy=sidebarHeading(doc,'Competencias',sy); for(const row of skills.slice(0,7)){doc.fillColor('#E6EDF5').font('Helvetica').fontSize(7.7).text(`• ${row}`,28,sy,{width:125,lineGap:1});sy=doc.y+4;} }

  try{ if(fs.existsSync(TALENTO_LOGO)) doc.image(TALENTO_LOGO,28,H-64,{fit:[116,30],align:'center'}); }catch{}
  doc.fillColor('#A9B7C8').font('Helvetica').fontSize(6.8).text('CV generado con Talento PyME',28,H-28,{width:125,align:'center',lineBreak:false});

  let y=42;
  doc.fillColor(TEXT).font('Helvetica').fontSize(25).text(fullName,mainX,y,{width:mainW,lineGap:0}); y=doc.y+5;
  doc.fillColor(TEXT).font('Helvetica').fontSize(12).text(title.toUpperCase(),mainX,y,{width:mainW}); y=doc.y+10;
  doc.fillColor(NAVY).rect(mainX,y,28,5).fill(); y+=18;

  const ensureSpace=(need=90)=>{
    if(y+need <= H-48) return;
    y=addContinuationPage(doc,fullName,title);
    mainX=42; mainW=W-84;
  };

  if(presentation){
    y=mainHeading(doc,'Perfil profesional',y,mainX,mainW);
    doc.fillColor(TEXT).font('Helvetica').fontSize(8.8).text(presentation,mainX,y,{width:mainW,lineGap:3});
    y=doc.y+14;
  }

  if(strengths.length){
    ensureSpace(190);
    y=mainHeading(doc,'Aptitudes y fortalezas profesionales',y,mainX,mainW);
    y=bulletList(doc,strengths,mainX,y,mainW,10)+10;
  }

  if(experienceLines.length){
    ensureSpace(120);
    y=mainHeading(doc,'Experiencia y trayectoria',y,mainX,mainW);
    y=bulletList(doc,experienceLines,mainX,y,mainW,7)+10;
  }
  if(educationLines.length){
    ensureSpace(105);
    y=mainHeading(doc,'Formación',y,mainX,mainW);
    y=bulletList(doc,educationLines,mainX,y,mainW,5)+9;
  }
  if(certLines.length){
    ensureSpace(105);
    y=mainHeading(doc,'Certificaciones y capacitación',y,mainX,mainW);
    y=bulletList(doc,certLines,mainX,y,mainW,5)+8;
  }

  if(motivation || closing){
    ensureSpace(145);
    y=mainHeading(doc,'Motivación y proyección profesional',y,mainX,mainW);
    if(motivation){
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.8).text(motivation,mainX,y,{width:mainW,lineGap:3});
      y=doc.y+9;
    }
    if(closing){
      doc.fillColor(TEXT).font('Helvetica').fontSize(8.8).text(closing,mainX,y,{width:mainW,lineGap:3});
      y=doc.y+8;
    }
  }

  if(!presentation && !experienceLines.length){
    y=mainHeading(doc,'Objetivo laboral',y,mainX,mainW);
    textBlock(doc,'Estoy construyendo mi perfil profesional. Puedo completar experiencia, objetivos, habilidades y formación en Talento PyME y volver a generar este currículum cada vez que lo actualice.',mainX,y,mainW,{size:9,lineGap:2});
  }

  // Pie consistente en todas las páginas, sin voz de evaluador externo.
  const range=doc.bufferedPageRange();
  for(let i=0;i<range.count;i++){
    doc.switchToPage(range.start+i);
    const first=i===0;
    const fx=first?196:42;
    const fw=first?(W-fx-34):(W-84);
    doc.strokeColor('#DCE4ED').lineWidth(0.6).moveTo(fx,H-34).lineTo(first?W-34:W-42,H-34).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.6).text(`CV preparado por el candidato con asistencia de Talento PyME · Página ${i+1} de ${range.count}`,fx,H-26,{width:fw,align:'center',lineBreak:false});
  }
  doc.end();
  return done;
}
