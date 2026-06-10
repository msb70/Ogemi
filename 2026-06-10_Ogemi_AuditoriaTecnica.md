# Auditoría técnica integral — Ogemi (Impresos Comerciales SA)

**Fecha:** 2026-06-10
**Alcance:** repo `Ogemi/ogemi-app` (Next.js 14 App Router + Supabase + Vercel), migraciones SQL, base de datos Supabase accesible vía MCP, dependencias, CI.

---

## Resumen ejecutivo

- **Estado general:** el proyecto está mejor de lo que suele estar un sistema construido a esta velocidad: RLS por módulo bien diseñada, triggers de negocio en DB, deduplicación de importación pensada, CI definido, headers de seguridad, secretos fuera de git, tests unitarios bien escritos para el parsing crítico. Pero tiene **tres problemas estructurales que anulan parte de ese trabajo**: (1) gobernanza de entornos rota — hay dos proyectos Supabase con datos reales y el historial de migraciones no refleja lo aplicado; (2) la suite de tests no puede ejecutarse (ni local ni en CI) por una dependencia faltante; (3) dependencias con vulnerabilidades altas sin parchear (`next`, `xlsx`).
- **Nivel de riesgo: ALTO.** No por exposición externa (la autenticación y RLS están razonablemente cerradas), sino por **integridad de datos financieros y gobernanza**: la base auditada no tiene el constraint anti-duplicados de facturas, su vista de cartera reporta tramos incorrectos, y borrar un pago corrompe silenciosamente la contabilidad del banco.
- **¿Listo para producción?: PARCIALMENTE.** Ya está en producción de facto (ogemi-iota.vercel.app). Funciona para el volumen actual (~164 facturas, ~78 clientes). No pasa un estándar de producción para datos financieros hasta cerrar los hallazgos Críticos y Altos.

**Limitación importante de esta auditoría:** la app de producción apunta a Supabase `tnuzaaetfbbnxtbedlhs` (cuenta ogemipty@gmail.com). El MCP de Supabase conectado a esta sesión accede a **otra cuenta**, donde existe un proyecto `ogemi-app` (`arillcotwkqrfptqhbed`) con datos reales hasta el 2 de junio. **No pude auditar la base de producción real.** Todos los hallazgos de DB verificados en vivo corresponden a `arill...`; los hallazgos de esquema/migraciones aplican al repo en cualquier caso.

---

## Hallazgos

### CRÍTICOS

**C-1. Dos proyectos Supabase paralelos con datos reales, sin fuente de verdad clara**
- Categoría: Arquitectura / Datos. Severidad: **Crítica**.
- Afectado: `.env.local` (→ `tnuz...`), `supabase/.temp/project-ref` (→ `tnuz...`), proyecto `arillcotwkqrfptqhbed` (164 facturas, último insert 2026-06-02).
- Problema: existe un proyecto viejo/paralelo con datos de producción hasta el 2 de junio y otro que es el actual. Nadie que llegue al repo puede saber cuál es la verdad sin preguntarte. El historial `supabase_migrations` del proyecto accesible **no registra** las migraciones `002` y `003` del repo: `002` se aplicó a mano (la vista tiene `monto_pagado`), `003` **nunca se aplicó** (verificado: no existe `uq_factura_numero_tipo` y la vista no tiene el tramo 91-120).
- Impacto: drift de esquema imposible de razonar; cualquier "fix" futuro puede aplicarse a la base equivocada o no aplicarse a ninguna. El proceso de migraciones ya falló al menos una vez — eso es un hecho, no una hipótesis.
- Recomendación: (1) decidir y documentar en el README cuál proyecto es producción; (2) pausar o borrar el proyecto obsoleto (exportando antes); (3) re-sincronizar: `supabase db diff` contra producción y consolidar `schema.sql` + `schema_compras.sql` + `ogemi_sql_unico_setup.sql` + migraciones `002/003/004` (naming sin timestamp, no registradas) en una cadena única de migraciones con timestamp aplicada vía CLI, nunca por SQL Editor.

**C-2. Constraint UNIQUE anti-duplicados de facturas ausente en la base verificada**
- Categoría: Datos. Severidad: **Crítica** (si producción está igual; verificar es la primera acción).
- Afectado: tabla `facturas`; `migrations/003_sprint2_correctness.sql`.
- Problema: la migración 003 crea `UNIQUE (numero_factura, tipo_documento)` precisamente porque la deduplicación en JS (`importar.service.ts`) no protege contra dos imports concurrentes o contra un reload del mapa fallido. En la base verificada el constraint **no existe**.
- Impacto: facturas duplicadas en el libro de ventas → cartera y reportes de cobro inflados. En un sistema cuyo propósito es cobrar, esto es el riesgo número uno.
- Recomendación: ejecutar en producción `SELECT numero_factura, tipo_documento, COUNT(*) FROM facturas GROUP BY 1,2 HAVING COUNT(*)>1;` y luego aplicar 003 vía migración registrada.

