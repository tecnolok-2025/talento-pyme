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
