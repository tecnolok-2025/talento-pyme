# Talento PyME v7.9.3 - Auditoría funcional

Fecha de preparación: 09/08/2026
Base: v7.9.2

## Alcance

La revisión incorpora cuatro mejoras sin eliminar funciones ni registros existentes:

1. Trazabilidad geográfica agregada por país de residencia y ciudad.
2. Reemplazo de la etiqueta ambigua `Actividad general` por `Actividad principal no especificada`.
3. Presentación personal del candidato por voz o texto, editable y reutilizable administrativamente.
4. Generación y descarga de un CV profesional PDF desde el perfil del candidato.

## 1. Residencia en trazabilidad

- Se agrega `paisResidencia` al perfil candidato como campo nullable para preservar compatibilidad.
- Ciudad/localidad pasa a admitir escritura libre con sugerencias, para no limitar a candidatos de otras ciudades o países.
- Administración incorpora composición agregada por país + ciudad.
- El PDF de trazabilidad incorpora el punto `4.1 País de residencia y ciudad` con cantidad y participación.
- No se cruza residencia con expertise, nivel ni identidad individual.
- Los registros antiguos sin dato explícito se muestran como `País no informado`, salvo que exista una provincia argentina inequívoca en el perfil previo.

## 2. Actividad principal de empresas

- `Actividad general` queda retirada de la aplicación ejecutable.
- La etiqueta de fallback pasa a ser `Actividad principal no especificada`.
- Esto significa que la información disponible no permite inferir una actividad principal con suficiente claridad; no significa que la empresa pueda realizar cualquier actividad.
- El reporte recomienda completar ese dato cuando existan registros en esta situación.

## 3. Presentación por voz o texto

- Mi Perfil candidato pasa a seis etapas. La etapa 2 es `Contanos con tus palabras · voz o texto`.
- El candidato puede hablar con el reconocimiento de voz disponible en el navegador o escribir/usar el micrófono del teclado del celular.
- Talento PyME no conserva el audio original.
- Se guardan dos campos: transcripción y presentación profesional revisada/aprobada.
- El asistente de redacción elimina muletillas, ordena el relato por actividad reciente, experiencia/fortalezas, objetivo laboral e información adicional, sin inventar antecedentes.
- El candidato puede editar manualmente la versión sugerida antes de guardarla.
- Se agrega `Guardar y seguir después`, permitiendo conservar datos personales + presentación y completar experiencia, formación, CV y foto más adelante.
- La clasificación administrativa incorpora el contenido de esta presentación para mejorar la detección de categoría y expertise.
- La ficha administrativa muestra la presentación aprobada y la transcripción original.
- Las empresas pueden utilizar la presentación profesional aprobada dentro del circuito de búsqueda/detalle, pero no reciben la transcripción cruda.

## 4. CV PDF del candidato

- Se agrega `Descargar mi CV PDF` en Mi Perfil.
- El PDF se regenera en cada descarga con los datos actuales guardados.
- Si existen cambios en edición, se guardan antes de generar el documento.
- Diseño universal de una página: barra lateral azul oscuro + cuerpo claro.
- Con foto: se utiliza la foto cargada por el candidato.
- Sin foto: se dibuja una silueta neutra para mostrar visualmente el espacio disponible.
- Secciones: Sobre mí, Contacto, Perfil, Competencias, Perfil profesional, Experiencia y trayectoria, Formación, Certificaciones y capacitación.
- La presentación por voz/texto puede complementar el CV cuando el currículum original es escaso.
- El archivo utiliza nombre cronológico `YYMMDD-HHmm CV-Nombre-Apellido-Talento-PyME.pdf`.

## 5. Base de datos y compatibilidad

Se agregan únicamente campos nullable a `CandidateBolsa`:

- `paisResidencia`
- `voiceNarrativeRaw`
- `voiceNarrativeSummary`

El `prestart` existente ejecuta `prisma db push`, por lo que Render aplicará la ampliación en el deploy. No se elimina ni reinicia información existente.

## 6. Privacidad

- El reporte ejecutivo sigue siendo agregado y anonimizado.
- La voz original no se conserva en Talento PyME.
- La transcripción cruda queda reservada al candidato y Administración.
- El CV PDF se entrega únicamente al candidato autenticado.
- El país/ciudad de residencia sólo se agrega al reporte en forma estadística.

## 7. Validación

- 76 pruebas automáticas: aprobadas.
- 25 archivos JavaScript: validación sintáctica correcta.
- 16 scripts JavaScript embebidos en HTML: validación sintáctica correcta.
- Frontend/PWA/API: versión 7.9.3.
- No quedan referencias ejecutables a v7.9.2.
- No queda la etiqueta `Actividad general` en la aplicación ejecutable.

Nota de entorno de auditoría: el registro npm disponible en el contenedor de validación no permitió descargar `@prisma/client`, por lo que no fue posible ejecutar localmente una instalación limpia de dependencias ni renderizar el PDF mediante el servicio Node. El código de generación PDF fue validado sintácticamente y la dependencia `pdfkit`, ya utilizada por el módulo de reportes de v7.9.2, permanece declarada. El deploy de Render instalará las dependencias como en la versión anterior.
