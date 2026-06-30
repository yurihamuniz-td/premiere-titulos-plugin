# Como o painel casa o CSV com o MOGRT

O plugin é **genérico**: funciona com **qualquer MOGRT de After Effects**. Não há
nomes de campo fixos — as **colunas do CSV** são os **campos do MOGRT** que você
escolheu. Esta pasta é só um lugar conveniente para guardar os `.mogrt`.

## A regra (uma frase)

> Para cada linha do CSV, o painel importa o MOGRT alvo e, para **cada coluna**,
> procura um parâmetro do Essential Graphics cujo **display name** seja **igual** ao
> nome da coluna — e seta o valor daquela célula. Coluna sem campo correspondente é
> ignorada; célula vazia mantém o texto padrão do MOGRT.

## O fluxo

1. No painel → **Configurações**, escolha o **MOGRT alvo** (um arquivo `.mogrt`).
2. Arraste **uma instância** desse MOGRT para a track-alvo e clique em
   **Diagnóstico: ler campos do MOGRT**. Ele lista os campos e monta o
   **cabeçalho do CSV** pronto pra colar.
3. Monte o CSV com esse cabeçalho (uma linha por título) e aplique.

## Requisitos do MOGRT

- Precisa ser um **MOGRT de After Effects** com o texto **exposto no Essential
  Graphics** (Texto de origem → "Adicionar propriedade aos Gráficos essenciais").
  - ⚠️ MOGRT **autorado nativamente no Premiere** (a partir de um gráfico) **não
    funciona** para injeção: ele vira um "Gráfico" comum e não tem
    `getMGTComponent()`. O Diagnóstico avisa ("não é MOGRT").
- O **nome do campo** no Essential Graphics é o que vira a **coluna do CSV** — então
  nomeie os campos de forma estável (ex.: `Manchete`, `Subtítulo`, ou o que fizer
  sentido para aquele template).
- Acentos no nome do campo são OK, mas o cabeçalho do CSV precisa bater
  **exatamente** — por isso o Diagnóstico gera o cabeçalho pra você não errar.

## Auto-fit (opcional)

Se quiser que o texto preencha a box sozinho, embuta o auto-fit **no MOGRT** (Master
Properties ou expressão `sourceRectAtTime`) — ver `docs/PLAN.md`. O painel não
interfere nisso: ele só troca o texto; o auto-fit roda no runtime do Premiere.
