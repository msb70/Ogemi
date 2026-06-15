/** @type {import('next').NextConfig} */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tnuzaaetfbbnxtbedlhs.supabase.co'
const supabaseWsUrl = supabaseUrl.replace(/^https:/, 'wss:')
const scriptSrc = process.env.NODE_ENV === 'production'
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'"

// SEC-04: Security headers HTTP
const securityHeaders = [
  // Previene clickjacking — nadie puede embeber la app en un iframe
  { key: 'X-Frame-Options', value: 'DENY' },
  // Previene MIME-type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Limita información enviada en el Referer header
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Desactiva features del navegador no necesarias
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  // CSP básico: permite recursos propios + Supabase + estilos inline (necesario para Tailwind)
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",                // unsafe-inline necesario para Tailwind
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self' ${supabaseUrl} ${supabaseWsUrl}`,
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
