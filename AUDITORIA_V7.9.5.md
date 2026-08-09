# Auditoría Talento PyME v7.9.5

## Objetivo del cambio
Eliminar la corrección automática temporizada de la presentación del candidato y dejar la decisión de procesar el relato exclusivamente en manos del usuario.

## Flujo definitivo
1. El candidato habla o escribe libremente.
2. Puede detenerse, continuar y agregar información sin que se dispare ningún procesamiento automático.
3. Cuando considera que terminó, pulsa **Corrección IA profesional**.
4. Talento PyME relee el relato completo desde el principio y genera una presentación profesional.
5. La versión corregida queda guardada inmediatamente como presentación profesional principal por defecto.
6. Esa presentación es la fuente principal para el CV PDF, la clasificación administrativa y la vista del administrador.
7. El candidato puede editar manualmente el resultado y guardar una versión posterior.

## Seguridad y datos
- No se conserva audio original.
- No se modificó el esquema de base de datos.
- No se eliminan registros existentes.
- Se mantienen las reglas de privacidad y el uso server-side de IA configurado en versiones anteriores.

## Validación
- 85 pruebas automáticas: 85 aprobadas.
- Archivos JavaScript: validación sintáctica correcta.
- Sin llamadas residuales a `scheduleVoiceRefine`.
- API, frontend y PWA unificados en v7.9.5.
