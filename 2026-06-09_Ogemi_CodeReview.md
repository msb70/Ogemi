# Code Review — Ogemi Sistema de Gestión de Cartera
**Fecha:** 2026-06-09  
**Revisor:** Software Architect & Senior Code Reviewer  
**Repositorio:** https://github.com/msb70/Ogemi  
**Producción:** https://ogemi-iota.vercel.app/  
**Stack:** Next.js 14 (App Router) · Supabase · Tailwind CSS · Vercel  

---

## Resumen Ejecutivo

El proyecto es un sistema de gestión de cartera / contabilidad para Impresos Comerciales SA, construido sobre Next.js + Supabase. La base de datos está bien modelada y el schema SQL es el punto más sólido del proyecto. Sin embargo, hay **vulnerabilidades de seguridad que bloquean producción**, ausencia total de tests, y patrones de rendimiento que escalarán mal. El proyecto es funcional para un usuario técnico en ambiente controlado, pero **no está listo para producción multi-usuario sin corregir los problemas críticos identificados abajo**.

---

## 1. Arquitectura

### Estructura del proyecto
```
ogemi-app/
  src/
    app/           # Next.js App Router — páginas
    components/    # AppLayout, Header, Sidebar, QrScanner
    lib/           # supabase.ts, supabase-server.ts, excel-parser.ts, utils.ts
    types/         # index.ts (tipos globales)
  supabase/
    schema.sql             # Schema principal
    schema_compras.sql     # Módulo compras
    migrations/002_*       # Anticipos y pagos parciales
    ogemi_sql_unico_setup.sql  # ??? archivo duplicado/redundante
```

**Hallazgos:**

- **[Media]** La lógica de negocio está mezclada con la capa de presentación. Cada `page.tsx` contiene directamente las queries a Supabase, sin capa de servicios/repositorio. Esto viola el principio de separación de responsabilidades y hace el código difícil de testear y mantener.

- **[Media]** `reportes/page.tsx` es un mega-componente con más de 2,000 líneas de código, múltiples sub-tabs, lógica de cálculo, renderizado y exportación todo en un solo archivo. Debe dividirse.

- **[Baja]** Los archivos SQL no tienen un sistema de migración real. Hay 4 archivos (`schema.sql`, `schema_compras.sql`, `migrations/002_*`, `ogemi_sql_unico_setup.sql`) sin un mecanismo claro para saber qué está aplicado en producción. Si se ejecuta el schema.sql después de schema_compras.sql, habría conflictos.

- **[Baja]** No hay `supabase/config.toml` ni CLI de Supabase configurado. El proyecto no puede reproducir el entorno de DB localmente de forma determinista.

---

## 2. Calidad del Código

### Código duplicado

**Severidad: Media | Múltiples archivos**

La lógica de cálculo de tramos de cartera está duplicada en al menos 4 lugares:
- `facturas/page.tsx` → funciones `getDiasVencida` y `getTramo` inline
- `compras/page.tsx` → objeto `TRAMO_LABELS` y `TRAMO_COLORS` duplicados
- `lib/utils.ts` → función `classifyTramo`
- SQL → CASE en las vistas `cartera_vencida` y `compras_vencidas`

**Riesgo:** Si la lógica de tramos cambia (e.g., agregar tramo 91-120), hay que cambiarlo en 4 lugares. Ya existe un bug: la vista SQL salta de `61-90` directamente a `+120`, ignorando el rango 91-120.

**Solución:**
```typescript
// Un solo lugar: lib/utils.ts
export const TRAMOS = ['corriente', '1-30', '31-60', '61-90', '91-120', '+120'] as const
export function classifyTramo(dias: number): string { ... }
```

### Manejo de errores ausente

**Severidad: Alta | `banco/page.tsx`, `compras/page.tsx`, `clientes/page.tsx`, `proveedores/page.tsx`**

La mayoría de operaciones de escritura ignoran el error retornado por Supabase:

```typescript
// banco/page.tsx línea 109 — SIN manejo de error
await supabase.from('banco_cuentas').insert({ ...nuevaCuenta, ... })
setShowNuevaCuenta(false)
loadData()  // Si el insert falló, el usuario no sabe
```

