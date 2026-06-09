## Imported Claude Cowork project instructions

extraer cada cierto tiempo de una hoja de excel el libro de venta se guarda en una base de datos de supabase con los campos de factura ,fecha,cliente, tipo de documento, documento afectado , monto , itbms y total, igual se debe crear una base de datos de clientes con nombre y dias de credito, estos clientes se crearan cada vez que se escanee el libro de venta los que no existan en la base de datos se crearan automaticamente, cada factura que se ingresa tendra una fecha de pago la cual es fecha de la factura mas los dias de credito del cliente por default cuando se crea el cliente el numero de dias es 30, adicional la factura tendra un estatus pendiente y pagada, se tendra un modulo de banco en el cual las facturas que se cancelen pasaran a banco y uno podra haer ingresos y egresos en banco y adicional un cierre de mes para cuadrar con el banco, el sistema debe ser capaz de generar reportes de cuentas x pagar x meses, la cartera de la deuda pendiente x cliente x30, 60,90 y mas de 120 dias. Tambien debe tener e modulo de seguridad para que cada usuario tenga privilegios de ver, editar y borrar. con toda esta data. Te adjunto el logo de la empresa y el libro de venta en excel, si necesitas mas informacion hazme todas las preguntas

## Project connections

- GitHub: https://github.com/msb70/Ogemi
- Supabase: https://tnuzaaetfbbnxtbedlhs.supabase.co
- Vercel: https://ogemi-iota.vercel.app/
- Vercel project: `ogemi` (`prj_dTi7FaDqsPwQiM2yfN2pj0xah2Um`)

## Vercel publication procedure

The reliable production publication path for this project is a manual Vercel deploy from the Next.js app directory:

```bash
cd /Users/miguelspina/Documents/Claude/Projects/Ogemi/ogemi-app
npx -y vercel@latest --prod --yes --scope team_skSZ5uPbcIfbs7LyfcHeca63
```

After deployment, verify the public alias:

```bash
npx -y vercel@latest inspect https://ogemi-iota.vercel.app --scope team_skSZ5uPbcIfbs7LyfcHeca63
```

The deploy is successful when `ogemi-iota.vercel.app` is aliased to a deployment with `status Ready`.
Avoid relying only on failed automatic Git deployments for debugging; when Vercel logs are missing, rerun the manual command above because it streams the build output.
