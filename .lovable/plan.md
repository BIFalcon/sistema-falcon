## Contexto

Hoje, ao subir uma nova planilha do OMIE (`parse-ap-report`), qualquer lançamento existente que não aparece na nova remessa é arquivado:

- Se estava **pago** → `archived_at = now(), archived_reason = "paid_history"` → vai pra aba "Ver pagos".
- Se estava em **qualquer outro status** (a pagar, em aprovação, agendado) → `archived_at = now()`, **sem** `archived_reason` → some da tela e não tem onde visualizar.

O dado continua no banco; só falta UI e marcação clara. Vou resolver com aba dedicada + retroação dos já arquivados.

## Mudanças

### 1. Banco — marcar removidos do OMIE
Migration que define `archived_reason = 'omie_removed'` para o caso "não-pago sumiu da remessa":

- Backfill: `UPDATE ap_entries SET archived_reason = 'omie_removed' WHERE archived_at IS NOT NULL AND archived_reason IS NULL AND payment_status <> 'pago'` — cobre o histórico que o usuário pediu para visualizar.

### 2. Edge function `parse-ap-report`
No bloco `toArchiveOther` (linha ~641), passar a gravar `archived_reason = 'omie_removed'` junto com `archived_at`. Mantém `paid_history` para os pagos. Adicionar `archived_upload_id = uploadRow.id` para mostrar em qual remessa o lançamento sumiu (já que `upload_id` é sobrescrito hoje — campo novo evita perder essa informação).

### 3. Hook `useAccountsPayable`
Novo hook `useApOmieRemovedEntries(hotelId, enabled)` espelhando `useApPaidEntries`, mas filtrando `archived_reason = 'omie_removed'`. Retorna ordenado por `archived_at desc`.

### 4. UI — Contas a Pagar
Na `ContasPagarPage`, adicionar um terceiro toggle ao lado de "Ver pagos":

- **"Removidos do OMIE"** — abre a lista de arquivados não-pagos.
- Cada linha mostra: fornecedor, documento, vencimento original, valor, **data em que foi removido** (`archived_at`) e o nome do arquivo da remessa que o removeu (join leve em `ap_uploads` via `archived_upload_id`).
- Ação por linha: **"Restaurar para ativos"** (set `archived_at = null, archived_reason = null`) — útil quando o financeiro quer reincluir manualmente um lançamento que sumiu por engano. Restrito às mesmas roles que hoje editam AP (controladoria, patronos, master).
- Sem checkbox de pagamento aqui (não faz sentido marcar pago um item que não está mais na remessa — se voltar a aparecer, o usuário restaura e marca normalmente).

### 5. Aviso pós-upload (opcional, leve)
Depois do upload bem-sucedido, o toast atual passa a mostrar:
> "X lançamentos atualizados, Y novos, **Z removidos do OMIE** (ver na aba "Removidos do OMIE")."

Assim o financeiro vê na hora se algo sumiu inesperadamente.

## Detalhes técnicos

**Arquivos:**
- `supabase/migrations/<nova>.sql` — backfill + comentário no enum/coluna.
- `supabase/functions/parse-ap-report/index.ts` — bloco de arquivamento dos não-pagos (linhas 641-644) e leitura da contagem para o response.
- `src/hooks/useAccountsPayable.ts` — novo hook + tipo + mutation `restoreApEntry`.
- `src/pages/ContasPagarPage.tsx` — toggle + tabela dedicada.
- `src/components/accounts-payable/ApEntryRow.tsx` — pequeno modo `variant="removed"` ou componente novo reusando a estrutura.

**Schema:** Vou adicionar a coluna `archived_upload_id uuid references ap_uploads(id)` em `ap_entries` (nullable). Sem isso a UI não consegue mostrar "removido por qual remessa".

**Não muda:** comportamento dos pagos arquivados, contadores do dashboard, lógica de match por `entry_key`/`lookup_key`.