**C-3. `npm test` está roto en todas partes: 42 tests inservibles y CI en rojo (o ignorado)**
- Categoría: Testing / Calidad. Severidad: **Crítica** para el proceso.
- Afectado: `jest.config.ts`, `package.json`, `.github/workflows/ci.yml` (step `Test`).
- Problema: `jest.config.ts` requiere `ts-node` para parsearse y `ts-node` **no está en package.json ni en package-lock**. Verificado: `npx jest` falla con "Cannot find package 'ts-node'". El step `npm test` del CI falla igual en cada push, lo que significa una de dos cosas: o el CI lleva tiempo en rojo y se ignora, o nunca se revisó. Ambas son peores que no tener CI.
- Impacto: los 42 tests que protegen el parsing monetario europeo (el bug "1.000,00 → 0.01" que ya te mordió una vez) no se ejecutan. Cero red de seguridad real.
- Corrección: `npm i -D ts-node` — una línea. O renombrar a `jest.config.js`. Que el CI vuelva a verde y que un push con CI rojo no se despliegue.

### ALTOS

**A-1. `xlsx` 0.18.5 con vulnerabilidades altas sin fix disponible en npm**
- Categoría: Seguridad / Dependencias. Severidad: **Alta**.
- Afectado: `package.json`; `excel-parser.ts` procesa archivos subidos por usuarios.
- Problema: Prototype Pollution (GHSA-4r6h-8v6p-xvw6) y ReDoS (GHSA-5pgg-2g8v-p4x9). El registro npm de `xlsx` está abandonado en 0.18.5; las versiones parcheadas (≥0.19.3 / 0.20.x) solo se distribuyen desde el CDN oficial de SheetJS.
- Impacto: el vector es justo el caso de uso central — parsear un archivo externo. Mitigado porque solo usuarios autenticados importan, pero sigue siendo deuda de seguridad conocida.
- Recomendación: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` y correr los tests de parser (cuando funcionen — ver C-3).

**A-2. Next.js 14.2.29 con 14 advisories acumulados**
- Categoría: Seguridad / Dependencias. Severidad: **Alta**.
- Problema: `npm audit` lista cache poisoning de RSC, request smuggling en rewrites, bypass de middleware, varios DoS, XSS con CSP nonces. Tu app usa middleware como única barrera de redirección a login, así que los advisories de middleware te aplican directamente.
- Recomendación: subir al último 14.2.x como mínimo inmediato; planificar Next 15. No `npm audit fix --force` (te llevaría a Next 16, breaking).

**A-3. El middleware ejecuta el cliente service-role y hasta 3 queries (incluida una ESCRITURA potencial) en cada request**
- Categoría: Arquitectura / Rendimiento / Disponibilidad. Severidad: **Alta**.
- Afectado: `src/middleware.ts` → `resolveAuthorizedProfile()` (`src/lib/auth-profile.ts`).
- Problema triple: (1) cada navegación paga 1–3 roundtrips a Supabase además de `getUser()`; (2) `resolveAuthorizedProfile` puede hacer un `UPDATE` del primary key de `user_profiles` (re-link por email) dentro del hot path de autorización — una escritura con privilegios service-role disparada por cualquier request; (3) si `SUPABASE_SERVICE_ROLE_KEY` falta o Supabase parpadea, el `catch` devuelve `null` y el middleware **desloguea a todos los usuarios** (`signOutAndRedirect`). Un secreto mal configurado = app caída con apariencia de "credenciales inválidas".
- Impacto: latencia en cada página, fragilidad de disponibilidad, y una operación de vinculación de cuentas que debería ocurrir una sola vez (en el callback de login) ejecutándose por request.
- Recomendación: en middleware solo verificar sesión (`getUser`). Mover la autorización de perfil al layout del servidor o a `/api/auth/me` (que ya existe y ya lo hace), y la re-vinculación por email exclusivamente a `auth/callback` y al login por password. Distinguir "perfil no autorizado" de "error de infraestructura": el segundo no debe desloguear.

**A-4. Contraseñas temporales débiles generadas con `Math.random()`**
- Categoría: Seguridad. Severidad: **Alta**.
- Afectado: `src/app/api/admin/users/route.ts` → `generateTempPassword()`.
- Problema: 8 caracteres de un alfabeto de 55, generados con `Math.random()` (no criptográfico, predecible). Además el password viaja en la respuesta JSON al navegador del admin y por email en texto plano. Y el advisor confirma que la protección de contraseñas filtradas (HaveIBeenPwned) está deshabilitada en Auth.
- Impacto: ventana real de account takeover entre la creación del usuario y el cambio forzado de contraseña (que sí existe, bien).
- Corrección:
  ```ts
  import { randomBytes } from 'crypto'
  function generateTempPassword(len = 14): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    const bytes = randomBytes(len)
    return Array.from(bytes, b => chars[b % chars.length]).join('')
  }
  ```
  Y habilitar leaked password protection en Supabase Auth (un toggle).

**A-5. Vista `cartera_vencida` en DB sin tramo 91-120 — reportes de antigüedad incorrectos e inconsistentes**
- Categoría: Datos / Lógica. Severidad: **Alta** (verificada en la base accesible; confirmar en producción).
- Afectado: vista `cartera_vencida` (versión de migración 002 vigente); `reportes/page.tsx` la consume; `utils.ts → classifyTramo` sí incluye 91-120.
- Problema: facturas vencidas 91–120 días caen en "+120" cuando el dato viene de la vista, pero en "91-120" cuando la UI clasifica client-side. Dos fuentes de verdad que no coinciden — exactamente el requisito de cartera 30/60/90/+120 del proyecto.
- Recomendación: aplicar 003 (que ya corrige la vista) y decidir UNA fuente de clasificación: o siempre la vista, o siempre `classifyTramo`. No ambas.

### MEDIOS

**M-1. Borrar un pago no revierte nada: corrupción contable silenciosa**
- Categoría: Datos. Severidad: **Media** (Alta si se habilita borrar pagos en UI).
- Afectado: `migrations/002_anticipos_pagos.sql` — trigger `procesar_pago` solo en `AFTER INSERT`; RLS `delete_pagos` permite DELETE.
- Problema: al borrar un pago, el `banco_movimiento` asociado queda vivo, `monto_pagado` no se recalcula y el estado de la factura no se revierte. La UI hoy no expone borrar pagos, pero la DB lo permite a cualquier rol con permiso `borrar` (vía API REST de Supabase directamente).
- Recomendación: trigger `AFTER DELETE ON pagos` que borre el movimiento ligado y recalcule `monto_pagado`/`estado`; o prohibir DELETE en pagos y modelar reversas como asiento contrario (más sano contablemente).

**M-2. Sin paginación: reportes carga tablas completas al navegador + N+1 admitido**
- Categoría: Rendimiento. Severidad: **Media** (crece con cada mes importado).
- Afectado: `reportes/page.tsx` (7 queries `select('*')` sin `range()`), y un loop por cuenta para saldos comentado en el propio código como "N+1 known issue". En todo `src/` hay 29 `select('*')` y solo 1 `.range()`.
- Impacto: con 164 facturas, nada. Con 24 meses de libros de venta, el dashboard y reportes degradarán linealmente; todo el cálculo (pivots, tramos) es client-side.
- Recomendación: agregaciones en Postgres (vistas o RPC por mes/cliente), `saldo_cuenta()` ya existe — usarla en vez del loop; paginar listados.

**M-3. Modelo de permisos legacy conviviendo con el nuevo**
- Categoría: Datos / Seguridad. Severidad: **Media**.
- Afectado: tabla `user_roles` + funciones `get_user_role()/can_edit()/can_delete()` (SECURITY DEFINER, ejecutables por `anon` y `authenticated` según advisors) vs. modelo nuevo `roles`/`rol_permisos`/`has_module_permission`. `requireAdmin()` aún consulta ambos. Advisor adicional: policy `profiles_insert_trigger` con `WITH CHECK (true)`.
- Impacto: superficie de confusión y de error; funciones definer expuestas vía `/rest/v1/rpc/` sin necesidad.
- Recomendación: migrar el dato residual de `user_roles`, eliminar tabla y funciones legacy, revocar EXECUTE a `anon` de toda función definer, fijar `SET search_path` en las 13 funciones que el advisor marca (las nuevas `app_private.*` ya lo hacen bien; las viejas no).

**M-4. Higiene del repo: working tree sucio y triple fuente de esquema**
- Categoría: Mantenibilidad. Severidad: **Media**.
- Afectado: 13 archivos modificados sin commit (incluye `email.ts` **sin trackear** — si se pierde esa copia local, se pierde la funcionalidad de invitaciones), migración `20260609210906` sin commitear, `reportes-page-modificado.tsx` suelto en la raíz, y tres archivos de esquema (`schema.sql`, `schema_compras.sql`, `ogemi_sql_unico_setup.sql`) que ya no representan el estado real.
- Recomendación: commit/push hoy; borrar artefactos sueltos; declarar las migraciones como única fuente de verdad y mover los schema.sql a `/docs` o regenerarlos con `supabase db dump`.

**M-5. Componentes monolíticos con lógica de negocio en el cliente**
- Categoría: Código. Severidad: **Media**.
- Afectado: `compras/page.tsx` (856 líneas), `usuarios/page.tsx` (699), `dashboard/page.tsx` (567), `banco/page.tsx` (515)… 15 páginas hablan con Supabase directo desde el cliente; 66 usos de `: any` (los estados de reportes son `useState<any[]>`).
- Impacto: el patrón servicio + tests que hiciste bien en `importar.service.ts` es la excepción, no la regla. Cambiar lógica de pagos/cierres exige tocar componentes UI gigantes sin tests posibles.
- Recomendación: extraer servicios (`facturas.service.ts`, `banco.service.ts`) siguiendo el patrón de importar; tipar los datos de reportes con los tipos de `src/types`.

### BAJOS

**B-1. CSP con `unsafe-eval`/`unsafe-inline` y URL de Supabase hardcodeada** — `next.config.mjs` duplica `tnuz...` que ya vive en env; si cambias de proyecto, la app rompe en silencio (connect-src). Generar el header desde `process.env`. `unsafe-eval` solo es necesario en dev: condicionar por `NODE_ENV`.
**B-2. `findAuthUserByEmail`/`deleteAuthUsersByEmail` paginan hasta 20.000 usuarios** para encontrar un email — funciona con 5 usuarios, pero es O(n) innecesario; mantener `user_profiles.id` como única referencia y borrar por id.
**B-3. Redirect `next` en `auth/callback`** concatenado a `origin` — mitigado, pero validar que `next` empiece por `/` y no por `//`.
**B-4. `dgi-qr`** — bien resuelto (validación exacta de hostname anti-SSRF, debug solo en dev), pero el parsing por regex de HTML de la DGI es frágil por diseño; loguear los fallos de parseo para detectar cuando la DGI cambie el HTML.

