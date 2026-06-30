# Recomendação: opção 2 (upload com deduplicação)

Recomendo fortemente a **segunda opção**. É mais segura, reaproveitável (serve para qualquer mês futuro em que faltem registros) e elimina o risco de apagar trabalho dos hotéis/matriz.

A primeira opção (substituir tudo de uma vez) é arriscada: qualquer documento anexado, marcação de pago, status de cobrança ou nota feita pelos hotéis seria perdida — e ainda exigiria um "modo de emergência" que precisaríamos travar depois, o que é frágil.

## O que vai ser feito

### 1. Chave de deduplicação (no parser/import)
Considerar um registro como "já existe" quando todos esses campos baterem:
- `property name` (hotel)
- `transaction date`
- `confirmation number`
- `amount` (valor)
- `account name`
- `account number`

Essa combinação vira a chave única do registro durante o import.

### 2. Comportamento do upload
- Lê o arquivo completo normalmente.
- Para cada linha:
  - **Se já existe** registro com a mesma chave → **ignora** (não toca em nada: nem status, nem documentos, nem pagamento, nem notas).
  - **Se não existe** → **insere** como novo registro pendente.
- No final, mostra um resumo: X linhas lidas · Y inseridas · Z já existentes (puladas).

### 3. Onde mudar
- `supabase/functions/parse-ar-report/index.ts` — adicionar checagem por chave composta antes de inserir cada linha, em vez do upsert atual por `entry_key`.
- `src/lib/arReportParser.ts` — garantir que `entry_key` seja gerada a partir exatamente desses 6 campos normalizados (sem acento, trim, valor com 2 casas) para casar 1:1 com o que já está no banco.
- `src/pages/ContasReceberPage.tsx` — ajustar o toast/resumo pós-upload para mostrar "inseridos" e "ignorados (já existentes)".

### 4. Sem mudança de schema
Não precisa de migração. A `entry_key` já existe em `ar_to_invoice_entries` e a tabela tem as colunas necessárias. Só precisamos garantir que a chave seja determinística pelos 6 campos acima.

## Observações
- O escopo é a aba **Faturamento (To Invoice)**. Se quiser o mesmo para **Open Folio**, me confirma que aplico a mesma lógica lá.
- Operações manuais já feitas (pago, documento, nota, status) ficam **intocadas**.
- Se algum mês tiver linhas com valor corrigido em relação à planilha (ex.: hotel atualizou), o sistema **não sobrescreve** — mantém o que está no banco. Isso é o comportamento desejado pelo seu pedido.

Posso seguir com essa implementação?