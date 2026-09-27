# Auditoría Talento PyME v7.10.1 — calibración contra 509 candidatos reales

**Fecha:** 27/09/2026  
**Base de trabajo:** v7.10.0, comparada contra producción v7.9.16.  
**Estado:** revisión candidata; **no desplegada**. Neon y la v7.9.16 de producción no fueron modificados.

## 1. Objetivo

La v7.10.0 corrigió la inflación de perfiles de v7.9.16, pero la prueba contra el padrón real reveló falsos negativos: antecedentes auténticos quedaban como “Información profesional por completar”, “Orientación laboral por definir” o sin puntaje aun cuando el CV describía tareas concretas. La v7.10.1 calibra el motor con esos 509 casos reales sin volver a premiar longitud, repetición o texto generado.

## 2. Banco de prueba real

Se utilizó una copia saneada del backup lógico de Neon correspondiente a **509 candidatos**. El archivo original de producción no se alteró. Para la auditoría se retiraron credenciales, hashes, seguridad, facturación y demás información ajena a la clasificación.

Cada candidato fue ejecutado localmente por el clasificador de v7.9.16 y por el de v7.10.1. Resultado técnico: **509/509 procesados, 0 errores del motor**.

## 3. Cambios principales en v7.10.1

- Se amplía la detección de experiencia real para comercio/atención al cliente, logística, administración, finanzas, RR.HH., compras, seguridad/vigilancia, limpieza/maestranza, gastronomía, salud/emergencias, cuidados, educación, construcción/obra, producción, mantenimiento, ingeniería, proyectos, planificación, laboratorio, IT, instrumentación, electricidad, mecánica y soldadura/montaje.
- Se prioriza la actividad reciente y las tareas efectivamente declaradas. Antecedentes históricos siguen siendo buscables, pero no desplazan automáticamente el rol actual.
- Presentaciones ampliadas por IA, listas generadas de habilidades y aspiraciones **no acreditan experiencia**.
- Un cargo aislado como “senior”, “gerente” o “supervisor” no alcanza por sí solo para inventar antigüedad. Supervisión/Gerencia pueden definir familia de perfil cuando están declaradas, pero el nivel queda separado de esa etiqueta.
- Ayudante/auxiliar conserva el carácter de asistencia y no se transforma en especialista autónomo por cantidad de años.
- Se incorporan fechas laborales con año, mes/año en español y fecha completa. Los períodos solapados no se duplican.
- Se corrige un hallazgo del padrón real: fechas escolares o de formación mezcladas antes del bloque “Experiencia laboral” podían contaminar la antigüedad. Ahora se recorta la sección y se detiene el conteo al entrar nuevamente en educación/formación/habilidades.
- Primer empleo exige señal explícita y no se deduce por edad, DNI o falta de datos.
- La búsqueda administrativa/empresarial se mantiene vinculada al perfil calculado y a la evidencia profesional real.

## 4. Resultado comparativo sobre los 509 candidatos

### v7.9.16
- **306 Senior**.
- Mediana de puntaje disponible: **83/100**.
- La clasificación tendía a elevar trayectoria y seniority con señales demasiado amplias.

### v7.10.0
- Había corregido la inflación, pero se había vuelto demasiado restrictiva.
- **273** candidatos quedaban en “Información profesional por completar”.
- **447** quedaban en “Nivel por verificar”.
- Sólo **234** tenían puntaje.
- **277** quedaban con “Orientación laboral por definir”.
- Mediana del puntaje disponible: **20/100**.

### v7.10.1
- **215** quedan en “Información profesional por completar” (58 menos que v7.10.0).
- **202** quedan como Operativos / Oficios.
- **33** Técnicos / Especialistas.
- **30** Administrativos / Gestión.
- **12** Supervisión / Jefaturas.
- **8** Profesionales / Ingeniería.
- **4** Gerencia / Dirección.
- **3** Trayectoria no determinada.
- **2** Aprendices / Pasantes / Primer empleo.
- **286** candidatos obtienen puntaje (52 más que v7.10.0).
- **223** quedan sin puntaje, en vez de 275 en v7.10.0.
- Mediana del puntaje disponible: **25/100**.
- **3 Senior provisional**, frente a 306 Senior de v7.9.16.
- **381 Nivel por verificar**, 47 Intermedio provisional, 47 Junior provisional, 29 Junior/asistencia, 3 Senior provisional y 2 Inicial/aprendiz.
- La orientación general baja de aproximadamente **279 a 225** registros respecto de v7.10.0.

La v7.10.1 cambia respecto de v7.10.0 la clase de 101 candidatos, la especialidad de 141, el nivel de 98 y el puntaje de 188. El objetivo de esos cambios es recuperar evidencia laboral verdadera sin volver al sesgo de inflación de v7.9.16.

## 5. Pruebas

- **509/509 candidatos reales**: comparación local completada sin errores de clasificación.
- **214/214 pruebas de regresión no-auth**: aprobadas.
- Dentro de esa suite, **94/94 pruebas focalizadas en clasificación, seniority, búsqueda y patrones reales**: aprobadas.
- La prueba `auth-v7100.test.js` no pudo ejecutarse en este entorno porque el paquete local `node_modules/bcryptjs` quedó sin sus archivos durante la extracción/instalación offline. El fallo es `ERR_MODULE_NOT_FOUND` antes de iniciar la prueba; no es un fallo funcional de autenticación observado. No se sustituyó bcrypt por una implementación simulada.

## 6. Límites pendientes antes de producción

Esta revisión **no debe interpretarse como desplegada ni certificada en producción**. Continúan pendientes:

1. comprobación gráfica en navegador de escritorio y móvil;
2. prueba del flujo de autenticación con instalación completa de dependencias (`npm ci`) en un entorno con red o en Render;
3. verificación final de login flexible, recuperación, fichas y búsquedas desde los tres roles;
4. revisión humana de una muestra de perfiles extremos o ambiguos;
5. despliegue controlado recién después de esas verificaciones.

## 7. Seguridad y datos

El ZIP de la aplicación no contiene el backup de Neon ni el JSON con los 509 candidatos. Tampoco debe contener `.env`, contraseñas, hashes, `DATABASE_URL` real ni secretos. La calibración se efectuó sobre una copia local saneada.

## 8. Conclusión técnica

La v7.10.1 es una mejora material sobre v7.10.0: recupera experiencia concreta detectada en el padrón real y mantiene un criterio mucho más exigente que v7.9.16. Es una **candidata de cierre**, no una versión para desplegar todavía. El siguiente control debe ser funcional/gráfico, no una nueva reclasificación masiva a ciegas.
