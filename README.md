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

## Fase 2 — Importar o corte do Koota (opcional)

Se o primeiro corte foi montado no **Koota**, você não precisa criar os range
markers na mão nem digitar o CSV do zero: o conversor gera um **XML (FCP7/XMEML)**
com a sequência já cortada + **um range marker por clip**, e opcionalmente um
**CSV rascunho** com o texto transcrito de cada trecho. O fluxo normal do painel
(carregar CSV → preview → Aplicar) continua idêntico. Detalhes e decisões:
[PRD #14](https://github.com/yurihamuniz-td/premiere-titulos-plugin/issues/14).

### Passo a passo

1. **Gerar o XML** apontando para a pasta `_edit` do projeto Koota (fica ao lado
   do vídeo, ex.: `R05_edit`):

   ```powershell
   node tools/koota2xmeml.js "C:\...\Footage\R05_edit"
   ```

   Sai `R05_koota.xml` dentro da própria pasta. Para gerar **também o CSV
   rascunho**, cole o cabeçalho que o botão **Diagnóstico** do painel gerou:

   ```powershell
   node tools/koota2xmeml.js "C:\...\Footage\R05_edit" --csv-header "Manchete,Subtítulo" --csv-quote-col "Manchete"
   ```

   Sai também `R05_titulos.csv` com o texto transcrito de cada clip na coluna
   `Manchete` (as demais ficam vazias = mantêm o texto padrão do MOGRT).

2. **Importar no Premiere**: `File > Import` → escolha o `.xml`. A sequência
   chega com o corte pronto, a mídia original relinkada e os markers de range.

3. **Podar**: nem todo corte merece título — apague os **markers** dos trechos
   sem título (na timeline) e as **linhas correspondentes** do CSV. O painel
   valida a contagem marcador↔linha antes de Aplicar, então descasamento não passa.

4. **Seguir o fluxo normal**: revisar os textos do CSV → painel → **Carregar
   CSV** → conferir o preview → **Aplicar**.

### Opções do conversor

| Opção | Efeito | Default |
|---|---|---|
| `--out arquivo.xml` | caminho do XML | `<pasta>\<nome>_koota.xml` |
| `--name nome` | nome da sequência | nome da pasta sem `_edit` |
| `--fps n` | timebase (inteiro) | fps do `koota.json` (30) |
| `--width n` / `--height n` | dimensões da sequência | do `koota.json` (1080×1920) |
| `--csv-header "…"` | cabeçalho do Diagnóstico → liga o CSV rascunho | (sem CSV) |
| `--csv-quote-col col` | coluna que recebe o texto transcrito | 1ª coluna |
| `--csv arquivo.csv` | caminho do CSV | `<pasta>\<nome>_titulos.csv` |

### Limitações e avisos

- **Timebase inteiro apenas** (24/25/30/50/60). Footage NTSC/29.97 fica fora do
  MVP — se for o seu caso, abra um issue (a fatia `ntsc TRUE` está prevista).
- O conversor lê a montagem **viva** do `koota.json` (auto-salva a cada edição no
  Koota — não precisa renderizar). Se o `koota.json` estiver sem clips (projetos
  de versões antigas do Koota), ele cai para os `ranges` do `edl.json` com um
  **aviso** — esse arquivo só é atualizado ao renderizar e pode estar defasado.
- Os clips apontam para os **arquivos-fonte originais** (caminhos absolutos do
  `edl.json`), não para o MP4 renderizado do Koota.
- O que ainda depende de validação humana no Premiere real (markers importarem
  como range etc.) está no issue
  [#20](https://github.com/yurihamuniz-td/premiere-titulos-plugin/issues/20).

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

O repo tem o empacotamento pronto ([`tools/package-zxp.ps1`](tools/package-zxp.ps1)):

```powershell
powershell -ExecutionPolicy Bypass -File tools\package-zxp.ps1 -CertPassword "<senha>"
```

Ele baixa o `ZXPSignCmd` oficial da Adobe (uma vez), monta só o runtime do painel,
cria um **certificado auto-assinado** (`dist\cert.p12`, validade 10 anos — suficiente
para CEP, não há aprovação da Adobe) e gera `dist\inserir-titulos-<versão>.zxp`
assinado e verificado.

**No computador do editor**: instalar o `.zxp` com o
[ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/) (2 cliques) —
**sem** PlayerDebugMode. Além do painel, o editor precisa de: os arquivos
**`.mogrt`** (apontados nas Configurações do painel) e as **fontes da marca**
instaladas. Node.js não é necessário para o painel.

> Guarde a senha e o `dist\cert.p12`: versões futuras devem ser assinadas com o
> **mesmo** certificado para atualizar por cima sem desinstalar. Cert e `.zxp`
> ficam fora do git; o `.zxp` é distribuído pelos
> [releases do GitHub](https://github.com/yurihamuniz-td/premiere-titulos-plugin/releases).

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
- **Re-aplicar**: o Aplicar acha o clipe pelo tempo do marcador, então a track-alvo pode
  ter outros clipes. Mas evite re-aplicar por cima de títulos antigos nos mesmos pontos —
  apague-os antes.
- **Undo**: a API do Premiere não agrupa ações de script em um único passo; desfazer a
  aplicação pode exigir vários `Ctrl+Z`.

## O que ainda depende de humano (parqueado em issues `needs-human`)

- [x] Provado end-to-end no Premiere com um MOGRT de AE (Diagnóstico + injeção de texto).
- [ ] **Milestone 0** — auto-fit do estilo da marca: reescala por expressão ou slider?
      (decide Master Properties vs. rebuild). Só importa para os MOGRTs estilizados.
- [ ] Autorar os `.mogrt` da marca com os campos de texto expostos no Essential Graphics
      (ver [`mogrt/CONTRACT.md`](mogrt/CONTRACT.md)).
- [x] Assinar o ZXP (auto-assinado, `tools/package-zxp.ps1`) — resta só instalar
      via ZXP Installer na máquina do editor e confirmar que carrega sem
      PlayerDebugMode.
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
tools/koota2xmeml.js       CLI do conversor Koota → XMEML (Fase 2)
tools/koota2xmeml-core.js  lógica pura do conversor (testável em Node)
mogrt/CONTRACT.md          como o CSV casa com os campos do MOGRT
template.csv               CSV de exemplo
test/                      testes Node da lógica pura
docs/PLAN.md               plano/decisões
```
