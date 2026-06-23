import { MANUAL_MODULOS } from './manual'

type EmailResult =
  | { sent: true; provider: 'resend'; id?: string }
  | { sent: false; provider: 'resend' | 'none'; error: string }

type WelcomeEmailInput = {
  to: string
  name: string
  tempPassword: string
  modulosVisibles?: string[]
  rolNombre?: string
}

type ManualEmailInput = {
  to: string
  name: string
  modulosVisibles?: string[]
  rolNombre?: string
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getAppUrl() {
  return (
    process.env.OGEMI_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://ogemi-iota.vercel.app'
  ).replace(/\/$/, '')
}

// Encabezado de marca (logo + nombre) reutilizable en los correos.
function brandHeaderHtml() {
  const logoUrl = `${getAppUrl()}/logo.jpeg`
  return `
    <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); border-radius: 12px; padding: 20px 24px; margin: 0 0 24px; text-align: center;">
      <img src="${logoUrl}" alt="Ogemi" width="64" height="64" style="display:inline-block; width:64px; height:64px; border-radius:12px; background:#ffffff; padding:6px; object-fit:contain;" />
      <p style="margin: 10px 0 0; color:#ffffff; font-size:18px; font-weight:bold; letter-spacing:0.5px;">OGEMI</p>
      <p style="margin: 2px 0 0; color:rgba(255,255,255,0.85); font-size:12px;">Impresos Comerciales S.A.</p>
    </div>`
}

async function sendViaResend(input: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.OGEMI_EMAIL_FROM

  if (!apiKey || !from) {
    return {
      sent: false,
      provider: 'none',
      error: 'Falta configurar RESEND_API_KEY y OGEMI_EMAIL_FROM para enviar correos.',
    }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      reply_to: process.env.OGEMI_EMAIL_REPLY_TO || undefined,
    }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    return {
      sent: false,
      provider: 'resend',
      error: payload?.message || payload?.error || 'No se pudo enviar el correo.',
    }
  }

  return { sent: true, provider: 'resend', id: payload?.id }
}

