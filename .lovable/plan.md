## Problema

Hoje, ao escolher **Matriz** no filtro do Turnover, o sistema cai em **3 Rios Plaza**. Causa: o `AppHeader` tem um efeito que, se o `hotelId` selecionado não existe na lista de hotéis permitidos, reseta para o primeiro hotel da lista. Como `__matriz__` é apenas um valor de marcador (não um hotel real), ele é descartado e substituído.

Além disso, hoje não existe nenhum "lugar" para armazenar colaboradores da Matriz, então só corrigir o reset não resolve — a Matriz precisa ter um escopo próprio para receber a planilha de ativos/desligados.

## Solução

Tratar Matriz como um **"hotel especial" usado apenas em RH/Turnover**, com planilha própria e isolado dos outros módulos.

### 1. Banco (migração)
- Criar 1 registro em `hotels` representando a Matriz (ex.: id `matriz`, nome "Matriz", `active = true`, `show_in_closing = false`).
- Adicionar coluna booleana `rh_only` (default `false`) em `hotels` e marcá-la como `true` para esse registro. Essa flag indica: "só aparece em telas de RH (Turnover/Rotatividade)".

### 2. Permissões / lista de hotéis (`AuthContext` + `useHotelAssets`)
- Onde a lista `allowedHotels` é construída, **excluir hotéis com `rh_only = true`** do retorno padrão.
- Expor uma lista paralela `rhAllowedHotels` (ou similar) que inclui Matriz apenas para usuários com papel **Master, RH, Viewer ou Fernando**.

### 3. Filtro no header (`AppHeader.tsx`)
- Quando estiver na rota `/rh/turnover` e o usuário puder ver Matriz, mostrar o item "Matriz" no Select (já existe), mas usando o **id real do hotel Matriz** em vez do sentinela `__matriz__`.
- Ajustar o efeito que reseta `hotelId` para considerar válidos tanto os hotéis em `allowedHotels` **quanto** o hotel Matriz quando o usuário tem permissão e está na tela de Turnover. Isso elimina o "vira 3 Rios Plaza".
- Garantir que Matriz **não apareça** em nenhum outro filtro global (Financeiro, Indicadores, Fechamento, etc.).

### 4. Página de Turnover (`TurnoverPage.tsx`)
- Nenhuma mudança de lógica de filtro além de aceitar o id da Matriz como qualquer outro hotel (o filtro `e.hotel_id === hotelId` já cobre).
- **Ranking**: excluir Matriz do ranking entre hotéis (ela é corporativa, não compete).
- **Upload**: o botão de upload já usa `hotelId`; ao ter Matriz selecionada, a planilha é importada com `hotel_id = matriz`. Os mesmos formatos POUSADA/ASSENSUS/RCASTRO continuam aceitos.

### 5. Sidebar / navegação
- Nenhuma mudança. Matriz não vira item de menu — continua sendo apenas uma opção dentro do filtro de hotel do Turnover.

## Resultado esperado

- Master, RH, Viewer e Fernando veem "Matriz" no filtro do Turnover; ao selecionar, a tela mostra zero dados (até subir a primeira planilha) — e **não** cai mais em 3 Rios Plaza.
- Upload da planilha de ativos/desligados da Matriz fica vinculado a esse escopo isolado.
- Matriz não aparece em Financeiro, Fechamento, Indicadores, Conciliação, etc.
- KPIs, gráficos e cálculos (Ativos, Desligamentos, % Experiência, % Turnover, % Rotatividade, Tempo de casa) funcionam para Matriz exatamente como para qualquer outro hotel.

## Fora deste plano

- Ajustes nos parsers POUSADA/R.CASTRO/Carneiros (combinado para o próximo passo).
- Qualquer mudança de fórmula nos indicadores (continuam as já validadas).
