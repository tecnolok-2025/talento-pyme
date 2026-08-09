# Auditoría funcional y de privacidad - Talento PyME v7.9.1

## Objetivo
Incorporar reportes ejecutivos de trazabilidad sin alterar las funciones de clasificación, seguridad, recuperación de contraseñas, Gmail, Factory ni base de datos existentes.

## Implementación
- Nueva pestaña `Reportes` en Administración.
- Endpoint autenticado `GET /admin/reports/traceability/pdf`.
- Endpoint autenticado `POST /admin/reports/traceability/email`.
- Generación PDF server-side con PDFKit.
- Envío mediante el mismo transporte Gmail configurado para Talento PyME.
- El destinatario es editable en Administración.

## Contenido del PDF
1. Objetivo y alcance.
2. Resumen ejecutivo.
3. Evolución reciente: últimos 30 días vs. 30 días anteriores.
4. Evolución de seis meses.
5. Composición de candidatos por tipo de perfil y expertise.
6. Composición de empresas por familia y actividad principal.
7. Calidad y disponibilidad de información curricular.
8. Conclusiones de gestión.
9. Sugerencias de mejora.
10. Cierre institucional.

## Privacidad
El PDF no recibe ni imprime registros individuales. La API utiliza datos de candidatos/empresas únicamente para construir agregados internos y entrega al generador PDF solamente:
- cantidades;
- porcentajes;
- etiquetas de clasificación;
- series temporales agregadas;
- conclusiones y recomendaciones derivadas de métricas agregadas.

No se incluyen nombres, apellidos, DNI, CUIT, correos, teléfonos, domicilios ni identificadores individuales.

## Seguridad
- Ambos endpoints requieren roles `ADMIN` o `SUPERADMIN`.
- El service worker ya excluye `/admin/` de cache.
- El envío usa `FACTORY_SUPPORT_EMAIL` / `GMAIL_APP_PASSWORD` ya configurados.
- No se agregaron contraseñas, tokens ni secretos al frontend.
- La descarga se realiza con token administrativo y `Cache-Control: no-store`.

## Base de datos
No se modificó `schema.prisma`. La v7.9.1 no necesita una nueva migración ni agrega tablas/campos.

## Compatibilidad
Se conservan íntegramente las funciones v7.9.0 de clasificación de candidatos, expertise dinámicas, índice de trayectoria, clasificación de empresas, trazabilidad, recuperación segura de contraseña y correo administrativo.

## Dependencia nueva
`pdfkit` se agrega a las dependencias del API para generar PDFs de forma programática.

## Resultado de validación final
- 66 pruebas automáticas: aprobadas.
- 16 archivos HTML con scripts inline: sintaxis validada.
- JavaScript del frontend: sintaxis validada.
- API y servicio de PDF: sintaxis validada.
- Service Worker y versión PWA: 7.9.1.
- `schema.prisma`: sin cambios respecto de v7.9.0.
- Endpoints de reportes: exclusivos de ADMIN/SUPERADMIN.
- Reportes: fuera de cache mediante la regla existente `/admin/` + `Cache-Control: no-store`.
