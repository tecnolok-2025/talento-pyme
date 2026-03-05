if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register(`/sw.js?v=${window.TP_APP_VERSION || Date.now()}`).catch(()=>{}));
}

const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t);

function roleLabel(r){
  if(r === "CANDIDATE") return "Candidato";
  if(r === "COMPANY") return "Empresa";
  if(r === "ADMIN_CANDIDATE") return "Admin Candidatos";
  if(r === "ADMIN_COMPANY") return "Admin Empresas";
  if(r === "SUPERADMIN") return "Superadministrador";
  return r || "";
}

function apiBase(){
  const manual = $("apiUrl").value?.trim();
  return manual || window.TP_API_URL;
}

$("apiUrl").value = window.TP_API_URL;


const roleRadios = Array.from(document.querySelectorAll('input[name="role"]'));
function selectedRole(){
  const r = roleRadios.find(x=>x.checked);
  return (r?.value || "CANDIDATE");
}
function refreshRoleUI(){
  const role = selectedRole();
  const w = document.getElementById("companyWrap");
  if(w) w.style.display = (role === "COMPANY") ? "block" : "none";
}
roleRadios.forEach(r=>r.addEventListener("change", refreshRoleUI));
refreshRoleUI();


async function post(path, body){
  const r = await fetch(`${apiBase()}${path}`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(()=> ({}));
  if(!r.ok) throw new Error(data?.error || "Error");
  return data;
}

$("btnRegister").onclick = async () => {
  msg("Registrando...");
  try{
    const email = $("email").value.trim();
    const password = $("password").value;
    const role = selectedRole();
    const fullName = $("fullName")?.value?.trim();
    const companyName = $("companyName")?.value?.trim();

    const body = { email, password, role };
    if(role === "CANDIDATE" && fullName) body.fullName = fullName;
    if(role === "COMPANY" && companyName) body.companyName = companyName;

    const data = await post("/auth/register", body);
    msg(`OK registro: ${data.email} (${roleLabel(data.role)})`);
  }catch(e){
    msg(e.message);
  }
};

$("btnLogin").onclick = async () => {
  msg("Ingresando...");
  try{
    const email = $("email").value.trim();
    const password = $("password").value;
    const data = await post("/auth/login",{ email, password });
    localStorage.setItem("tp_token", data.token);
    msg(`OK login. Rol: ${roleLabel(data.role)}`);
  }catch(e){
    msg(e.message);
  }
};
