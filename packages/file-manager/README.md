# File Manager

Explorador de arquivos do ThinkIac. Ele lista e organiza os arquivos do workspace, recebe uploads e abre prévias internas sem enviar o usuário para outra aba.

## O que oferece

- Navegação por pastas, criação, renomeação, cópia, recorte, colagem, movimentação e exclusão recuperável.
- Upload de arquivos e diretórios, extração de arquivos compactados e registro de visualizadores externos.
- Prévia interna para Markdown, texto, imagens, áudio, vídeo, PDF, planilhas e modelos `.glb`.
- Registro de prévias e de aplicativos em “Open with…” por hooks do Runtime.

As operações recebem caminhos relativos ao workspace. O serviço recusa caminhos absolutos e tentativas de sair da raiz do projeto.

## Prévia de Markdown

Arquivos `.md`, `.markdown`, `.mdown` e `.mkdn` usam uma leitura formatada, com títulos, listas, tabelas, citações, blocos de código, links e imagens responsivos. HTML embutido no arquivo é removido antes da exibição, para que uma prévia não execute conteúdo do workspace. O botão **Download** mantém acesso ao arquivo original.

## Prévia de imagens

Imagens são abertas no `ImageView` com nome do arquivo, estado de carregamento, dimensões após o download e link para baixar o original. O bitmap é mostrado como conteúdo visual, não como texto extraído: o File Manager não faz OCR. Caso seja necessário copiar ou pesquisar o texto presente em uma imagem, abra-a em uma ferramenta que ofereça OCR.

## Extensões nativas

| Tipo | Extensões principais | View |
| --- | --- | --- |
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkdn` | `MarkdownView` |
| Texto | `.txt`, `.json`, código e configuração | `TextView` |
| Imagem | `.png`, `.jpg`, `.webp`, `.svg`, `.avif` | `ImageView` |
| Documento | `.pdf` | `PdfView` |
| Planilha | `.csv`, `.tsv`, `.xlsx`, `.xlsm`, `.ods` | `SpreadsheetView` |
| Mídia | vídeo e áudio comuns | `VideoView`, `AudioView` |
| 3D | `.glb` | `GlbView` |

## Desenvolvimento

Na pasta deste pacote:

```bash
npm test
```

Os testes verificam o protocolo de prévia, a seleção do visualizador, o SSR e os contratos dos endpoints usados pelas views.

## Extensibilidade

No boot, outro pacote pode registrar uma prévia nativa pelo hook `file:register:view`. Informe a extensão, o pacote e o nome simples do componente em `views/`. O último registro para a mesma extensão substitui o anterior.

Para abrir um arquivo em uma aba completa de outro aplicativo, use `file:register:opener`. Ele adiciona o aplicativo ao menu “Open with…” e entrega o caminho por query string.

Consulte os comentários de `onRegisterView` e `onRegisterOpener` em `index.js` para o formato completo dos payloads.
