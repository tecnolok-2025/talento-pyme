# Talento PyME v8.0.0 — LEER PRIMERO

Versión mayor basada en el resguardo lógico del 03/10/2026 (v7.10.15, 593 candidatos / 593 clasificaciones).

## Objetivo
Convertir los perfiles sin trayectoria laboral verificable en categorías útiles para empresas: **Aprendices** y **Pasantes**, con orientación por formación y con búsqueda directa por palabra clave.

## Criterio
- Sin experiencia + secundario/técnico: Aprendiz.
- Sin experiencia + bachiller: Aprendiz administrativo.
- Sin experiencia + terciario/universitario/superior: Pasante.
- Sin experiencia + sin estudios secundarios declarados: Aprendiz – estudios secundarios no declarados.
- La experiencia real siempre prevalece sobre la formación.
- La clasificación sigue siendo conservadora: una formación orienta, pero no acredita experiencia.

## Búsqueda
`aprendiz`, `aprendiz eléctrico`, `aprendiz mecánico`, `aprendiz electromecánico`, `pasante`, `pasante eléctrico`, etc. se incorporan al `searchText` y funcionan sin distinguir mayúsculas/minúsculas ni acentos.

## Instalación
Aplicar el parche v7.10.15 → v8.0.0 respetando carpetas. Hacer commit y desplegar API primero; luego el sitio estático. No requiere migración nueva de Neon.
