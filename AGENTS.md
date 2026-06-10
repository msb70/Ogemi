## Imported Claude Cowork project instructions

extraer cada cierto tiempo de una hoja de excel el libro de venta se guarda en una base de datos de supabase con los campos de factura ,fecha,cliente, tipo de documento, documento afectado , monto , itbms y total, igual se debe crear una base de datos de clientes con nombre y dias de credito, estos clientes se crearan cada vez que se escanee el libro de venta los que no existan en la base de datos se crearan automaticamente, cada factura que se ingresa tendra una fecha de pago la cual es fecha de la factura mas los dias de credito del cliente por default cuando se crea el cliente el numero de dias es 30, adicional la factura tendra un estatus pendiente y pagada, se tendra un modulo de banco en el cual las facturas que se cancelen pasaran a banco y uno podra haer ingresos y egresos en banco y adicional un cierre de mes para cuadrar con el banco, el sistema debe ser capaz de generar reportes de cuentas x pagar x meses, la cartera de la deuda pendiente x cliente x30, 60,90 y mas de 120 dias. Tambien debe tener e modulo de seguridad para que cada usuario tenga privilegios de ver, editar y borrar. con toda esta data. Te adjunto el logo de la empresa y el libro de venta en excel, si necesitas mas informacion hazme todas las preguntas

## Project connections

- GitHub: https://github.com/msb70/Ogemi
- Supabase: https://tnuzaaetfbbnxtbedlhs.supabase.co
- Vercel: https://ogemi-iota.vercel.app/
- Vercel project: `ogemi` (`prj_dTi7FaDqsPwQiM2yfN2pj0xah2Um`)

## Vercel publication procedure

**Production publishes automatically on every `git push` to `main`.** Verified working 2026-06-10
(project `ogemi` in team `ogemi-s-projects`, Root Directory `ogemi-app`, Git connected to msb70/Ogemi).
No manual command is needed.

To verify a publication: Vercel dashboard (ogemi account) → project `ogemi` → Deployments →
the newest entry must show the commit message with status `Ready` and the `Production` badge,
aliased to https://ogemi-iota.vercel.app.

Manual deploy — FALLBACK ONLY (e.g. Git integration down). It streams build output, useful for debugging:

```bash
cd /Users/miguelspina/Documents/Claude/Projects/Ogemi/ogemi-app
npx -y vercel@latest --prod --yes --scope team_skSZ5uPbcIfbs7LyfcHeca63
```

WARNINGS:
- Do NOT look at the Vercel dashboard of the personal msb account: its `ogemi` project
  (ogemi.vercel.app) is an obsolete duplicate pointing at the paused Supabase project (arill...).
  It must be deleted; until then, ignore it.
- The CI on GitHub Actions (lint, typecheck, build, test) is the quality gate: if CI is red,
  do not consider the push publishable even if Vercel deploys it.

## Admin user management

Creating/inviting users from the app requires the server-only Vercel environment variable `SUPABASE_SERVICE_ROLE_KEY`.
Do not expose this key with a `NEXT_PUBLIC_` prefix. Without it, `/api/admin/users` can still report the missing configuration but cannot create Supabase Auth users.
