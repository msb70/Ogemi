import fs from 'fs'
import path from 'path'

const appRoot = path.resolve(__dirname, '../../..')

function readProjectFile(relativePath: string) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8')
}

describe('production hardening guardrails', () => {
  const migration = readProjectFile(
    'supabase/migrations/20260615161000_harden_accounting_views_and_payment_reversals.sql'
  )

  it('keeps cartera_vencida aligned with partial payments and aging buckets', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.cartera_vencida')
    expect(migration).toContain('COALESCE(f.monto_pagado, 0) AS monto_pagado')
    expect(migration).toContain('(f.total - COALESCE(f.monto_pagado, 0)) AS saldo_pendiente')
    expect(migration).toContain("WHEN CURRENT_DATE - f.fecha_pago BETWEEN 91 AND 120 THEN '91-120'")
    expect(migration).toContain("AND (f.total - COALESCE(f.monto_pagado, 0)) > 0")
  })

  it('keeps compras_vencidas aligned with partial payments and aging buckets', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.compras_vencidas')
    expect(migration).toContain('COALESCE(c.monto_pagado, 0) AS monto_pagado')
    expect(migration).toContain('(c.total - COALESCE(c.monto_pagado, 0)) AS saldo_pendiente')
    expect(migration).toContain("WHEN CURRENT_DATE - c.vencimiento BETWEEN 91 AND 120 THEN '91-120'")
    expect(migration).toContain("AND (c.total - COALESCE(c.monto_pagado, 0)) > 0")
  })

  it('makes payments immutable and provides an auditable reversal path', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.pago_reversos')
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.pagos')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.reversar_pago')
    expect(migration).toContain("'Reverso cobro factura - '")
    expect(migration).toContain("'Reverso pago compra - '")
  })

  it('does not return temporary passwords from admin user API responses', () => {
    const route = readProjectFile('src/app/api/admin/users/route.ts')
    const responseLines = route
      .split('\n')
      .filter(line => line.includes('return NextResponse.json'))
      .join('\n')

    expect(responseLines).not.toContain('tempPassword')
    expect(responseLines).not.toMatch(/\bpassword\b/)
  })

  it('does not render or copy temporary passwords in the users page', () => {
    const page = readProjectFile('src/app/usuarios/page.tsx')
    expect(page).not.toContain('TempPasswordDialog')
    expect(page).not.toContain('navigator.clipboard.writeText(password)')
    expect(page).not.toContain('result.tempPassword')
  })
})
