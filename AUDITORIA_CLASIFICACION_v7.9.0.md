# Auditoría de clasificación administrativa — Talento PyME v7.9.1

## Alcance
Revisión funcional y de regresión de la evolución solicitada para **Perfiles candidatos**, **Perfiles empresas** y **Trazabilidad**, tomando como base la v7.8.15 y preservando todos los cambios de seguridad, recuperación por correo y privacidad ya incorporados.

## 1. Candidatos — clasificación administrativa total

### Categoría principal
Ningún candidato queda bajo una etiqueta “Pendiente de clasificar”. El sistema intenta integrarlo en una de las siguientes familias administrativas:

- Aprendices / Pasantes / Primer empleo
- Operativos / Oficios
- Técnicos / Especialistas
- Supervisión / Jefaturas
- Profesionales / Ingeniería
- Gerencia / Dirección
- Administrativos / Gestión

Cuando la información es escasa, el perfil se integra como perfil inicial/aprendiz en lugar de quedar fuera del directorio.

### Expertise / subcategoría
Dentro de cada familia se agrupa por expertise. El catálogo cubre Mecánica, Eléctrica, Producción/Operaciones, Mantenimiento, Soldadura/Montaje/Calderería, Instrumentación/Automatización, Ingeniería/Oficina técnica, Construcción, Planificación/Costos, Calidad/HSE, Logística/Transporte/Comex, Administración, RR.HH., Finanzas, Comercial, Compras, Ambiente, IT, Laboratorio, Energía y Proyectos.

Si el perfil informa una especialidad no contemplada, se genera una **subcategoría dinámica** (`EXP_*`) con una etiqueta legible derivada de la información profesional disponible. Esto evita utilizar “Pendiente” como depósito de perfiles distintos.

### Prioridad de la actividad reciente
La clasificación pondera con mayor fuerza:
1. Último trabajo informado.
2. Titular profesional, especialidad y área actual.
3. Experiencia reciente / resumen de CV.
4. Resto de la trayectoria.

Se incorporó una prueba específica donde un candidato con actividad reciente en Producción y antecedentes históricos en Logística permanece clasificado en Producción.

## 2. Índice de trayectoria 0–100

La ficha y el directorio administrativo muestran un **Índice de trayectoria** junto al nombre de cada candidato. Los tramos visuales son:

- 0–24: Aprendiz / Pasante
- 25–49: Junior
- 50–74: Semi-senior
- 75–100: Senior

El cálculo se ejecuta en cada lectura administrativa y, por lo tanto, se actualiza cuando cambian el perfil o el contenido curricular disponible.

### Evidencia permitida en el indicador
- Rango de experiencia declarado.
- Responsabilidad de supervisión, coordinación, gerencia o dirección detectada en la trayectoria profesional.
- Señales explícitas de seniority cuando el CV las informa.
- Situación laboral actual informada.
- Formación terciaria/universitaria.
- Capacitaciones y certificaciones.
- Profundidad del resumen y experiencia curricular.

### Exclusiones expresas
El cálculo no utiliza edad, fotografía, género, nacionalidad, estado civil, hijos, domicilio, sueldo pretendido ni otros atributos personales sensibles. Tampoco se utiliza como recomendación automática de contratación: es una lectura administrativa orientativa de **trayectoria profesional**, destinada a acelerar la revisión humana del CV.

## 3. Empresas — actividad principal

Las empresas siguen organizadas en las tres familias solicitadas:

- Fabricación
- Logística
- Servicio

Cada familia muestra cantidad y, al abrirse, contiene subgrupos de **actividad principal** con sus propios contadores. La inferencia prioriza la descripción institucional/nombre/sitio y utiliza las búsquedas publicadas únicamente como respaldo.

Cuando aparece una actividad no incluida en el catálogo, se genera una etiqueta dinámica a partir de la descripción disponible. No se presenta una categoría “Pendiente de clasificar”. La corrección manual de la familia continúa disponible y persistida en `CompanyProfile.adminCategory`.

## 4. Trazabilidad

Se agregó una lectura general de composición con tres bloques:

1. Candidatos por expertise.
2. Empresas por familia (Fabricación / Logística / Servicio).
3. Empresas por actividad principal.

El nivel individual Aprendiz/Junior/Semi-senior/Senior no se agrega a esta vista general, siguiendo el criterio solicitado de medir qué tipo de talento y qué tipo de empresas está incorporando la plataforma.

## 5. Privacidad

La clasificación avanzada, el índice 0–100 y los contadores de composición son **exclusivamente administrativos**. Se ejecutó un escaneo de las pantallas públicas y no se encontraron referencias a `profileScore`, `classificationComposition`, `seniorityLabel`, `candidateScoreBadge` ni `companiesByFamily` fuera de Administración.

## 6. Base de datos y compatibilidad

- v7.9.1 no agrega campos nuevos respecto de v7.8.15.
- Se reutiliza `CompanyProfile.adminCategory`, ya incorporado en la versión anterior.
- No hay migraciones destructivas.
- No se borran candidatos, empresas, perfiles, CV, postulaciones, búsquedas ni documentos comerciales.
- Gmail, `FACTORY_SUPPORT_EMAIL`, `GMAIL_APP_PASSWORD`, recuperación de contraseña y configuración Starter no requieren cambios por esta versión.

## 7. Validación final

- Pruebas Node: **58/58 aprobadas**.
- Archivos JavaScript verificados con `node --check`: **21**.
- Scripts inline HTML verificados: **16**.
- Referencias antiguas 7.8.15 dentro del código ejecutable: ninguna.
- “Pendiente de clasificar” en código ejecutable: ninguno.
- Exposición de campos administrativos en pantallas públicas: ninguna detectada.
- Secretos Gmail hardcodeados: ninguno detectado.
- Versión UI / API / PWA: **7.9.1**.
