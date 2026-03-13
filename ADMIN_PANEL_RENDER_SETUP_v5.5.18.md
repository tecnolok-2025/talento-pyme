Panel General + Factory Admin v5.5.18

1. En Render, dentro del servicio API, definir estas variables:
   FACTORY_ADMIN_ALIAS=Talento PyME
   FACTORY_ADMIN_PASSWORD=tu_clave_segura
   FACTORY_SUPPORT_EMAIL=factory@gmail.com
   FACTORY_ADMIN_ALLOWED_COMPANIES=Mengabo SA,Mengabo Sociedad Anonima

2. Guardar y hacer Redeploy.

3. Para entrar al Panel General:
   - Abrí la pantalla inicial.
   - Elegí Empresa.
   - En Empresa (nombre) escribí exactamente: Talento PyME
   - En Contraseña escribí el valor de FACTORY_ADMIN_PASSWORD.

4. El sistema redirige a /admin.html.

5. Esta versión agrega tablas nuevas para soporte/chat, por lo que el build debe ejecutar:
   npx prisma generate
   npx prisma db push --accept-data-loss
