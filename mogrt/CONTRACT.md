# Contrato dos MOGRT (interface entre o After Effects e o painel)

Esta pasta guarda os `.mogrt` exportados do After Effects. Os arquivos em si são
**autorados no AE** (depende do Yuri / GUI — ver issues `needs-human`). Enquanto
não existem, este documento é o **stub/mock**: define o contrato que o backend
(`jsx/titulos-core.js`) já assume, para que o resto do plugin seja construído e
testado sem o AE.

> Se algum nome aqui mudar ao autorar no AE, atualize também
> `jsx/titulos-core.js` (`STYLE_MOGRT`, `FIELD_MANCHETE`, `FIELD_SUBTITULO`).

## 1. Estilos → arquivo `.mogrt`

| Chave no CSV (`estilo`) | Estilo               | Arquivo esperado nesta pasta |
|-------------------------|----------------------|------------------------------|
| `l3rd`                  | Lower third          | `CT_L3rd.mogrt`              |
| `centered`              | Texto centralizado   | `CT_Centered.mogrt`         |
| `question`              | Pergunta             | `CT_Question.mogrt`         |

Aliases aceitos no CSV (normalizados pelo parser): `lower third`, `lt` → `l3rd`;
`center`, `centralizado`, `box` → `centered`; `pergunta`, `q` → `question`.

## 2. Campos de texto expostos no Essential Graphics

Cada `.mogrt` **precisa** expor os campos de texto com **exatamente** estes
*display names* (o backend casa por display name, com acento):

| Display name no Essential Graphics | Vem da coluna do CSV | Obrigatório |
|------------------------------------|----------------------|-------------|
| `Manchete`                         | `manchete`           | sim         |
| `Subtítulo`                        | `subtitulo`          | não (pode ficar vazio) |

- O estilo `centered` pode ter só `Manchete` — se o `.mogrt` não tiver `Subtítulo`,
  o backend simplesmente não seta o subtítulo (sem erro).
- O auto-fit (texto preenchendo a largura da box) deve estar **embutido no MOGRT**
  (Master Properties ou expressão `sourceRectAtTime`), avaliado em runtime pelo
  Premiere ao trocar o texto via script. Ver `docs/PLAN.md` → "Estratégia de
  simplificação do MOGRT".

## 3. Como o backend usa este contrato

`jsx/inserir-titulos.jsx`, para cada par marcador↔linha:

1. `seq.importMGT(<pasta>/CT_<Estilo>.mogrt, <in do marcador>, trackAlvo, trackAlvo)`
2. `clip.end = <out do marcador>` (ajusta a duração ao range)
3. `getMGTComponent()` → acha a propriedade com `displayName === "Manchete"` → `setValue(texto, true)`
4. idem para `"Subtítulo"`, se houver texto.

## 4. Suposições a confirmar no AE (issues `needs-human`)

- Nomes exatos das comps de origem: `CT_L3rd`, centralizado (≈ `CT_Centered Clean Box`), `CT_Question`.
- Se o auto-fit do pacote "Sliced Bread" reescala sozinho (expressão) ou por slider manual
  (decide Master Properties vs. rebuild — **Milestone 0** do PLAN).
- Os display names `Manchete` / `Subtítulo` ao promover/expor os textos.
