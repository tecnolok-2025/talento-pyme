# LEER PRIMERO · Talento PyME v8.0.10

Instalar sobre **v8.0.9**.

## Qué cambia
- Correos recuperables e historial: una sola entrada por asunto, conservando la versión más reciente.
- Administración → Trazabilidad: buscador de candidatos/empresas y tilde **Ocultar de búsquedas**.
- El tilde está desmarcado por defecto y es reversible.
- Candidatos ocultos no aparecen en Buscar Talento.
- Empresas ocultas no muestran sus oportunidades a candidatos.

## Instalación
1. Subir el parche a GitHub y hacer commit.
2. Desplegar primero `talento-pyme-api` para ejecutar la migración aditiva.
3. Esperar el deploy completo del API.
4. Desplegar `talento-pyme`.
5. En Administración → Trazabilidad, buscar el perfil de prueba y marcar **Ocultar de búsquedas**.

No se eliminan datos ni se modifica el score o la clasificación profesional.
