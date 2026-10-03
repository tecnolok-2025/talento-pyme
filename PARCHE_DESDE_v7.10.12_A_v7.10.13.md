# Parche v7.10.12 → v7.10.13

1. Reemplazar los archivos incluidos respetando carpetas.
2. Subir a GitHub.
3. Hacer deploy de API y Static Site en Render.
4. La API ejecutará la migración aditiva de `secondaryProfiles`.
5. Al iniciar, el motor `7.10.13` detectará las clasificaciones antiguas y recalificará el padrón.
6. Verificar `/health` y la versión visible `v7.10.13`.

No se modifica el texto original de los CV ni se borran candidatos.
