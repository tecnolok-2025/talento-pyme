function norm(value=''){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

const ARGENTINA_PROVINCES = [
  'Buenos Aires','Ciudad Autónoma de Buenos Aires','Catamarca','Chaco','Chubut','Córdoba','Corrientes','Entre Ríos','Formosa','Jujuy','La Pampa','La Rioja','Mendoza','Misiones','Neuquén','Río Negro','Salta','San Juan','San Luis','Santa Cruz','Santa Fe','Santiago del Estero','Tierra del Fuego','Tucumán'
];

const PROVINCE_ALIASES = new Map();
for(const p of ARGENTINA_PROVINCES) PROVINCE_ALIASES.set(norm(p), p);
[
  ['caba','Ciudad Autónoma de Buenos Aires'],
  ['capital federal','Ciudad Autónoma de Buenos Aires'],
  ['ciudad de buenos aires','Ciudad Autónoma de Buenos Aires'],
  ['bs as','Buenos Aires'],
  ['bsas','Buenos Aires'],
  ['pcia de buenos aires','Buenos Aires'],
  ['provincia de buenos aires','Buenos Aires'],
].forEach(([k,v])=>PROVINCE_ALIASES.set(norm(k),v));

// Mapa de localidades frecuentes de Talento PyME y del corredor productivo.
// Se usa únicamente cuando la localidad es inequívoca; si no, se conserva lo declarado.
const CITY_ROWS = [
  ['Campana','Buenos Aires',['campana']],
  ['Zárate','Buenos Aires',['zarate']],
  ['Lima','Buenos Aires',['lima zarate','lima buenos aires','lima']],
  ['Tigre','Buenos Aires',['tigre']],
  ['San Fernando','Buenos Aires',['san fernando']],
  ['San Isidro','Buenos Aires',['san isidro']],
  ['San Nicolás de los Arroyos','Buenos Aires',['san nicolas de los arroyos','san nicolas']],
  ['Pergamino','Buenos Aires',['pergamino']],
  ['General Rodríguez','Buenos Aires',['general rodriguez','gral rodriguez']],
  ['Escobar','Buenos Aires',['escobar','belen de escobar']],
  ['Pilar','Buenos Aires',['pilar']],
  ['Exaltación de la Cruz','Buenos Aires',['exaltacion de la cruz','capilla del senor']],
  ['Malvinas Argentinas','Buenos Aires',['malvinas argentinas']],
  ['Tortuguitas','Buenos Aires',['tortuguitas']],
  ['Luján','Buenos Aires',['lujan']],
  ['Baradero','Buenos Aires',['baradero']],
  ['San Pedro','Buenos Aires',['san pedro']],
  ['Ramallo','Buenos Aires',['ramallo']],
  ['San Antonio de Areco','Buenos Aires',['san antonio de areco']],
  ['Mercedes','Buenos Aires',['mercedes buenos aires']],
  ['La Plata','Buenos Aires',['la plata']],
  ['CABA','Ciudad Autónoma de Buenos Aires',['caba','capital federal','ciudad autonoma de buenos aires','ciudad de buenos aires']],
  ['Rosario','Santa Fe',['rosario']],
  ['Villa Constitución','Santa Fe',['villa constitucion']],
  ['Santa Fe','Santa Fe',['santa fe capital','ciudad de santa fe']],
  ['Rafaela','Santa Fe',['rafaela']],
  ['Córdoba','Córdoba',['cordoba capital','ciudad de cordoba']],
  ['Mendoza','Mendoza',['mendoza capital','ciudad de mendoza']],
].map(([city,province,aliases])=>({city,province,country:'Argentina',aliases:aliases.map(norm)}));

function parseLocalityParts(locality=''){
  const raw=String(locality || '').trim();
  if(!raw) return {city:'', province:''};
  const parts=raw.split(/\s*[-–—,|/]\s*/).map((x)=>x.trim()).filter(Boolean);
  if(parts.length >= 2){
    const last=PROVINCE_ALIASES.get(norm(parts[parts.length-1]));
    if(last) return {city:parts.slice(0,-1).join(' - '), province:last};
  }
  return {city:raw, province:''};
}

export function inferResidence({ locality='', province='', country='' }={}){
  const parsed=parseLocalityParts(locality);
  let city=parsed.city || String(locality || '').trim();
  let resolvedProvince=String(province || parsed.province || '').trim();
  let resolvedCountry=String(country || '').trim();

  if(resolvedProvince){
    resolvedProvince=PROVINCE_ALIASES.get(norm(resolvedProvince)) || resolvedProvince;
  }

  const cityNorm=norm(city);
  const fullNorm=norm(locality);
  const match=CITY_ROWS.find((row)=> row.aliases.some((a)=>cityNorm===a || fullNorm===a || fullNorm.startsWith(`${a} `)));
  if(match){
    city=match.city;
    if(!resolvedProvince) resolvedProvince=match.province;
    if(!resolvedCountry) resolvedCountry=match.country;
  }

  if(!resolvedCountry && resolvedProvince && PROVINCE_ALIASES.has(norm(resolvedProvince))){
    resolvedCountry='Argentina';
  }
  if(!resolvedCountry && /\bargentina\b/.test(fullNorm)) resolvedCountry='Argentina';

  return {
    city:city || String(locality || '').trim(),
    province:resolvedProvince,
    country:resolvedCountry,
    inferred:!!match || (!!resolvedProvince && !country),
  };
}

export function isArgentinaProvince(value=''){
  return PROVINCE_ALIASES.has(norm(value));
}


// v7.10.6 · normalización no destructiva para agrupaciones y reportes.
// Conserva los datos originales del candidato: esta función sólo construye una
// residencia canónica para lectura agregada, búsquedas y PDF de trazabilidad.
const GROUPING_CITY_ROWS = [
  ...CITY_ROWS,
  { city:'Los Cardales', province:'Buenos Aires', country:'Argentina', aliases:['los cardales','cardales'].map(norm) },
  { city:'Grand Bourg', province:'Buenos Aires', country:'Argentina', aliases:['grand bourg','grand boug'].map(norm) },
  { city:'San Miguel', province:'Buenos Aires', country:'Argentina', aliases:['san miguel buenos aires','san miguel'].map(norm) },
  { city:'San Cayetano', province:'Buenos Aires', country:'Argentina', aliases:['san cayetano'].map(norm) },
];

const GROUPING_PROVINCE_ALIASES = new Map(PROVINCE_ALIASES);
[
  ['buenos aires provincia','Buenos Aires'],
  ['provincia buenos aires','Buenos Aires'],
  ['buenos aires aires','Buenos Aires'],
  ['bueno aires','Buenos Aires'],
  ['gba zona norte','Buenos Aires'],
  ['gba','Buenos Aires'],
].forEach(([k,v])=>GROUPING_PROVINCE_ALIASES.set(norm(k),v));

const GROUPING_POSTAL_CITY = new Map([
  ['2804',{ city:'Campana', province:'Buenos Aires', country:'Argentina' }],
  ['2800',{ city:'Zárate', province:'Buenos Aires', country:'Argentina' }],
]);

const GROUPING_EMPTY_VALUES = new Set([
  '', 'otra', 'otro', 'pendiente', 'sin dato', 'no informado', 'no informada',
  'localidad no informada', 'ciudad no informada', 's d', 'sd', 'n a', 'na'
]);

const CABA_NEIGHBORHOODS = new Set([
  'almagro','palermo','recoleta','belgrano','caballito','flores','villa crespo','boedo','san telmo',
  'monserrat','balvanera','barracas','colegiales','chacarita','villa urquiza','villa del parque','mataderos',
  'liniers','nunez','saavedra','parque patricios','constitucion','retiro','la boca'
]);

function editDistance(a='', b=''){
  const x=norm(a), y=norm(b);
  if(x===y) return 0;
  if(!x) return y.length;
  if(!y) return x.length;
  const prev=Array.from({length:y.length+1},(_,i)=>i);
  for(let i=1;i<=x.length;i++){
    let left=i;
    let diag=i-1;
    for(let j=1;j<=y.length;j++){
      const up=prev[j];
      const next=Math.min(up+1,left+1,diag+(x[i-1]===y[j-1]?0:1));
      prev[j]=next;
      diag=up;
      left=next;
    }
  }
  return prev[y.length];
}

function containsAlias(text='', alias=''){
  const t=` ${norm(text)} `;
  const a=norm(alias);
  return !!a && t.includes(` ${a} `);
}

function canonicalGroupingProvince(value=''){
  const n=norm(value);
  if(!n) return '';
  if(GROUPING_PROVINCE_ALIASES.has(n)) return GROUPING_PROVINCE_ALIASES.get(n);
  if(/\bbuenos\s+aires\b/.test(n) || /^gba\b/.test(n)) return 'Buenos Aires';
  if(n==='federal') return '';
  if(/^(soltero|soltera|casado|casada|divorciado|divorciada|viudo|viuda)( a)?$/.test(n.replace(/\//g,' '))) return '';
  return String(value || '').trim();
}

function canonicalGroupingCountry(value=''){
  const raw=String(value || '').trim();
  const n=norm(raw);
  if(!n) return '';
  if(n==='argentina' || n.startsWith('argent') || editDistance(n,'argentina')<=2) return 'Argentina';
  return raw;
}

function exactOrContainedCityMatch(value=''){
  const n=norm(value);
  if(!n) return null;
  const rows=[...GROUPING_CITY_ROWS].sort((a,b)=>Math.max(...b.aliases.map(x=>x.length))-Math.max(...a.aliases.map(x=>x.length)));
  return rows.find((row)=>row.aliases.some((a)=> n===a || containsAlias(n,a))) || null;
}

function fuzzyCityMatch(value=''){
  const n=norm(value);
  if(!n || n.length<5 || /\d/.test(n) || n.includes(' ')) return null;
  let best=null, second=null;
  for(const row of GROUPING_CITY_ROWS){
    for(const alias of row.aliases){
      if(alias.includes(' ') || alias.length<5) continue;
      const d=editDistance(n,alias);
      const candidate={row,d,alias};
      if(!best || d<best.d){ second=best; best=candidate; }
      else if(!second || d<second.d){ second=candidate; }
    }
  }
  if(!best) return null;
  const maxDistance=n.length>=7?2:1;
  if(best.d>maxDistance) return null;
  if(second && second.d===best.d && second.row.city!==best.row.city) return null;
  return best.row;
}

function cityMatch(value=''){
  return exactOrContainedCityMatch(value) || fuzzyCityMatch(value);
}

function addressCityMatch(value=''){
  const raw=String(value || '').trim();
  if(!raw || !/[;,|/]/.test(raw)) return null;
  const parts=raw.split(/\s*[;,|/]\s*/).map((x)=>x.trim()).filter(Boolean);
  for(const part of parts.slice(-2).reverse()){
    const match=exactOrContainedCityMatch(part);
    if(match && match.aliases.some((a)=>norm(part)===a)) return match;
  }
  return null;
}

function cleanGroupingCity(value=''){
  const raw=String(value || '').trim();
  const n=norm(raw);
  if(GROUPING_EMPTY_VALUES.has(n)) return '';
  if(/^\d{2,6}$/.test(n)) return '';
  return raw;
}

export function normalizeResidenceForGrouping({
  locality='', province='', country='',
  alternateLocality='', alternateProvince='', alternateCountry='',
  address='', alternateAddress=''
}={}){
  const primaryLocality=String(locality || '').trim();
  const secondaryLocality=String(alternateLocality || '').trim();
  const primaryProvince=String(province || '').trim();
  const secondaryProvince=String(alternateProvince || '').trim();

  // Algunos registros históricos tienen ciudad y provincia desplazadas una columna.
  // Si la supuesta provincia no es una provincia válida pero sí es una ciudad inequívoca
  // (por ejemplo provincia=Campana), esa señal tiene prioridad para el agrupamiento.
  const primaryProvinceCanonical=canonicalGroupingProvince(primaryProvince);
  const secondaryProvinceCanonical=canonicalGroupingProvince(secondaryProvince);
  const primaryProvinceIsReal=!!primaryProvinceCanonical && GROUPING_PROVINCE_ALIASES.has(norm(primaryProvinceCanonical));
  const secondaryProvinceIsReal=!!secondaryProvinceCanonical && GROUPING_PROVINCE_ALIASES.has(norm(secondaryProvinceCanonical));
  let match=null;
  let source='';
  if(!primaryProvinceIsReal){
    const misplaced=cityMatch(primaryProvince);
    if(misplaced){ match=misplaced; source='misplaced-field'; }
  }
  if(!match && !secondaryProvinceIsReal){
    const misplaced=cityMatch(secondaryProvince);
    if(misplaced){ match=misplaced; source='misplaced-field'; }
  }
  if(!match){
    match=cityMatch(primaryLocality) || cityMatch(secondaryLocality);
    if(match) source='locality';
  }

  // Códigos postales inequívocos del corredor, usados sólo para agrupación.
  if(!match){
    const postal=GROUPING_POSTAL_CITY.get(norm(primaryLocality)) || GROUPING_POSTAL_CITY.get(norm(secondaryLocality));
    if(postal){ match={...postal,aliases:[]}; source='postal-code'; }
  }

  // Como último respaldo, se mira únicamente un segmento explícito de ciudad al final de una dirección.
  if(!match){
    const fromAddress=addressCityMatch(address) || addressCityMatch(alternateAddress);
    if(fromAddress){ match=fromAddress; source='address'; }
  }

  if(match){
    return {
      city:match.city,
      province:match.province,
      country:match.country,
      inferred:true,
      normalized:true,
      source,
    };
  }

  let resolvedProvince=canonicalGroupingProvince(primaryProvince) || canonicalGroupingProvince(secondaryProvince);
  let resolvedCountry=canonicalGroupingCountry(country) || canonicalGroupingCountry(alternateCountry);
  let city=cleanGroupingCity(primaryLocality) || cleanGroupingCity(secondaryLocality);

  if(resolvedProvince==='Ciudad Autónoma de Buenos Aires' && CABA_NEIGHBORHOODS.has(norm(city))){
    city='CABA';
  }

  // Si la ciudad repite la provincia, es un dato territorial incompleto y no una ciudad válida.
  if(city && resolvedProvince && norm(city)===norm(resolvedProvince)) city='';

  if(!resolvedCountry && resolvedProvince && GROUPING_PROVINCE_ALIASES.has(norm(resolvedProvince))) resolvedCountry='Argentina';

  return {
    city:city || 'Ciudad no informada',
    province:resolvedProvince || 'Provincia / región no informada',
    country:resolvedCountry || 'País no informado',
    inferred:false,
    normalized:!!(resolvedProvince || resolvedCountry),
    source:'declared',
  };
}
