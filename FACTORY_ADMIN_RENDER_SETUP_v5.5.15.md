# Factory Admin · configuración en Render (v5.5.15)

Estas variables van en el servicio **API** de Render:

- `FACTORY_ADMIN_ALIAS`
- `FACTORY_ADMIN_PASSWORD`
- `FACTORY_SUPPORT_EMAIL`
- `FACTORY_ADMIN_ALLOWED_COMPANIES`

## Ejemplo recomendado

- `FACTORY_ADMIN_ALIAS=TalentoPyme`
- `FACTORY_ADMIN_PASSWORD=tu_clave_superadmin`
- `FACTORY_SUPPORT_EMAIL=factory@gmail.com`
- `FACTORY_ADMIN_ALLOWED_COMPANIES=Mengabo SA,Mengabo Sociedad Anonima`

## Pasos

1. Entrá a Render.
2. Abrí el servicio `talento-pyme-api`.
3. Entrá a **Environment**.
4. Creá o editá las variables anteriores.
5. Guardá.
6. Hacé **Redeploy**.

## Importante

- Factory Admin **solo va a aparecer** en la empresa cuyo nombre coincida con alguno de los valores de `FACTORY_ADMIN_ALLOWED_COMPANIES`.
- En las demás empresas, Factory sigue visible pero **Factory Admin queda oculto**.
- El acceso administrativo queda habilitado **solo durante la sesión actual**. Al salir o volver a entrar a Factory, se vuelve a pedir el nombre Factory y la clave.
