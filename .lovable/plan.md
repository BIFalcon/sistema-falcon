# Plano: nova matriz de roles + remoção de `financeiro`

## 1. Migração de banco (uma migration grande)

### 1.1 Enum `app_role`
- Adicionar valor `patronos` ao enum.
- **Remover** o valor `financeiro` no fim da migration (após reescrever tudo que usa).

Como Postgres não permite remover valor de enum em uso, vou:
1. Criar `app_role_new` com os valores finais (sem `financeiro`, com `patronos`).
2. Migrar `user_roles.role` e todas as funções/policies para o tipo novo.
3. Dropar o antigo e renomear.

### 1.2 Migração de dados (antes do swap de enum)
- 3 usuários `financeiro` + subrole `equipe` → `controladoria`.
- 1 usuário `financeiro` + subrole `coordenadora` → `patronos`.
- Limpar `profiles.financeiro_subrole` (manter coluna por enquanto, só zerar valores).

### 1.3 Reescrever funções SECURITY DEFINER
Trocar `has_role(_, 'financeiro')` por `(has_role(_, 'controladoria') OR has_role(_, 'patronos'))`:
- `is_ap_manager` → controladoria OR patronos
- `is_ar_manager` → controladoria OR patronos
- `is_hotel_allowed` → trocar `financeiro` por `controladoria` e `patronos`
- `has_global_data_access` → trocar `financeiro` por `controladoria` e `patronos`
- `is_dre_uploader` → **somente master** (remove controladoria e gop)
- `is_financeiro_coordenadora` → vira `is_patronos` (retorna `has_role(_, 'patronos')`)
- `is_financeiro_equipe` → manter retornando false (compat) ou remover; remover é mais limpo.

### 1.4 Reescrever RLS policies que mencionam `financeiro`
Todas as policies listadas no contexto que usam `'financeiro'::app_role` serão recriadas trocando por `controladoria` ou `controladoria + patronos` conforme a regra:
- AP (ap_entries, ap_documents, ap_uploads, ap_bank_balance, ap_anticipation, ap_card_receivable, ap_notification_log): managers = controladoria + patronos. **Bloquear GG** (remover `has_role(_,'gg')` das policies de update de ap_entries e ap_documents).
- AR (ar_*): managers idem; manter políticas adm/gg como estão.
- ar_client_contracts: substituir financeiro por controladoria/patronos.
- closing_status_log, dre_parsed_lines, dre_versions, closings: via `has_global_data_access` (já cobre).
- approvals, comments: usam `has_any_role` + exclusões de viewer/ri — manter.

### 1.5 `enforce_ap_payment_status_change`
Marcar "Pago" só permitido por master OR `is_patronos`.

### 1.6 Drop/swap do enum
Após reescrever tudo, drop enum antigo e rename `app_role_new` → `app_role`.

### 1.7 GRANTs
Reaplicar GRANTs nas tabelas tocadas (sem mudança real, mas garantir).

## 2. Frontend

### 2.1 `src/lib/constants.ts`
- Atualizar `AppRole` removendo `financeiro`, adicionando `patronos`.
- `MASTER_ROLES` inalterado.

### 2.2 `src/contexts/AuthContext.tsx`
- Trocar checagens `roles.includes("financeiro")` por `controladoria` ou `patronos`.
- `GLOBAL_ACCESS_ROLES`: substituir `financeiro` por `controladoria`, `patronos`.
- Adicionar `isPatronos`. Remover `isFinanceiroEquipe/Coordenadora/financeiroSubrole` (ou manter sempre `false/null` para não quebrar imports — escolha: **manter como deprecated** retornando false/null para evitar refactor enorme; pode remover depois).
- Adicionar helper `canViewPerformanceSla` = master || viewer || `isFernandoCEO`.
- Adicionar helper `canUploadRetroactiveDre` = `isMaster` apenas.

### 2.3 `src/App.tsx` — RoleGuards
- `/fechamento/financeiro` → `["controladoria","patronos"]`
- `/fechamento/consolidado` → trocar `financeiro` por `controladoria, patronos`
- `/financeiro` (visão geral) → `["controladoria","patronos","gg","viewer"]` (viewer leitura; GG só do hotel dele via RLS)
- `/financeiro/contas-pagar` → `["controladoria","patronos","viewer"]` (sem GG)
- `/financeiro/contas-receber` → `["controladoria","patronos","gg","adm","gop","viewer"]`
- `/financeiro/contas-receber/clientes` → `["controladoria","patronos","gg","adm"]`
- `/fechamento/performance` → guard custom: master || viewer || FernandoCEO
- `/indicadores` → adicionar `rh`
- `/controladoria/conciliacao` → `["controladoria","patronos"]`

### 2.4 Sidebar (`AppSidebar.tsx`)
- Renomear seção "Financeiro" para "Controladoria"; manter os 4 itens dentro.
- Esconder Contas a Pagar para GG.
- Esconder Upload retroativo de DRE para todos exceto master.
- Performance SLA visível só para master/viewer/FernandoCEO.

### 2.5 Upload retroativo DRE
- Página `UploadRetroativoDrePage`: bloquear render se `!isMaster`.
- Esconder link na sidebar para não-master.

### 2.6 Telas read-only para viewer
- AP/AR/Visão Geral: as RLS já garantem leitura. Frontend precisa esconder botões de ação se `viewer`. Auditar `ContasPagarPage`, `ContasReceberPage`, `FinanceiroVisaoGeralPage` e adicionar `const readOnly = roles.includes('viewer') && !isMaster` para desabilitar ações.

### 2.7 Hooks/componentes que referenciam `financeiro` ou subrole
- `useUsers.ts`: remover `financeiro_subrole` (ou deixar deprecated).
- `useAccountsPayable.ts`, `useAccountsReceivable.ts`, formulários de aprovação, etc — trocar checagens.

### 2.8 `UsuariosPage` formulário
- Remover opção `financeiro` da lista de roles; adicionar `patronos` e `controladoria` (já existe).
- Remover seletor de subrole financeiro.

## 3. Edge functions
- `be-eight-export`: o `COLUMN_BLOCKLIST` não muda. Verificar se há referências a role `financeiro` em manage-users etc. e ajustar.
- `manage-users/index.ts`: validar role válida — remover `financeiro` da lista permitida, adicionar `patronos`.

## 4. Ordem de execução

1. Migration única (steps 1.1 → 1.7).
2. Após approve da migration, regenera tipos — então atualizo código frontend e edge functions.
3. Validação manual: lint, build, smoke test login.

## Riscos e mitigação
- **Remover enum value `financeiro`**: requer recriar TODAS as policies e funções que o referenciam. Faço tudo em uma migration transacional; se algo falhar, rollback completo.
- **Frontend pós-migration**: tipos regerados vão quebrar compilação onde ainda houver `"financeiro"`. Vou atualizar todos os arquivos no mesmo PR pós-migration.

## Pergunta de confirmação
A migration vai falhar se algum arquivo/política não-listada também referenciar `'financeiro'::app_role`. Vou rodar uma varredura no banco (`pg_policies`, `pg_proc`) durante a migration para garantir cobertura. Se aparecer algo inesperado, paro e aviso antes de prosseguir. Posso seguir?