```typescript
// compras/page.tsx línea 159 — SIN manejo de error
await supabase.from('compras').update({ estado: 'pagada', ... }).eq('id', c.id)
load()  // Si falla, el estado en UI queda inconsistente
```

**Riesgo de negocio:** Un operador marca una factura como pagada, el servidor falla silenciosamente, el operador asume que está pagada, y la factura queda pendiente en la base de datos. Esto genera descuadres de cartera.

### Código muerto

**Severidad: Baja | `reportes/page.tsx`**

La función `buildPivotSemanal` está comentada como "antiguo — mantenido para compatibilidad" pero sigue en el código activo ocupando ~80 líneas.

### Type safety

**Severidad: Baja | Múltiples archivos**

Uso de `any` en múltiples lugares:
- `pagosExistentes: any[]` en `facturas/page.tsx` y `compras/page.tsx`  
- `vencidas: any[]` en `compras/page.tsx`
- `reciboMovimiento: any | null` en `banco/page.tsx`
- `catch (e: any)` en `importar/page.tsx`

---

## 3. Seguridad 🔴

### SEC-01: SSRF (Server Side Request Forgery)

**Severidad: CRÍTICA | `src/app/api/dgi-qr/route.ts`**

La validación de URL usa `.includes()` en lugar de parseo real:

```typescript
// VULNERABLE
if (!url || !url.includes('dgi-fep.mef.gob.pa')) { ... }
```

Un atacante autenticado puede enviar: `https://dgi-fep.mef.gob.pa.evil.com/` o `https://evil.com/?x=dgi-fep.mef.gob.pa` y el servidor Vercel hará un fetch a una URL arbitraria.

**Riesgo de negocio:** Exfiltración de credenciales del entorno, acceso a metadatos del servidor, ataques a servicios internos.

**Solución:**
```typescript
try {
  const parsed = new URL(url)
  if (parsed.hostname !== 'dgi-fep.mef.gob.pa') {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 })
  }
} catch {
  return NextResponse.json({ error: 'URL inválida' }, { status: 400 })
}
```

### SEC-02: Control de acceso admin solo en cliente

**Severidad: CRÍTICA | `src/app/admin/page.tsx`**

La protección de la página de administración se verifica únicamente en el frontend:

```typescript
// Solo en React state — NO es seguridad real
if (currentUserRole !== 'admin') {
  return <div>Solo los administradores...</div>
}
// Luego hace:
await supabase.from('user_roles').update({ role, ... }).eq('id', roleId)
```

Un usuario con rol `operador` puede:
1. Abrir DevTools en el navegador
2. Modificar el estado de React para que `currentUserRole === 'admin'`
3. Llamar `handleSave()` directamente

Sin embargo, el RLS de Supabase tiene `CREATE POLICY "editar_roles" ON user_roles FOR ALL TO authenticated USING (get_user_role() = 'admin')`, lo que **sí protege** el UPDATE en la base de datos. El RLS es la barrera real aquí. **Pero** la página expone la lista completa de `user_ids` a cualquier usuario autenticado (la política `ver_roles` permite SELECT si `get_user_role() IS NOT NULL`).

**Riesgo:** Enumeración de todos los usuarios del sistema por parte de cualquier operador.

**Solución:** Agregar verificación server-side y restringir la política SELECT de `user_roles` a solo admins (o limitar los campos retornados).

### SEC-03: Datos sensibles en debug de errores

**Severidad: Alta | `src/app/api/dgi-qr/route.ts`**

En respuestas de error 422, se retornan datos de parsing intermedios:

```typescript
return NextResponse.json({
  error: 'No se pudieron extraer los datos...',
  debug: { numero_factura, fecha, emisor_nombre, emisor_ruc, total, itbms }
}, { status: 422 })
```

**Riesgo:** Exponer datos fiscales (RUC, montos) de facturas en respuestas de API en producción.

**Solución:** Eliminar el campo `debug` en producción. Usar `process.env.NODE_ENV === 'development'` para incluirlo solo en dev.

### SEC-04: Sin security headers HTTP

**Severidad: Alta | `next.config.mjs`**

No hay headers de seguridad configurados. El servidor no envía:
- `Content-Security-Policy`
- `X-Frame-Options` (riesgo de clickjacking)
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`

**Solución:**
```javascript
// next.config.mjs
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
]

const nextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
  // ...
}
```

### SEC-05: allowedOrigins en serverActions solo tiene localhost

**Severidad: Alta | `next.config.mjs`**

```javascript
serverActions: {
  allowedOrigins: ["localhost:3000"],  // ← Solo localhost
}
```

En producción (ogemi-iota.vercel.app) las Server Actions podrían ser rechazadas o vulnerables a CSRF cross-origin.

**Solución:**
```javascript
allowedOrigins: ["localhost:3000", "ogemi-iota.vercel.app"]
```

### SEC-06: Sin rate limiting en API de DGI

**Severidad: Media | `src/app/api/dgi-qr/route.ts`**

La ruta no tiene límite de llamadas. Un atacante puede usar la infraestructura de Vercel para hacer scraping masivo del DGI de Panamá o agotar el budget de Vercel.

---

## 4. Rendimiento

### PERF-01: N+1 query explícito en banco

**Severidad: Alta | `src/app/banco/page.tsx` líneas 50-59**

```typescript
// N+1: una query por cada cuenta bancaria
for (const c of (cuentasData || [])) {
  const { data: movs } = await supabase
    .from('banco_movimientos')
    .select('tipo, monto')
    .eq('cuenta_id', c.id)   // ← una query por cuenta
}
```

Con 5 cuentas bancarias = 6 queries (1 + 5). Con 20 = 21 queries.

**Solución:** Usar la función `saldo_cuenta()` ya definida en el schema de Supabase, o hacer una sola query con GROUP BY:

```typescript
// Una sola query
const { data: saldos } = await supabase.rpc('calcular_saldos_todas_cuentas')
```

O llamar `saldo_cuenta` por RPC en paralelo con `Promise.all`.

### PERF-02: Importación Excel fila por fila

**Severidad: Alta | `src/app/importar/page.tsx`**

El proceso de importación hace una inserción individual por cada fila del Excel, secuencialmente:

```typescript
for (const row of preview) {  // 500 filas = 500+ requests a Supabase
  // ... lógica por fila
  const { error: eFact } = await supabase.from('facturas').insert({ ... })
}
```

Para un libro de ventas de 500 facturas: ~500 requests HTTP, tiempo estimado 30-120 segundos, alta probabilidad de timeout en Vercel (límite de 30s en serverless).

**Solución:** Batch insert + upsert:
```typescript
// Cargar todos los clientes al inicio
// Crear nuevos clientes en batch
await supabase.from('clientes').upsert(clientesNuevos)
// Insertar facturas en batch (máximo 1000 por vez)
const chunks = chunkArray(facturasAInsertar, 200)
for (const chunk of chunks) {
  await supabase.from('facturas').insert(chunk)
}
```

### PERF-03: Carga sin paginación

**Severidad: Media | `src/app/facturas/page.tsx`, `reportes/page.tsx`**

```typescript
// Sin límite — carga TODAS las facturas
let query = supabase
  .from('facturas')
  .select('*, clientes(nombre, dias_credito), banco_cuentas(nombre, banco)')
  .order('fecha', { ascending: false })
