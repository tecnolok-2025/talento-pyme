# Auditoría puntual v7.8.14

## Hallazgos confirmados
1. La portada v7.8.13 abría `/forgot.html` sin transmitir el rol seleccionado; `forgot.html` inicializaba siempre CANDIDATE. Corregido con `?role=CANDIDATE|COMPANY` y lectura de ese parámetro.
2. El CUIT permitía formato con guiones visualmente. Corregido a sólo 11 dígitos, máximo 11 y sanitización automática.
3. El envío por Gmail usa SMTP 465. Render bloquea SMTP saliente en instancias Free, por lo que el fallo observado no corresponde a una contraseña de aplicación incorrecta por sí mismo. La v7.8.14 acorta timeouts y mejora el diagnóstico.
4. No se modifica esquema ni contenido de base de datos.

## Requisito externo para envío Gmail
Para conservar Gmail + GMAIL_APP_PASSWORD mediante SMTP, el Web Service `talento-pyme-api` debe ejecutarse en una instancia paga de Render. En Free no puede abrir 25/465/587.
