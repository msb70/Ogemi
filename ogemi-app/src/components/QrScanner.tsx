'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Loader2 } from 'lucide-react'

interface QrScannerProps {
  onDetected: (url: string) => void
  active: boolean
}

export default function QrScanner({ onDetected, active }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const detectedRef = useRef(false)

  const stopCamera = () => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    detectedRef.current = false
  }

  useEffect(() => {
    if (!active) { stopCamera(); setStatus('idle'); return }

    let cancelled = false
    setStatus('starting')
    detectedRef.current = false

    const startCamera = async () => {
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
          setErrorMsg(e.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilítalo en la configuración del navegador.'
            : 'No se pudo acceder a la cámara: ' + e.message)
          setStatus('error')
        }
      }
    }

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

    startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [active])

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <CameraOff size={32} className="text-red-400" />
        <p className="text-sm text-red-600">{errorMsg}</p>
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