---

## Lo que está bien (y conviene no romper)

RLS por módulo con `app_private.has_module_permission` es un diseño correcto y poco común en proyectos de este tamaño; defensa en profundidad real (middleware + API + RLS). Triggers de negocio en DB (`calcular_fecha_pago`, `procesar_pago`) en lugar de confiar en el cliente. `importar.service.ts` separado y testeado, con el caso crítico del formato europeo documentado. Constraint `pago_origen` (XOR factura/compra). `.env` fuera de git, service key solo server-side, escape HTML en emails, headers de seguridad, validación SSRF. CI con lint+typecheck+build (typecheck pasa limpio hoy).

---

## Checklist final

| Área | Estado | Nota |
|---|---|---|
| Arquitectura | ⚠️ Aceptable | Capas correctas en auth/API; lógica de negocio atrapada en componentes; middleware sobrecargado (A-3) |
| Código | ⚠️ Aceptable | Typecheck limpio, 0 console.log; 66 `any`, páginas monolíticas (M-5) |
| Datos | ❌ Deficiente | Migraciones desincronizadas (C-1/C-2), vista de cartera incorrecta (A-5), delete de pagos sin reversa (M-1) |
| APIs | ✅ Correcto | Auth + permisos consistentes en todas las rutas; validación de inputs razonable |
| Seguridad | ⚠️ Aceptable | RLS sólida; deps vulnerables (A-1/A-2), passwords débiles (A-4), legacy expuesto (M-3) |
| Performance | ⚠️ Aceptable hoy | Sin paginación ni agregación server-side (M-2); escala mal con datos |
| Testing | ❌ Roto | 42 tests buenos que no pueden ejecutarse (C-3); 0 tests de integración/E2E |
| Producción | ⚠️ Parcial | Ya desplegado y funcionando; no pasa estándar de producción financiera hasta cerrar C-1..C-3, A-1..A-5 |

