# Punto 2 — Conectar WEB (Static Site) con API (Web Service)

## 1) Editar archivo
Ruta: `apps/web/config.js`

Debe quedar:
`window.TP_API_URL = "https://talento-pyme-api.onrender.com";`

## 2) Subir a GitHub
Hacé commit a la rama `main`.

## 3) Redeploy del Static Site
Render → servicio `talento-pyme` (Static Site) → Manual Deploy → Deploy latest commit.
