## Visão Geral Financeiro — blocos 4 a 6
- [x] Não conciliados Opera/Adquirente: quantidade e valor por hotel/período; totais conferidos contra registros de Serra Talhada e Divinópolis.
- [x] Total a receber colapsável, quatro parcelas e nova fórmula de saldo líquido. PIX/dinheiro usam Opera pendente; faturamento usa vencimento vigente, excluindo pagos/não faturáveis/inadimplentes.
- [x] Comparação multi-hotel e links com hotel/filtros para os detalhes autorizados; acesso AP preservado e conciliação abre um hotel válido, com origem prioritária.
- [x] 19 testes passaram; sessão autorizada de José conferiu dois hotéis, total R$311.255,11 e saldo R$332.176,85, card fechado inicialmente, Open Folio, vencidos e Opera. Datas específicas prevalecem na RPC; aplicação sem erros.

## Desfazer e extrato incorreto — Serra Talhada
- [x] Desfazer atômico com autorização por hotel e rechecagem somente de lotes afetados; PIX/dinheiro sem varredura de cartões. Seleção múltipla também usa uma única requisição.
- [x] Remover o upload 8c2417c0-fca7-4943-adba-b76868bdefd6 e seus 1.134 lançamentos, 19 rendimentos e 40 saldos incorretos; duas conciliações PIX posteriores também desfeitas, preservando quatro vendas Opera, quatro adquirente e dois créditos legítimos. Cópia arquivada no histórico de auditoria; contagens dos demais dados preservadas.
- [x] Cinco testes passaram, aplicação sem erros; sessão autorizada de José desfez conciliação PIX temporária pela tela (RPC 200/true, toast e remoção confirmados, banco liberado). Registro temporário removido. Cartões reais não foram desfeitos para teste.

## Visão Geral Financeiro — blocos 1 a 3
- [x] Acesso somente leitura GOP/ADM, seleção multi-hotel exclusiva da Visão Geral e período compartilhado.
- [x] Cartão automático nos dez hotéis definidos, com fallback manual nos demais; prazo textual numérico validado.
- [x] Inadimplência, Open Folio e AP atrasado atuais com faixas de valores; 29 testes e validações de totais/dias específicos no banco passaram.
- [x] Conferir seleção e indicadores na tela com conta autorizada — sessão de José validou dois hotéis, totais estruturais, cartão e navegação ao concluir blocos 4 a 6.

## Antecipações — três etapas
- [x] Estender antecipações e proteger criação, edição e confirmação; preservar lançamentos antigos.
- [x] Adicionar simulação e saldo projetado no Contas a Pagar.
- [x] Conciliar relatório Rede, mostrar recebimento/taxa separados e incluir taxa nas Tarifas.
- [x] Testar regras de projeção, tolerância, encargos e tarifas; conferir estruturas e políticas aplicadas.
- [ ] Validar criação/confirmação e recusa de perfis pela tela autenticada — bloqueado: não existe conta correspondente ao solicitante; requer login no preview. Nenhuma simulação real criada neste atendimento.

## Revisão completa das baixas
- [x] Compor lotes Rede com descontos explicitamente vinculados, sem duplicar cancelamento; remover taxa presumida e bloquear lotes repetidos.
- [x] Abrir todos os ciclos transitórios por identidade; mostrar provas/candidatos e confirmar PIX/dinheiro D−1/D+1 por soma exata e justificativa.
- [x] Disponibilizar prefixos centralizadores por hotel; nenhum prefixo inventado ou transferência presumida.
- [x] Baixar 237 rendimentos/R$162,74, com histórico e bloqueio de reaplicação após desfazer.
- [x] Reprocessar Rede e rever vínculos em todos os hotéis; 17 baixas sem prova reabertas. Manhuaçu mantém R$588,27 aguardando confirmação explícita; nenhum crédito operacional novo liberado.
- [ ] Conferir confirmações e regras na tela com sessão autorizada — bloqueado: conta do solicitante não encontrada; preview no login. Exige login ou autorização para outra conta.

## Justificativas, Faturamento e Excel
- [x] Adicionar filtros de data inicial/final e mês de referência nas Justificativas; período inclusivo, busca e limpeza testados.
- [x] Destacar edição de nota, boleto e vencimento mantendo permissões existentes.
- [x] Incluir justificativas salvas no Excel de conciliação para Patronos; atualização antes de exportar, associação por modalidade/origem/lançamento e registro de exportação. Quatro testes passaram; mês, limpeza, visual móvel e Excel baixado conferidos em amostra.
- [ ] Conferir edição/salvamento e exportação com dados reais pela tela — bloqueado: preview no login e nenhuma conta corresponde ao solicitante para sessão automática; requer login no preview.

