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
