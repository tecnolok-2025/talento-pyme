# Talento PyME v8.0.1 — Leer primero

Corrección funcional de la nueva etapa 8.x.

## Objetivo
Eliminar del panel de Perfiles candidatos las categorías ambiguas:
- Información profesional por completar
- Perfil profesional / Trayectoria no determinada

Cuando no existe una actividad profesional suficientemente demostrada, el motor utiliza la formación para clasificar al candidato como:
- APRENDIZ: secundaria, bachillerato, formación técnica secundaria o ausencia de estudios superiores.
- PASANTE: formación terciaria o universitaria declarada.

La orientación se discrimina cuando hay evidencia: eléctrico, electromecánico, mecánico, electrónico, químico, industrial, informática/sistemas, logística, administrativo, seguridad e higiene, ambiental, construcción, etc.

Aprendiz y Pasante, junto con sus especialidades, forman parte del texto de búsqueda administrativa.

## Instalación recomendada
Si actualmente la aplicación muestra v7.10.15, instalar directamente el parche v7.10.15 -> v8.0.1. No hace falta instalar v8.0.0 antes.

Desplegar primero talento-pyme-api y luego talento-pyme. La API detectará el cambio de motor y reclasificará el padrón.
