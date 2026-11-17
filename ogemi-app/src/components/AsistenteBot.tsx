'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Send, X, Loader2 } from 'lucide-react'

/**
 * Asistente flotante (IA: Groq o Grok) — botón con el logo de Impresos Comerciales.
 * Responde solo sobre los datos de la app vía /api/asistente (lectura con la sesión del usuario).
 * La conversación vive en memoria; se borra al recargar la página.
 */

type Mensaje = { role: 'user' | 'assistant'; content: string; error?: boolean }

const SUGERENCIAS = [
  '¿Qué cliente tiene mayor venta este año?',
  '¿Cuánto le debemos a cada proveedor?',
  '¿Cuántas facturas pendientes tiene el proveedor…?',
  '¿Cuál es la cartera vencida de más de 60 días?',
]

// --- Render mínimo de markdown (negritas, listas y tablas) sin dependencias ---
function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>
      : <span key={`${key}-${i}`}>{p}</span>
  )
}

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Tabla: línea con | seguida de separador |---|
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const head = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++ }
      out.push(
        <div key={`t${i}`} className="overflow-x-auto my-1.5">
          <table className="text-xs border-collapse w-full">
            <thead><tr>{head.map((h, k) => <th key={k} className="border-b border-gray-300 px-2 py-1 text-left font-semibold whitespace-nowrap">{inline(h, `h${k}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="odd:bg-gray-50">{r.map((c, k) => <td key={k} className="px-2 py-1 whitespace-nowrap">{inline(c, `c${ri}${k}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
      continue
    }
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (li) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
        if (!m) break
        items.push(m[1]); i++
      }
      out.push(<ul key={`l${i}`} className="list-disc pl-5 my-1 space-y-0.5">{items.map((t, k) => <li key={k}>{inline(t, `li${i}${k}`)}</li>)}</ul>)
      continue
    }
    const h = line.match(/^#{1,4}\s+(.*)$/)
    if (h) { out.push(<p key={`h${i}`} className="font-semibold mt-1">{inline(h[1], `hh${i}`)}</p>); i++; continue }
    if (line.trim() === '') { out.push(<div key={`b${i}`} className="h-1.5" />); i++; continue }
    out.push(<p key={`p${i}`}>{inline(line, `p${i}`)}</p>)
    i++
  }
  return <div className="space-y-0.5">{out}</div>
}

export default function AsistenteBot() {
  const [open, setOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(false)
  const [mounted, setMounted] = useState(false)
  const finRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [configurado, setConfigurado] = useState(false)

  useEffect(() => {
    setMounted(true)
    fetch('/api/asistente').then(r => r.json()).then(d => setConfigurado(!!d?.configurado)).catch(() => setConfigurado(false))
  }, [])
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mensajes, cargando, open])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 250) }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const toggle = () => {
    setPressed(true)
    setTimeout(() => setPressed(false), 650)
    setOpen(o => !o)
  }

  const enviar = async (pregunta?: string) => {
    const q = (pregunta ?? texto).trim()
    if (!q || cargando) return
    const historial: Mensaje[] = [...mensajes.filter(m => !m.error), { role: 'user', content: q }]
    setMensajes(prev => [...prev, { role: 'user', content: q }])
    setTexto('')
    setCargando(true)
    try {
      const res = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historial.map(({ role, content }) => ({ role, content })) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Error ${res.status}`)
      setMensajes(prev => [...prev, { role: 'assistant', content: data.respuesta || '' }])
    } catch (e: any) {
      setMensajes(prev => [...prev, { role: 'assistant', content: e?.message || 'No se pudo obtener respuesta.', error: true }])
    } finally {
      setCargando(false)
    }
  }

  if (!mounted || !configurado) return null

  return createPortal(
    <div className="print:hidden">
      <style>{`
        @keyframes asis-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        @keyframes asis-ring { 0% { transform: scale(1); opacity: .55 } 100% { transform: scale(1.65); opacity: 0 } }
        @keyframes asis-press {
          0% { transform: scale(1) rotate(0) } 25% { transform: scale(.82) rotate(-12deg) }
          55% { transform: scale(1.12) rotate(10deg) } 80% { transform: scale(.97) rotate(-4deg) } 100% { transform: scale(1) rotate(0) }
        }
        @keyframes asis-squares { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
        @keyframes asis-panel { from { opacity: 0; transform: translateY(16px) scale(.97) } to { opacity: 1; transform: none } }
        @keyframes asis-dot { 0%,80%,100% { opacity: .25; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-3px) } }
        .asis-float { animation: asis-float 3.2s ease-in-out infinite }
        .asis-ring { animation: asis-ring 2.4s ease-out infinite }
        .asis-press { animation: asis-press .65s cubic-bezier(.34,1.56,.64,1) }
        .asis-squares { animation: asis-squares 2.2s ease-in-out infinite }
        .asis-panel { animation: asis-panel .22s ease-out }
        .asis-dot { animation: asis-dot 1.2s infinite }
        @media (prefers-reduced-motion: reduce) { .asis-float,.asis-ring,.asis-squares,.asis-press { animation: none } }
      `}</style>

      {open && (
        <div className="asis-panel fixed z-[70] bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[420px] h-[min(620px,calc(100vh-8rem))] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
            <img src="/logo.jpeg" alt="Impresos Comerciales" className="h-7 w-auto object-contain" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 leading-tight">Asistente</p>
              <p className="text-[11px] text-gray-400 leading-tight">Pregunta sobre los datos de la app</p>
            </div>
            {mensajes.length > 0 && (
              <button onClick={() => setMensajes([])} className="text-[11px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded" title="Nueva conversación">Limpiar</button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Cerrar asistente" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {mensajes.length === 0 && (
              <div className="text-gray-500">
                <p className="mb-3">Hola. Puedo responder preguntas sobre clientes, ventas, proveedores, compras, cobros, banco y anticipos. Prueba con:</p>
                <div className="flex flex-col gap-2">
                  {SUGERENCIAS.map(s => (
                    <button key={s} onClick={() => s.endsWith('…?') ? (setTexto(s.replace('…?', ' ')), inputRef.current?.focus()) : enviar(s)}
                      className="text-left text-xs bg-gray-50 hover:bg-brand-50 border border-gray-200 hover:border-brand-200 rounded-xl px-3 py-2 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={
                  m.role === 'user'
                    ? 'max-w-[85%] bg-brand-600 text-white rounded-2xl rounded-br-md px-3 py-2 whitespace-pre-wrap break-words'
                    : m.error
                      ? 'max-w-[90%] bg-red-50 text-red-700 border border-red-100 rounded-2xl rounded-bl-md px-3 py-2'
                      : 'max-w-[92%] bg-gray-100 text-gray-800 rounded-2xl rounded-bl-md px-3 py-2 break-words'
                }>
                  {m.role === 'assistant' && !m.error ? <Markdown text={m.content} /> : m.content}
                </div>
              </div>
            ))}
            {cargando && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-3 py-2.5 flex gap-1">
                  <span className="asis-dot w-1.5 h-1.5 rounded-full bg-gray-500" />
                  <span className="asis-dot w-1.5 h-1.5 rounded-full bg-gray-500" style={{ animationDelay: '.15s' }} />
                  <span className="asis-dot w-1.5 h-1.5 rounded-full bg-gray-500" style={{ animationDelay: '.3s' }} />
                </div>
              </div>
            )}
            <div ref={finRef} />
          </div>

          <form className="border-t border-gray-100 p-3 flex items-end gap-2" onSubmit={e => { e.preventDefault(); enviar() }}>
            <textarea
              ref={inputRef}
              rows={1}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
              placeholder="Escribe tu pregunta…"
              className="input flex-1 resize-none max-h-32 text-sm"
            />
            <button type="submit" disabled={cargando || !texto.trim()} aria-label="Enviar"
              className="btn-primary h-10 w-10 flex items-center justify-center p-0 rounded-xl disabled:opacity-40">
              {cargando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
          <p className="text-[10px] text-gray-400 text-center pb-2 -mt-1">Respuestas generadas con IA. Verifica las cifras importantes.</p>
        </div>
      )}

      <div className="fixed z-[70] bottom-5 right-4 sm:right-6">
        <div className={open ? '' : 'asis-float'}>
          {!open && <span className="asis-ring absolute inset-0 rounded-full bg-brand-400 pointer-events-none" />}
          <button
            onClick={toggle}
            aria-label={open ? 'Cerrar asistente' : 'Abrir asistente'}
            title="Asistente"
            className={`relative w-16 h-16 rounded-full bg-white shadow-xl ring-1 ring-gray-200 hover:shadow-2xl hover:scale-105 active:scale-90 transition-transform duration-150 flex items-center justify-center overflow-hidden ${pressed ? 'asis-press' : ''}`}
          >
            {open
              ? <X size={26} className="text-gray-600" />
              : <img src="/asistente-icono.png" alt="" className="asis-squares w-11 h-11 object-contain" />}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
