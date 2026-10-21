# Parche acumulativo v9.1.2 → v9.1.3

Aplicar sobre la carpeta raíz del proyecto, conservando los demás archivos. Reemplaza únicamente: `apps/api/src/index.js`, `apps/api/package.json`, `apps/web/admin.html`, `apps/web/config.js`, `apps/web/sw.js` y `CURRENT_VERSION.txt`.

No reemplazar la base de datos. No ejecutar migraciones, `prisma db push` ni comandos de restauración.
