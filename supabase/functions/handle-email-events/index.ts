import { createEmailWebhookHandler } from 'npm:@lovable.dev/email-js@0.1.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Notificação apenas: a supressão em si é aplicada pela Lovable no envio.
async function record(
  event: { event_id: string; data: { recipient: string } },
  args: {
    logStatus: 'bounced' | 'complained' | 'suppressed'
    suppressionReason: 'bounce' | 'complaint' | 'unsubscribe'
    logMessage: string
  },
) {
  const email = String(event.data.recipient ?? '').toLowerCase()
  if (!email) return

  const { error: logError } = await admin.from('email_send_log').insert({
    message_id: null,
    template_name: 'system',
    recipient_email: email,
    status: args.logStatus,
    error_message: args.logMessage,
    metadata: null,
  })
  if (logError) {
    console.error('Failed to write email_send_log row', {
      event_id: event.event_id,
      code: (logError as { code?: string }).code,
      message: (logError as { message?: string }).message,
    })
    throw new Error('email_send_log insert failed')
  }

  const { error: suppError } = await admin
    .from('suppressed_emails')
    .upsert({ email, reason: args.suppressionReason, metadata: null }, { onConflict: 'email' })
  if (suppError) {
    console.error('Failed to upsert suppressed_emails row', {
      event_id: event.event_id,
      code: (suppError as { code?: string }).code,
      message: (suppError as { message?: string }).message,
    })
    throw new Error('suppressed_emails upsert failed')
  }
}

const handler = createEmailWebhookHandler({
  apiKey: Deno.env.get('LOVABLE_API_KEY')!,
  on: {
    'email.bounced': async (event) => {
      await record(event, {
        logStatus: 'bounced',
        suppressionReason: 'bounce',
        logMessage: 'Endereço suprimido após retorno (bounce)',
      })
    },
    'email.complaint': async (event) => {
      await record(event, {
        logStatus: 'complained',
        suppressionReason: 'complaint',
        logMessage: 'Endereço suprimido após reclamação de spam',
      })
    },
    'email.unsubscribed': async (event) => {
      await record(event, {
        logStatus: 'suppressed',
        suppressionReason: 'unsubscribe',
        logMessage: 'Endereço cancelou o recebimento de e-mails',
      })
    },
  },
})

Deno.serve((req) => handler(req))
