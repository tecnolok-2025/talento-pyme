# LEER PRIMERO · Talento PyME v9.1.0

Esta versión parte de **v9.0.0** y corresponde a **Seguridad · Etapa 1**.

## Qué cambia
- CORS restringido al frontend oficial.
- Cabeceras defensivas en API.
- `no-store` para respuestas sensibles.
- límite anti-abuso adicional sobre `/auth`.
- protección de uploads contra dotfiles/listados.
- actualización de versión/cache PWA.

## Qué NO cambia
No se tocaron búsquedas, clasificación, score, seniority, expertise, perfiles, CV, postulaciones, oportunidades ni lógica comercial.

## Neon
**No requiere migración de base de datos.**

## Render
Mantener:
`WEB_BASE_URL=https://talento-pyme.onrender.com`

Opcional:
`SECURITY_ALLOWED_ORIGINS=`

Dejarla vacía salvo que exista un segundo frontend legítimo.

## Instalación
Puede publicarse la versión completa o copiarse el parche sobre v9.0.0. Luego desplegar API y Web para que ambos queden en v9.1.0.
