# Inserir Títulos — painel CEP para Premiere Pro

Painel que insere títulos ao longo de uma sequência do Premiere a partir de um
**CSV**, posicionando cada título no tempo de um **range marker** da timeline e
aplicando **qualquer MOGRT de After Effects**. As **colunas do CSV** são os
**campos do MOGRT** — então funciona com lower-thirds, texto centralizado, pergunta,
ou qualquer template que você tenha. O editor preenche um CSV, cria os marcadores,
confere o preview e clica **Aplicar**.

> Plano completo, decisões e riscos: [`docs/PLAN.md`](docs/PLAN.md).
> Como o CSV casa com os campos do MOGRT: [`mogrt/CONTRACT.md`](mogrt/CONTRACT.md).

## Como funciona (fluxo do editor)

1. Edita o vídeo normalmente.
2. Cria **range markers** (com in/out) onde cada título aparece/some, **na ordem**.
3. Escolhe o **MOGRT alvo** no painel e clica **Diagnóstico** → ele lista os campos e
   monta o **cabeçalho do CSV** pronto pra colar.
4. Preenche o CSV (uma linha por título; cada coluna = um campo do MOGRT).
5. `Window > Extensions > Inserir Títulos` → **Carregar CSV** → confere a **tabela de
   preview** do pareamento marcador↔linha → **Aplicar**.

O pareamento é **por ordem**: marcador nº 1 ↔ linha 1, e assim por diante. O painel
**valida** antes de aplicar (nº de marcadores vs. linhas) e só habilita **Aplicar**
quando as contagens batem.

## Formato do CSV

UTF-8, uma linha por título. A **1ª linha é o cabeçalho** com os **nomes dos campos**
do MOGRT (= os display names do Essential Graphics). Exemplo para um MOGRT com os
campos `Manchete` e `Subtítulo`:

```csv
Manchete,Subtítulo
GPT-5.6 chega com raciocínio em vídeo,OpenAI mira no mercado de edição
"Sora, Runway e Pika: a corrida dos vídeos por IA",
```

- **Campos = colunas**: cada coluna é setada no campo de mesmo nome do MOGRT. Coluna
  sem campo correspondente é ignorada; célula vazia mantém o texto padrão.
- **Descubra os nomes** com o botão **Diagnóstico** (ele gera o cabeçalho pra você).
- **Acentos**: salve como **UTF-8**. O parser trata BOM e acentos do português.
- **Delimitador**: aceita `,` **ou** `;` — detectado automaticamente (Excel pt-BR usa `;`).
- **Vírgula no texto/nome**: use aspas, ex.: `"Sora, Runway e Pika",…`.

Veja [`template.csv`](template.csv) para um exemplo pronto.

> ⚠️ Só funciona com **MOGRT de After Effects** (texto exposto no Essential Graphics).
> MOGRT criado nativamente no Premiere vira um "Gráfico" e não recebe a injeção de
> texto — o Diagnóstico avisa.

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

- **Track de vídeo alvo** — em qual track os títulos entram (padrão V3). Deve estar
  livre nos pontos de inserção (ver limitações).
- **MOGRT alvo** — o arquivo `.mogrt` (de After Effects) aplicado em todas as linhas.
- **Diagnóstico** — arraste 1 instância do MOGRT para a track-alvo e clique: lista os
  campos e gera o **cabeçalho do CSV**.

> **Cor de marcador não filtra.** A API de scripting do Premiere não expõe um getter
> de cor confiável, então o painel conta **todos os marcadores de range** (in/out). Use
> marcadores de range só para títulos; marcadores de ponto são ignorados.

## Limitações conhecidas

- **Só MOGRT de After Effects**: MOGRT criado nativamente no Premiere não tem
  `getMGTComponent()` e não recebe a injeção de texto (o Diagnóstico avisa).
- **Track-alvo livre**: o Aplicar pega "o último clipe da track" após importar, então a
  track-alvo deve estar livre nos pontos onde os títulos entram.
- **Undo**: a API do Premiere não agrupa ações de script em um único passo; desfazer a
  aplicação pode exigir vários `Ctrl+Z`.

## O que ainda depende de humano (parqueado em issues `needs-human`)

- [x] Provado end-to-end no Premiere com um MOGRT de AE (Diagnóstico + injeção de texto).
- [ ] **Milestone 0** — auto-fit do estilo da marca: reescala por expressão ou slider?
      (decide Master Properties vs. rebuild). Só importa para os MOGRTs estilizados.
- [ ] Autorar os `.mogrt` da marca com os campos de texto expostos no Essential Graphics
      (ver [`mogrt/CONTRACT.md`](mogrt/CONTRACT.md)).
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
jsx/inserir-titulos.jsx    backend ExtendScript (markers, importMGT, injeção genérica)
jsx/titulos-core.js        lógica pura (testável em Node e incluída no host)
jsx/json2.js               polyfill JSON (idempotente; ES3)
mogrt/CONTRACT.md          como o CSV casa com os campos do MOGRT
template.csv               CSV de exemplo
test/                      testes Node da lógica pura
docs/PLAN.md               plano/decisões
```
