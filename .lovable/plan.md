## Objetivo

Permitir abrir a Carta ao Investidor e a DRE diretamente no sistema, sem precisar baixar os arquivos.

## Onde aparece

- **Carta ao Investidor** (`/fechamento/carta`): ao lado do botão "Baixar PDF v{n}", adicionar um botão **"Visualizar"** que abre um modal com o PDF inline. Só aparece quando existe `letter.pdf_url`.
- **DRE** (`/fechamento/dre`): na tabela de versões, **somente a versão mais recente** ganha um botão **"Visualizar"** ao lado de "Baixar". As versões antigas continuam só com download.

## Como vai funcionar

### Carta (PDF)
- Modal grande (cerca de 90% da viewport).
- Gera uma signed URL temporária do bucket `investor-letters` para o `pdf_url` da carta.
- Renderiza o PDF em um `<iframe>` apontando para essa URL (navegadores modernos têm visualizador nativo).
- Botões no rodapé do modal: "Baixar PDF" (reaproveita o fluxo atual) e "Fechar".

### DRE (Excel renderizado completo)
- Modal grande com a planilha renderizada como tabela HTML.
- Baixa o arquivo da versão atual do bucket `closings` via signed URL, lê como ArrayBuffer no cliente e usa **SheetJS** (`xlsx`) para converter cada aba em HTML.
- Abas (`Tabs`) no topo do modal — uma para cada planilha do arquivo (`SheetNames`).
- A tabela é scrollável horizontal e verticalmente, mantém mesclagens de células (`sheet_to_html` já cuida disso) e preserva os textos como estão na planilha.
- Estado de carregamento enquanto baixa/parsa e mensagem de erro amigável se algo falhar.
- Botões no rodapé: "Baixar planilha" (mesmo fluxo atual) e "Fechar".
- Limite de segurança: se o arquivo passar de um tamanho razoável (ex.: 10 MB), mostrar aviso "Arquivo grande, pode demorar alguns segundos" antes de renderizar.

## Permissão de acesso

Não há mudança de permissão: a visualização usa as mesmas signed URLs que o download já usa hoje, então quem pode baixar pode visualizar.

## Detalhes técnicos

- Nova dependência: `xlsx` (SheetJS community) — apenas para parsear o Excel no cliente.
- Componentes novos:
  - `src/components/closings/CartaPdfViewerDialog.tsx` — modal com `<iframe>` do PDF + botões.
  - `src/components/closings/DreExcelViewerDialog.tsx` — modal com Tabs por aba, tabela renderizada e botões.
- Páginas alteradas:
  - `src/pages/CartaPage.tsx` — adicionar botão "Visualizar" ao lado de "Baixar PDF" e estado de abertura do modal.
  - `src/pages/DrePage.tsx` — identificar a versão de maior `version_number` e renderizar "Visualizar" só nessa linha.
- Não muda nada no banco, RLS, edge functions ou storage policies.

## Fora de escopo

- Editar a planilha pelo viewer (somente leitura).
- Pré-visualizar versões antigas da DRE.
- Anotações/comentários sobre células da DRE.
