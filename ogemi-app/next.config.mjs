/** @type {import('next').NextConfig} */

// SEC-04: Security headers HTTP
const securityHeaders = [
  // Previene clickjacking — nadie puede embeber la app en un iframe
  { key: 'X-Frame-Options', value: 'DENY' },
  // Previene MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Limita información enviada en el Referer header
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Desactiva features del navegador no necesarias
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // CSP básico: permite recursos propios + Supabase + estilos inline (necesario para Tailwind)
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval necesario para Next.js dev; evaluar eliminar en prod
      "style-src 'self' 'unsafe-inline'",                // unsafe-inline necesario para Tailwind
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self' https://tnuzaaetfbbnxtbedlhs.supabase.co wss://tnuzaaetfbbnxtbedlhs.supabase.co`,
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig = {
  async headers() {
    return [
      {
        // Aplicar a todas las rutas
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  experimental: {
    serverActions: {
      // SEC-05: Incluir dominio de producción en Vercel
      allowedOrigins: ['localhost:3000', 'ogemi-iota.vercel.app'],
    },
  },
}

export default nextConfig
