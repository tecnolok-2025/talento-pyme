function tpToken(){ return localStorage.getItem("tp_token"); }
function tpRole(){ return normalizeRole(localStorage.getItem("tp_role")); }
function getRole(){ return tpRole(); }
function loadToken(){ return tpToken(); }
function requireAuth(){
  const t = tpToken();
  if(!t){ window.location.href = "/"; return null; }
  return t;
}
function logout(){
  localStorage.removeItem("tp_token");
  localStorage.removeItem("tp_role");
  window.location.href = "/";
}
async function apiFetch(path, options={}){
  const base = window.TP_API_URL;
  const headers = new Headers(options.headers || {});
  const t = tpToken();
  if(t && !headers.has("Authorization")) headers.set("Authorization", "Bearer " + t);
  const isFormData = (typeof FormData !== "undefined") && (options.body instanceof FormData);
  if(options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(base + path, Object.assign({}, options, { headers }));
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const data = ct.includes("application/json")
    ? await res.json().catch(()=> ({}))
    : await res.text().catch(()=> "");
  if(!res.ok) throw new Error((data && data.error) || (typeof data === "string" && data) || "Error");
  return data;
}



function setZoomLock(unlocked) {
  try {
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    if (unlocked) {
      vp.setAttribute('content', 'width=device-width,initial-scale=1');
      localStorage.setItem('tp_zoom_unlocked', '1');
    } else {
      vp.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no');
      localStorage.removeItem('tp_zoom_unlocked');
    }
    document.querySelectorAll('[data-zoom-toggle]').forEach((btn) => {
      const isUnlocked = !!localStorage.getItem('tp_zoom_unlocked');
      btn.textContent = isUnlocked ? 'Bloquear zoom' : 'Desbloquear zoom';
      btn.setAttribute('aria-pressed', isUnlocked ? 'true' : 'false');
    });
  } catch (_) {}
}

function applyZoomPreference() {
  const unlocked = !!localStorage.getItem('tp_zoom_unlocked');
  setZoomLock(unlocked);
}
function tpVersion(){
  return (window.TP_APP_VERSION || "dev");
}
function applyVersionBadges(){
  const v = "v" + tpVersion();
  document.querySelectorAll(".tp-version, .appVersion").forEach(el => { el.textContent = v; });
}

function applyGlobalBranding(){
  try {
    document.querySelectorAll('.brand img, .authBrand .brandLogo, .topbar .brand img, .header > a img').forEach((img)=>{
      img.setAttribute('src','/icon-192.png');
      img.setAttribute('alt','Talento PyME');
    });
    if (!document.querySelector('.globalBrandFooter') && !document.querySelector('.brandFooter')) {
      const footer = document.createElement('div');
      footer.className = 'globalBrandFooter';
      footer.innerHTML = '<img src="/assets/logo-talento-pyme.png" alt="Talento PyME" />';
      (document.querySelector('.wrap') || document.querySelector('.container') || document.querySelector('.authWrap') || document.body).appendChild(footer);
    }
  } catch(_){}
}
document.addEventListener("DOMContentLoaded", applyVersionBadges);
document.addEventListener("DOMContentLoaded", applyGlobalBranding);

function applyRoleVisibility(){
  const role = tpRole();
  document.querySelectorAll('[data-role]').forEach(el => {
    const r = normalizeRole(el.getAttribute('data-role'));
    if(r && role && r !== role) el.style.display = 'none';
  });
  return role;
}

function requireRole(allowed){
  const role = tpRole();
  const ok = Array.isArray(allowed) ? allowed.includes(role) : (role === allowed);
  if(!ok){ window.location.href = '/perfil.html'; return false; }
  return true;
}

function roleES(role){
  switch(role){
    case "CANDIDATE": return "Candidato";
    case "COMPANY": return "Empresa";
    case "ADMIN":
    case "SUPERADMIN": return "Administración";
    default: return role || "";
  }
}


// UI helpers (shared)
window.addEventListener("DOMContentLoaded", () => {
  // Version badges
  const v = window.TP_APP_VERSION;
  if (v) {
    document.querySelectorAll(".tp-version").forEach(el => { el.textContent = "v" + v; });
  }

  // Password visibility toggles
  document.querySelectorAll(".pwToggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-target");
      const inp = targetId ? document.getElementById(targetId) : null;
      if (!inp) return;

      const willShow = (inp.type === "password");
      inp.type = willShow ? "text" : "password";
      btn.textContent = willShow ? "🙈" : "👁";
      btn.setAttribute("aria-label", willShow ? "Ocultar contraseña" : "Mostrar contraseña");
    });
  });
});

async function checkApiHealth() {
  try {
    const r = await fetch(`${window.TP_API_URL}/health`, { method: "GET" });
    const j = await r.json().catch(() => ({}));
    const el = document.getElementById("apiHealth");
    if (!el) return;
    if (r.ok) el.textContent = `API OK · v${j.version || "?"}`;
    else el.textContent = `API error (${r.status})`;
  } catch (e) {
    const el = document.getElementById("apiHealth");
    if (el) el.textContent = "API sin respuesta";
  }
}
window.addEventListener("load", () => checkApiHealth());

async function hardUpdate() {
  const msg = document.getElementById("updateMsg");
  try {
    if (msg) msg.textContent = "Actualizando…";

    // 1) Desregistrar SW
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }

    // 2) Borrar caches
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

    // 3) Recargar con cache-busting
    const u = new URL(location.href);
    u.searchParams.set("v", Date.now().toString());
    location.replace(u.toString());
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "No se pudo actualizar. Probá cerrar y volver a abrir.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyZoomPreference();

  const btn = document.getElementById("btnUpdate");
  if (btn) btn.addEventListener("click", () => hardUpdate());

  document.querySelectorAll('[data-zoom-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const unlocked = !!localStorage.getItem('tp_zoom_unlocked');
      setZoomLock(!unlocked);
    });
  });
});

// Normaliza roles para evitar errores recurrentes (mayúsculas/minúsculas/ES/EN)
function normalizeRole(role) {
  if (!role) return null;
  const r = String(role).trim().toUpperCase();
  if (r === 'CANDIDATO' || r === 'CANDIDATE') return 'CANDIDATE';
  if (r === 'EMPRESA' || r === 'COMPANY') return 'COMPANY';
  if (r === 'ADMIN' || r === 'SUPERADMIN') return 'ADMIN';
  return r;
}

