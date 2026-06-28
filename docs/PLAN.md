# Automação de Lower-Thirds via CSV + Marcadores (Premiere / MOGRT)

## Context

Estamos montando um canal de notícias/recap ("Melhores da Semana"). A tarefa mais
trabalhosa hoje é **inserir manualmente as sobreposições de texto** (manchete + subtítulo)
ao longo de um vídeo longo, título a título. O objetivo é automatizar isso: o editor
alimenta um **CSV** com os textos e o sistema posiciona os títulos no tempo certo, dentro
do template visual da marca, com **auto-fit** (o texto preenchendo a largura total da box,
sem o editor ajustar tamanho na mão).

Exploramos 3 abordagens (script nativo Premiere, After Effects data-driven, e código/Remotion).
A decisão foi por **MOGRT + injeção de texto via script**, porque mantém tudo no stack que o
editor já domina (Adobe/Premiere) e **não** joga uma dependência técnica (Node/Remotion/IA)
no colo de quem não é técnico.

Descoberta-chave da exploração: o projeto de AE já existe e é montado sobre o pacote
comercial **"Change Things Graphics Package — Sliced Bread"**. Ele já traz um sistema de
auto-fit embutido (precomps `*_Size Comp`), mas os textos vivem em camadas/precomps aninhadas
demais para virar MOGRT diretamente — daí a necessidade de uma etapa de **simplificação**.

## Decisões travadas (árvore de decisão do grill)

| Nó | Decisão |
|---|---|
| Abordagem | **MOGRT + injeção de texto via ExtendScript** (fica no stack do editor) |
| Empacotamento | **Painel CEP** — UI em HTML/JS + ExtendScript por baixo (interface simples, não um script avulso) |
| Modelo de saída | **1 vídeo longo**, títulos sincronizados no tempo |
| Como o resultado chega | Script **popula a sequência ativa do Premiere** com instâncias do MOGRT |
| Auto-fit | **Embutido no MOGRT** (têm After Effects para autorar 1x) |
| Escopo dos textos | **Manchete + subtítulo**, em ~2–3 estilos (sem nomes/@, sem ticker) |
| Estilos usados | `CT_L3rd` (lower third), texto centralizado (prov. `CT_Centered Clean Box`), `CT_Question` — **nomes exatos a confirmar no AE** |
| Fonte do timing (MVP) | **Range markers** na timeline, **pareados por ordem** com as linhas do CSV |
| Duração de cada título | **Tamanho do range marker** (sem coluna de duração no CSV) |
| Fase 2 (futuro) | Plugin que gera **XML/FCP7** a partir da estrutura de montagem do **Koota** para fazer o 1º corte e puxar o timing automaticamente |

## Arquitetura (MVP)

Três peças:

1. **MOGRTs** (autorados no AE, uma vez por estilo) — versões "MOGRT-friendly" dos estilos do
   pacote, com auto-fit preservado e com os campos de texto **expostos no Essential Graphics**
   com nomes previsíveis (ex.: `Manchete`, `Subtítulo`).
2. **CSV** (preenchido pelo editor/redação) — uma linha por título, com estilo + textos.
3. **Painel CEP** (a interface) + **backend ExtendScript** (a lógica) — a UI roda em HTML/JS e
   chama o ExtendScript via `CSInterface.evalScript`. O backend lê os range markers da sequência
   ativa e o CSV, pareia por ordem, e para cada par: importa o MOGRT do estilo certo na track-alvo,
   no `in` do marcador, ajusta o `out` ao tamanho do range, e injeta os textos.

### Fluxo do editor (dia a dia)
1. Edita o vídeo normalmente.
2. Cria **range markers** na timeline onde cada título entra (in/out = aparece/some), na ordem.
3. Preenche/cola o CSV (estilo, manchete, subtítulo).
4. Abre o painel (**Window > Extensions > Inserir Títulos**) → **Carregar CSV** → confere o
   **preview de pareamento** na tabela → **Aplicar**. Todos os títulos aparecem posicionados e com auto-fit.

## Contratos

### CSV (UTF-8 — atenção a acentos do português)
Colunas (ordem = ordem dos markers):
- `estilo` — chave do estilo (`l3rd`, `centered`, `question`)
- `manchete` — texto principal
- `subtitulo` — texto secundário (pode ficar vazio)

> Nada de timecode no CSV — o tempo vem do range marker correspondente.

### Convenção de marcadores
- **Range markers** (têm in/out). Pareados por **ordem** com as linhas do CSV.
- Opcional/robustez: filtrar por **cor de marcador** (ex.: só markers verdes contam como título),
  para markers de outros usos não entrarem na conta. (decidir na implementação)
- O script **valida**: nº de markers vs nº de linhas, e mostra um preview
  ("marker 3 @ 00:01:23–00:01:31 → linha 3: 'GPT-5.6…'") antes de aplicar.

## Estratégia de simplificação do MOGRT (o ponto técnico central)

Ordem de tentativa, da mais barata à mais cara:

1. **Master Properties** (preferido): num comp de export limpo, colocar a precomp do estilo
   (ex.: `CT_L3rd`) e **promover** as Source Text aninhadas (via Essential Properties) até a
   comp pai → expor no Essential Graphics → exportar `.mogrt`. Mantém look + animação + Size Comp.
