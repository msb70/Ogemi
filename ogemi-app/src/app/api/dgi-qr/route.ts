import { NextRequest, NextResponse } from 'next/server'

/**
 * API route para consultar facturas del DGI Panama por QR
 * Recibe la URL del QR, hace el fetch server-side (sin CORS) y parsea el HTML
 *
 * Campos extraídos:
 *   - numero_factura: heading "No. XXXXXXXXXX"
 *   - fecha:          heading "DD/MM/YYYY HH:MM:SS"  → convertido a YYYY-MM-DD
 *   - emisor_nombre:  sección EMISOR → NOMBRE
 *   - emisor_ruc:     sección EMISOR → RUC
 *   - monto:          "Valor Total:" (subtotal sin ITBMS)
 *   - itbms:          "ITBMS Total:"
 */

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractBetween(html: string, before: string, after: string): string | null {
  const idx = html.indexOf(before)
  if (idx === -1) return null
  const start = idx + before.length
  const end = html.indexOf(after, start)
  if (end === -1) return null
  return stripHtml(html.substring(start, end)).trim()
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()

    // SEC-01: Validar hostname exacto para prevenir SSRF
    // .includes() es bypasseable con: dgi-fep.mef.gob.pa.evil.com
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return NextResponse.json({ error: 'URL inválida' }, { status: 400 })
    }
    if (!url || parsedUrl.hostname !== 'dgi-fep.mef.gob.pa') {
      return NextResponse.json({ error: 'URL inválida' }, { status: 400 })
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OgemiApp/1.0)',
        'Accept': 'text/html',
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: `DGI respondió ${response.status}` }, { status: 502 })
    }

    const html = await response.text()

    // --- Número de factura ---
    // <h2>No. 0000000001</h2>  o similar
    const noMatch = html.match(/No\.\s*([\d]+)/)
    const numero_factura = noMatch ? noMatch[1].replace(/^0+/, '') || noMatch[1] : null

    // --- Fecha emisión ---
    // heading: "19/05/2026 17:53:21"
    const fechaMatch = html.match(/(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}:\d{2}/)
    let fecha: string | null = null
    if (fechaMatch) {
      // Convertir DD/MM/YYYY → YYYY-MM-DD
      fecha = `${fechaMatch[3]}-${fechaMatch[2]}-${fechaMatch[1]}`
    }

    // --- Emisor ---
    // Sección EMISOR contiene: RUC, DV, NOMBRE, DIRECCIÓN, TELÉFONO
    // Buscamos el bloque EMISOR y extraemos RUC y NOMBRE
    const emisorBlock = html.match(/EMISOR[\s\S]{0,800}?RECEPTOR/)
    let emisor_ruc: string | null = null
    let emisor_nombre: string | null = null

    if (emisorBlock) {
      const block = emisorBlock[0]
      const rucMatch = block.match(/RUC[\s\S]*?>([\w\d-]+)</)
      if (rucMatch) emisor_ruc = rucMatch[1].trim()

      const nombreMatch = block.match(/NOMBRE[\s\S]*?>([\w\s,.\-ÁÉÍÓÚÑÜ]+)</)
      if (nombreMatch) emisor_nombre = nombreMatch[1].trim()

      // Fallback más flexible
      if (!emisor_ruc) {
        const rucFlex = block.match(/RUC\s*<\/\w+>\s*<[^>]+>([\w\d-]+)</)
        if (rucFlex) emisor_ruc = rucFlex[1].trim()
      }
    }

    // Fallback con extractBetween para RUC y nombre del emisor
    if (!emisor_ruc || !emisor_nombre) {
      // Buscar texto plano entre tags en el bloque emisor
      const emisorIdx = html.indexOf('EMISOR')
      const receptorIdx = html.indexOf('RECEPTOR', emisorIdx)
      if (emisorIdx !== -1 && receptorIdx !== -1) {
        const emisorSection = html.substring(emisorIdx, receptorIdx)
        const texts = emisorSection
          .replace(/<[^>]+>/g, '\n')
          .split('\n')
          .map(s => s.trim())
          .filter(s => s.length > 0)

        // texts: ["EMISOR","RUC","E-8-123654","DV","60","NOMBRE","MIGUEL SPINA", ...]
        const rucIdx = texts.indexOf('RUC')
        if (rucIdx !== -1 && texts[rucIdx + 1]) emisor_ruc = texts[rucIdx + 1]

        const nomIdx = texts.indexOf('NOMBRE')
        if (nomIdx !== -1 && texts[nomIdx + 1]) emisor_nombre = texts[nomIdx + 1]
      }
    }

    // --- Montos ---
    // "Valor Total:</...> <...>963.00"
    const valorTotalMatch = html.match(/Valor Total[:\s\S]*?>([\d,]+\.?\d*)</)
    const itbmsMatch = html.match(/ITBMS Total[:\s\S]*?>([\d,]+\.?\d*)</)

    const parseAmount = (s: string | undefined) => {
      if (!s) return 0
      return parseFloat(s.replace(/,/g, '')) || 0
    }

    // "Valor Total" en DGI = total de la factura (base + ITBMS)
    // monto base = Valor Total - ITBMS Total
    const total = parseAmount(valorTotalMatch?.[1])
    const itbms = parseAmount(itbmsMatch?.[1])
    const monto = Math.round((total - itbms) * 100) / 100  // base sin ITBMS

    if (!numero_factura || !emisor_nombre || total === 0) {
      // SEC-03: No exponer datos de parseo en producción
      const debugInfo = process.env.NODE_ENV === 'development'
        ? { debug: { numero_factura, fecha, emisor_nombre, emisor_ruc, total, itbms } }
        : {}
      return NextResponse.json({
        error: 'No se pudieron extraer los datos de la factura. Verifica que la URL del QR sea correcta.',
        ...debugInfo
      }, { status: 422 })
    }

    return NextResponse.json({
      numero_factura,
      fecha,
      emisor_nombre,
      emisor_ruc,
      monto,   // base sin ITBMS
      itbms,
      total,   // total con ITBMS
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}
