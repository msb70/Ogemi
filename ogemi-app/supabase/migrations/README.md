# Migraciones — Estado y Convención

## Convención de nombres

El Supabase CLI requiere formato timestamp para rastrear migraciones:
```
YYYYMMDDHHMMSS_descripcion.sql
```

## Estado actual

| Archivo | Formato | Estado en prod | Acción requerida |
|---|---|---|---|
| `002_anticipos_pagos.sql` | ❌ Sin timestamp | Aplicada | Ver abajo |
| `003_sprint2_correctness.sql` | ❌ Sin timestamp | Aplicada | Ver abajo |
| `20260602151942_create_presupuestos_module.sql` | ✅ Correcto | Aplicada | Ninguna |

## Cómo reparar `002` y `003`

Las migraciones ya están aplicadas en producción. Renombrarlas directamente
rompería el rastreo del CLI. El procedimiento correcto es:

```bash
# 1. Linkar el CLI con el proyecto remoto
supabase link --project-ref tnuzaaetfbbnxtbedlhs

# 2. Registrar las migraciones existentes como aplicadas con el nombre que tienen
supabase migration repair --status applied 002_anticipos_pagos
supabase migration repair --status applied 003_sprint2_correctness

# 3. Verificar que el CLI las reconoce
supabase migration list
```

Si prefieres normalizar los nombres antes de hacer `repair`:
```bash
# Renombrar localmente con fechas aproximadas de cuando fueron creadas
mv 002_anticipos_pagos.sql 20260530000000_anticipos_pagos.sql
mv 003_sprint2_correctness.sql 20260601000000_sprint2_correctness.sql

# Luego hacer repair con los nombres nuevos
supabase migration repair --status applied 20260530000000_anticipos_pagos
supabase migration repair --status applied 20260601000000_sprint2_correctness
```

## Nuevas migraciones

A partir de ahora, crear siempre con el CLI:
```bash
supabase migration new nombre_descriptivo
# → crea supabase/migrations/YYYYMMDDHHMMSS_nombre_descriptivo.sql
```

O manualmente con timestamp real:
```bash
date +%Y%m%d%H%M%S  # → genera el timestamp
```

## Tests de integración con DB local

Para correr tests que requieren Supabase real (no mocks):
```bash
supabase start          # levanta Postgres local en puerto 54322
npm run test:integration # (cuando se implemente)
supabase stop
```
