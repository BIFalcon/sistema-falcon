# Ampliar reconhecimento da linha "a Distribuir" no Consolidado

## Objetivo

Garantir que a coluna **Distrib. Total** do Consolidado (Fechamento) sempre puxe a linha "a Distribuir" da DRE quando ela existir, cobrindo todas as variações de rótulo usadas pelos hotéis. Hoje hotéis como Ibis Cuiabá caem para "Lucro Líquido / Prejuízo do Exercício" porque o rótulo da planilha não bate com o regex atual.

## Variações que o sistema passará a reconhecer

1. "Lucro / Prejuízo a Distribuir do Período"
2. "Lucro / Prejuízo a Distribuir no Período"
3. "Lucro/Prejuízo a Distribuir do Período" (com ou sem espaços ao redor da barra)
4. "Lucro Prejuízo a Distribuir" (sem a barra)
5. "Lucro a Distribuir" sozinho
6. "Prejuízo a Distribuir" sozinho
7. "Resultado a Distribuir"

## Mudanças

### 1. Regex de matching (`src/hooks/useConsolidado.ts`)

Substituir o array atual `LUCRO_A_DISTRIBUIR_PATTERNS` por um conjunto que cubra as 7 variações acima, na seguinte ordem de prioridade (a mais específica primeiro, para evitar capturar uma linha intermediária quando existir a linha "do/no período"):

```text
1. /lucro\s*\/?\s*preju[íi]zo\s+a\s+distribuir\s+(do|no)\s+per[íi]odo/i
2. /lucro\s*\/?\s*preju[íi]zo\s+a\s+distribuir/i
3. /^\s*lucro\s+a\s+distribuir/i
4. /^\s*preju[íi]zo\s+a\s+distribuir/i
5. /resultado\s+a\s+distribuir/i
```

O matching continua usando `findLineByPattern`, que já ignora valores nulos/zero e percorre na ordem dos padrões.

### 2. Filtro `ilike` da query (mesma função, bloco `extraLines`)

Adicionar cláusulas para que o Postgres entregue ao cliente também as linhas que hoje não chegam (ex.: "Prejuízo a Distribuir" sem a palavra "lucro"):

- `line_label.ilike.%preju%distribu%`
- `line_label.ilike.%resultado%distribu%`

A cláusula existente `%lucro%distribu%` continua e já cobre os casos 1–5.

### 3. Comportamento de fallback (sem mudança)

- Se nenhuma das 5 regex casar, `distribuicaoTotal` continua vindo de `closings.final_distribution ?? closings.estimated_distribution` (comportamento atual).
- `distribuicaoPorUh` continua derivando de `distribuicaoTotal` quando a linha "Por UH" não existir e o hotel não estiver na `NO_DISTRIB_UH_HOTELS`.

## Validação

1. Recarregar a página Consolidado para o mês/ano usado pelo Ibis Cuiabá e conferir que a coluna **Distrib. Total** agora corresponde à linha "a Distribuir" da DRE (e não ao Lucro Líquido).
2. Conferir que hotéis que já estavam corretos continuam batendo (sem regressão).
3. Conferir que hotéis sem essa linha continuam mostrando o valor salvo em `final_distribution` / `estimated_distribution`.

## Fora de escopo

- Não altera o estimador (`dreEstimator.ts`) nem o valor salvo em `closings.estimated_distribution`. A correção é só na leitura do Consolidado, conforme combinado anteriormente.
- Não muda a página Financeiro, Envio ou a Carta ao Investidor.
