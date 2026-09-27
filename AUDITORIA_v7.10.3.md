# Talento PyME — Auditoría v7.10.3

Fecha de revisión: 27/09/2026

## Objetivo

Corregir la lectura de períodos laborales detectada al validar los cuatro candidatos incorporados entre los backups de 509 y 513 registros, manteniendo intactas la automatización, la clasificación por antecedentes y las protecciones contra inflación de experiencia.

Neon y la v7.9.16 de producción no fueron modificados durante esta auditoría.

## Cambios del motor

1. Se amplió el reconocimiento de períodos laborales a mes/año numérico, año abreviado, meses escritos y fechas completas.
2. Se normalizan distintos guiones usados por PDFs y CVs.
3. Se evita contar dos veces un rango cuando una fecha completa o mes/año ya contiene los mismos años.
4. Se preserva la separación entre fechas educativas y laborales.
5. Se agregó asociación de proximidad acotada para períodos que aparecen después de varias tareas del mismo puesto, cortando la búsqueda cuando aparece un nuevo cargo fuerte.
6. La experiencia relevante de una especialidad pasa a ser un piso lógico para la experiencia total: el total no puede quedar por debajo de un período laboral que ya fue verificado para esa especialidad.
7. Se amplió el reconocimiento de expresiones de atención y asesoramiento al cliente para evitar una regresión de clasificación detectada durante la prueba; con ello v7.10.3 conserva las mismas clases y especialidades de v7.10.2 en los 513 casos.

## Validación sobre el padrón real de 513

Comparación v7.10.2 → v7.10.3:

- total: 513;
- errores: 0;
- cambios de clase: 0;
- cambios de especialidad: 0;
- cambios de seniority: 29;
- cambios de puntaje: 31;
- cambios en experiencia total detectada: 47;
- cambios en experiencia relevante: 50;
- Senior provisional: 3 → 4;
- Intermedio provisional: 48 → 56;
- Junior: 78 → 93;
- Nivel por verificar: 382 → 358.

La corrección no altera la familia ocupacional ni la especialidad ya calibradas. Los cambios se concentran donde ahora existe duración laboral verificable.

## Cuatro candidatos nuevos

### Cristian Daniel Castillo

- Clase: Operativos / Oficios.
- Especialidad: Logística / Depósito.
- Nivel: Intermedio provisional.
- Puntaje: 45.
- Experiencia relevante: 6 años.
- Resultado automático equivalente al directo.

### Camila Conte

- Clase: Información profesional por completar.
- Especialidad: Orientación laboral por definir.
- Nivel: Nivel por verificar.
- Sin puntaje ni antigüedad inventada.
- Resultado automático equivalente al directo.

### Leonardo Dybiec

- Clase: Profesionales / Ingeniería.
- Especialidad: Ingeniería / Oficina técnica.
- v7.10.2: duración relevante no determinada.
- v7.10.3: aproximadamente 2,7 años relevantes, Junior provisional, puntaje 25.
- Se reconocen `01/2024 - 06/2026` y `10/2023 - 01/2024`.
- Resultado automático equivalente al directo.

### Iris Abril Perez

- Clase: Administrativos / Gestión.
- Especialidad: Recursos Humanos.
- v7.10.2: duración relevante no determinada.
- v7.10.3: aproximadamente 1,3 años relevantes, Junior / asistencia, puntaje 25.
- Se vincula `Mar 2025 - Jul 2026` al bloque de RR.HH. aunque el período aparezca después de varias tareas.
- El rango anual posterior no se utiliza para inflar ese puesto.
- Resultado automático equivalente al directo.

## Pipeline automático real sobre 513

La función real de clasificación, fingerprint y persistencia se ejecutó con un Prisma simulado, sin conexión de escritura a Neon:

- primera pasada: 513 escaneados, 513 clasificados, 0 omitidos, 0 errores;
- 6 transacciones de lote;
- 0 diferencias semánticas entre salida directa y datos persistidos;
- segunda pasada sin cambios: 513 escaneados, 0 clasificados, 513 omitidos, 0 errores.

Esto valida que el comportamiento automático usa el mismo resultado que la clasificación directa y que el fingerprint evita recálculos innecesarios.

## Escala y crecimiento

Se mantiene el diseño de v7.10.2:

- cola inmediata por eventos;
- revisión incremental cada 60 segundos;
- barrido completo cada 6 horas;
- barrido inicial tras el arranque;
- lotes configurables, por defecto 100;
- reintento individual si una transacción de lote falla;
- versión y fingerprint por candidato.

La cantidad 513 no está fijada en el código. El proceso trabaja contra el padrón existente en cada ejecución.

## Pruebas automatizadas

Pruebas específicas de fechas y patrones reales: **26/26 aprobadas**.

Suite completa: 228 pruebas detectadas, 227 aprobadas. La única falla corresponde a `auth-v7100.test.js`, que no puede cargar `bcryptjs` en este entorno local. `bcryptjs` permanece declarado como dependencia de la API. No se modificó la autenticación para eludir la prueba.

## Estado

v7.10.3 queda como candidata técnica para la verificación funcional y gráfica integral. **No desplegar todavía** hasta completar ese control.
