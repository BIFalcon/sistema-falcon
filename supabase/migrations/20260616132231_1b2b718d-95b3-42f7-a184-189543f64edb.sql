-- Resolve alertas antigos sobre e-mails que falharam por endereço com múltiplos
-- destinatários concatenados (";" / nome + email). A nova versão da função
-- process-notifications quebra a string em destinatários individuais.
UPDATE public.system_alerts
SET resolved = true
WHERE resolved = false
  AND type = 'email_dlq'
  AND (
    message LIKE '%;%'
    OR message ~ 'falhou: Max retries'
  );