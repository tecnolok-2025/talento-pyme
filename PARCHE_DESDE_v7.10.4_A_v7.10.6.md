# Parche v7.10.4 -> v7.10.6

Este parche está pensado para el repositorio que actualmente ejecuta v7.10.4.

## Uso simple

1. Hacer una copia del repositorio actual.
2. Extraer el ZIP del parche sobre la raíz del proyecto, permitiendo reemplazar los archivos coincidentes.
3. Subir/commitear los cambios al mismo repositorio usado por Render.
4. Render ejecutará `npm start` y aplicará automáticamente las migraciones aditivas.
5. Confirmar en el log: `Talento PyME API escuchando ... (v7.10.6)`.

No hace falta instalar v7.10.5 previamente.

El parche no contiene `.env`, claves, bases de datos ni backups de producción.
