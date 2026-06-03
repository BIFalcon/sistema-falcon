Plano para aplicar `lovable-contas-receber-v2.md` na íntegra. Aplico em ordem, parando para confirmação só se aparecer ambiguidade.

## Bloco 1 — Role `adm`
- Migration: `ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'adm'`.
- `AuthContext.tsx`: expor `isAdm`. Decidir se `adm` entra em `is_hotel_allowed` (sim, mas só via `user_hotels`, sem bypass global).
- `AppSidebar`/rotas: esconder Contas a Pagar e Fechamento de quem só tem `adm`.
- `constants.ts`: adicionar `'adm'` à lista de `AppRole`.

## Bloco 2 — Cadastro de clientes
- Migration `ar_clients` + colunas novas em `ar_to_invoice_entries` (`client_id`, `is_not_billable`, `not_billable_reason`, `proof_file`, `is_paid`, `paid_at`, `is_defaulting`, `defaulting_note`, `defaulting_at`). Campos `invoice_file_1/2` e `estimated_due_date` já existem.
- GRANTs + RLS (`is_master`, `financeiro`, `adm`, `gg`, `gop` com `is_hotel_allowed`).
- Hook `useArClients` (list/create/update/delete).
- `src/pages/ClientesPage.tsx` + rota `/financeiro/contas-receber/clientes`.
- Link a partir do `ContasReceberPage`.

## Bloco 3 — Novo fluxo de Faturamento
Reorganizar a aba "A Faturar" em `ContasReceberPage.tsx`:
- Coluna nova **Cliente** (select de `ar_clients` ligado à linha).
- Adm/GG, quando `gg_status='pendente'`: dois inputs de NF/Boleto + comprovante de envio; botão "Enviar documentos" (vira `gg_status='documentos_enviados'`).
- Financeiro: botão "Faturado" (define `gg_status='faturado'`, calcula `estimated_due_date = hoje + payment_term_days`), "Pago" (`is_paid`, `paid_at`), "Inadimplente" (`is_defaulting`, `defaulting_note`).
- Financeiro: botão "Problema nos documentos" com Textarea → cria notificação para adm e GG (reaproveitar `enqueue_workflow_notification` ou tabela `notification_queue`).
- Adm/GG: botão "Não vai ser faturado" com motivo (select) + observação → `is_not_billable=true`.
- Estender o enum/coluna `gg_status` adicionando `documentos_enviados`, `nao_faturavel`, `pago`, `inadimplente` (a coluna é `ar_gg_status`).
- Storage: subir arquivos em bucket `accounts-receivable` (já existe). Definir paths `arInvoices/{entry_id}/...`.

## Bloco 4 — Filtros
- Manter filtro global de mês (data lançamento).
- Adicionar filtros: data de vencimento (from/to), status (pendente, documentos_enviados, faturado, pago, inadimplente, nao_faturavel).
- Permissões: adm/GG/GOP podem filtrar e ver "Pago".

## Bloco 5 — Open Folio
- Migration: `ar_open_folio_date_history` (entry_id, hotel_id, old_date, new_date, changed_by, note, created_at) + RLS + GRANTs.
- Migration: `ar_open_folio_entries` adicionar `company`, `travel_agent`.
- `src/lib/arReportParser.ts` (open folio): ler colunas "Company" e "Travel Agent".
- UI Open Folio: renomear label "Data prevista de pagamento" → "Data prevista de fechamento" (mantém campo `expected_payment_date`).
- Ao gravar nova data, inserir em `ar_open_folio_date_history`. Popover mostrando histórico.
- Adm e GG podem editar data + justificativa; não podem importar arquivo.
- Mostrar colunas Company/Travel Agent quando preenchidas.
- Habilitar GOP somente leitura em todo Contas a Receber.

## Bloco 6 — Carta
- `CartaPage.tsx`: antes de chamar `useEnsureClosing`, consultar closing existente por (hotel, month, year). Só criar se for `null`.
- `useDre.ts` (`useDreIndicators`): `staleTime = 30min`, `gcTime = 1h`.
- Botão "Recarregar dados da DRE" que invalida a query.
- Função de download da carta: usar `URL.createObjectURL` + `<a download>` + revoke (compatibilidade Safari/Edge).

## Notas técnicas
- Tudo em migrations separadas por bloco para facilitar revisão.
- `app_role` ALTER TYPE precisa estar em migration própria (sem outro DDL no mesmo statement de commit) — Postgres exige commit antes de uso.
- `ar_gg_status` enum: adicionar novos valores via `ALTER TYPE ... ADD VALUE`.
- Notificações: usar `notification_queue` via `enqueue_workflow_notification` se o `notification_event` aceitar; caso contrário criar evento próprio ou reaproveitar `ar_to_invoice_pending_to_gg`.
- Tabelas novas com GRANT explícito (`authenticated`, `service_role`).
- Reutilizar `Toast`, `Dialog`, `Select` existentes — sem novas libs.

## Perguntas
1. Quero confirmação para criar **novos `notification_event`** (`ar_documents_problem`, `ar_defaulting`, `ar_not_billable`)? Senão reuso o evento existente `ar_to_invoice_pending_to_gg` com `payload.kind` diferenciado.
2. O **bucket `accounts-receivable`** é privado — manter privado e gerar signed URLs para visualizar/baixar?

Pode aprovar para eu seguir com os blocos 1→6 nesta ordem, ou indicar se quer pular/ajustar algum bloco.