# Talento PyME — v2.4

## Incluye
- Roles: CANDIDATE / COMPANY
- Hotelería como rubro con subrubros
- Empresa: Mi Empresa, Publicar, Mis Búsquedas
- Candidato: Mi Perfil, Mi CV (incluye Observaciones), Empleos (postularse)

## Render
### API (Web Service) `talento-pyme-api`
Root Directory: `apps/api`
Build: `npm install && npx prisma generate && npx prisma db push`
Start: `npm start`
Environment:
- DATABASE_URL
- JWT_SECRET

### WEB (Static Site) `talento-pyme`
Root Directory: `apps/web`
Build: `echo "no build"`
Publish: `.`