```

Con 10,000 facturas, esto transfiere ~2-5MB de JSON por cada carga de página y consume memoria en el navegador.

**Solución:** Implementar paginación o virtualización:
```typescript
.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
```

### PERF-04: Búsqueda client-side

**Severidad: Media | `src/app/facturas/page.tsx`**

El filtro de búsqueda se aplica en JavaScript del cliente sobre todos los registros cargados. No hay búsqueda server-side. Esto significa que la carga inicial siempre trae todos los datos.

### PERF-05: `supabase = createClient()` en cada render

**Severidad: Baja | Múltiples páginas**

```typescript
export default function FacturasPage() {
  const supabase = createClient()  // ← se recrea en cada render
```

Debería estar en `useMemo` o fuera del componente.

---

## 5. Base de Datos

### DB-01: Bug en tramo de cartera — 91-120 días no existe

**Severidad: Alta | `supabase/schema.sql`, `supabase/migrations/002_*`**

```sql
CASE
  WHEN CURRENT_DATE - f.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
  ELSE '+120'  -- ← Una factura de 100 días cae en "+120", que es incorrecto
END AS tramo
```

El tramo 91-120 no existe. Una factura vencida de 100 días aparece en "+120" (más de 120 días), lo cual es incorrecto para reportes de cartera. Los tipos TypeScript tienen `'+120'` que sugiere que este es el tramo correcto para MÁS de 120 días, no para 91+.

**Riesgo de negocio:** Los reportes de antigüedad de cartera presentan datos incorrectos. Una deuda de 95 días aparece como si llevara más de 120 días, inflando el riesgo aparente de la cartera.

**Solución:**
```sql
WHEN CURRENT_DATE - f.fecha_pago BETWEEN 61 AND 90 THEN '61-90'
WHEN CURRENT_DATE - f.fecha_pago BETWEEN 91 AND 120 THEN '91-120'
ELSE '+120'
```

### DB-02: Total en compras no tiene CHECK de consistencia

**Severidad: Media | `supabase/schema_compras.sql`**

La columna `total` en compras no tiene una constraint que garantice `total = monto + itbms`. Depende del trigger `calcular_vencimiento_compra` para calcularlo, pero si el trigger falla o se deshabilita, pueden quedar datos inconsistentes.

**Solución:**
```sql
-- Agregar constraint
CONSTRAINT total_consistente CHECK (
  ABS(total - (monto + itbms)) < 0.01
)
```

### DB-03: No hay índice en facturas.monto_pagado

**Severidad: Media | Schema**

Las consultas de cartera filtran por `estado = 'pendiente' AND total > 0`. Con muchas facturas, `monto_pagado` se usa en cálculos pero no tiene índice.

### DB-04: `banco_movimientos` permite montos negativos indirectamente

**Severidad: Media | `supabase/schema.sql`**

El CHECK `monto > 0` existe, pero el tipo `egreso` con monto positivo es correcto. Sin embargo, no hay constraint que impida duplicar un movimiento si el trigger se ejecuta más de una vez (e.g., por un fallo transaccional parcial).

### DB-05: No hay UNIQUE en facturas por número + tipo_documento + fecha

**Severidad: Media | Schema**

La deduplicación de importación se hace en código (Set en JavaScript), no en la base de datos. Si dos procesos de importación corren en paralelo, pueden insertarse facturas duplicadas.

**Solución:**
```sql
ALTER TABLE facturas 
ADD CONSTRAINT uq_factura_tipo UNIQUE (numero_factura, tipo_documento);
```

### DB-06: Gestión de migraciones sin sistema formal

**Severidad: Media | Directorio supabase/**

Hay 4 archivos SQL sin numeración ni sistema de tracking (sin `supabase_migrations` table, sin Supabase CLI). No hay forma de saber el estado real de la DB en producción.

---

## 6. Frontend

### FE-01: Página Admin visible en sidebar para no-admins

**Severidad: Media | `src/components/Sidebar.tsx`**

El link "Administración" aparece en la navegación para todos los usuarios autenticados, independientemente de su rol. Solo al entrar a la página se muestra el mensaje de acceso denegado.

**Solución:** Cargar el rol del usuario en el contexto de la app y ocultar el link condicionalmente.

### FE-02: Sin estado de error global

**Severidad: Media | Aplicación en general**

No hay manejo de errores global (no hay Error Boundary, no hay toast/notification system consistente). Los errores de API se ignoran silenciosamente en ~60% de las mutaciones. La única retroalimentación al usuario es en importar/page.tsx y algunos modales.

### FE-03: Sin accesibilidad básica

**Severidad: Media | Tablas y modales**

- Las tablas no tienen `aria-label` ni `scope` en los `<th>`
- Los modales no tienen `role="dialog"` ni manejo de foco (focus trap)
- Los botones de iconos no tienen `aria-label`
- Sin contraste suficiente en algunos badges (brand-100/brand-700)

### FE-04: `parseNumero` en excel-parser.ts — lógica frágil

**Severidad: Alta | `src/lib/excel-parser.ts`**

```typescript
const parseNumero = (cell) => {
  if (Number.isInteger(cell.v)) {
    return cell.v / 100   // "373,10" → 37310 → 373.10
  } else {
    return cell.v * 1000  // "1.836,00" → 1.836 → 1836.00
  }
}
```

Esta lógica asume que todos los enteros fueron desplazados por el separador de coma, y todos los decimales son el separador de miles. Falla para:
- Un valor exacto como `$1000.00` → SheetJS lo lee como `1000.00` (no entero) → `1000 * 1000 = 1,000,000`
- Un valor como `$1.00` → SheetJS lo lee como `1.0` (no entero) → `1 * 1000 = 1000`

**Riesgo de negocio:** Importación de facturas con montos incorrectos (multiplicados por 1000) sin que el usuario lo note.

**Recomendación:** Validar el resultado contra el total de la fila antes de importar, o usar el valor de texto de la celda (`cell.w`) como fuente de verdad para parsing de formato europeo.

### FE-05: Sin responsive design validado

**Severidad: Baja | Layout general**

El layout usa `w-64` fijo para el sidebar. En pantallas menores a 768px, el contenido queda aplastado. No hay breakpoint para mobile.

---

## 7. Testing

**Severidad: CRÍTICA**

**No existe ningún test en la aplicación.** Ni unitarios, ni de integración, ni E2E.

Los módulos más críticos sin cobertura:
- `excel-parser.ts` — lógica de parsing con casos edge documentados en comentarios pero sin tests que los verifiquen
- Lógica de tramos de cartera (duplicada en 4 lugares, con el bug del 91-120)
- Triggers de base de datos (procesamiento de pagos, cálculo de fechas)
- Importación de facturas (proceso de deduplicación, manejo de errores)
- Ruta de API del DGI (parsing de HTML)

**Riesgo:** Cualquier refactoring rompe la lógica de negocio sin saberlo. El bug de tramos DB-01 probablemente existe desde el inicio y nadie lo detectó porque no hay tests.

---

## 8. DevOps

### DEV-01: Sin CI/CD

**Severidad: Alta**

No hay `.github/workflows/`. No hay pipeline de CI que:
- Ejecute linting antes del merge
- Verifique que el build no falla antes de desplegar
- Corra tests (aunque actualmente no existan)

El deployment a Vercel es directo desde git push sin gates de calidad.

### DEV-02: Variables de entorno en producción no documentadas

**Severidad: Alta**

El `.env.local.example` tiene la URL real de Supabase hardcodeada (`https://tnuzaaetfbbnxtbedlhs.supabase.co`), no como placeholder. No hay documentación de qué variables son necesarias en Vercel.

### DEV-03: `xlsx` versión 0.18.5 con vulnerabilidades conocidas

**Severidad: Alta | `package.json`**

SheetJS CE 0.18.5 tiene reportes de vulnerabilidades en el parsing de archivos maliciosos. El archivo que se procesa viene del usuario directamente. Aunque el servidor no ejecuta el archivo, el parsing en el navegador puede ser explotado.

**Solución:** Evaluar actualización a versión más reciente, o migrar a `exceljs` que tiene mantenimiento activo.

### DEV-04: `next.js` en versión `^14.2.29`

**Severidad: Media**

Next.js 14.x tiene varias CVEs parcheadas en versiones posteriores. No hay pin de versión exacta (`^` permite actualizaciones menores automáticas).

### DEV-05: Sin Dockerfile ni entorno de desarrollo reproducible

**Severidad: Baja**

No hay forma de levantar el stack completo localmente sin acceso a internet (Supabase en la nube). Esto complica el onboarding de nuevos desarrolladores y hace imposible el desarrollo offline.

---

## A. Score Global

| Área | Puntuación | Notas |
|------|-----------|-------|
| Arquitectura | 55/100 | Estructura básica OK, falta separación de capas |
| Calidad de código | 50/100 | Sin tests, errores silenciados, duplicación |
| Seguridad | 45/100 | SSRF, sin headers, admin client-side |
| Rendimiento | 50/100 | N+1, sin paginación, importación serial |
| Base de datos | 65/100 | Schema sólido, RLS bien, bug en tramos |
| Frontend | 55/100 | Funcional, sin accesibilidad, sin responsive |
| Testing | 0/100 | Cero tests |
| DevOps | 35/100 | Sin CI/CD, sin reproducibilidad |

### **Score Global: 45/100**

---

## B. ¿Apruebo producción?

# ❌ NO

No apruebo el paso a producción en el estado actual. Hay al menos **3 blockers** que deben resolverse antes:

1. **SSRF en la ruta DGI QR** — permite que un usuario autenticado use el servidor de Vercel como proxy para requests arbitrarios
2. **Sin manejo de errores en mutaciones críticas** — un fallo silencioso al registrar un pago genera descuadres de cartera irrecuperables
3. **Bug de tramos 91-120** — los reportes de antigüedad presentan datos financieros incorrectos

---

## C. Top 10 Riesgos

| # | Riesgo | Severidad | Probabilidad | Impacto |
|---|--------|-----------|-------------|---------|
| 1 | SSRF en DGI QR permite proxy a URLs arbitrarias | Crítica | Media | Seguridad/Legal |
| 2 | Error silencioso al pagar factura genera descuadres | Alta | Alta | Negocio crítico |
| 3 | Bug tramo 91-120 — reportes de cartera incorrectos | Alta | Certeza | Toma de decisiones |
| 4 | parseNumero puede multiplicar montos por 1000 | Alta | Media | Datos financieros |
| 5 | Sin headers HTTP — clickjacking posible | Alta | Baja | Seguridad usuarios |
| 6 | Importación serial de 500+ facturas → timeout Vercel | Alta | Alta | Operaciones |
| 7 | N+1 en saldos bancarios escala mal | Media | Alta | Rendimiento |
| 8 | Sin tests — refactoring rompe sin aviso | Media | Alta | Mantenibilidad |
| 9 | Datos de tramos no son única fuente de verdad | Media | Alta | Inconsistencia |
| 10 | Sin constraint UNIQUE en facturas — duplicados posibles | Media | Media | Integridad datos |

---

## D. Plan Priorizado de Corrección

### Sprint 1 — Blockers de seguridad (1-2 días)

1. **Corregir validación URL en DGI QR** → usar `new URL()` y verificar hostname exacto
2. **Agregar security headers** → X-Frame-Options, CSP básico, XSCO, etc.
3. **Actualizar allowedOrigins** → incluir dominio de Vercel
4. **Eliminar campo `debug`** en respuestas de error de producción

### Sprint 2 — Correctness de negocio (2-3 días)

5. **Corregir bug tramo 91-120** → SQL en ambas vistas + frontend
6. **Agregar manejo de errores en todas las mutaciones** → toast/alert visible al usuario
7. **Agregar UNIQUE constraint en facturas** → `(numero_factura, tipo_documento)`
8. **Corregir parseNumero** → validar contra total de fila + tests unitarios

### Sprint 3 — Rendimiento (3-4 días)

9. **Convertir importación serial a batch** → reducir 500 requests a <5
10. **Eliminar N+1 en saldos bancarios** → query única o Promise.all
11. **Agregar paginación en facturas y reportes** → `.range()` de Supabase
12. **Mover búsqueda a server-side** → filtros via query params

### Sprint 4 — Calidad y DevOps (5-7 días)

13. **Tests unitarios para excel-parser.ts** → casos edge documentados en comentarios
14. **Tests de integración para importación** → deduplicación, manejo de errores
15. **Configurar GitHub Actions CI** → lint + build en cada PR
16. **Formalizar migraciones con Supabase CLI** → `supabase/config.toml`
17. **Separar lógica de negocio en capa de servicios** → `src/lib/services/`
18. **Dividir reportes/page.tsx** → componentes por módulo

---

## E. Deuda Técnica Estimada

| Categoría | Horas |
|-----------|-------|
| Seguridad (Sprints 1) | 8h |
| Correctness de negocio (Sprint 2) | 16h |
| Rendimiento (Sprint 3) | 20h |
| Tests (mínimo viable) | 24h |
| CI/CD y DevOps | 8h |
| Refactoring de arquitectura | 32h |
| **Total deuda técnica** | **~108 horas** |

A velocidad de 1 desarrollador senior: **~3-4 semanas** para dejar el sistema en estado production-grade.

---

## Próximos Pasos

1. **Inmediato (hoy):** Aplicar fix de SSRF y security headers — 2 horas de trabajo
2. **Esta semana:** Corregir bug de tramos y manejo de errores en mutaciones críticas
3. **Próxima semana:** Batch import y N+1 en banco
4. **Mes 1:** Tests unitarios para lógica financiera crítica + CI/CD
5. **Mes 2:** Refactoring de arquitectura y paginación

---
*Revisado sobre commit: `565dbb2` (Lock Node engine for Vercel)*
