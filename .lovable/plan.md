## Diagnóstico

A regra hoje em `src/pages/ContasReceberPage.tsx` já é, em teoria, "só Master e Patronos":

```ts
const canImportAr = isMaster || isFinanceiroCoordenadora;
```

Mas `isFinanceiroCoordenadora` é um **alias legado** definido em `AuthContext` como `isPatronos`. Esse encadeamento confuso (e o nome antigo "financeiro coordenadora") tem dois problemas:

1. Não é óbvio que essa flag realmente é "patronos" — qualquer mexida futura no alias quebra o upload.
2. Existem outros pontos da página que ainda usam `isManager = !isFernando && (isMaster || hasRole("financeiro"))`, o que **abre o upload para Controladoria** (porque o shim de `hasRole("financeiro")` devolve `true` para Controladoria e Patronos). O `UploadCard` está OK (usa `canImportAr`), mas o nome confunde quem lê.

Backend já está correto: a função `is_ar_manager` libera Master/Controladoria/Patronos, e as policies de `ar_uploads`, `ar_to_invoice_entries`, `ar_open_folio_entries` e do bucket `accounts-receivable` usam ela. Não precisa migração.

A reclamação da patrona deve estar relacionada ao app publicado estar numa versão anterior à do alias `isPatronos`, ou a cache. Vamos eliminar a ambiguidade e republicar.

## Mudança

Arquivo: `src/pages/ContasReceberPage.tsx`

1. Trocar a regra de upload para uso explícito de `isPatronos`:

```ts
const { isMaster, isPatronos, hasRole, userHotels, isFernando } = useAuth();
...
const canImportAr = isMaster || isPatronos;
```

2. Atualizar o texto auxiliar do `UploadCard` (linha ~2176):

> "Apenas usuários **Patronos** ou **Master** podem fazer upload."

3. Após salvar, **publicar** para que a versão em produção também receba a correção.

## Escopo

- Apenas frontend.
- Nenhuma migração / nenhuma alteração em edge function.
- Sem impacto nas demais permissões da página (visualização, confirmação GG, etc.) — só o botão "Importar Relatório" muda de gate.
