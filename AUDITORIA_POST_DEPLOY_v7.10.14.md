# AUDITORÍA POST-DEPLOY v7.10.14 → CORRECCIÓN v7.10.15

## Resguardo auditado
- appVersion del backup: 7.10.14
- candidatos: 593
- clasificaciones: 593
- todas las clasificaciones persistidas: classificationVersion 7.10.14
- confianza: 44 ALTA, 197 MEDIA, 352 BAJA
- puntaje máximo observado: 65/100
- secundarios guardados: 60 en 51 candidatos
- secundarios buscables: 2; los otros 58 quedan como ANTECEDENTE no buscable

## Validación del criterio v7.10.14
Se confirmó la corrección de los casos estructurales revisados: Calidad, Producción, Eléctrica, Maestranza, Administración, Logística, Comercial y uso conservador de especialidades secundarias.

## Hallazgo residual
Agustín Jesús Amores quedó como Comercial / Atención al cliente aunque su experiencia cronológicamente más reciente es Peón de Cocina (Aramark, enero-junio 2026). La causa fue léxica: `Peón de Cocina` no estaba incluido como cargo gastronómico explícito.

## v7.10.15
Se agrega `Peón de Cocina` y `Operario/a de Cocina` al vocabulario gastronómico, manteniendo las reglas conservadoras de v7.10.14. También se sincronizan README.md, CURRENT_VERSION.txt, frontend, API y Service Worker en 7.10.15.

No requiere migración de Neon. El cambio de versión del motor fuerza reclasificación automática.

## Pruebas
Suite general: 278 pruebas; 277 aprobadas. La única no ejecutable en este entorno es auth-v7100 por ausencia local de bcryptjs/node_modules; la dependencia continúa declarada en package.json.
