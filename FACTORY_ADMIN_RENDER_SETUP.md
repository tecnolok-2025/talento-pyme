# Factory Admin · configuración en Render (v5.5.12)

Configurá estas variables en el servicio **API** de Render:

- `FACTORY_ADMIN_ALIAS`
- `FACTORY_ADMIN_PASSWORD`
- `FACTORY_SUPPORT_EMAIL`

## Sugerencia práctica

- `FACTORY_ADMIN_ALIAS=TalentoPyme`
- `FACTORY_ADMIN_PASSWORD=tu_clave_superadmin`
- `FACTORY_SUPPORT_EMAIL=talentopyme00@gmail.com`

## Pasos

1. Entrá a Render.
2. Abrí el servicio `talento-pyme-api`.
3. Entrá a **Environment**.
4. Creá `FACTORY_ADMIN_ALIAS` con el nombre de fantasía que quieras usar.
5. Creá `FACTORY_ADMIN_PASSWORD` con la clave que quieras usar.
6. Creá `FACTORY_SUPPORT_EMAIL` con el mail de soporte.
7. Guardá.
8. Hacé **Redeploy**.

## Cómo ingresar

1. Entrá a Talento PyME como **Empresa**.
2. Abrí **Factory**.
3. En el bloque **Factory Admin** escribí el nombre Factory y la clave de acceso.
4. Tocá **Ingresar**.
5. Se habilita el panel **Factory Admin**.

## Compatibilidad

`FACTORY_SUPERADMIN_KEY` queda soportada solo como compatibilidad, pero desde esta revisión la forma recomendada es usar alias + clave.
