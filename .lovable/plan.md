## Plano

1. **Não exigir nova DRE para corrigir a carta**
   - Ajustar a geração do PDF para limpar os dados já salvos quando o hotel for Arcoverde.
   - Assim, ao gerar o PDF novamente, o outlier de abril do ano anterior e o mês de junho no gráfico deixam de aparecer mesmo que a DRE antiga continue salva.

2. **Tratar Arcoverde diretamente no histórico da carta**
   - Em `fetchLetterHistory`, identificar Arcoverde pelo `hotel_id`/nome esperado.
   - Para Arcoverde, remover/anular todos os meses do ano anterior antes da abertura operacional, incluindo abril.
   - Também anular o mês de fechamento atual no gráfico, para junho não aparecer sozinho.

3. **Manter a correção do parser para uploads futuros**
   - Preservar a limpeza feita no `dreParser.ts` para quando uma nova DRE for enviada.
   - Complementar apenas se necessário para garantir que a correção funcione tanto para DRE nova quanto para dados já persistidos.

4. **Validar o fluxo esperado**
   - Conferir que regenerar narrativa não reprocessa DRE; quem muda gráfico é gerar novo PDF.
   - Depois do ajuste, a ação correta será apenas gerar o PDF novamente, sem reenviar a DRE.