- [x] Corrigir reimportação Rede sem NSU e otimizar preenchimento sob permissões existentes; arquivo real completou 1.271 NSUs de Manhuaçu sem novas vendas. Baixa autorizada confirmou 88 lotes, inclusive R$233,79 de 02/09, exibido em Baixados e com 1/1 vendas (100%) no detalhe. Permanecem 45 vendas sem NSU não completadas pelo arquivo; travas mantidas.
- [x] Corrigir percepção de Resolver nos alertas: total real, data de cada alerta e confirmação de salvamento; cinco testes de persistência/erros passaram e aplicação sem erros; 51 pendentes/28 resolvidos confirmados, sem reenvio ou remoção de bloqueios de e-mail.
- [ ] Conferir Resolver pela tela autenticada — bloqueado: preview sem sessão; conta Babi não disponível para acesso automático.
- [x] Vincular créditos de boletos à soma diária da Francesinha e marcar faturamentos validados como pagos na data bancária; 9 créditos/34 boletos de Serra Talhada baixados, inclusive R$253,26; 15 testes e teste integrado de lote incompleto/data bancária passaram.
- [ ] Conferir baixa e avisos dos boletos pela tela autenticada — bloqueado: não existe conta correspondente ao solicitante; requer login no preview.
- [x] Travar baixa Rede/B2B até composição integral e 100% das vendas conciliadas no Ópera; detalhes clicáveis nas baixas e pendências, reabertura ao desfazer vendas e transição preservada. 57 baixas antigas reabertas com histórico; conta transitória conferida; lote real R$2.480,70 com 17/17 vendas verificado; 22 testes passaram.
- [ ] Conferir detalhes dos lotes e baixa automática pela tela com sessão real — bloqueado: solicitante sem conta correspondente; preview retorna ao login.
- [x] Compatibilizar saldos sem nome de conta com a conta única do hotel e usar o último saldo real anterior, preservando contas distintas, saldos manuais e autorizações; Serra Talhada 19–22/10 sem lacunas e quatro cenários de banco passaram.
- [ ] Conferir Fechamento diário pela tela com sessão real — bloqueado: solicitante sem conta correspondente; requer login no preview.
- [x] Permitir inserir corte por hotel/provedor nas baixas Rede/B2B; classificação pela venda original, transição selecionada com justificativa/confirmação, histórico e desfazer. Nenhuma data inventada ou baixa real executada. Estruturas e controles de acesso conferidos; 19 testes passaram.
- [x] Corrigir reconhecimento de antecipação AT para crédito Rede sem aceitar AT para débito; 15 candidatos pendentes confirmados na base, liberados para a próxima baixa automática. Aplicação sem erros.
- [ ] Conferir salvamento do corte e transição/desfazer pela tela com sessão autorizada — bloqueado: solicitante sem conta correspondente para sessão automática; requer login no preview. Não foi registrada nenhuma transição em dados reais.
- [x] Executar passagens completas da RPC de conciliação até zero mudanças após importações B2B/Opera; falhas agora avisam sem invalidar upload salvo. Testes de repetição e falha passaram.
- [x] Impedir importação de cobranças PIX expiradas mesmo canceladas pela Rede; manter PIX pagos e ajustes de cartão. Removidos 23 expirados pendentes de cinco hotéis, arquivados em seus uploads; um já conciliado preservado. 22 testes passaram, aplicação sem erros.
- [ ] Conferir novos uploads B2B/Opera e PIX pela tela com sessão real autorizada — bloqueado: não há conta correspondente ao solicitante; conferência autenticada indisponível nesta sessão.
- [x] Corrigir identidade da importação Opera por hotel/TRX_NO; importação inteira serializada, reaproveitamento de antigos compatíveis e rejeição atômica de ambiguidades; 19 testes passaram, aplicação sem erros.
- [x] Mesclar 21 duplicidades confirmadas (13 Divinópolis, 8 Caruaru), preservando 14 conciliações e marcações B2B; cópias arquivadas no registro mantido. Redução indevida removida: R$10.425,44. Divinópolis 03/09 9142: 5 linhas/R$2.029,86; 04/09 9152: 1 linha/R$242,07. Histórico de todos os hotéis sem pares antigos/novos sobrepostos; 13 grupos semelhantes no mesmo arquivo mantidos por não serem duplicações de reimportação confirmadas.
- [ ] Validar reimportação Opera pela tela com sessão real autorizada — bloqueado: solicitante sem conta correspondente para sessão automática; requer login no preview.
- [x] Redesenhar Performance SLA para primeiras interações, RPC somente leitura, quatro tempos, comparação de três meses, tabela e Excel; 14 testes passaram, visual e exportação conferidos em amostra sem login. Dados reais: Itaperuna 26/337/100/462h; GOP registrado às 18:49 (documento dizia 18:39); médias julho 148h, agosto 262,75h, setembro 168,40h.
- [ ] Conferir Performance SLA e RPC com sessão real autorizada — bloqueado: solicitante sem conta correspondente para sessão automática; requer login no preview. Nenhuma permissão existente alterada; consulta de aceite reproduzida somente leitura nos dados originais.
- [x] Permitir selecionar divergências antes do envio e informar quantidade/valor total no e-mail. Sessão autorizada de José selecionou 2 itens (R$36), enfileirou 5 e-mails; conteúdo e seleção exata conferidos, IDs inválidos rejeitados. Entrega na caixa de entrada não verificada.
- [x] Retornar B2B classificados aos não conciliados mantendo identificação, remover aba antiga e corrigir prefixo ZOOP no cliente e servidor. Histórico/conciliações preservados; Baixas B2B exibe créditos ZOOP.
- [x] Separar Baixas e Cadastros TRX em Contas a Receber. Navegação autenticada conferida, sem controles de upload nessas seções.
- [x] Centralizar relatórios financeiros exclusivamente em Financeiro → Importações; arquivos de comprovação vinculados a lançamentos permanecem em suas ações. Sessão de José importou extrato real com 444 movimentos e leitura confirmada, permissões por tipo preservadas.
- [x] Incluir RECEBIDOS/RECEBIMENTOS entre lançamentos bancários de PIX, exceto boletos, em cliente, matching e divergências; arquivo real com 8 créditos desse tipo e 9 ZOOP validado, predicados servidor conferidos.
- [x] Enviar divergências de Cartão/PIX/Dinheiro e inadimplência ao GG/ADM vinculado; link direto e pendências na Home. Clique autenticado em Arcoverde enfileirou 5 e-mails (1 GG/4 ADM); Home do GG e abertura de justificativas de Cartão/PIX/Dinheiro verificadas com sessão real; 13 testes passaram. Entrega na caixa de entrada não verificada.
- [x] Criar conta transitória e fechamento diário por hotel/dia, com saldos do extrato/preenchimento manual; 16 testes passaram, ciclo bancário de criação/reversão/reabertura validado com registro temporário removido e 2.279 pendências reais sem inconsistências.
- [ ] Conferir fechamento diário e conciliação manual pela tela com sessão real — bloqueado: solicitante sem conta correspondente para sessão automática; requer login no preview. Transição bancária testada diretamente, sem execução do botão manual.
- [x] Separar Base (direcionamento) de Categoria OMIE (etiqueta e cruzamento), atualizar lançamentos existentes sem desfazer conciliações; 18 testes passaram, classificação conferida sem divergências e aplicação sem erros.
- [ ] Conferir conciliação por Categoria OMIE na tela com sessão real — bloqueado: solicitante sem conta correspondente para sessão automática; requer login no preview.
- [x] Corrigir composição da receita na Carta do Manhattan com as seis linhas da DRE, sem alterar os demais hotéis; planilha e valores salvos conferidos (total 1.147.436,41), nove testes passaram e página PDF renderizada sem cortes, mantendo centavos na distribuição. Geração completa com sessão real continua bloqueada pelo login abaixo.
- [x] Renomear Administrativo & Financeiro nos departamentos (74 registros existentes) e compactar a tabela de colaboradores com cabeçalhos quebrados; 30 testes passaram e larguras verificadas sem rolagem horizontal em amostra visual (1048, 1280 e 1775px). Conferência autenticada continua bloqueada pelo login abaixo.
- [x] Detalhar extras da nova folha por departamento e colaborador, renomear Recepção & Atendimento e preservar compatibilidade com a folha antiga; 48 testes passaram, arquivo real validado (473 linhas, 19 hotéis, nenhum desconhecido). Arquivo não importado: reenviar pela tela após login.
- [x] Corrigir leitura de Roomnights usando quartos ocupados da DRE; setembro auditado nos hotéis com DRE, Confins 4.538 e Serra Talhada 1.786.
- [ ] Conferir tabelas detalhadas e Roomnights com sessão RH/Master — bloqueado: solicitante sem conta correspondente para sessão automática; requer login no preview.
- [x] Ajustar seleção de hotéis da Carta para RI: ignorar carteira GOP antiga, selecionar hotel válido e liberar vínculo fixo ao trocar filtros; 24 testes passaram, aplicação sem erros.
- [ ] Conferir seleção da Carta com sessão real RI — bloqueado: preview sem login e solicitante sem conta correspondente; requer login no preview.
- [x] Criar perfil Novos Negócios: consulta à DRE do Fechamento e três Indicadores DRE de todos os hotéis; cadastro disponível, políticas aplicadas e oito testes de acesso passaram.
- [ ] Conferir acesso com sessão real Novos Negócios — bloqueado: perfil novo ainda não atribuído a uma conta; sem sessão correspondente do solicitante.
- [x] Alterar Custo e Folha para líquido, cards de salário/bruto/extras e série mensal de extras; migração aplicada, campos/permissões conferidos e 40 testes passaram.
- [ ] Conferir novos valores e exportação de Custo e Folha com sessão real RH/Master — bloqueado: não existe conta correspondente ao solicitante para sessão automática; requer login no preview.
- [x] Liberar Indicadores DRE para ADM: somente Resumo e um hotel vinculado por vez; cinco testes de permissão passaram e geração conferida sem erros.
- [ ] Conferir Indicadores DRE com sessão real ADM — bloqueado: sem sessão autorizada disponível; requer login no preview.
- [x] Corrigir visualização/download da carta sem fallback silencioso e sem alterar versões; sete testes passaram.
- [ ] Conferir download da carta com sessão real — bloqueado: não há conta correspondente ao solicitante; requer login no preview.
- [x] Unificar fonte e leitura da planilha mensal de RH por competência e hotel.
- [x] Substituir o mês inteiro em uma operação segura, mantendo histórico de outros meses.
- [x] Alimentar Turnover e Custo e Folha pela fonte única; remover envio do Turnover.
- [x] Conferir acessos RH/Master, Fernando/Viewer, GOP/GG e bloqueio de ADM nas funções e telas mensais.
- [x] Testar regras e leitura da planilha real (389 linhas; dois nomes de hotel não reconhecidos).
- [ ] Validar envio e leitura com sessão real RH/Master — bloqueado: usuário solicitante não tem conta correspondente para sessão automática; requer login no preview.
- [x] Atualizar gráficos de Turnover, fórmula única, histórico mensal e rolagem do ranking; testar regras.
- [ ] Conferir gráficos e ranking com sessão real — bloqueado: preview sem login e sem conta correspondente ao solicitante.
- [x] Mover comparação de turnover por hotel para o Ranking, substituindo a lista pelo gráfico.
- [x] Aplicar classificação aprovada de cargos aos departamentos nos custos atuais e futuras importações; reservas/comercial em Hospedagem e Serviços Gerais em Governança.
- [x] Mostrar percentuais após as barras do Ranking e permitir baixar o gráfico completo como imagem.
- [ ] Conferir download de imagem no Ranking com sessão real — bloqueado: solicitante sem conta correspondente; requer login no preview.
## Nova planilha OMIE — Contas a Pagar
- [x] Aceitar o novo layout, priorizar previsão com fallback para vencimento e preservar a apresentação atual.
- [x] Persistir dados estruturados de pagamento; 14 testes passaram e arquivo real validou 4 lançamentos/R$1.347,93, três boletos e um PIX.
- [ ] Validar importação/reimportação com sessão autorizada — bloqueado: solicitante sem conta correspondente para acesso automático; requer login no preview. Nenhuma remessa ou importação real executada.

## Alterações Gerais (3 blocos)
- [x] 1.1 Voltar à Visão Geral (DRE e Carta)
- [x] 1.2 Quem visualizou a DRE (dre_view_log + RPC)
- [x] 1.3 Fernando aprovando fora da vez (diagnóstico + regra front e servidor)
- [x] 1.4 Performance SLA só com filtro global
- [ ] 2 Indicadores DRE Jaboatão: lucro = -(Aluguel Variável), checar Petrópolis
- [ ] 3 RH Custo e Folha: aba Consolidado + RPC agregada + gráficos + export
