# Inserir Títulos — painel CEP para Premiere Pro

Painel que insere **lower-thirds** (manchete + subtítulo) ao longo de uma sequência
do Premiere a partir de um **CSV**, posicionando cada título no tempo de um **range
marker** da timeline e aplicando o template visual da marca via **MOGRT** (com
auto-fit embutido). O editor preenche um CSV, cria os marcadores, confere o preview
e clica **Aplicar** — sem ajustar tamanho de texto na mão.

> Plano completo, decisões e riscos: [`docs/PLAN.md`](docs/PLAN.md).
> Contrato dos MOGRT (display names): [`mogrt/CONTRACT.md`](mogrt/CONTRACT.md).

## Como funciona (fluxo do editor)

1. Edita o vídeo normalmente.
2. Cria **range markers** (com in/out) onde cada título aparece/some, **na ordem**.
3. Preenche o `template.csv` (uma linha por título: estilo, manchete, subtítulo).
4. `Window > Extensions > Inserir Títulos` → **Carregar CSV** → confere a **tabela de
   preview** do pareamento marcador↔linha → **Aplicar**.

O pareamento é **por ordem**: marcador nº 1 ↔ linha 1, e assim por diante. O painel
**valida** antes de aplicar (nº de marcadores vs. linhas, estilos válidos, manchete
preenchida) e só habilita **Aplicar** quando está tudo certo.

## Formato do CSV

UTF-8, uma linha por título. Colunas (cabeçalho opcional; se ausente, assume esta ordem):

| Coluna      | Conteúdo                                   | Obrigatório |
|-------------|--------------------------------------------|-------------|
| `estilo`    | `l3rd`, `centered` ou `question`           | sim         |
| `manchete`  | texto principal                            | sim         |
| `subtitulo` | texto secundário (pode ficar vazio)        | não         |

- **Acentos**: salve o CSV como **UTF-8**. O parser trata BOM e acentos do português.
- **Delimitador**: aceita vírgula (`,`) **ou** ponto-e-vírgula (`;`) — detectado
  automaticamente (Excel pt-BR costuma exportar com `;`).
- **Vírgula no texto**: use aspas, ex.: `centered,"Sora, Runway e Pika",`.

Veja [`template.csv`](template.csv) para um exemplo pronto.

## Instalação

### Modo desenvolvimento (extensão não assinada)

1. **Ativar PlayerDebugMode** (permite rodar extensões não assinadas). No PowerShell:

   ```powershell
   # Use o número da versão CSXS do seu Premiere (CC2019=9, 2020=10, 2021/22=11, 2024+=11/12).
   # Na dúvida, rode para todas:
   9..12 | ForEach-Object {
     New-Item -Path "HKCU:\Software\Adobe\CSXS.$_" -Force | Out-Null
     Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$_" -Name PlayerDebugMode -Value 1 -Type String
   }
   ```

2. **Copiar a extensão** para a pasta de extensões do CEP:

   ```powershell
   $dst = "$env:APPDATA\Adobe\CEP\extensions\com.td.premiere.titulos"
   robocopy "." "$dst" /E /XD .git node_modules /XF *.zxp
   ```

   (Ou crie um *symlink* da pasta do repo para `…\CEP\extensions\com.td.premiere.titulos`.)

3. **Reabrir o Premiere** → `Window > Extensions > Inserir Títulos`.

### Modo produção (entregar ao editor)

Assinar a extensão como **ZXP** com [ZXPSignCmd](https://github.com/Adobe-CEP/CEP-Resources)
e instalar com o [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/) ou via
um instalador. (Assinatura com certificado oficial = passo humano — ver checklist abaixo.)

## Configurações do painel

- **Track de vídeo alvo** — em qual track os títulos entram (padrão V3).
- **Pasta dos `.mogrt`** — onde estão `CT_L3rd.mogrt`, `CT_Centered.mogrt`, `CT_Question.mogrt`.

> **Cor de marcador não filtra.** A API de scripting do Premiere não expõe um getter
> de cor confiável, então o MVP conta **todos os marcadores de range** (in/out). Use
> marcadores de range só para títulos; marcadores de ponto são ignorados.

## Limitações conhecidas

- **Undo**: a API do Premiere não agrupa ações de script em um único passo; desfazer a
  aplicação pode exigir vários `Ctrl+Z`.
- **`.mogrt` reais**: dependem de autoria no After Effects (ver checklist). Sem eles, o
  **Aplicar** acusa "MOGRT não encontrado"; o **preview/validação já funcionam** sem AE.
- **Ajuste do out (`clip.end`)** e a injeção de texto seguem o padrão de API conhecido,
  mas só podem ser confirmados em teste end-to-end no Premiere real (issue `needs-human`).

## O que ainda depende de humano (parqueado em issues `needs-human`)

- [ ] **Milestone 0** — testar no AE se o auto-fit do `CT_L3rd` reescala sozinho (expressão)
      ou por slider manual (decide Master Properties vs. rebuild).
- [ ] Autorar e exportar os `.mogrt` (`CT_L3rd`, `CT_Centered`, `CT_Question`) com os
      campos `Manchete`/`Subtítulo` expostos (ver [`mogrt/CONTRACT.md`](mogrt/CONTRACT.md)).
- [ ] Confirmar os nomes exatos das comps no AE.
- [ ] Teste end-to-end real no Premiere (preview → aplicar → conferir auto-fit e acentos).
- [ ] Assinar o ZXP com certificado de distribuição.
- [ ] Instalar as fontes da marca na máquina do editor (Plus Jakarta Sans, Gelasio,
      Fin Serif Display, Courier New).

## Desenvolvimento

A lógica pura (parse de CSV, BOM, pareamento, validação) vive em
[`jsx/titulos-core.js`](jsx/titulos-core.js) — **sem** dependência do Premiere — e é
coberta por testes Node:

```bash
npm test
```

### Estrutura

```
CSXS/manifest.xml          manifesto da extensão CEP
index.html                 UI do painel
css/styles.css             estilo (tema escuro do Premiere)
js/CSInterface.js          biblioteca padrão da Adobe (CEP)
js/main.js                 lógica do painel (carrega CSV, preview, aplicar)
jsx/inserir-titulos.jsx    backend ExtendScript (markers, importMGT, injeção de texto)
jsx/titulos-core.js        lógica pura (testável em Node e incluída no host)
jsx/json2.js               polyfill JSON (idempotente; ES3)
mogrt/CONTRACT.md          contrato dos .mogrt (display names) — stub sem AE
template.csv               CSV de exemplo
test/                      testes Node da lógica pura
docs/PLAN.md               plano/decisões
```
