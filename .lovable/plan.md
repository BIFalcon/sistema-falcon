# Conciliação de Notas Fiscais — correção do cruzamento e persistência por hotel/período

## O que está errado hoje (diagnóstico com os arquivos de Caruaru)

Testei os dois arquivos de Caruaru (580 notas da prefeitura, 513 reservas do Opera) e reproduzi o problema: **nada concilia**.

A causa é o número do RPS. No relatório da prefeitura de Caruaru não existe coluna "RPS" — o número real vem escrito dentro do texto do serviço (`... / RPS: 1979 / ...`). O sistema, sem achar a coluna, usa o campo "DPS Nº", que é o próprio número da nota (2112) e nunca corresponde ao número fiscal do Opera (1979). Pior: como ele considera que "já tem RPS", nem tenta o cruzamento alternativo pelo número de confirmação — então a reserva fica sem par e tudo cai em "sem nota".

Conferi que os dados estão corretos: lendo o RPS de dentro do texto, **483 notas casam** pelo número fiscal do Opera; pelo número de confirmação, **473 casam**. Combinando os dois critérios praticamente todo o mês concilia.

Um segundo problema no mesmo arquivo: o nome do hóspede não é reconhecido (o texto é `Hospede: Nome / Confirmacao: ...`, e a leitura só esperava `Hospede: Nome / CPF`), então a checagem de nome fica sempre em branco.

## Correções do cruzamento

1. Ler o RPS na ordem certa: coluna RPS própria → número dentro do texto (`RPS: nnnn`) → só então DPS, e nunca usar DPS quando ele for igual ao número da nota.
2. Indexar cada nota pelos dois critérios ao mesmo tempo (RPS e confirmação), em vez de "RPS ou senão confirmação". O cruzamento tenta RPS primeiro e cai para confirmação quando não achar.
3. Reconhecer o nome do hóspede também no formato `Hospede: Nome / Confirmacao`, além do atual.
4. Aceitar a data de check-in já em formato ISO (`2026-08-29`), como vem em Caruaru.

## Filtro de hotel e de data (itens 2 e 3) + duplicidade (item 4)

Hoje a tela não grava nada: os dois arquivos são lidos no navegador e o resultado desaparece ao sair. Não existe hotel nem período associado ao que foi inserido — por isso não há como "escopar" nem como evitar duplicidade. Vou passar o módulo a gravar no banco, seguindo o mesmo padrão do Faturamento:

- Duas tabelas novas (linhas do Opera e notas da prefeitura), cada linha com hotel, ano/mês de referência e uma **chave estável** calculada a partir do próprio conteúdo da linha (hotel + mês + confirmação + número fiscal + valor para o Opera; hotel + mês + número da nota para a prefeitura). Reenviar o arquivo MTD na semana seguinte reaproveita a mesma chave e não duplica — linhas novas entram, linhas repetidas são ignoradas.
- Uma tabela de registros de envio, guardando o hotel selecionado no filtro no momento do clique e o período, para auditoria.
- O hotel e o período usados na gravação são lidos do filtro no instante do envio (passados como parâmetro para o processamento), nunca de estado antigo — e o botão de envio fica bloqueado sem hotel selecionado.
- A tela passa a mostrar o que está gravado para o hotel + mês escolhidos no filtro, então trocar de hotel troca o conteúdo sem misturar dados.

## Consumo de banco (item 5)

- Índices nas colunas de filtro: `(hotel_id, ref_year, ref_month)` nas duas tabelas de lançamentos, além de índice único na chave estável (que é o que impede duplicidade).
- Cartões de resumo (conciliadas / divergências / sem nota / notas sem reserva) calculados por contagem e soma agregada no banco, não trazendo o acervo para o navegador.
- Listas detalhadas paginadas de verdade (páginas de 1.000 linhas, como já é feito na Conciliação de Cartão), e a leitura completa só acontece no clique de exportar.
- Nenhuma consulta presa em versão antiga: depois de um envio, a próxima abertura já reflete o dado novo sem recarregar a página.

## Detalhes técnicos

- `src/lib/nfConferenceParser.ts`: nova ordem de resolução do RPS, regex `RPS:\s*(\d+)` na descrição, guarda contra `dps === numeroNfse`, regex de nome com terminador `/`, `toIsoDate` aceitando ISO; parsers passam a receber `hotelId`, `refYear`, `refMonth` e devolver `entry_key`.
- `src/hooks/useNfConference.ts`: indexação dupla (`notasByRps` **e** `notasByConf` para a mesma nota), com marcação de nota já usada para não contar duas vezes.
- Novo hook `useNfConferenceData.ts`: upsert em lote com `onConflict: entry_key, ignoreDuplicates: true`, leitura paginada (`fetchAllPaged`), contadores agregados, `staleTime: 0 / refetchOnMount: "always"`.
- `src/pages/ConferenciaNotasFiscaisPage.tsx`: usa o `FilterContext` (hotel + mês) como escopo de leitura e de gravação.
- Migração: tabelas `nf_opera_entries`, `nf_nota_entries`, `nf_uploads` com GRANTs, RLS via `can_view_hotel_data` / `can_access_conciliacao` e os índices acima.
