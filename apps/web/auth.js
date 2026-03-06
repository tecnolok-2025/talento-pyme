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
  const headers = Object.assign({ "Content-Type":"application/json" }, options.headers||{});
  const t = tpToken();
  if(t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch(base + path, Object.assign({}, options, { headers }));
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data?.error || "Error");
  return data;
}


function tpVersion(){
  return (window.TP_APP_VERSION || "dev");
}
function applyVersionBadges(){
  const v = "v" + tpVersion();
  document.querySelectorAll(".tp-version, .appVersion").forEach(el => { el.textContent = v; });
}
document.addEventListener("DOMContentLoaded", applyVersionBadges);

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
  const btn = document.getElementById("btnUpdate");
  if (btn) btn.addEventListener("click", () => hardUpdate());
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

