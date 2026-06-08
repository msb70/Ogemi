# Ogemi — Sistema de Gestión de Cartera
**Impresos Comerciales SA**

Sistema web para gestión de cuentas por cobrar, banco y cartera vencida.
Stack: Next.js 14 + TypeScript + Supabase + Tailwind CSS

---

## SETUP RÁPIDO (30 minutos)

### Paso 1 — Crear proyecto en Supabase

1. Ir a https://supabase.com → **New project**
2. Proyecto usado actualmente: `tnuzaaetfbbnxtbedlhs`
3. Guardar la contraseña de la base de datos
4. Esperar ~2 minutos a que el proyecto se inicialice

### Paso 2 — Correr los SQL de base de datos

1. En el dashboard de Supabase → **SQL Editor** → **New query**
2. Ejecutar estos archivos en orden:
   - `supabase/schema.sql`
   - `supabase/schema_compras.sql`
   - `supabase/migrations/20260602151942_create_presupuestos_module.sql`
   - `supabase/migrations/002_anticipos_pagos.sql`
3. Verificar que no haya errores rojos

### Paso 3 — Crear el primer usuario administrador

1. En Supabase → **Authentication** → **Users** → **Invite user**
2. Ingresar el email del administrador → **Send invite**
3. El usuario recibirá un email para crear su contraseña
4. Copiar el UUID del usuario (columna `id` en la lista de usuarios)
5. En **SQL Editor**, ejecutar:

```sql
INSERT INTO user_roles (user_id, role, puede_ver, puede_editar, puede_borrar)
VALUES ('<PEGAR-UUID-AQUI>', 'admin', true, true, true);
```

### Paso 4 — Configurar la aplicación

1. Copiar `.env.local.example` → `.env.local`
2. Obtener credenciales en Supabase → **Project Settings** → **API**:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://tnuzaaetfbbnxtbedlhs.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhb...
```

### Paso 5 — Instalar y correr localmente

Requisitos: Node.js 18+

```bash
cd ogemi-app
npm install
npm run dev
```

Abrir: http://localhost:3000

---

## MÓDULOS DEL SISTEMA

### 📊 Dashboard
Resumen ejecutivo: cartera total, vencida, cobrado del mes, gráfico de antigüedad por tramos.

### 📄 Facturas
- Listado completo con filtros por estado (pendiente/pagada)
- Búsqueda por número, cliente, tipo
- Registro de cobro: marca como pagada, asigna cuenta bancaria y fecha
- El sistema crea automáticamente el movimiento bancario al cobrar

### 👥 Clientes
- CRUD completo de clientes
- Edición de días de crédito (afecta la fecha de pago de facturas futuras)
- Estadísticas por cliente: pendiente e histórico total
- Clientes se crean automáticamente al importar el Libro de Ventas

### 🏦 Banco
**Cuentas**: Catálogo de cuentas bancarias con saldo en tiempo real
**Movimientos**: Ingresos y egresos manuales por cuenta
**Cierre de mes**: Comparar saldo del sistema vs estado de cuenta del banco

### 📈 Reportes
**Cartera vencida**: Tabla y resumen por tramos (corriente, 1-30, 31-60, 61-90, +120 días)
**Por mes**: Gráfico y tabla de facturación mensual con % cobrado
**Por cliente**: Ranking de deudores con barra de proporciones

### 📤 Importar
Upload del Libro de Ventas en Excel (.xlsx):
1. Arrastra o selecciona el archivo
2. Vista previa de los registros detectados
3. Clic en "Importar al sistema"
4. El sistema: crea clientes nuevos, evita duplicados, calcula fecha de pago

### 🔐 Administración
Gestión de roles y permisos por usuario:
- **Admin**: acceso total
- **Operador**: ver + editar, sin borrar ni administrar usuarios
- **Lectura**: solo consulta

---

## FLUJO DE TRABAJO TÍPICO

```
1. Recibir el Libro de Ventas del mes (Excel)
2. Ir a "Importar" → subir el archivo → importar
3. En "Facturas" revisar las facturas importadas
4. Cuando un cliente paga: clic en "Cobrar" → seleccionar cuenta → confirmar
5. En "Banco" registrar egresos del mes (gastos, pagos a proveedores)
6. Al cierre del mes: "Banco" → "Cierre de mes" → ingresar saldo del estado de cuenta
7. En "Reportes" revisar la cartera vencida y enviar cobros
```

---

## DESPLIEGUE EN PRODUCCIÓN

### Opción A: Vercel (recomendado, gratis)
```bash
npm install -g vercel
vercel --prod
```
Agregar las variables de entorno en el dashboard de Vercel.

### Opción B: Hostinger / VPS
```bash
npm run build
npm start
```
Usar PM2 para mantener el proceso activo:
```bash
npm install -g pm2
pm2 start npm --name "ogemi" -- start
```

---

## ESTRUCTURA DEL PROYECTO

```
ogemi-app/
├── supabase/
│   ├── schema.sql          # Schema base: clientes, facturas, banco y seguridad
│   ├── schema_compras.sql  # Compras y proveedores
│   └── migrations/         # Presupuestos, anticipos y pagos parciales
├── src/
│   ├── app/
│   │   ├── login/           # Página de login
│   │   ├── dashboard/       # Dashboard principal
│   │   ├── facturas/        # Gestión de facturas
│   │   ├── clientes/        # Gestión de clientes
│   │   ├── banco/           # Módulo bancario
│   │   ├── reportes/        # Reportes y análisis
│   │   ├── importar/        # Importación de Excel
│   │   └── admin/           # Administración de usuarios
│   ├── components/          # Componentes reutilizables
│   ├── lib/
│   │   ├── supabase.ts      # Cliente Supabase (browser)
│   │   ├── supabase-server.ts # Cliente Supabase (server)
│   │   ├── excel-parser.ts  # Parser del Libro de Ventas
│   │   └── utils.ts         # Utilidades generales
│   └── types/
│       └── index.ts         # Tipos TypeScript
├── .env.local.example       # Template de variables de entorno
├── package.json
└── README.md
```

---

## SOPORTE

Para agregar un usuario nuevo:
1. Supabase → Authentication → Invite user → ingresar email
2. Ejecutar SQL con su UUID y rol deseado

Para cambiar días de crédito de un cliente:
- Ir a Clientes → clic en el ícono de lápiz → cambiar días → guardar
- Las facturas **ya importadas** no cambian su fecha_pago (solo las futuras)

Para recalcular fecha_pago de facturas existentes:
```sql
UPDATE facturas f
SET fecha = f.fecha  -- forzar re-trigger
WHERE estado = 'pendiente';
```
