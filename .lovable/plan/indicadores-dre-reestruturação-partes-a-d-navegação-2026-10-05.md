# Indicadores DRE — reestruturação (Partes A–D + navegação)

## O que a planilha mostrou
- 17 hotéis, 65.925 linhas, 414 nomes diferentes de linha da DRE, anos de 2020 a ago/2026.
- Entidade: Hotel (61.469), Pool = Manhattan (3.209), Condomínio = Cuiabá (1.247).
- 23 grupos prontos no "Grupo do painel" (Manutenção, Lavanderia, Energia, Água, Fees Accor, Comissões de cartão/agências, Impostos s/ receita, A&B custo...).
- O sistema já tem fechamentos de 2024 em diante na maioria dos hotéis. Antes de 2024 (ex.: Confins 2020–2023, Barbacena 2021–2023) só existe na planilha.

## Navegação
Abas no topo, igual a Contas a Receber (a aba escolhida fica no endereço da página):
**Resumo** (tela atual) | **Comparativo** | **Histórico por hotel**.
Logo abaixo, uma barra única com o **Ano** e os **12 meses como botões marcáveis**, usada pelas três abas. O filtro de mês do topo do sistema deixa de aparecer nessa página.

## Parte D — período único
- Saem: o menu Mensal/Trimestral/Semestral, o "Meses (múltiplos)" escondido e o mês do topo.
- Ficam: Ano + meses marcáveis (1 mês = mensal; Jan+Mar+Jun = soma só desses três). Atalhos rápidos "Ano todo" e "Limpar".
- Gráfico e tabela usam exatamente os meses marcados. Indicadores de razão continuam sendo soma de cima ÷ soma de baixo.

## Parte A — catálogo e Comparativo
- Novos indicadores: TrevPAR, GOPPAR, Labor Cost (% da receita), Custo Restaurante/RN, Café da Manhã/RN, Hospedagem/RN, Turnover, Custo fixo por quarto disponível, Custo variável por quarto ocupado, Receita de A&B por hóspede. %GOP também aceita o nome "Margem Bruta".
- Turnover vem do RH (desligados ÷ ativos). Hoje a coluna de desligamento ainda não existe na folha → mostra "sem dado" até ela chegar.
- Custo fixo × variável: uso o "Grupo do painel". Variáveis: A&B custo, Materiais e amenities, Lavanderia, Comissões, Fees Accor, Impostos s/ receita. O resto conta como fixo. Dá para ajustar depois.
- Café da manhã: um grupo com os 6 nomes encontrados.
- **Comparativo:** escolher 2 ou mais hotéis (seleção livre, com atalhos por bandeira: ibis / ibis budget / ibis Styles / outros). Cada hotel fica numa coluna, com um indicador por linha e a coluna "Rede" no fim.

## Parte B — importação única do histórico
- Feita uma vez só, por mim, a partir da planilha. Não fica nenhum botão de reimportar.
- Grava na mesma estrutura do Fechamento: um fechamento por hotel e mês, todas as etapas marcadas como "não se aplica", e uma versão da DRE chamada "Base histórica".
- **Só preenche o que falta:** se o mês já tem DRE enviada pelo Fechamento, ela é mantida e a planilha é ignorada para aquele mês.
- Esses fechamentos antigos **não disparam e-mails nem lembretes** e não entram nas listas de pendências do Fechamento.
- A aba Cobertura define quais meses existem; o resto fica "sem dado", nunca zero.
- "Despesas totais" até 2024 = Receita Líquida − GOP.
- Cuiabá (Condomínio) e Manhattan (Pool) ficam gravados à parte e aparecem só como bloco complementar no Histórico. Nunca entram nos indicadores do hotel nem no total da rede.
- Ligação de nomes: "Confins" → Ibis Styles Confins, "Jaboatão" → Ibis budget Recife Jaboatão, e assim por diante. Confiro os 17 antes de gravar.

## Parte C — Histórico por hotel
Escolhe um hotel. Mostra colunas ano a ano desde o primeiro ano da Cobertura. Hotéis com menos de 12 meses de dados (Arcoverde, Caruaru) mostram mês a mês. Cada bloco traz a variação contra o período anterior:
1. Receita e operação
2. A&B, CMV e hóspedes (Confins: hóspedes "sem dado")
3. Folha (total, salários, encargos, benefícios, % da receita, por RN)
4. Custos por roomnight, um por Grupo do painel
5. Custos ligados à tarifa (Fees Accor, impostos, comissões) como % da receita de hospedagem

## Testes antes de entregar
Confins (sem hóspedes), Macaé (sem 2023), Barbacena (sem jan/2023), Cuiabá e Manhattan (separados), e a seleção Jan + Mar + Jun.

## Technical details
- Import via a one-off script (service-side SQL inserts), not app code. Closings get a `is_historical` flag (new boolean column, default false) so the workflow triggers (`notify_on_*`, `enqueue_*`, SLA) and the Fechamento lists skip them. The consolidado cache recalculation runs once at the end.
- Lines are stored in the existing `[cline_m] Label` / indicator format on one "Base histórica" version per hotel+year, so `get_year_latest_dre_lines` and `useDreAnalytics` read them with no new read path. Panel group is stored in `line_segment`. Entity is stored in `line_category` prefix for Pool/Condomínio rows.
- New RPC `get_dre_history(_hotel_id)` that aggregates per year/month on the server, so the History view never downloads raw lines.
- Comparativo reuses `useDreAnalytics` per hotel, with the same month set.
- `IndicadoresDrePage.tsx` is split into `ResumoTab`, `ComparativoTab` and `HistoricoTab`, plus a shared `MonthMultiSelect`. RATIO_SPECS moves to `src/lib/dreIndicatorCatalog.ts`.
- `/indicadores` is added to `hideAllFilters` in AppHeader, so the global month filter disappears there.