2. **Fallback — rebuild enxuto**: se o `_Size Comp` **não** sobreviver à promoção (ou se o
   auto-fit do pacote for por **slider manual**, não por expressão), recriar só a camada de texto
   num comp simplificado com auto-fit por expressão **`sourceRectAtTime()`** (escala/encolhe o
   texto até caber na box). Premiere **avalia expressões de MOGRT em runtime**, então o auto-fit
   funciona ao trocar o texto via script. (técnica conhecida e confiável)

## Plano de execução (tracer-bullet: 1 estilo primeiro)

**Milestone 0 — De-risk do auto-fit (FAZER PRIMEIRO).**
Abrir o `.aep`, achar `CT_L3rd`, e testar: digitar uma manchete curta e uma muito longa.
O texto **se reescala sozinho** (expressão) ou tem que mexer num slider de tamanho (manual)?
Isso decide se vamos de Master Properties (caminho 1) ou rebuild (caminho 2).

**Milestone 1 — 1 MOGRT ponta a ponta.**
Produzir o `.mogrt` de **um** estilo (provavelmente `CT_L3rd`) com auto-fit + texto exposto.
Confirmar no Premiere: trocar o texto na mão e ver o auto-fit funcionando.

**Milestone 2 — Backend ExtendScript mínimo.**
Função que lê 1 range marker + 1 linha de CSV, importa o MOGRT, posiciona, ajusta duração, injeta os 2 textos.
Referência de API: `importMGT(...)` e set de "Source Text" por **display name** do parâmetro
(mesmo padrão do `graphics.jsx` do repo antipaster/Adobe-Premiere-Pro-MCP — que é, ele próprio, um CEP+ExtendScript).

**Milestone 3 — Batch + pareamento por ordem + preview/validação + parser CSV (UTF-8).**

**Milestone 4 — Multi-estilo.** Repetir Milestones 1–2 para `CT_Centered Clean Box` e `CT_Question`;
mapear `estilo` do CSV → arquivo `.mogrt`.

**Milestone 5 — Painel CEP (a embalagem).**
Scaffold do CEP (`CSXS/manifest.xml`, `index.html`, `CSInterface.js`, host `jsx/`). UI simples:
botão **Carregar CSV**, **tabela de preview** do pareamento (marker↔linha), botão **Aplicar**,
mensagens de erro claras, e um mini-settings (track-alvo, cor de marcador, pasta dos `.mogrt`).
Instalação: em dev, `PlayerDebugMode` p/ rodar não-assinado; p/ entregar ao editor, assinar **ZXP** (ou instalador).

## Riscos & mitigação
- **Auto-fit não sobrevive ao MOGRT / é slider manual** → fallback rebuild com `sourceRectAtTime` (Milestone 0 resolve cedo).
- **Descasamento marker↔linha** → preview obrigatório + checagem de contagem; (opção) cor de marcador.
- **Acentuação (português) quebrando no CSV** → ler como UTF-8, tratar BOM no parser ExtendScript.
- **Display names dos parâmetros mudando** → nomear/expor os campos de forma estável ao autorar o MOGRT.
- **Fontes** (Plus Jakarta Sans, Gelasio, Fin Serif Display, Courier New) precisam estar instaladas na máquina do editor (já estão na pasta `Fonts/` do projeto).
- **Instalação do CEP** → em dev exige `PlayerDebugMode=1` (extensão não-assinada); p/ entregar ao editor, assinar o **ZXP** (ou usar instalador). Conferir a versão do CEP compatível com a versão do Premiere do editor.

## Fase 2 (visão futura — não no MVP)
Plugin que escreve **XML/FCP7 (XMEML)** a partir da estrutura de montagem do **Koota**, fazendo o
**primeiro corte** e **puxando o timing** automaticamente (substitui os markers manuais). A lógica
"linha → título no tempo X" do MVP é reaproveitada; muda só a origem do tempo (XML em vez de marker).
Mecanismo de import nativo validado no repo `ckonteos80/Claude-Soundbite-Editor` (Python gera XMEML
→ Premiere importa via File > Import). Obs.: XMEML é ótimo para **cortes**, mas **não** carrega
texto/MOGRT — então os títulos continuam vindo pelo caminho MOGRT do MVP.

## Arquivos / locais relevantes
- Projeto AE: `…\premiere-publicitarios\Melhores da Semana After Effects\Melhores da Semana.aep`
- Fontes da marca: `…\Melhores da Semana After Effects\Fonts\`
- Comps-alvo (a confirmar): `CT_L3rd` (+ `Edit_CT_L3rd Text 1/2`, `CT_L3rd Text_Size Comp`), `CT_Centered Clean Box`, `CT_Question`
- A criar: extensão CEP (`CSXS/manifest.xml`, `index.html`, `js/` com `CSInterface.js`, `jsx/inserir-titulos.jsx`) + pasta de `.mogrt` exportados + `template.csv` de exemplo

## Verificação (end-to-end)
1. **Auto-fit isolado**: no Premiere, aplicar o MOGRT e digitar manchete curta vs. longa →
   confirmar que o texto preenche a largura da box em ambos sem estourar.
2. **Pareamento**: criar 3 range markers + CSV de 3 linhas (estilos misturados, com acento) →
   rodar o `.jsx` → conferir preview → aplicar.
3. **Resultado**: 3 títulos no in/out certos, estilo certo por linha, textos com acento corretos,
   auto-fit ok. Reverter (undo) deve limpar tudo de uma vez.
4. **Borda**: nº de markers ≠ nº de linhas → script avisa e não aplica; subtítulo vazio → só manchete.
