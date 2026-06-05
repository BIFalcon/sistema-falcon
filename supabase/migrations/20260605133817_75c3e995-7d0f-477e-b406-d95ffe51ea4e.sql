
-- 1) Drena DLQ atual (sobras da rodada anterior) com queued_at atualizado
DO $$
DECLARE
  m RECORD;
  new_payload JSONB;
BEGIN
  FOR m IN
    SELECT msg_id, message FROM pgmq.read('transactional_emails_dlq', 0, 10000)
  LOOP
    new_payload := m.message || jsonb_build_object('queued_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    PERFORM pgmq.send('transactional_emails', new_payload);
    PERFORM pgmq.delete('transactional_emails_dlq', m.msg_id);
  END LOOP;
END $$;

-- 2) Limpa logs de 'failed'/'dlq' das mensagens reenfileiradas para
--    zerar o contador de tentativas usado pelo process-email-queue
DELETE FROM public.email_send_log
WHERE status IN ('dlq','failed')
  AND created_at > now() - interval '2 hours';
