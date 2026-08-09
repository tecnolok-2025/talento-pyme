# Auditoría Talento PyME v7.9.7

## Objetivo
Corregir definitivamente la voz narrativa del CV y convertir la función “Corrección IA profesional” en una verdadera asistencia de redacción para el candidato: primera persona, vocabulario técnico coherente con el rol, fortalezas concretas, motivación y proyección profesional, manteniendo la posibilidad de edición manual.

## Cambios auditados

### 1. Voz del candidato
- El prompt de IA exige primera persona.
- Se prohíben expresiones de evaluación externa como “el candidato”, “su perfil”, “la experiencia declarada permite identificar”, “el relato evidencia” o equivalentes.
- El analizador local de respaldo también usa primera persona.

### 2. Enriquecimiento técnico
- Se amplió la biblioteca de conocimiento contextual por profesión/expertise.
- El apoyo técnico se utiliza sólo cuando es compatible con lo declarado.
- No se atribuyen logros, empresas, certificaciones, software, normas, cantidades, presupuestos ni resultados no declarados.
- En tareas típicas no expresamente detalladas, el prompt exige formulación prudente y no afirmación de un antecedente concreto.

### 3. Aptitudes y fortalezas
- La IA devuelve exactamente 10 propuestas cuando responde correctamente.
- El respaldo local construye hasta 10 fortalezas coherentes con el rol detectado.
- Son editables; el candidato puede borrar o reemplazar las que no representen su experiencia.

### 4. Motivación según seniority
- Aprendiz / primer empleo: aprendizaje, primera experiencia y desarrollo progresivo.
- Junior: consolidación de práctica, aprendizaje y responsabilidades crecientes.
- Semi-senior: autonomía, mayor alcance y profundización de conocimientos.
- Senior: aporte de experiencia, desafíos de mayor alcance, transferencia de conocimiento y evolución profesional.
- Si la persona declara que trabaja actualmente, la redacción evita presentarla como desempleada.

### 5. Cierre profesional
- Se genera en primera persona.
- Integra expertise, aporte y proyección.
- Queda editable por el candidato.

### 6. PDF de CV
- “Sobre mí” mantiene una síntesis breve en la franja lateral.
- “Perfil profesional” desarrolla la presentación principal.
- Se incorporan “Aptitudes y fortalezas profesionales” y “Motivación y proyección profesional”.
- Se agregó continuidad multipágina cuando el contenido requiere más espacio.
- Pie de página: “CV preparado por el candidato con asistencia de Talento PyME”.
- Nombre: `YYMMDD-HHmm CV Nombre Apellido.pdf`.

### 7. Administración
La ficha administrativa incorpora:
- texto profesional principal;
- 10 aptitudes / fortalezas;
- motivación y objetivo;
- cierre y proyección;
- título profesional detectado;
- años de experiencia;
- fuente/versión de procesamiento.

### 8. Persistencia
Se agregan al modelo CandidateBolsa:
- `voiceNarrativeStrengths String[] @default([])`
- `voiceNarrativeMotivation String?`
- `voiceNarrativeClosing String?`

Son campos aditivos. No se elimina ni reinicia información existente.

## Validación automatizada
- 101 pruebas Node: 101 aprobadas, 0 fallidas.
- 30 archivos JavaScript: sintaxis validada.
- 16 scripts JavaScript inline en HTML: sintaxis validada.
- API y generador candidate-cv.js: `node --check` correcto.

## Limitación de validación local
El entorno de trabajo utilizado para esta auditoría no dispone del paquete runtime `pdfkit` instalado para ejecutar una renderización real del nuevo CV. La dependencia permanece declarada en `apps/api/package.json` (`pdfkit ^0.15.0`) y ya forma parte del despliegue de Render de las versiones anteriores. Por ese motivo se validó el generador por sintaxis y pruebas de regresión, pero la inspección visual definitiva debe realizarse generando un CV luego del deploy en Render.