export async function sendWelcomeEmail({ to, name, tempPassword, modulosVisibles, rolNombre }: WelcomeEmailInput): Promise<EmailResult> {
  const safeName = escapeHtml(name || to)
  const safeEmail = escapeHtml(to)
  const safePassword = escapeHtml(tempPassword)
  const loginUrl = `${getAppUrl()}/login`
  const manualUrl = `${getAppUrl()}/manual`
  const safeLoginUrl = escapeHtml(loginUrl)
  const safeManualUrl = escapeHtml(manualUrl)
  const rolLinea = rolNombre
    ? `<p style="margin:0 0 16px; text-align:center; color:#6b7280; font-size:13px;">Su rol asignado: <strong style="color:#374151;">${escapeHtml(rolNombre)}</strong></p>`
    : ''
  void modulosVisibles

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 520px; margin: 0 auto;">
      ${brandHeaderHtml()}
      <h1 style="font-size: 20px; margin: 0 0 14px; color:#111827;">Bienvenido a Ogemi</h1>
      <p style="margin:0 0 12px;">Hola ${safeName},</p>
      <p style="margin:0 0 16px;">Lo invitamos al sistema de gestión de cartera de Impresos Comerciales S.A. Estos son sus datos de acceso inicial:</p>
      ${rolLinea}

      <div style="background:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; padding:16px; margin:0 0 20px; text-align:center;">
        <p style="margin:0 0 4px; font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0f766e;">Su correo</p>
        <p style="margin:0 0 12px; font-size:15px; font-weight:bold; color:#115e59;">${safeEmail}</p>
        <p style="margin:0 0 4px; font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0f766e;">Su clave temporal</p>
        <p style="margin:0; font-family:'Courier New', monospace; font-size:24px; font-weight:bold; color:#115e59; letter-spacing:2px;">${safePassword}</p>
      </div>

      <div style="text-align:center; margin:0 0 14px;">
        <a href="${safeLoginUrl}" style="display:inline-block; background:#0f766e; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-size:15px; font-weight:bold;">
          Entrar a Ogemi
        </a>
      </div>
      <div style="text-align:center; margin:0 0 22px;">
        <a href="${safeManualUrl}" style="display:inline-block; background:#ffffff; color:#0f766e; text-decoration:none; padding:11px 26px; border-radius:8px; font-size:14px; font-weight:bold; border:1px solid #0f766e;">
          Ver manual del sistema
        </a>
      </div>

      <p style="margin:0 0 4px; font-size:14px; color:#374151;">Al entrar por primera vez, el sistema le pedirá cambiar esta clave.</p>
      <p style="font-size:12px; color:#9ca3af; margin:16px 0 0;">Si usted no esperaba esta invitación, ignore este correo. — Impresos Comerciales S.A.</p>
    </div>
  `

  const text = [
    `Hola ${name || to},`,
    '',
    'Lo invitamos al sistema de gestión de cartera de Impresos Comerciales S.A.',
    rolNombre ? `Su rol: ${rolNombre}` : '',
    '',
    `Correo: ${to}`,
    `Clave temporal: ${tempPassword}`,
    '',
    'Al entrar por primera vez, el sistema le pedirá cambiar esta clave.',
    `Entrar a Ogemi: ${loginUrl}`,
    `Ver manual del sistema: ${manualUrl}`,
  ].filter(Boolean).join('\n')

  return sendViaResend({ to, subject: 'Bienvenido a Ogemi', html, text })
}

export async function sendResetPasswordEmail({ to, name, tempPassword }: WelcomeEmailInput): Promise<EmailResult> {
  const safeName = escapeHtml(name || to)
  const safePassword = escapeHtml(tempPassword)
  const loginUrl = `${getAppUrl()}/login`
  const safeLoginUrl = escapeHtml(loginUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 520px; margin: 0 auto;">
      ${brandHeaderHtml()}
      <h1 style="font-size: 20px; margin: 0 0 14px; color:#111827;">Restablecimiento de contraseña</h1>
      <p style="margin:0 0 12px;">Hola ${safeName},</p>
      <p style="margin:0 0 16px;">Se generó una nueva <strong>clave temporal</strong> para su cuenta en Ogemi. Úsela para ingresar; el sistema le pedirá crear una clave nueva de inmediato.</p>

      <div style="background:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; padding:16px; margin:0 0 20px; text-align:center;">
        <p style="margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#0f766e;">Su clave temporal</p>
        <p style="margin:0; font-family:'Courier New', monospace; font-size:24px; font-weight:bold; color:#115e59; letter-spacing:2px;">${safePassword}</p>
      </div>

      <div style="text-align:center; margin:0 0 22px;">
        <a href="${safeLoginUrl}" style="display:inline-block; background:#0f766e; color:#ffffff; text-decoration:none; padding:13px 28px; border-radius:8px; font-size:15px; font-weight:bold;">
          Entrar y cambiar mi clave
        </a>
      </div>

      <div style="background:#f9fafb; border-radius:10px; padding:16px 18px; margin:0 0 18px;">
        <p style="margin:0 0 8px; font-weight:bold; color:#374151;">Cómo cambiar su clave (3 pasos)</p>
        <ol style="margin:0; padding-left:18px; color:#1f2937;">
          <li style="margin-bottom:6px;">Pulse el botón "Entrar y cambiar mi clave".</li>
          <li style="margin-bottom:6px;">Ingrese con su correo y la clave temporal de arriba.</li>
          <li>El sistema le pedirá escribir su nueva clave. Confírmela y listo.</li>
        </ol>
      </div>

      <p style="font-size:13px; color:#6b7280; margin:0 0 6px;">Por seguridad, esta clave es temporal y de un solo uso para volver a entrar.</p>
      <p style="font-size:12px; color:#9ca3af; margin:14px 0 0;">Si usted no solicitó este cambio, contacte al administrador del sistema. — Impresos Comerciales S.A.</p>
    </div>
  `

  const text = [
    `Hola ${name || to},`,
    '',
    'Se generó una nueva clave temporal para su cuenta en Ogemi.',
    '',
    `Clave temporal: ${tempPassword}`,
    '',
    'Cómo cambiar su clave:',
    '1. Entre a Ogemi con su correo y la clave temporal.',
    '2. El sistema le pedirá crear una clave nueva.',
    '3. Confírmela y listo.',
    '',
    `Entrar a Ogemi: ${loginUrl}`,
    '',
    'Si usted no solicitó este cambio, contacte al administrador.',
  ].join('\n')

  return sendViaResend({ to, subject: 'Restablecimiento de contraseña · Ogemi', html, text })
}

