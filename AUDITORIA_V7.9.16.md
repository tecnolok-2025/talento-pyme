# Auditoría Talento PyME v7.9.16

## Objetivo
Evitar que candidatos con información profesional incompleta queden incorrectamente agrupados como Primer empleo/Pasante, sin utilizar edad, DNI, nacionalidad o condición migratoria para estimar experiencia.

## Cambios auditados
- Nuevo grupo: `TRAYECTORIA` → **Perfil profesional / Trayectoria no determinada**.
- `GENERAL` → **Perfil general / Expertise no determinado**.
- Primer empleo exige señal explícita y ausencia de evidencia contradictoria.
- Se reconocen señales de conducción empresarial: empresario/a, fundador/a, socio/a gerente y titular de empresa.
- Esas señales pueden sostener Semi-senior cuando el resto del contenido profesional las respalda.
- DNI alto/bajo no altera la salida de clasificación.
- No se usa edad, fecha de nacimiento, nacionalidad ni datos migratorios.

## Validaciones
- Suite Node: **168/168 pruebas aprobadas**.
- JavaScript: **39/39 archivos con sintaxis válida**.
- HTML: **18 archivos revisados; 17 scripts inline cubiertos por la suite**.
- Frontend/API/PWA: **7.9.16**.
- Build PWA: **20260811_02**.
- `schema.prisma`: sin cambios funcionales respecto de v7.9.15.

## Casos específicos incorporados a pruebas
- DNI alto vs. DNI bajo con idéntica experiencia → misma clasificación.
- Perfil empresarial sin años declarados pero con rol de socio gerente y responsabilidades → al menos Semi-senior y grupo gerencial.
- Perfil profesional insuficiente → Trayectoria no determinada, nunca Primer empleo por defecto.
- Primer empleo explícito → conserva Aprendiz/Pasante cuando no existe evidencia que lo contradiga.
