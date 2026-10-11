# Parche Talento PyME v9.0.0 → v9.1.0

Aplicar solamente sobre una instalación v9.0.0.

El parche contiene middleware de seguridad, actualización de versión/cache y documentación. No contiene migraciones SQL.

Después de copiarlo:
1. desplegar API;
2. desplegar Web;
3. verificar `/health` y confirmar versión 9.1.0;
4. probar login de un candidato y una empresa;
5. probar una búsqueda de empresa y descarga de CV para confirmar regresión funcional.

Variable opcional nueva en Render: `SECURITY_ALLOWED_ORIGINS`. Dejar vacía si sólo se usa `https://talento-pyme.onrender.com`.
