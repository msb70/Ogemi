import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { parseRespuestaPAC } from '@/lib/fe-catalogos'

/**
 * Timbra un documento electrónico contra el PAC TheFactory Panamá (CFE Premium Soft).
 * - Corre server-side para no exponer pin/usuario/clave del PAC al navegador.
 * - Body: { documento_id: string }
 * - Respuesta del PAC (texto plano): tipo|mensaje|cufe|fecha_cufe|url_dgi (tipo 2 = éxito)
 * - Si el timbrado es exitoso EN PRODUCCIÓN, registra el documento en cobros:
 *   FE (01/02/03/08/10) → tabla facturas; NC (04/06) → tabla notas_credito.
 * - En ambiente de PRUEBAS el documento se timbra pero NO se registra en cobros,
 *   por lo que no aparece en ningún reporte (cartera, ventas, banco, etc.).
 */

const fmt = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)

export async function POST(req: NextRequest) {
  try {
    const { documento_id } = await req.json()
    if (!documento_id) {
      return NextResponse.json({ error: 'Falta documento_id' }, { status: 400 })
    }

    // 1) Autenticación y permisos
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: perfil } = await supabase
      .from('user_profiles').select('rol_id, activo').eq('id', user.id).single()
    if (!perfil?.activo) return NextResponse.json({ error: 'Usuario inactivo' }, { status: 403 })

    if (perfil.rol_id !== 'admin') {
      const { data: permiso } = await supabase
        .from('rol_permisos').select('puede_agregar')
        .eq('rol_id', perfil.rol_id).eq('modulo', 'factura_electronica').single()
      if (!permiso?.puede_agregar) {
        return NextResponse.json({ error: 'Sin permiso para emitir documentos electrónicos' }, { status: 403 })
      }
    }

    const admin = createAdminClient()

    // 2) Configuración del PAC — selecciona credenciales según ambiente activo
    const { data: config } = await admin.from('fe_config').select('*').eq('id', true).single()
    const esProduccion = config?.ambiente === 'produccion'
    const cred = esProduccion
      ? { pin: config?.pin_prod, usuario: config?.usuario_prod, clave: config?.clave_prod, endpoint: config?.endpoint_url_prod || config?.endpoint_url }
      : { pin: config?.pin, usuario: config?.usuario, clave: config?.clave, endpoint: config?.endpoint_url }
    if (!config?.activo || !cred.pin || !cred.usuario || !cred.clave || !cred.endpoint) {
      return NextResponse.json({
        error: `El PAC no está configurado o está inactivo para el ambiente de ${esProduccion ? 'PRODUCCIÓN' : 'PRUEBAS'}. Un administrador debe completar pin/usuario/clave de ese ambiente en Configuración y activarlo.`,
      }, { status: 422 })
    }

    // 3) Documento + líneas + pagos
    const { data: doc, error: docError } = await admin
      .from('fe_documentos')
      .select('*, fe_documento_lineas(*), fe_documento_pagos(*)')
      .eq('id', documento_id)
      .single()
    if (docError || !doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 })
    if (doc.estado === 'aceptado') {
      return NextResponse.json({ error: 'El documento ya fue timbrado (tiene CUFE).' }, { status: 409 })
    }

    const lineas = (doc.fe_documento_lineas || []).sort((a: any, b: any) => a.orden - b.orden)
    const pagosDoc = doc.fe_documento_pagos || []

    // 4) Validaciones según manual
    if (lineas.length === 0) return NextResponse.json({ error: 'El documento no tiene líneas de detalle.' }, { status: 422 })
    if (pagosDoc.length === 0) return NextResponse.json({ error: 'El documento no tiene formas de pago.' }, { status: 422 })
    if (['01', '03'].includes(doc.tipo_cliente) && (!doc.ruc || !doc.dv)) {
      return NextResponse.json({ error: 'RUC y DV son obligatorios para clientes contribuyentes/gobierno.' }, { status: 422 })
    }
    if (['04', '05'].includes(doc.tipo_doc) && (!doc.cufe_devol || !doc.fecha_cufe_devol)) {
      return NextResponse.json({ error: 'Para NC/ND referenciada (tipos 04/05) el CUFE y fecha del documento afectado son obligatorios.' }, { status: 422 })
    }

    // Totales deben cuadrar con las líneas (precioneto x cantidad + ITBMS)
    let neto = 0, impuesto = 0
    for (const l of lineas) {
      const base = Number(l.precioneto) * Number(l.cantidad)
      neto += base
      impuesto += base * Number(l.prc_impuesto) / 100
    }
    neto = Math.round(neto * 100) / 100
    impuesto = Math.round(impuesto * 100) / 100
    const totalFinal = Math.round((neto + impuesto) * 100) / 100
    if (Math.abs(neto - Number(doc.totneto)) > 0.011 || Math.abs(totalFinal - Number(doc.totalfinal)) > 0.011) {
      return NextResponse.json({
        error: `Los totales no cuadran con las líneas (neto ${fmt(neto)} / total ${fmt(totalFinal)} vs encabezado ${fmt(Number(doc.totneto))} / ${fmt(Number(doc.totalfinal))}).`,
      }, { status: 422 })
    }
    const sumaPagos = pagosDoc.reduce((s: number, p: any) => s + Number(p.monto), 0)
    if (Math.abs(sumaPagos - Number(doc.total_pagado)) > 0.011) {
      return NextResponse.json({ error: 'La suma de las formas de pago no coincide con el total pagado.' }, { status: 422 })
    }

    // 5) Payload JSON según manual TheFactory
    const payload = {
      pin: cred.pin,
      usuario: cred.usuario,
      clave: cred.clave,
      operti: {
        documento: doc.documento,
        codigo_sucursal: config.codigo_sucursal,
        nro_terminal: config.nro_terminal,
        tipo_doc: doc.tipo_doc,
        nombre_cliente: doc.nombre_cliente,
        tipo_contribuyente: Number(doc.tipo_contribuyente),
        tipo_cliente: doc.tipo_cliente,
        ruc: doc.ruc || '',
        dv: doc.dv || '',
        direccion_cliente: doc.direccion_cliente || 'Panamá',
        email_cliente: doc.email_cliente || '',
        totneto: fmt(Number(doc.totneto)),
        totimpuest: fmt(Number(doc.totimpuest)),
        totalfinal: fmt(Number(doc.totalfinal)),
        total_pagado: fmt(Number(doc.total_pagado)),
        codigo_retencion: doc.codigo_retencion || '',
        prc_retencion: fmt(Number(doc.prc_retencion || 0)),
        retencion: fmt(Number(doc.retencion || 0)),
        cufe_devol: doc.cufe_devol || '',
        fecha_cufe_devol: doc.fecha_cufe_devol || '',
        notas: doc.notas || '',
      },
      pagos: pagosDoc.map((p: any) => ({
        codigo: p.codigo,
        nombre: p.nombre,
        monto: fmt(Number(p.monto)),
      })),
      opermv: lineas.map((l: any) => ({
        codigo_articulo: l.codigo_articulo,
        nombre_articulo: l.nombre_articulo,
        precioneto: fmt(Number(l.precioneto)),
        prc_impuesto: String(Number(l.prc_impuesto)),
        cantidad: fmt(Number(l.cantidad)),
        unidad: l.unidad,
        grupo_inv: l.grupo_inv,
        subgr_inv: l.subgr_inv,
      })),
    }

    // 6) Enviar al PAC
    await admin.from('fe_documentos').update({ estado: 'enviando' }).eq('id', doc.id)

    let textoRespuesta = ''
    try {
      const pacRes = await fetch(cred.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      })
      textoRespuesta = await pacRes.text()
    } catch (e: any) {
      await admin.from('fe_documentos').update({
        estado: 'rechazado',
        respuesta_pac: `Error de conexión con el PAC: ${e.message}`,
      }).eq('id', doc.id)
      return NextResponse.json({ error: `No se pudo contactar al PAC: ${e.message}` }, { status: 502 })
    }

    const r = parseRespuestaPAC(textoRespuesta)

    // 7) Resultado
    if (r.tipo !== 2 || !r.cufe) {
      await admin.from('fe_documentos').update({
        estado: 'rechazado',
        respuesta_pac: textoRespuesta.slice(0, 2000),
      }).eq('id', doc.id)
      return NextResponse.json({ ok: false, mensaje: r.mensaje, respuesta: textoRespuesta.slice(0, 500) }, { status: 422 })
    }

    // Éxito: guardar CUFE (con el ambiente en que se timbró) y registrar en cobros
    const updates: Record<string, unknown> = {
      estado: 'aceptado',
      cufe: r.cufe,
      fecha_cufe: r.fecha_cufe,
      url_dgi: r.url_dgi,
      respuesta_pac: textoRespuesta.slice(0, 2000),
      ambiente: esProduccion ? 'produccion' : 'pruebas',
    }

    const esNC = ['04', '06'].includes(doc.tipo_doc)
    const esFactura = ['01', '02', '03', '08', '10'].includes(doc.tipo_doc)
    let integracion = ''

    // Los documentos timbrados en PRUEBAS no se integran a cobros: no deben
    // aparecer en facturas, notas de crédito ni en ningún reporte del sistema.
    if (!esProduccion) {
      integracion = 'Documento de PRUEBAS: no se registró en cobros y no aparecerá en reportes.'
    }

    if (esProduccion && esFactura && !doc.factura_id) {
      const numeroInt = parseInt(doc.documento, 10)
      const { data: existente } = await admin
        .from('facturas').select('id').eq('numero_factura', numeroInt).limit(1)
      if (existente && existente.length > 0) {
        integracion = `La factura #${numeroInt} ya existía en cobros; no se duplicó.`
        updates.factura_id = existente[0].id
      } else {
        const { data: cli } = await admin
          .from('clientes').select('dias_credito, retencion_pct').eq('id', doc.cliente_id).single()
        const fechaPago = new Date(doc.fecha + 'T00:00:00')
        fechaPago.setDate(fechaPago.getDate() + (cli?.dias_credito ?? 30))
        const { data: nueva, error: fErr } = await admin.from('facturas').insert({
          numero_factura: numeroInt,
          fecha: doc.fecha,
          cliente_id: doc.cliente_id,
          tipo_documento: 'FACTURA',
          monto: doc.totneto,
          itbms: doc.totimpuest,
          total: doc.totalfinal,
          fecha_pago: fechaPago.toISOString().split('T')[0],
          estado: 'pendiente',
          retencion_pct: cli?.retencion_pct ?? 0,
          notas: `FE timbrada. CUFE: ${r.cufe}`,
        }).select('id').single()
        if (fErr) integracion = `Timbrada OK, pero no se pudo crear la factura en cobros: ${fErr.message}`
        else { updates.factura_id = nueva.id; integracion = `Factura #${numeroInt} creada en cobros.` }
      }
    }

    if (esProduccion && esNC && !doc.nota_credito_id) {
      const { data: nc, error: ncErr } = await admin.from('notas_credito').insert({
        numero: doc.documento,
        cliente_id: doc.cliente_id,
        fecha: doc.fecha,
        monto: doc.totneto,
        itbms: doc.totimpuest,
        notas: `NC electrónica timbrada. CUFE: ${r.cufe}`,
      }).select('id').single()
      if (ncErr) integracion = `Timbrada OK, pero no se pudo crear la NC en cobros: ${ncErr.message}`
      else { updates.nota_credito_id = nc.id; integracion = 'Nota de crédito disponible en el módulo de NC.' }
    }

    await admin.from('fe_documentos').update(updates).eq('id', doc.id)

    return NextResponse.json({
      ok: true,
      mensaje: r.mensaje,
      cufe: r.cufe,
      fecha_cufe: r.fecha_cufe,
      url_dgi: r.url_dgi,
      integracion,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 })
  }
}
