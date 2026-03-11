# Factory Admin · configuración en Render

## Variables de entorno a crear

En el servicio API de Render, agregá estas variables:

- `FACTORY_SUPERADMIN_KEY`
  - ejemplo: `TalentoPyME-Factory-2026!`
  - esta clave habilita la consola **Factory Admin** desde el lado empresa.

- `FACTORY_SUPPORT_EMAIL`
  - ejemplo: `factory@gmail.com`
  - este mail se muestra en el panel Factory para consultas.

## Cómo cargarla en Render

1. Entrá a tu servicio API en Render.
2. Abrí **Environment**.
3. Elegí **Add Environment Variable**.
4. Creá `FACTORY_SUPERADMIN_KEY` con la clave que quieras usar.
5. Creá `FACTORY_SUPPORT_EMAIL` con el mail de soporte.
6. Guardá los cambios.
7. Ejecutá un **Manual Deploy** o esperá el redeploy automático.

## Cómo usarla en la app

1. Ingresá con la empresa.
2. Abrí **Factory**.
3. En el bloque **Superadministración**, escribí la clave.
4. Tocá **Habilitar**.
5. Se abrirá la pestaña **Factory Admin**.

## Qué permite Factory Admin

- modificar la matriz de planes:
  - días
  - precio
  - publicaciones
  - búsquedas
- crear códigos de bonificación
- crear códigos de acceso total free por empresa con vencimiento por mes
- revisar empresas y facturación agrupada

## Importante

- si no cargás `FACTORY_SUPERADMIN_KEY`, la consola admin no se habilita
- los cambios de planes y códigos se guardan en base de datos
- esta revisión requiere correr `npx prisma generate` y `npx prisma db push --accept-data-loss`
