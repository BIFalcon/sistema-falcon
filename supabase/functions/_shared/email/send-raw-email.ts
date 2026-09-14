// Server-only: envia e-mails com HTML/texto compostos em tempo de envio
// através da API gerenciada de e-mails da Lovable. Entrega, retentativas,
// supressão e cancelamento de inscrição são responsabilidade da Lovable.
import { EmailAPIError, sendLovableEmail } from 'npm:@lovable.dev/email-js@0.1.0'

const SITE_NAME = 'Sistema Falcon'
// Subdomínio verificado, delegado aos nameservers da Lovable.
const SENDER_DOMAIN = 'notify.falconhoteis.com.br'
// Domínio exibido no cabeçalho From: (cosmético).
const FROM_DOMAIN = 'falconhoteis.com.br'

export type SendRawEmailResult =
  | { sent: true }
  | { sent: false; reason: 'recipient_suppressed' }

export interface SendRawEmailArgs {
  to: string
  subject: string
  html: string
  text: string
  label: string
  idempotencyKey: string
}

function isRateLimited(error: unknown): error is EmailAPIError {
  return error instanceof EmailAPIError && error.status === 429
}

async function dispatch(args: SendRawEmailArgs, apiKey: string): Promise<void> {
  await sendLovableEmail(
    {
      to: args.to,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: args.subject,
      html: args.html,
      text: args.text,
      purpose: 'transactional',
      label: args.label,
      idempotency_key: args.idempotencyKey,
    },
    { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') },
  )
}

/**
 * Envia um e-mail já renderizado. Destinatário suprimido é resultado
 * esperado ({ sent: false }); qualquer outra falha lança (EmailAPIError
 * expõe .code e .status).
 */
export async function sendRawEmail(args: SendRawEmailArgs): Promise<SendRawEmailResult> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  if (!apiKey) {
    throw new Error('LOVABLE_API_KEY is not configured')
  }

  try {
    await dispatch(args, apiKey)
  } catch (error) {
    if (error instanceof EmailAPIError && error.code === 'recipient_suppressed') {
      return { sent: false, reason: 'recipient_suppressed' }
    }
    // 429: aguarda o intervalo indicado antes de uma única nova tentativa.
    if (isRateLimited(error)) {
      const waitSeconds = error.retryAfterSeconds ?? 60
      await new Promise((r) => setTimeout(r, waitSeconds * 1000))
      try {
        await dispatch(args, apiKey)
      } catch (retryError) {
        if (
          retryError instanceof EmailAPIError &&
          retryError.code === 'recipient_suppressed'
        ) {
          return { sent: false, reason: 'recipient_suppressed' }
        }
        throw retryError
      }
      return { sent: true }
    }
    throw error
  }

  return { sent: true }
}

// Cliente Supabase (service role) — tipagem frouxa de propósito, os
// chamadores usam versões diferentes do SDK.
// deno-lint-ignore no-explicit-any
type Admin = any


/** Registra a tentativa de envio em email_send_log (nunca decide o resultado). */
export async function logEmailSend(
  admin: Admin,
  row: {
    message_id: string | null
    template_name: string
    recipient_email: string
    status: 'sent' | 'suppressed' | 'failed'
    error_message?: string | null
  },
): Promise<void> {
  const { error } = await admin.from('email_send_log').insert({
    message_id: row.message_id,
    template_name: row.template_name,
    recipient_email: row.recipient_email,
    status: row.status,
    error_message: row.error_message ? String(row.error_message).slice(0, 1000) : null,
  })
  if (error) console.error('Failed to write email_send_log row', error)
}

/** Alerta no painel Master quando um e-mail não pôde ser entregue. */
export async function logEmailFailureAlert(
  admin: Admin,
  info: { to: string; subject: string; label: string; reason: string },
): Promise<void> {
  const { error } = await admin.from('system_alerts').insert({
    type: 'email_dlq',
    message: `E-mail para ${info.to ?? '—'} falhou: ${info.reason}`,
    payload: {
      to: info.to,
      subject: info.subject,
      template: info.label,
      reason: info.reason,
    },
  })
  if (error) console.error('Failed to log system alert for email failure', error)
}
