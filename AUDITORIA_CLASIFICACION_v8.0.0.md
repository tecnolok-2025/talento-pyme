# Auditoría de clasificación — Talento PyME v8.0.0

## Base utilizada
Resguardo lógico `logical_20261003_211542(1).json`, generado por v7.10.15.

- 593 candidatos
- 593 clasificaciones
- 255 perfiles en “Información profesional por completar”
- 5 perfiles en “Perfil profesional / Trayectoria no determinada”

## Simulación v8.0.0 sobre los 260 perfiles problemáticos

- 246 → Aprendices
- 12 → Pasantes
- 2 → Trayectoria laboral con orientación por validar
- 0 → Información profesional por completar

Distribución destacada: 211 Aprendices sin estudios secundarios declarados; 16 Aprendices generales; 8 Aprendices administrativos; especialidades técnicas/sectoriales adicionales; 12 Pasantes distribuidos entre formación general y orientaciones específicas.

## Seguridad conceptual
- La formación no se convierte en experiencia.
- Una actividad laboral verificable conserva prioridad.
- Los términos de Aprendiz/Pasante entran al índice de búsqueda sólo cuando esa es la situación actual del perfil.
- No se utilizan edad, DNI ni atributos personales para estimar experiencia.

## Validación
Pruebas específicas v8.0.0: 7/7 aprobadas.
Suite general: 284/285 aprobadas; la única prueba no ejecutable en el entorno local es autenticación por ausencia de `bcryptjs` instalado en `node_modules`. La dependencia continúa declarada en `package.json`.
