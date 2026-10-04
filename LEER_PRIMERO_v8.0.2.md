# Talento PyME v8.0.2

Revisión centrada en clasificación práctica de Aprendices, búsqueda guiada y lectura real de capacidad.

- Aprendices sin formación declarada: si la persona escribió tareas o saberes concretos, se orienta como Aprendiz cocina/gastronomía, limpieza/maestranza, cuidado de personas, atención al cliente/ventas, logística/depósito, construcción/albañilería, seguridad/vigilancia, producción, electricidad, mecánica, mantenimiento general, pintura, jardinería, costura/textil, conducción/reparto, peluquería/estética o administrativo.
- Si no existe ninguna evidencia concreta, se conserva Aprendiz – estudios secundarios no declarados. No se inventa una especialidad.
- Las nuevas orientaciones forman parte del buscador y del desglose de Trazabilidad.
- Buscar en Administración y Empresa desplaza la pantalla al primer resultado y lo destaca brevemente.
- Acceso inicial: el selector superior dice “Ya tengo cuenta”; el botón de acción conserva “Ingresar”.
- Capacidad operativa: el semáforo se calcula contra una capacidad segura estimada de candidatos usando el tamaño real de PostgreSQL, candidatos actuales y una reserva preventiva del 20%. El proveedor se detecta desde DATABASE_URL (Neon cuando corresponde).

No requiere migración nueva de Neon. Desplegar primero API y luego sitio web.
