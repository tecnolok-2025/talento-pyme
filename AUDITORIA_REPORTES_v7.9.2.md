# Talento PyME v7.9.2 - Auditoría de Reporte de Trazabilidad

Fecha de revisión: 09/08/2026

## Objetivo
Corregir la presentación y consistencia temporal del Informe Ejecutivo de Trazabilidad generado en v7.9.1, manteniendo intacta la lógica de privacidad y los datos agregados.

## Hallazgos sobre el PDF v7.9.1 revisado

1. Los títulos posteriores a tablas heredaban la posición horizontal del último campo dibujado por PDFKit. Esto producía bloques angostos alineados hacia el margen derecho en las secciones 3, 4, 5, 6, 7 y 8.
2. La numeración se dibujaba dentro del margen inferior con el flujo de texto activo. PDFKit agregaba páginas nuevas para alojar los pies, generando páginas adicionales que contenían únicamente el footer.
3. El encabezado no incorporaba los logos institucionales de UIC y Talento PyME.
4. Las altas mensuales y de los últimos 30 días de empresas se tomaban desde `CompanyProfile.createdAt`. Para representar el alta de una empresa como cuenta registrada, el origen correcto es `User.createdAt` con `role='COMPANY'`.
5. La presentación de fecha/hora dependía de la zona horaria del servidor. Se fija explícitamente `America/Argentina/Buenos_Aires`.
6. El nombre del archivo no comenzaba con la hora, por lo que varios reportes del mismo día no quedaban ordenados cronológicamente por nombre.

## Correcciones v7.9.2

- Encabezado institucional con logo UIC a la izquierda y logo Talento PyME a la derecha.
- Encabezado secundario discreto con ambos logos en páginas posteriores.
- Todos los títulos, párrafos y tablas se anclan explícitamente al margen izquierdo del contenido.
- El cursor horizontal de PDFKit se reinicia después de cada componente.
- Pie real en cada página con línea separadora, título breve y `Página X de Y`, sin crear páginas adicionales.
- Altas de empresa en 30/60 días y serie de seis meses calculadas por fecha de alta de la cuenta `COMPANY`.
- Agrupación mensual y fecha de corte con zona horaria de Argentina.
- Nombre de archivo: `YYMMDD-HHmm Talento-PyME-Informe-Trazabilidad-YYYYMMDD-HHmm.pdf`.
- El reporte sigue siendo agregado y anonimizado.

## Compatibilidad

- No modifica `schema.prisma`.
- No requiere nuevas variables de entorno.
- No altera Gmail, Starter, recuperación de contraseñas ni clasificación administrativa.
- No elimina ni migra registros existentes.

## Validación

- 69 pruebas automáticas aprobadas.
- Sintaxis de API y generador PDF validada con `node --check`.
- 16 bloques JavaScript inline de las pantallas HTML validados.
- No quedan referencias ejecutables a v7.9.1 en `apps/`.