---

## Riesgos y limitaciones de esta auditoría

- No tuve acceso a la base de **producción** (`tnuz...`): los hallazgos C-2 y A-5 están verificados en el proyecto paralelo `arill...` y deben confirmarse en producción antes de darlos por ciertos allí (5 minutos de SQL).
- No revisé la configuración de Vercel (env vars, dominios) ni los logs de runtime.
- No ejecuté pruebas de penetración activas; el análisis de seguridad es estático + advisors de Supabase.

## Próximos pasos

1. **Hoy:** confirmar en producción (`tnuz...`) si existe `uq_factura_numero_tipo` y qué versión tiene `cartera_vencida`; si falta, aplicar migración 003. Commit/push del working tree (incluye `email.ts` sin trackear).
2. **Esta semana:** `npm i -D ts-node` (CI a verde), `next` al último 14.2.x, `xlsx` desde el CDN de SheetJS, `generateTempPassword` con crypto + leaked password protection.
3. **Próximo sprint:** decidir el destino del proyecto Supabase paralelo y consolidar migraciones; sacar `resolveAuthorizedProfile` del middleware; trigger de reversa en `pagos`.
4. **Backlog:** limpieza del modelo legacy `user_roles`, paginación/agregaciones server-side, extracción de servicios desde las páginas monolíticas.