export async function sendManualEmail({ to, name, modulosVisibles, rolNombre }: ManualEmailInput): Promise<EmailResult> {
  const safeName = escapeHtml(name || to)
  const manualUrl = `${getAppUrl()}/manual`
  const safeManualUrl = escapeHtml(manualUrl)

  const visibles = (!modulosVisibles || modulosVisibles.length === 0)
    ? MANUAL_MODULOS
    : MANUAL_MODULOS.filter(m => modulosVisibles.includes(m.id))

  const rolLinea = rolNombre
    ? `<p style="margin:0 0 16px; text-align:center; color:#6b7280; font-size:13px;">Su rol: <strong style="color:#374151;">${escapeHtml(rolNombre)}</strong></p>`
    : ''

  const chips = visibles.map(m =>
    `<span style="display:inline-block; background:#f0fdfa; color:#0f766e; border:1px solid #99f6e4; border-radius:999px; padding:5px 12px; font-size:13px; margin:0 6px 8px 0;">${escapeHtml(m.titulo)}</span>`
  ).join('')

  const html = `
    <div style="font-family: Arial, sans-serif; color:#1f2937; line-height:1.6; max-width:520px; margin:0 auto;">
      ${brandHeaderHtml()}
      <h1 style="font-size:20px; margin:0 0 14px; color:#111827; text-align:center;">Manual del sistema</h1>
      <p style="margin:0 0 12px;">Hola ${safeName},</p>
      <p style="margin:0 0 16px;">Le compartimos el manual interactivo de Ogemi, con el paso a paso de cada módulo y proceso. Ábralo directamente en la aplicación:</p>
      ${rolLinea}

      <div style="text-align:center; margin:0 0 22px;">
        <a href="${safeManualUrl}" style="display:inline-block; background:#0f766e; color:#ffffff; text-decoration:none; padding:14px 30px; border-radius:8px; font-size:16px; font-weight:bold;">
          Abrir el manual del sistema
        </a>
      </div>

      <div style="background:#f9fafb; border-radius:10px; padding:16px 18px; margin:0 0 18px;">
        <p style="margin:0 0 10px; font-weight:bold; color:#374151;">Módulos disponibles para usted</p>
        <div>${chips}</div>
      </div>

      <p style="font-size:13px; color:#6b7280; margin:0;">Dentro del manual encontrará una guía visual, búsqueda de procesos y la opción de imprimir.</p>
      <p style="font-size:12px; color:#9ca3af; margin:16px 0 0;">Impresos Comerciales S.A. · Sistema Ogemi de gestión de cartera.</p>
    </div>
  `

  const text = [
    `Hola ${name || to},`,
    '',
    'Le compartimos el manual del sistema Ogemi. Ábralo en la aplicación:',
    manualUrl,
    '',
    rolNombre ? `Su rol: ${rolNombre}` : '',
    `Módulos disponibles: ${visibles.map(m => m.titulo).join(', ')}`,
  ].filter(Boolean).join('\n')

  return sendViaResend({ to, subject: 'Manual del sistema · Ogemi', html, text })
}
