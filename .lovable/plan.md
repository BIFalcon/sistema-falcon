## 1) Histórico de Pagamentos — colunas faltantes + busca

**Tabela "Pagos" (histórico):**
- Adicionar 3 colunas visíveis: **Valor original**, **Juros pagos** e **Valor pago (efetivo)**. Hoje só aparece o valor original.
- Mostrar as colunas mesmo quando o lançamento ficou arquivado (após nova remessa). O parser do OMIE já preserva `paid_amount` e `paid_interest` ao arquivar; o histórico passa a ler esses campos.

**Filtro/busca:**
- Corrigir o filtro de busca da aba "Pagos": hoje o estado de busca da aba ativa não é aplicado ao subconjunto histórico. Vou unificar com o mesmo `searchTerm` que já existe e aplicar nos campos `supplier_name`, `description`, `amount`, `paid_amount`, `cnpj`, `nota`.

## 2) Novo status "Quitado"

**Fluxo:** Coordenadora/Patrono marca **Pago** → qualquer usuário da Controladoria (incl. equipe) pode marcar como **Quitado**.

**Banco (migração):**
- Estender o enum `ap_payment_status` com `quitado` (mantém `pago`, `pago_parcialmente`, `agendado`, `pendente`).
- Adicionar colunas: `settled_at timestamptz`, `settled_by uuid`.
- Trigger `enforce_ap_payment_status_change`: permitir transição `pago → quitado` para Master/Controladoria/Patronos; bloquear marcar `quitado` se status atual não é `pago`/`pago_parcialmente`.
- Atualizar policies para permitir update do campo por controladoria.

**Front:**
- Botão "Marcar Quitado" na linha (e em lote) na aba **Pagos**, visível para Master/Controladoria/Patronos.
- Badge "Quitado" com cor distinta.
- Aba "Pagos" passa a listar **Pago + Quitado**, com filtro adicional `subStatus`.

**Pendente desaparece após pagar:** o "Pendente" já é o default; vou ajustar a contagem/filtro "Pendente" para excluir entries com `payment_status in ('pago','pago_parcialmente','quitado','agendado')`. Hoje em alguns lugares ainda aparece como pendente — vou corrigir o derived em `useApPageDerived`.

## 3) Visão "Todos os hotéis" — histórico de pagos

Na visão consolidada (sem hotel selecionado), adicionar a aba/toggle **"Pagos (todos os hotéis)"** mostrando tudo que já foi pago/quitado, com coluna "Hotel" e os mesmos campos (Valor original, Juros, Valor pago, Data do pagamento, Quem marcou).

## 4) Removidos do OMIE — 5 ajustes

a. **Seleção múltipla** com checkbox por linha + "selecionar todos" + ações em lote: **Restaurar**, **Marcar como Pago**, **Excluir**.

b. **Marcar como Pago direto** (sem precisar restaurar): para Patrono/Master. Abre o mesmo modal de data efetiva + valor pago + juros. Mantém o lançamento fora dos ativos, só registra o pagamento e move de "Removidos" para "Pagos".

c. **Match desagrupado:** ao processar uma remessa nova, antes de marcar como "removidos" os lançamentos antigos agrupados, **expandir o agrupamento** (campo `grouped_entry_ids` no `ap_entries` — verificar nome) e comparar item-a-item (fornecedor + valor + vencimento) contra a remessa nova desagrupada. Se cada componente do agrupado bater, considerar substituído e arquivar como "pago/substituído", não como "removido".

d. **Excluir lançamentos removidos:** ação por linha + em lote → hard delete (ou `archived_status='excluido'`). Visível para Master/Patrono/Controladoria.

e. **Filtro global de vencimento aplica-se à aba Removidos do OMIE**: hoje a lista ignora `dateFrom/dateTo`. Vou aplicar o mesmo filtro de período (`due_date BETWEEN dateFrom AND dateTo`) na query `useApOmieRemovedEntries`.

## 5) E-mails aos ADMs no Notify-GG

Bug: o template/edge function `notify-gg-ap` envia ao GG mas os ADMs (e CCs adicionados no `NotifyGgDialog`) não recebem.

**Investigar e corrigir:**
- Conferir se `extra_recipients` está sendo persistido em `ap_notification_log` e enviado em `to`/`cc` na função.
- Conferir se os usuários com role `adm` do hotel estão sendo incluídos automaticamente (espelhar `users_with_role_for_hotel('adm', ...)` como já é feito em AR).
- Garantir `cc` na chamada Resend e log no `email_send_log`.

## Detalhes técnicos

- Tipos do Supabase serão regenerados após a migração (aceitar antes de codar o front que depende de `settled_at`).
- Não mexer nas fórmulas/parsers de DRE. Não mexer no escopo Matriz/RH.
- Manter testes: `scripts/test-parse-arc.mjs` — adicionar caso para match desagrupado se houver fixture.

## Fora de escopo

- Mudar UI/UX além do necessário para os 5 itens.
- Ajustar Contas a Receber, Conciliação, RH, etc.
