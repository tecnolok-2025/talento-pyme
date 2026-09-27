# LEER PRIMERO — Talento PyME v7.10.3

## Estado

**NO DESPLEGADA.** La v7.9.16 y Neon de producción permanecen sin modificaciones por esta revisión.

La v7.10.3 conserva el motor automático de v7.10.2 y corrige la interpretación temporal de antecedentes laborales usando el padrón real actualizado de **513 candidatos**.

## Corrección principal

La auditoría de los cuatro candidatos incorporados después del padrón de 509 detectó que algunos CV expresaban la antigüedad con formatos que v7.10.2 no vinculaba correctamente al puesto, por ejemplo:

- `01/2024 - 06/2026`;
- `04/24 - Actualidad`;
- `Mar 2025 - Jul 2026`;
- fechas completas `10/01/2025 - 05/06/2025`;
- períodos ubicados al final de varias tareas del mismo puesto.

v7.10.3 reconoce esos formatos, separa las fechas educativas de las laborales, evita el doble conteo de rangos más precisos y exige que la experiencia total nunca quede por debajo de la experiencia relevante de la especialidad.

## Casos reales que motivaron el ajuste

- **Leonardo Dybiec:** Ingeniería / Oficina técnica. El período `01/2024 - 06/2026` y el antecedente `10/2023 - 01/2024` quedan reconocidos; la propuesta pasa de duración no determinada a aproximadamente **2,7 años relevantes**, nivel **Junior provisional**.
- **Iris Abril Perez:** Recursos Humanos. El período `Mar 2025 - Jul 2026`, ubicado después de varias tareas, queda vinculado al bloque de RR.HH.; aproximadamente **1,3 años relevantes**, manteniendo **Junior / asistencia**.
- **Cristian Daniel Castillo** y **Camila Conte:** conservan la orientación obtenida en v7.10.2; no se fuerza experiencia donde no existe evidencia suficiente.

## Regresión sobre los 513 candidatos

v7.10.2 y v7.10.3 fueron ejecutadas sobre exactamente el mismo backup lógico de 513 candidatos:

- 513 procesados;
- 0 errores;
- **0 cambios de clase**;
- **0 cambios de especialidad**;
- 29 cambios de nivel derivados de antigüedad ahora verificable;
- 31 cambios de puntaje;
- 50 cambios en años relevantes;
- Senior provisional: 3 → 4;
- Nivel por verificar: 382 → 358.

El único Senior adicional es un caso con trayectoria extensa y fechas laborales verificables; no se produjo un retorno a la inflación de seniority de v7.9.16.

## Clasificación automática

Se verificó el pipeline real de v7.10.3 contra los 513 registros con persistencia simulada:

- 513 revisados;
- 513 clasificados;
- 0 errores;
- 6 lotes de hasta 100;
- 0 diferencias semánticas entre clasificación directa y automática;
- segunda pasada sin cambios: 0 reclasificados y 513 omitidos por fingerprint/versionado.

Por lo tanto, el mismo criterio queda preparado para seguir trabajando automáticamente a medida que crece la base, incluida una futura importación masiva desde Ecoempleo una vez mapeados sus campos al modelo de Talento PyME.

## Pruebas

- 26/26 pruebas específicas de fechas y patrones reales: aprobadas.
- Suite completa: 228 pruebas detectadas; **227 aprobadas**.
- La única prueba no ejecutable localmente es `auth-v7100.test.js` porque este entorno no tiene instalado `bcryptjs`. La dependencia sigue declarada en `apps/api/package.json`; no se sustituyó ni se simuló esa prueba.

## Antes de desplegar

Todavía falta la verificación funcional y gráfica final de ingreso, recuperación, candidato, empresa, administración, ficha breve, búsquedas y responsive. Hasta finalizar ese control, conservar v7.9.16 en producción.
