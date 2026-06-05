## Situação

- ~100 e-mails enviados de fato; ~3.400+ expiraram por TTL (60 min) e estão na DLQ.
- A causa não é mais o payload (`text`/`unsubscribe_token` já corrigidos), e sim **rate-limit + TTL curto demais** para o tamanho do lote reenfileirado.
- Reenfileirar tudo de novo da mesma forma vai repetir o mesmo desfecho.

## Plano

### 1. Aumentar o TTL transacional antes de qualquer reprocesso
Criar a linha em `email_send_state` (hoje está vazia, então o worker usa defaults de 60 min) com:
- `transactional_email_ttl_minutes = 360` (6h) — tempo suficiente para drenar mesmo com cooldowns.
- `batch_size = 10`, `send_delay_ms = 250` (mantém ~120/min sem espremer o provider).

### 2. Limpar logs `dlq`/`failed` antigos
Apagar entradas de `email_send_log` com `status in ('dlq','failed')` das últimas 24h para não inflar o contador de tentativas (`failedAttempts`) por `message_id`.

### 3. Deduplicar antes de reenfileirar
Da DLQ atual (~2.169 + as que ainda vão cair), agrupar por `message_id` para enviar **uma única cópia** por e-mail lógico (hoje há muitos duplicados do mesmo `notif-<id>` por causa das tentativas anteriores). Isso reduz drasticamente o volume real.

### 4. Reenfileirar em ondas
Migration que:
- Lê todas as mensagens da DLQ.
- Para cada `message_id` único, reenvia **uma** mensagem para `pgmq.q_transactional_emails` com `queued_at = now()` (UTC).
- Deleta todas as ocorrências daquele `message_id` da DLQ.
- Espalha o `queued_at` em janelas de 10 min (offset incremental) para não estourar rate-limit logo de cara — opcional, mas reduz risco.

### 5. Monitorar
Depois de aplicar, conferir a cada 5 min:
- `pgmq.q_transactional_emails` decrescendo.
- `email_send_log` com `status='sent'` crescendo (~100–120/min).
- `pgmq.q_transactional_emails_dlq` permanecendo estável ou crescendo só por falhas reais (não TTL).

### 6. Mitigação futura (opcional, mesma migration ou depois)
- Manter `transactional_email_ttl_minutes` em 360 permanentemente, já que o cron pode entrar em cooldown 429 a qualquer momento.
- Considerar aumentar `send_delay_ms` se o provider continuar devolvendo 429 em rajadas.

## Entregáveis técnicos
1. Migration única que: (a) faz `upsert` em `email_send_state` com novo TTL/batch, (b) limpa logs dlq/failed recentes, (c) deduplica e reenfileira a DLQ com `queued_at=now()`, (d) esvazia a DLQ.
2. Sem mudanças de código nas Edge Functions (o fix de payload já está em produção).

## Pergunta antes de executar
Confirma os números **TTL = 360 min (6h)** e **deduplicar por `message_id`** (envia só 1 e-mail por destinatário/evento, mesmo que esteja duplicado na DLQ)? Se preferir reenviar tudo sem deduplicar, alguns usuários podem receber a mesma notificação várias vezes.