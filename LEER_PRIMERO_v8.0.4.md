# Talento PyME v8.0.4

## Objetivo
Esta revisión fortalece el seguimiento de consultas realizadas por candidatos en **Ayuda IA** y permite responderlas en forma general, detallada y sin repetir envíos innecesarios.

## Cambio principal
En **Correo / Consultas → Comunicación a candidatos → Grupo general de candidatos** se agrega:

**Detalles de respuestas solicitadas por candidatos**

Este grupo es dinámico:
- incluye a candidatos que hicieron al menos una consulta en Ayuda IA;
- excluye a quienes ya tienen programada o enviada una guía posterior a su última consulta;
- si el mismo candidato vuelve a preguntar después, reaparece automáticamente;
- respeta bajas de comunicaciones.

## Guía ampliada
Al seleccionar el grupo, Administración prepara automáticamente una guía general con explicaciones más completas según los temas realmente consultados: perfil, punto 2 y Corrección IA, foto, CV, visibilidad, búsquedas, oportunidades y postulaciones.

## Memoria de Ayuda IA
Se amplía la base de conocimiento interna con respuestas detalladas sobre:
- foto de perfil;
- carga y formatos de CV;
- uso del punto 2 y Corrección IA profesional;
- palabras clave y visibilidad;
- búsquedas sin resultados;
- tareas e intereses para candidatos con poca experiencia formal.

## Base de datos
No requiere una migración nueva de Neon/PostgreSQL. La trazabilidad utiliza `SupportThread`, `SupportMessage`, `AdminCommunication` y `AdminCommunicationRecipient` ya existentes.

## Instalación
1. Subir los archivos del parche respetando carpetas.
2. Commit en GitHub.
3. Deploy de `talento-pyme-api`.
4. Deploy del sitio estático `talento-pyme`.
5. Verificar que la pantalla indique **v8.0.4**.
