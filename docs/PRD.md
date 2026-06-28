# PRD — Inserir Títulos (lower-thirds via CSV + range markers)

> Sintetizado a partir de [`docs/PLAN.md`](PLAN.md). Fonte da verdade das decisões
> de produto/arquitetura continua sendo o PLAN; este PRD organiza em problema,
> histórias, decisões e testes para fatiar em issues.

## Problem Statement

Como editor do canal "Melhores da Semana", hoje eu insiro **manualmente** cada
sobreposição de texto (manchete + subtítulo) ao longo de um vídeo longo, título a
título: aplico o template, digito o texto, ajusto o tamanho para caber na box e
posiciono no tempo. Isso é lento, repetitivo e propenso a erro — e o ajuste de
tamanho na mão (para o texto preencher a largura) é a parte mais chata.

## Solution

Um **painel CEP no Premiere** onde eu: (1) crio **range markers** na timeline onde
cada título entra/sai, (2) preencho um **CSV** com estilo + manchete + subtítulo,
(3) carrego o CSV no painel, confiro uma **tabela de preview** do pareamento
marcador↔linha e clico **Aplicar**. O painel posiciona cada título no tempo do seu
marcador, dentro do **MOGRT** da marca (com **auto-fit embutido**, sem eu ajustar
tamanho), e injeta os textos. Tudo fica no stack que eu já domino (Adobe/Premiere),
sem me jogar uma dependência técnica (Node/IA) no colo.

## User Stories

1. Como editor, quero criar **range markers** na timeline e que cada um vire o tempo
   (in/out) de um título, para não digitar timecode em lugar nenhum.
2. Como editor, quero preencher um **CSV** simples (estilo, manchete, subtítulo), para
   alimentar todos os títulos de uma vez.
3. Como editor, quero que o CSV aceite **acentos do português** sem quebrar, para não
   ver "raciocÃ­nio" no vídeo.
4. Como editor que exporta do Excel pt-BR, quero que o CSV com **ponto-e-vírgula**
   funcione igual ao com vírgula, para não precisar reconfigurar o Excel.
5. Como editor, quero usar **vírgula dentro do texto** (entre aspas), para escrever
   manchetes naturais como `"Sora, Runway e Pika"`.
6. Como editor, quero **deixar o subtítulo vazio** em alguns títulos, para usar só a
   manchete quando faz sentido.
7. Como editor, quero escolher entre os estilos **`l3rd`, `centered` e `question`** por
   linha, para misturar formatos no mesmo vídeo.
8. Como editor, quero abrir o painel em **Window > Extensions > Inserir Títulos**, para
   acessá-lo de dentro do Premiere.
9. Como editor, quero um botão **Carregar CSV**, para escolher o arquivo pelo explorador.
10. Como editor, quero uma **tabela de preview** mostrando "marcador N @ in–out → linha
    N: estilo + manchete", para conferir o pareamento **antes** de aplicar.
11. Como editor, quero que o painel me **avise quando o nº de marcadores ≠ nº de linhas**
    e **não deixe aplicar**, para nunca desalinhar título e tempo.
12. Como editor, quero ser avisado de **estilo desconhecido** ou **manchete vazia** numa
    linha específica, para corrigir o CSV com precisão.
13. Como editor, quero clicar **Aplicar** e ver **todos os títulos** posicionados nos
    in/out certos, com o estilo certo por linha, para terminar em um clique.
14. Como editor, quero que o texto **preencha a largura da box automaticamente**
    (auto-fit), tanto numa manchete curta quanto numa muito longa, para nunca ajustar
    tamanho na mão.
15. Como editor, quero escolher em **qual track de vídeo** os títulos entram, para não
    sobrescrever minha edição.
16. Como editor, quero apontar a **pasta dos `.mogrt`** nas configurações, para o painel
    achar os templates.
17. Como editor, quero que as **configurações fiquem salvas** entre sessões, para não
    reconfigurar toda vez.
18. Como editor, quero **mensagens de erro claras em português**, para entender o que
    corrigir sem suporte.
19. Como editor, quero que o painel **ignore marcadores que não são de range** (ponto),
    para poder usar marcadores comuns para outros fins.
20. Como editor, quero ver o **estado da sequência ativa** (nome + nº de tracks) no topo
    do painel, para confirmar que estou na timeline certa.
21. Como desenvolvedor, quero a **lógica de parsing/pareamento/validação testada
    automaticamente**, para evoluir o plugin sem medo de regressão nos acentos/BOM.
22. Como desenvolvedor, quero um **contrato de display names** dos MOGRT documentado,
    para autorar os `.mogrt` no AE sem adivinhar nomes.
23. Como editor, quero **instalar a extensão em modo dev** (não assinada), para testar
    antes de termos o ZXP assinado.
24. Como responsável pela entrega, quero **assinar um ZXP**, para distribuir ao editor
    sem PlayerDebugMode.
25. Como editor, quero um **CSV de exemplo** (`template.csv`), para começar copiando e
    colando.
26. (Fase 2) Como editor, quero que o **timing venha de um XML/FCP7** gerado a partir da
    montagem do Koota, para dispensar os marcadores manuais — reaproveitando a lógica
    "linha → título no tempo X".

## Implementation Decisions

- **Stack**: painel **CEP** (UI HTML/JS) + **ExtendScript** por baixo, chamado via
  `CSInterface.evalScript`. (Decidido no PLAN: fica no stack do editor.)
