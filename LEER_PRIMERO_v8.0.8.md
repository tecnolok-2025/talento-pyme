# LEER PRIMERO · Talento PyME v8.0.8

Esta revisión parte de **v8.0.7** y consolida el circuito de respuesta general a consultas.

## Qué cambia

- El grupo especial pasa a llamarse **Candidatos con consultas pendientes · App + Email**.
- La guía general se construye con todas las preguntas pendientes recibidas por **Ayuda IA** y por **email**.
- Se informan por separado consultas APP, EMAIL, temas cubiertos y consultas nuevas.
- Una consulta ya respondida individualmente, o con una guía general enviada/programada después de la última pregunta, deja de mostrarse en **Chat operador**.
- Si el candidato vuelve a consultar después, el hilo reaparece automáticamente.
- Los rebotes y mensajes automáticos de Gmail no se muestran como consultas del operador.
- No se modifica score, clasificación profesional, CV ni semáforos.

## Instalación

1. Partir de v8.0.7.
2. Subir el contenido del parche respetando carpetas.
3. Commit en GitHub.
4. Desplegar primero `talento-pyme-api`.
5. Desplegar luego `talento-pyme`.
6. Recargar el navegador para tomar la v8.0.8.

**No requiere una nueva migración de Neon.**
