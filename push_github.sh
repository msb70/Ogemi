#!/bin/bash
# Script para hacer push de Ogemi a GitHub
# Ejecutar UNA sola vez desde Terminal:
#   cd ~/Documents/Claude/Projects/Ogemi && bash push_github.sh

set -e  # detener si hay error

cd "$(dirname "$0")"

echo "📁 Directorio: $(pwd)"

# 1. Quitar lock si quedó de proceso anterior
rm -f .git/index.lock
echo "✅ Lock limpio"

# 2. Commit
git commit -m "feat: módulo compras/proveedores + dashboard períodos + reportes completos

- Tabla proveedores: nombre, días_crédito, activo, RLS
- Tabla compras: fecha, vencimiento auto, proveedor, monto, ITBMS, total, estado, banco/cuenta, RLS
- Trigger vencimiento = fecha + días_crédito del proveedor
- Trigger egreso bancario automático al pagar compra
- Vista compras_vencidas con tramos de antigüedad
- compra_id en banco_movimientos para trazabilidad
- /proveedores: CRUD completo
- /compras: listado, pago rápido, cuentas por pagar por tramos
- Dashboard: selector mensual/trimestral/anual, KPIs con % variación,
  saldo bancos, bar chart, pie charts por cliente y proveedor
- Reportes: 4 módulos (Ventas, Compras, NC, Banco) con sub-reportes
- Sidebar actualizado, types actualizados"

echo "✅ Commit creado"

# 3. Configurar remoto (solo si no existe)
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/msb70/Ogemi.git
echo "✅ Remoto configurado: https://github.com/msb70/Ogemi.git"

# 4. Push
echo "🚀 Haciendo push a GitHub..."
git push -u origin main

echo ""
echo "✅ ¡Push exitoso! https://github.com/msb70/Ogemi"
