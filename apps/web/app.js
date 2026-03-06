// Shared helpers for Talento PyME (v4.0.3)
// NOTA: Este archivo puede cargarse en cualquier pantalla.
// No debe asumir que existen ciertos elementos en el DOM.

function apiBase() {
  const base = (typeof TP_API_URL !== "undefined" && TP_API_URL) ? TP_API_URL : "";
  return String(base).replace(/\/$/, "");
}

async function apiFetch(path, options = {}) {
  const token = (typeof loadToken === "function") ? loadToken() : localStorage.getItem("tp_token");

  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", "Bearer " + token);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = /^https?:\/\//i.test(path) ? path : apiBase() + path;

  const res = await fetch(url, { ...options, headers });
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  let data = null;
  try {
    if (ct.includes("application/json")) data = await res.json();
    else data = await res.text();
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    const errMsg =
      (data && typeof data === "object" && (data.error || data.message)) ? (data.error || data.message) :
      (typeof data === "string" && data.trim()) ? data :
      `HTTP ${res.status}`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Helpers UI
function setPageError(rootId, title, detail) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0;">${escapeHtml(title || "Ocurrió un error")}</h2>
      <div class="small">${escapeHtml(detail || "")}</div>
      <div class="small" style="margin-top:10px;">Tip: tocá <b>Actualizar versión</b> en la pantalla de acceso si sospechás caché.</div>
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
