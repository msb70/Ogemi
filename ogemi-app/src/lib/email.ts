import { buildManualHtml, buildManualText } from './manual'

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
  const safeLoginUrl = escapeHtml(loginUrl)
  const manualHtml = buildManualHtml({ nombre: name, rolNombre, modulosVisibles })
  const manualText = buildManualText({ nombre: name, rolNombre, modulosVisibles })

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5; max-width: 620px;">
      <h1 style="font-size: 22px; margin: 0 0 16px;">Bienvenido a Ogemi</h1>
      <p>Hola ${safeName},</p>
      <p>Ogemi lo está invitando al sistema de gestión de cartera de Impresos Comerciales SA.</p>
      <p>Estos son sus datos de acceso inicial:</p>
      <div style="background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin: 16px 0;">
        <p style="margin: 0 0 8px;"><strong>Correo:</strong> ${safeEmail}</p>
        <p style="margin: 0;"><strong>Clave temporal:</strong> <span style="font-family: monospace; font-size: 18px;">${safePassword}</span></p>
      </div>
      <p>Al entrar por primera vez, el sistema le pedirá cambiar esta clave.</p>
      <p>
        <a href="${safeLoginUrl}" style="display: inline-block; background: #0f5f86; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 6px;">
          Entrar a Ogemi
        </a>
      </p>
      <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;" />
      ${manualHtml}
      <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">
        Si usted no esperaba esta invitación, ignore este correo.
      </p>
    </div>
  `

  const text = [
    `Hola ${name || to},`,
    '',
    'Ogemi lo está invitando al sistema de gestión de cartera de Impresos Comerciales SA.',
    '',
    `Correo: ${to}`,
    `Clave temporal: ${tempPassword}`,
    '',
    'Al entrar por primera vez, el sistema le pedirá cambiar esta clave.',
    `Entrar a Ogemi: ${loginUrl}`,
    '',
    '----------------------------------------',
    '',
    manualText,
  ].join('\n')

  return sendViaResend({ to, subject: 'Bienvenido a Ogemi', html, text })
}

export async function sendManualEmail({ to, name, modulosVisibles, rolNombre }: ManualEmailInput): Promise<EmailResult> {
  const manualHtml = buildManualHtml({ nombre: name, rolNombre, modulosVisibles })
  const manualText = buildManualText({ nombre: name, rolNombre, modulosVisibles })
  const loginUrl = `${getAppUrl()}/login`
  const safeLoginUrl = escapeHtml(loginUrl)

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5; max-width: 620px;">
      ${manualHtml}
      <p style="margin-top:18px;">
        <a href="${safeLoginUrl}" style="display: inline-block; background: #0f5f86; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 6px;">
          Entrar a Ogemi
        </a>
      </p>
    </div>
  `
  const text = [manualText, '', `Entrar a Ogemi: ${loginUrl}`].join('\n')

  return sendViaResend({ to, subject: 'Manual del sistema Ogemi', html, text })
}
