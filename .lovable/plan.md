# Módulo Conciliação (Cartão, PIX, Extrato) em Contas a Receber

## O que será entregue

Novo submódulo em Contas a Receber com 4 abas de navegação:
1. **Cartão e PIX** (Opera × Adquirente)
2. **PIX × Extrato Bancário**
3. **Dinheiro** — espaço reservado, sem regra ainda
4. **Importações / Códigos** — uploads e tabela de referência TRX_CODE

Acesso restrito a: Master, Fernando, Patronos, Controladoria.

## Dados e importações

Três importações acumulativas (nunca substituem, só somam; reimportar o mesmo arquivo não duplica, por chave única):

- **Opera (XML)**: lê TRX_CODE, TRX_DESC, CASHIER_CREDIT (valor), BUSINESS_FORMAT_DATE, ROOM, GUEST_FULL_NAME, RECEIPT_NO. Entram só os códigos ativos da tabela de referência; a categoria vem do mapeamento.
- **Adquirente (Rede, Excel)**: cabeçalho na 2ª linha; só linhas com status "aprovada" ou "pago"; usa valor da venda atualizado, data da venda, bandeira + modalidade como categoria (bandeira vazia = PIX) e nome do estabelecimento para achar o hotel.
- **Extrato Bancário (Excel)**: apenas aba "Lançamentos", cabeçalho na linha 10; usa "Nome" (linhas de identificação) para achar o hotel; colunas Data, Lançamento, Valor (R$); descarta SALDO ANTERIOR e SALDO TOTAL DISPONÍVEL DIA.

**Identificação do hotel por texto**: mesma normalização já usada nos relatórios do sistema (sem acento, maiúsculas, sem pontuação/ruído), comparando com nome do hotel e nome de propriedade Opera, com tolerância a variação de grafia. Se não casar, a importação avisa quais nomes ficaram sem hotel.

**Tabela de referência trx_code_mapping**: campos trx_code, descrição, categoria, ativo. Carga inicial com os 110 códigos da planilha enviada. Editável na tela (ativar/desativar e ajustar categoria). Categorias normalizadas (maiúsculo, sem acento) nos dois lados antes de comparar.

## Tela 1 — Cartão e PIX (Opera × Adquirente)

- Seletor de hotel no topo (usa o filtro global de hotel do sistema).
- Abas internas: **Não Conciliados**, **Front Caixa X Adquirente** (histórico), **Cartões Conciliados**.
- Em Não Conciliados: filtro de Data de Conciliação + campo Buscar. (Filtro de Conta Transitória fica para fase seguinte.)
- Dois quadros lado a lado — Adquirente à esquerda, Front Caixa (Opera) à direita — mostrando somente pendências.
- Seleção manual com checkbox em cada lado, N:1 permitido; botão **Conciliar** cria o grupo. O sistema nunca concilia sozinho.
- Rodapé de cada quadro com soma da seleção e, no centro, a diferença em tempo real (verde quando zero).
- Valores positivos e negativos com cores distintas.
- Ação por linha do Opera: **Recebido direto no banco** — remove da pendência sem conciliar (reversível).
- Conciliados saem das pendências e aparecem em Cartões Conciliados (com data, usuário, itens dos dois lados e diferença), com opção de desfazer.

## Tela 2 — PIX × Extrato Bancário

Mesmo layout e interação da Tela 1:
- Esquerda: lançamentos do Opera classificados como PIX.
- Direita: linhas do extrato com "PIX" no Lançamento e valor positivo.
- Sugestão de par por data + valor apenas como destaque visual; a conciliação continua manual.

## Verificação automática — Faturamento Pago × Extrato

- Para cada lançamento de Faturamento com data de pagamento preenchida, procura no extrato do hotel uma linha com a mesma data e o mesmo valor positivo.
- Sem correspondência → badge de alerta na tela de Faturamento: "marcado como pago, mas não encontrado no extrato bancário — investigar".
- Recalcula automaticamente a cada novo extrato importado.

## Exportar Excel

Botão em cada aba das telas de conciliação, respeitando filtros aplicados. Na aba de conciliados, o arquivo inclui soma de cada lado e a diferença.

## Detalhes técnicos

- Novas tabelas: `trx_code_mapping`, `conc_opera_entries`, `conc_acquirer_entries`, `conc_bank_statement_entries`, `conc_uploads`, `conc_matches` + `conc_match_items` (suporta N:1), e flag de "recebido direto no banco" na entrada do Opera. RLS liberando leitura/escrita apenas aos papéis autorizados, com GRANTs.
- Parsers no cliente (`src/lib/conciliacaoCartaoParser.ts`): XML do Opera via DOMParser, Excel via `xlsx` (padrão já usado em `conciliationParser.ts` e `arReportParser.ts`).
- Hook `src/hooks/useCardConciliation.ts` para consultas, seleção, conciliação e desfazer.
- Páginas em `src/pages/conciliacao/` e rotas sob `/financeiro/contas-receber/conciliacao` protegidas por `RoleGuard` com os 4 papéis.
- Verificação Faturamento × Extrato calculada por consulta no hook de Contas a Receber, exibida como badge na lista de Faturamento.
