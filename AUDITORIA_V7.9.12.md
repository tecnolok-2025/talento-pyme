# Talento PyME v7.9.12 — Auditoría de descarga de CV candidato

## Motivo
Se corrigió el flujo de **Mi Perfil → Descargar mi CV PDF** para que sea directo y consistente para todos los candidatos. También se eliminó el botón **Recargar**, que únicamente volvía a consultar los datos guardados y generaba confusión.

## Cambios funcionales
- Se elimina `Recargar` del perfil candidato y su manejador JavaScript.
- El texto superior explica que el PDF utiliza la última información guardada del perfil.
- `Descargar mi CV PDF` ya no exige:
  - ejecutar nuevamente `Corrección IA profesional`;
  - recargar el perfil;
  - guardar nuevamente el perfil sólo para poder descargar.
- La generación usa el endpoint autenticado `/candidate/cv/pdf` y toma los datos guardados en Neon en el momento de la solicitud.
- Una presentación pendiente de nueva fusión IA no bloquea el CV: se utiliza la mejor información guardada disponible.
- La clasificación administrativa se trata como enriquecimiento no bloqueante: si un dato histórico atípico impidiera clasificar, el PDF igualmente intenta generarse.
- Se valida que el buffer PDF no esté vacío y se envía `Content-Length` más cabeceras `no-cache`.
- Compatibilidad específica para Safari iPhone/iPad: se abre una pestaña durante el gesto del usuario y allí se entrega el PDF después del `fetch` autenticado. En escritorio/Android se conserva descarga directa.
- Nombre del archivo: `YYMMDD-HHmm CV Nombre Apellido.pdf`.

## Caché y versión
- Frontend: `7.9.12`.
- API: `7.9.12`.
- Service Worker / caché: `7.9.12`.
- Build: `20260810_02`.
- La subida de versión fuerza renovación de `bolsa-candidato.js` respecto de 7.9.11/R01.
- La constante interna de análisis profesional `AI_V7_7.9.11_VOICE_CV_FUSION` se conserva deliberadamente para no marcar como pendientes nuevamente a candidatos ya procesados.

## Base de datos
No hay cambios de Prisma ni migraciones nuevas.

## Validación
- 136 pruebas Node ejecutadas: 136 aprobadas.
- 35 archivos JavaScript validados con `node --check`.
- 17 scripts inline HTML validados con `node --check`.
- ZIP verificado con `unzip -t`.

## Limitación de la auditoría local
El entorno de auditoría no tiene instaladas las dependencias npm de producción (`pdfkit`), por lo que no se ejecutó una generación binaria real de PDF contra Neon. La ruta, la lógica del cliente, el generador y las pruebas estáticas fueron validadas; la prueba final debe realizarse después del deploy en Render, donde `npm install` instala `pdfkit`.