- **Separação de camadas (a costura de teste principal)**:
  - `jsx/titulos-core.js` — **lógica pura** (sem `app` do Premiere): strip de BOM,
    detecção de delimitador, parse CSV (RFC-4180-ish), normalização de estilo,
    pareamento por ordem, validação e montagem do preview. ES3-safe **e** carregável
    no Node (cauda UMD).
  - `jsx/inserir-titulos.jsx` — **host/glue** com o `app`: leitura de arquivo UTF-8,
    leitura de range markers, `importMGT`, injeção de texto, ajuste do out. Inclui o
    core e o `json2.js`.
  - `js/main.js` — **UI fina**: carrega CSV, pede preview/aplicação ao host, desenha a
    tabela. Sem regra de negócio.
- **Contrato CSV**: colunas `estilo,manchete,subtitulo`; cabeçalho **opcional**
  (sem cabeçalho ⇒ posicional). Delimitador **`,` ou `;`** autodetectado. Encoding
  **UTF-8** com tratamento de **BOM**.
- **Estilos**: chaves canônicas `l3rd`, `centered`, `question`, com aliases tolerantes
  (`lower third`/`lt`, `center`/`centralizado`/`box`, `pergunta`/`q`).
- **Timing**: **range markers** (out > in) da sequência ativa, ordenados por tempo,
  **pareados por ordem** com as linhas. Sem coluna de duração — a duração é o tamanho
  do range.
- **Filtro por cor de marcador: descartado no MVP.** A API de scripting do Premiere
  não expõe um getter de cor confiável; o filtro estável é "**apenas marcadores de
  range**". (Reduz escopo e risco; documentado.)
- **Injeção de texto no MOGRT**: `clip.getMGTComponent()` → casar pelo `displayName`
  do parâmetro exposto no Essential Graphics → `setValue(texto, true)`. Display names
  assumidos: **`Manchete`** e **`Subtítulo`** (ver contrato).
- **Posicionamento/duração**: `seq.importMGT(path, ticksDoIn, trackAlvo, trackAlvo)` e
  `clip.end = Time(outDoMarcador)`. Ticks = segundos × 254016000000.
- **Auto-fit**: **embutido no MOGRT** (autorado no AE 1×), avaliado em runtime pelo
  Premiere ao trocar o texto. Estratégia: Master Properties (preferido) ou rebuild com
  `sourceRectAtTime` (fallback) — decidido pelo Milestone 0.
- **Configurações**: track-alvo e pasta dos `.mogrt`, persistidas em `localStorage`.
- **Serialização host↔painel**: sempre **JSON string**; `json2.js` garante `JSON` em
  motores ES3.
- **Empacotamento**: dev com `PlayerDebugMode=1` (não assinada); produção com **ZXP**
  assinado.

## Testing Decisions

- **O que é um bom teste aqui**: exercita **comportamento externo** da camada pura
  (entra texto de CSV + lista de marcadores → sai pareamento/validação/preview), nunca
  detalhes de implementação. É a costura **mais alta** que dá para automatizar sem o
  Premiere.
- **Módulo testado**: `jsx/titulos-core.js`, via `node --test` (`test/titulos-core.test.js`).
  Casos: acentos PT, BOM, `;` vs `,`, campo com vírgula entre aspas, aspas escapadas,
  CRLF + linha em branco, subtítulo vazio, cabeçalho vs posicional, estilo
  desconhecido→null, pareamento (igual/maior/menor/zero), validação (descasamento,
  manchete vazia, estilo inválido, sem marcadores), `formatTimecode`, `buildPreview`,
  e um teste de integração CSV pt-BR ponta a ponta. **(21 testes, todos passando.)**
- **Prior art**: o repo `antipaster/Adobe-Premiere-Pro-MCP` (mesma stack CEP+ExtendScript)
  é a referência de API (`graphics.jsx`, `markers.jsx`).
- **Fora do alcance de teste automatizado (costura não-automatizável)**: tudo que toca o
  `app`/`File`/`Time`/`importMGT`/`getMGTComponent` — só verificável **end-to-end no
  Premiere real** (issue `needs-human`). O contrato de display names (`mogrt/CONTRACT.md`)
  é o stub que permite construir e testar o resto sem o AE.

## Out of Scope

- Geração de **XML/FCP7 (XMEML)** a partir da montagem do Koota (é a **Fase 2**).
- Nomes/@, ticker, e estilos além de `l3rd`/`centered`/`question`.
- Coluna de duração no CSV (a duração vem do range marker).
- Filtro de marcadores por cor.
- Undo em passo único (limitação da API do Premiere).
- Instalador gráfico/auto-update da extensão.

## Further Notes

- **Dependências humanas (parqueadas como `needs-human`)**: Milestone 0 (de-risk do
  auto-fit no AE), autoria/export dos `.mogrt`, confirmação dos nomes das comps, teste
  end-to-end no Premiere, assinatura do ZXP, instalação das fontes da marca.
- **Riscos** (do PLAN): auto-fit não sobreviver ao MOGRT (→ rebuild `sourceRectAtTime`);
  descasamento marcador↔linha (→ preview + checagem obrigatórios); acentuação (→ UTF-8 +
  BOM, **coberto por teste**); display names mudando (→ contrato + ponto único de
  configuração em `titulos-core.js`).
