## Problema
Hoje cada fechamento (hotel/mês/ano) só lê os valores da DRE que foi enviada para **aquele** closing. Mas a Controladoria preenche cada nova DRE mensal com o **acumulado atualizado de todos os meses anteriores** — então a DRE de Mai/2026 tem os valores corretos e mais recentes de Jan, Fev, Mar, Abr e Mai. Hoje, ao abrir Jan/2026, o sistema mostra o que estava na DRE enviada em Janeiro (desatualizada), não na de Maio.

## Regra nova (única)
Para qualquer mês **M** do ano **Y** do hotel **H**, a fonte de verdade é a **última versão** (maior `created_at` em `dre_versions`) entre **todos** os closings de (H, Y). A coluna do mês M dessa planilha é o valor exibido.

## Mudanças

### 1. Parser (`src/hooks/useDre.ts` upload)
Hoje só persistimos a série mensal completa para **orçamento** (`[bline_M] <label>`) e **ano anterior** (`[pline_M] <label>`). Vamos persistir também para o **realizado**:
- Novo prefixo `[cline_M] <label>` para cada linha da aba `DRE`, com os 12 meses.
- Os campos existentes (`<label>` direto, `[series_cur_*]`) continuam para compatibilidade.

### 2. Função SQL nova
`get_year_latest_dre_lines(_hotel_id text, _year int)` que retorna as linhas da versão mais recente do ano (maior `created_at` em `dre_versions` entre os closings do par H/Y). Marcada `SECURITY DEFINER` + `search_path = public`.

### 3. Leitura
- `useDreIndicators(closingId)`: passa a buscar via nova função e monta os indicadores do mês usando `[series_cur_<key>_<M>]`, `[series_prev_<key>_<M>]`, `[series_budget_<key>_<M>]` da última DRE do ano. Cai pra `[<key>]` / `[prev_<key>]` / `[budget_<key>]` antigos só se a série não existir (fallback compat).
- `useDreAnalytics`: deixa de fazer merge entre closings; passa a usar 1 única consulta — a última DRE do ano. Todas as séries vêm prontas.
- Telas que exibem linha detalhada do realizado (ex.: tabela DRE da Carta) passam a usar `[cline_<M>] <label>` quando disponível.

### 4. Indicadores do painel (`DreIndicatorsPanel`)
Sem mudança de UI. Só passa a receber valores certos por construção.

### 5. Backfill
Não precisa rodar backfill: as DREs já enviadas continuam funcionando porque o fallback antigo está mantido. Conforme novas DREs forem enviadas, o `[cline_M]` vai ficando disponível e a leitura vai automaticamente para a fonte nova.

## Casos cobertos
- **Ibis Macaé Jan/2026 Receita Bruta Total ano anterior**: virá da aba `ANO ANTERIOR` da última DRE do ano (Mai/2026), coluna JAN — que tem o valor corrigido.
- **Ibis Macaé Abr/2026 Salários realizado**: virá da aba `DRE` da última DRE do ano (Mai/2026), coluna ABR (-59.638,03), em vez do -1.854,08 que ficou na v2 de Abril.
- **Qualquer hotel**: mesma regra automaticamente.

## Não incluso (fica pra depois)
- Tabela comparativa Realizado/Orçado/Ano Anterior com expansão de linhas (Fase 2 — implementada após esta refatoração).
- Detecção de outliers — pulada conforme silêncio na pergunta anterior.

## Detalhes técnicos
- O parser já produz `currentSeries`, `previousSeries`, `budgetSeries` e `prevLines` / `budgetLines` (com 12 meses). Falta apenas adicionar **`currentLines`** análogo a `prevLines` (mesma aba `DRE`, mas com 12 colunas) — varredura idêntica a `parseSeries`.
- Limite de inserção do `dre_parsed_lines` é alto; mesmo com 200 linhas × 12 meses (≈2400 linhas extras por upload) cabe folgado no batch.
- A função SQL evita N+1: 1 chamada → todas as linhas da versão mais recente do ano.
