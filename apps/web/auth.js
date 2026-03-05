function tpToken(){ return localStorage.getItem("tp_token"); }
function tpRole(){ return localStorage.getItem("tp_role"); }
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
  document.querySelectorAll(".tp-version").forEach(el => { el.textContent = v; });
}
document.addEventListener("DOMContentLoaded", applyVersionBadges);

function applyRoleVisibility(){
  const role = tpRole();
  document.querySelectorAll('[data-role]').forEach(el => {
    const r = el.getAttribute('data-role');
    if(r && role && r !== role) el.style.display = 'none';
  });
  return role;
}

function requireRole(allowed){
  const role = tpRole();
  const ok = Array.isArray(allowed) ? allowed.includes(role) : (role === allowed);
  if(!ok){ window.location.href = '/dashboard.html'; return false; }
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
