# Parche acumulativo Talento PyME v9.1.3 → v9.1.4

Incluye los cambios de mantenimiento y consulta administrativa de bienvenida preparados para v9.1.4, más la reducción conservadora de tareas periódicas de base de datos.

## Frecuencias
- Clasificación periódica de perfiles: 12 horas (se mantiene la clasificación inmediata por evento y el barrido completo diario).
- Sincronización automática de la bandeja: 12 horas; la sincronización manual sigue disponible.
- Recuperación de la cola de correos: 12 horas; la cola sigue iniciándose al recibir nuevos trabajos.
- Revisión de respaldos: se conserva cada 6 horas; la generación del respaldo sigue siendo diaria.

Las frecuencias mínimas se aplican incluso si Render conserva variables de entorno anteriores con valores de 6 horas. No se cambian datos, esquema, migraciones, contraseñas ni configuraciones existentes. No ejecutar comandos de migración para instalar esta versión.
