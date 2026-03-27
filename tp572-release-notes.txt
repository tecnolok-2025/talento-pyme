# Render Setup (Talento PyME)

## 1) Static Site: `talento-pyme`
Publica la web/PWA (instalable sin AppStore/PlayStore).

- Root Directory:
  - Repo anidado (tenés `talento-pyme/apps/...`): `talento-pyme/apps/web`
  - Repo limpio: `apps/web`
- Build Command: `echo "no build"`
- Publish Directory: `.`
- NO requiere variables tipo DB.

## 2) Web Service: `talento-pyme-api`
Corre Node/Express y se conecta a Neon.

- Root Directory:
  - Repo anidado: `talento-pyme/apps/api`
  - Repo limpio: `apps/api`
- Build Command: `npm install && npx prisma generate`
- Start Command: `npm start`

### Environment Variables (OBLIGATORIAS)
- DATABASE_URL: pegar el connection string de Neon (pooler ON)
- JWT_SECRET: clave larga

## Verificación
- API: https://talento-pyme-api.onrender.com/health
- WEB: https://talento-pyme.onrender.com/
