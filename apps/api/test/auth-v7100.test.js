import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
const api=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
async function harness({users=[],profiles=[],companies=[]}={}){
 const routes={};const ctx={bcrypt,z,console,FACTORY_ADMIN_ALIAS:'root-admin',FACTORY_ADMIN_PASSWORD:'StrictAdminKey',VIRTUAL_ADMIN_USER_ID:'root',VIRTUAL_ADMIN_ROLE:'SUPERADMIN',
  signToken:u=>u.id,normalizeId:s=>String(s).replace(/\D/g,''),app:{post:(path,...handlers)=>routes[path]=handlers},
  prisma:{user:{findMany:async()=>users,findFirst:async({where})=>users.find(x=>x.email.toLowerCase()===where.email.equals)},profile:{findMany:async()=>profiles},companyProfile:{findMany:async()=>companies}}};
 vm.createContext(ctx);
 vm.runInContext(api.slice(api.indexOf('function normalizeName'),api.indexOf('function clampText'))+api.slice(api.indexOf('const loginSchema'),api.indexOf('const passwordRecoveryStartSchema'))+api.slice(api.indexOf('const loginAttempts710'),api.indexOf('app.post("/auth/password-recovery/start"'))+';globalThis.verify=verifyLoginPassword710;',ctx);
 return {ctx,async login(body,ip='client'){
  const req={body,ip};const res={code:200,body:null,status(n){this.code=n;return this;},json(x){this.body=x;return this;},setHeader(){}};
  const [limit,handler]=routes['/auth/login'];let allowed=false;limit(req,res,()=>allowed=true);if(allowed)await handler(req,res);return res;
 }};
}
const user={id:'candidate-1',role:'CANDIDATE',email:'pepe@example.com',passHash:await bcrypt.hash('Talento1234',4)};
test('DNI formateado + primera letra minúscula identifica la cuenta exacta',async()=>{const h=await harness({users:[user]});const r=await h.login({fullName:'30.123.456',password:'talento1234',roleHint:'CANDIDATE'});assert.equal(r.code,200);assert.equal(r.body.token,user.id);});
test('email mayúsculas admite espacios accidentales en contraseña',async()=>{const h=await harness({users:[user]});assert.equal((await h.login({fullName:' PEPE@EXAMPLE.COM ',password:' Talento1234 ',roleHint:'CANDIDATE'})).code,200);});
test('no acepta un cambio interno ni contraseña completamente minúscula si difiere internamente',async()=>{const h=await harness({users:[user]});assert.equal((await h.login({fullName:'30123456',password:'Talento1235',roleHint:'CANDIDATE'})).code,401);});
test('fuzzy nombre requiere contraseña exacta',async()=>{const h=await harness({profiles:[{fullName:'José Pérez',user}]});assert.equal((await h.login({fullName:'Jose Perezz',password:'Talento1234',roleHint:'CANDIDATE'})).code,200);assert.equal((await h.login({fullName:'Jose Perezz',password:'talento1234',roleHint:'CANDIDATE'})).code,401);});
test('nombre acepta tildes mayúsculas orden apellido/nombre',async()=>{const h=await harness({profiles:[{fullName:'José Pérez',user}]});assert.equal((await h.login({fullName:'PEREZ JOSE',password:'Talento1234',roleHint:'CANDIDATE'})).code,200);});
test('homónimos no se eligen por adivinación',async()=>{const h=await harness({profiles:[{fullName:'José Pérez',user},{fullName:'José Pérez',user:{...user,id:'other'}}]});assert.equal((await h.login({fullName:'Jose Perez',password:'Talento1234'})).code,409);});
test('DNI duplicado legado no permite entrar a una cuenta arbitraria',async()=>{const h=await harness({users:[user,{...user,id:'other'}]});assert.equal((await h.login({fullName:'30123456',password:'Talento1234'})).code,401);});
test('administrador no admite variantes de contraseña',async()=>{const h=await harness();assert.equal((await h.login({fullName:'root-admin',password:'strictAdminKey'})).code,401);assert.equal((await h.login({fullName:'root-admin',password:'StrictAdminKey'})).code,200);assert.equal(await h.ctx.verify('talento1234',{...user,role:'ADMIN'},true),false);});
test('email respeta rol elegido',async()=>{const h=await harness({users:[user]});assert.equal((await h.login({fullName:user.email,password:'Talento1234',roleHint:'COMPANY'})).code,401);});
test('límite de intentos responde 429',async()=>{const h=await harness();let r;for(let i=0;i<21;i++)r=await h.login({fullName:'root-admin',password:'wrong-key'});assert.equal(r.code,429);});
