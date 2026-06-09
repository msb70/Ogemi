'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Camera, CameraOff, Loader2, RefreshCw } from 'lucide-react'

interface QrScannerProps {
  onDetected: (url: string) => void
  active: boolean
}

type ScanStatus = 'idle' | 'starting' | 'scanning' | 'error'
type ErrorKind = 'permission_denied' | 'no_media_devices' | 'not_found' | 'generic'

interface ScanError {
  kind: ErrorKind
  message: string
}

function classifyError(e: any): ScanError {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return {
      kind: 'no_media_devices',
      message: 'La cámara no está disponible. Esta función requiere una conexión segura (HTTPS).',
    }
  }
  if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
    return {
      kind: 'permission_denied',
      message: 'Permiso de cámara denegado.',
    }
  }
  if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
    return {
      kind: 'not_found',
      message: 'No se encontró ninguna cámara en este dispositivo.',
    }
  }
  return {
    kind: 'generic',
    message: e?.message ? `Error de cámara: ${e.message}` : 'No se pudo acceder a la cámara.',
  }
}

const BROWSER_INSTRUCTIONS: Record<string, string> = {
  Chrome: 'En Chrome: haz clic en el ícono de cámara en la barra de direcciones → Permitir siempre.',
  Safari: 'En Safari: ve a Ajustes del sitio web → Cámara → Permitir.',
  Firefox: 'En Firefox: haz clic en el candado en la barra de direcciones → Permisos → Cámara.',
}

function detectBrowser(): string {
  if (typeof navigator === 'undefined') return 'Chrome'
  const ua = navigator.userAgent
  if (ua.includes('Firefox')) return 'Firefox'
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari'
  return 'Chrome'
}

export default function QrScanner({ onDetected, active }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [status, setStatus] = useState<ScanStatus>('idle')
  const [scanError, setScanError] = useState<ScanError | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const detectedRef = useRef(false)
  const browser = detectBrowser()

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    detectedRef.current = false
  }, [])

  useEffect(() => {
    if (!active) { stopCamera(); setStatus('idle'); return }

    let cancelled = false
    setStatus('starting')
    setScanError(null)
    detectedRef.current = false

    const scanLoop = async () => {
      if (!videoRef.current || !canvasRef.current || detectedRef.current) return
      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scanLoop)
        return
      }

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)

      try {
        const jsQR = (await import('jsqr')).default
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        })
        if (code && code.data.includes('dgi-fep.mef.gob.pa')) {
          detectedRef.current = true
          stopCamera()
          setStatus('idle')
          onDetected(code.data)
          return
        }
      } catch (_) {}

      rafRef.current = requestAnimationFrame(scanLoop)
    }

    const startCamera = async () => {
      // Verificar disponibilidad de mediaDevices (requiere HTTPS en producción)
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setScanError(classifyError(null))
          setStatus('error')
        }
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setStatus('scanning')
          scanLoop()
        }
      } catch (e: any) {
        if (!cancelled) {
          setScanError(classifyError(e))
          setStatus('error')
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [active, retryCount, stopCamera])

  function handleRetry() {
    setScanError(null)
    setStatus('starting')
    setRetryCount(prev => prev + 1)
  }

  if (status === 'error' && scanError) {
    return (
      <div className="flex flex-col items-center gap-4 bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <CameraOff size={32} className="text-red-400" />

        <div className="space-y-1">
          <p className="text-sm font-medium text-red-700">{scanError.message}</p>

          {scanError.kind === 'permission_denied' && (
            <p className="text-xs text-red-500 max-w-xs">
              {BROWSER_INSTRUCTIONS[browser]}
              {' '}Luego recarga la página.
            </p>
          )}

          {scanError.kind === 'no_media_devices' && (
            <p className="text-xs text-red-500 max-w-xs">
              Asegúrate de acceder al sistema desde una URL con HTTPS.
            </p>
          )}
        </div>

        {scanError.kind !== 'no_media_devices' && (
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} />
            Reintentar
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        playsInline
        muted
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* Overlay con guía de enfoque */}
      {status === 'scanning' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-52 h-52 relative">
            {/* Esquinas del marco */}
            {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
              <div key={i} className={`absolute w-8 h-8 border-white border-4 ${pos} ${
                i < 2 ? (i === 0 ? 'border-r-0 border-b-0' : 'border-l-0 border-b-0')
                       : (i === 2 ? 'border-r-0 border-t-0' : 'border-l-0 border-t-0')
              }`} />
            ))}
            {/* Línea de escaneo animada */}
            <div className="absolute left-0 right-0 h-0.5 bg-green-400 opacity-80 animate-scan"
                 style={{ animation: 'scan 2s linear infinite' }} />
          </div>
        </div>
      )}

      {status === 'starting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-2 text-white">
            <Loader2 size={28} className="animate-spin" />
            <span className="text-sm">Iniciando cámara...</span>
          </div>
        </div>
      )}

      {status === 'scanning' && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
          <span className="bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
            Apunta al código QR de la factura DGI
          </span>
        </div>
      )}

      <style>{`
        @keyframes scan {
          0% { top: 10%; }
          50% { top: 85%; }
          100% { top: 10%; }
        }
      `}</style>
    </div>
  )
}
