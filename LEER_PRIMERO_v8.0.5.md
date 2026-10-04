# LEER PRIMERO — Talento PyME v8.0.5

Esta revisión agrega clasificación automática de consultas de Ayuda IA.

## Qué cambia
- Chat operador muestra dos contadores: **Tema ya cubierto** y **Consulta nueva / requiere ampliar respuesta**.
- Cada pregunta individual queda etiquetada dinámicamente según el conocimiento vigente.
- Una respuesta del operador marcada como reutilizable puede hacer que futuras preguntas similares pasen a **Tema ya cubierto**.
- Correo / Consultas muestra también el desglose de consultas pendientes por ambos estados.

## Base de datos
No hay migración nueva. No se alteran CV ni clasificaciones de candidatos.

## Instalación
Aplicar sobre v8.0.4, hacer commit y desplegar primero API y luego web.
