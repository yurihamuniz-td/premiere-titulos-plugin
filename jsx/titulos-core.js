/*
 * titulos-core.js — Lógica pura do "Inserir Títulos" (CSV -> lower-thirds).
 *
 * NÃO depende do objeto `app` do Premiere, do DOM nem do Node. Tudo aqui opera
 * sobre strings/arrays/objetos simples, para poder ser ao mesmo tempo:
 *   - incluído pelo host ExtendScript via  #include "titulos-core.js"
 *   - exigido pelos testes Node  (require("../jsx/titulos-core.js"))
 *
 * Mantido propositalmente ES3-safe (motor ExtendScript): apenas for-loops
 * clássicos, sem Array.map/filter/forEach/indexOf, sem String.trim, sem JSON.
 * É aqui que mora o risco do português (acentos, BOM, ; vs ,) — por isso é a
 * parte 100% coberta por testes automatizados.
 */

/* ───────────────────────── estilos ───────────────────────── */

var CANONICAL_STYLES = ['l3rd', 'centered', 'question'];

/* chave do estilo (colapsada p/ alfanumérico minúsculo) -> estilo canônico */
var STYLE_ALIASES = {
  'l3rd': 'l3rd', 'lowerthird': 'l3rd', 'lt': 'l3rd',
  'centered': 'centered', 'center': 'centered', 'centralizado': 'centered', 'box': 'centered',
  'question': 'question', 'pergunta': 'question', 'q': 'question'
};

/* estilo canônico -> nome do arquivo .mogrt (autorado no After Effects).
 * Os arquivos em si são produzidos no AE — ver mogrt/CONTRACT.md. */
var STYLE_MOGRT = {
  'l3rd': 'CT_L3rd.mogrt',
  'centered': 'CT_Centered.mogrt',
  'question': 'CT_Question.mogrt'
};

/* Display names que o MOGRT DEVE expor no Essential Graphics.
 * SUPOSIÇÃO explícita (confirmar ao autorar no AE — ver CONTRACT.md): */
var FIELD_MANCHETE = 'Manchete';
var FIELD_SUBTITULO = 'Subtítulo';

/* ───────────────────────── helpers ───────────────────────── */

function _trim(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/^\s+/, '').replace(/\s+$/, '');
}

/* remove BOM UTF-8 (U+FEFF) do início, caso o ExtendScript File não o tenha removido */
function stripBom(text) {
  if (text && text.length && text.charCodeAt(0) === 0xFEFF) {
    return text.substring(1);
  }
  return text || '';
}

/* normaliza chave: minúsculo, sem acentos comuns do PT */
function _normKey(s) {
  s = _trim(s).toLowerCase();
  s = s.replace(/[áàâãä]/g, 'a').replace(/[éèê]/g, 'e').replace(/[íì]/g, 'i')
       .replace(/[óòôõ]/g, 'o').replace(/[úù]/g, 'u').replace(/ç/g, 'c');
  return s;
}

/* sniff do delimitador na 1ª linha não vazia: ';' (Excel pt-BR) ou ',' */
function detectDelimiter(text) {
  var nl = text.indexOf('\n');
  var firstLine = nl === -1 ? text : text.substring(0, nl);
  var semi = 0, comma = 0, k, ch;
  for (k = 0; k < firstLine.length; k++) {
    ch = firstLine.charAt(k);
    if (ch === ';') semi++;
    else if (ch === ',') comma++;
  }
  return semi > comma ? ';' : ',';
}

/* parser CSV (estilo RFC-4180): aspas, "" escapado, delimitador e \n dentro de
 * campo entre aspas, CRLF/LF. Retorna array de linhas (cada linha = array de células). */
function parseDelimited(text, delim) {
  var rows = [];
  var row = [];
  var field = '';
  var i = 0, c;
  var inQuotes = false;
  var n = text.length;
  while (i < n) {
    c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }            /* CR engolido; LF quebra a linha */
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function _rowIsEmpty(cells) {
  for (var c = 0; c < cells.length; c++) {
    if (_trim(cells[c]) !== '') return false;
  }
  return true;
}

/* chave bruta do CSV -> estilo canônico, ou null se desconhecido */
function normalizeStyle(raw) {
  var k = _normKey(raw).replace(/[\s_\-]+/g, '');
  if (STYLE_ALIASES.hasOwnProperty(k)) return STYLE_ALIASES[k];
  return null;
}

var HEADER_MAP = {
  'estilo': 'estilo', 'style': 'estilo',
  'manchete': 'manchete', 'titulo': 'manchete', 'title': 'manchete', 'headline': 'manchete',
  'subtitulo': 'subtitulo', 'subtitle': 'subtitulo', 'sub': 'subtitulo'
};

/*
 * parseRows(text) -> {
 *   delimiter, header (array|null),
 *   rows: [{ line, estiloRaw, estilo(canônico|null), manchete, subtitulo }],
 *   errors: [string]
 * }
 * Detecta cabeçalho (estilo/manchete/subtitulo). Sem cabeçalho => posicional.
 */
function parseRows(text) {
  text = stripBom(text || '');
  var result = { delimiter: ',', header: null, rows: [], errors: [] };
  if (_trim(text) === '') { result.errors.push('CSV vazio.'); return result; }

  var delim = detectDelimiter(text);
  result.delimiter = delim;

  var grid = parseDelimited(text, delim);
  var clean = [];
  var r;
  for (r = 0; r < grid.length; r++) {
    if (!_rowIsEmpty(grid[r])) clean.push(grid[r]);
  }
  if (clean.length === 0) { result.errors.push('CSV sem linhas de conteúdo.'); return result; }

  var head = clean[0];
  var col = { estilo: -1, manchete: -1, subtitulo: -1 };
  /* É cabeçalho só se a 1ª célula for um nome de coluna conhecido. Uma linha de
   * dados começa com o estilo (l3rd/centered/question), que nunca é cabeçalho —
   * isso evita falso-positivo quando uma célula de dados casa com um alias. */
  var hasHeader = HEADER_MAP.hasOwnProperty(_normKey(head[0]));
  var h;
  if (hasHeader) {
    for (h = 0; h < head.length; h++) {
      var mapped = HEADER_MAP[_normKey(head[h])];
      if (mapped && col[mapped] === -1) col[mapped] = h;
    }
  }

  var startRow;
  if (hasHeader) {
    result.header = head;
    startRow = 1;
  } else {
    col.estilo = 0; col.manchete = 1; col.subtitulo = 2;   /* posicional */
    startRow = 0;
  }

  if (col.estilo === -1 || col.manchete === -1) {
    result.errors.push('CSV precisa das colunas "estilo" e "manchete".');
    return result;
  }

  var dr;
  for (dr = startRow; dr < clean.length; dr++) {
    var cells = clean[dr];
    var estiloRaw = col.estilo >= 0 && col.estilo < cells.length ? cells[col.estilo] : '';
    var manchete = col.manchete >= 0 && col.manchete < cells.length ? cells[col.manchete] : '';
    var subt = col.subtitulo >= 0 && col.subtitulo < cells.length ? cells[col.subtitulo] : '';
    result.rows.push({
      line: dr + 1,                               /* nº de linha 1-based p/ mensagens */
      estiloRaw: _trim(estiloRaw),
      estilo: normalizeStyle(estiloRaw),          /* canônico ou null */
      manchete: _trim(manchete),
      subtitulo: _trim(subt)
    });
  }
  return result;
}

/* ───────────────────────── pareamento ───────────────────────── */

/* markers e rows JÁ ordenados por tempo / por linha. Pareia por POSIÇÃO. */
function pairByOrder(markers, rows) {
  var pairs = [];
  var n = Math.min(markers.length, rows.length);
  var i;
  for (i = 0; i < n; i++) {
    pairs.push({ index: i, marker: markers[i], row: rows[i] });
  }
  return {
    pairs: pairs,
    markerCount: markers.length,
    rowCount: rows.length,
    countMatch: markers.length === rows.length
  };
}

/* validação: retorna lista de { level: 'error'|'warn', message } */
function validate(parseResult, markers) {
  var problems = [];
  var i;
  for (i = 0; i < parseResult.errors.length; i++) {
    problems.push({ level: 'error', message: parseResult.errors[i] });
  }
  var rows = parseResult.rows;

  if (markers.length === 0) {
    problems.push({ level: 'error', message: 'Nenhum marcador de range (in/out) encontrado na sequência ativa.' });
  }
  if (markers.length !== rows.length) {
    problems.push({
      level: 'error',
      message: 'Nº de marcadores de range (' + markers.length + ') ≠ nº de linhas do CSV (' + rows.length + ').'
    });
  }
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.estilo === null) {
      problems.push({ level: 'error', message: 'Linha ' + row.line + ': estilo desconhecido "' + row.estiloRaw + '" (use l3rd, centered ou question).' });
    }
    if (row.manchete === '') {
      problems.push({ level: 'error', message: 'Linha ' + row.line + ': manchete vazia.' });
    }
  }
  return problems;
}

/* ───────────────────────── preview ───────────────────────── */

function formatTimecode(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return '--:--';
  var s = Math.floor(sec);
  var hh = Math.floor(s / 3600);
  var mm = Math.floor((s % 3600) / 60);
  var ss = s % 60;
  function p2(x) { return x < 10 ? '0' + x : '' + x; }
  return (hh > 0 ? p2(hh) + ':' : '') + p2(mm) + ':' + p2(ss);
}

function buildPreview(pairs) {
  var out = [];
  var i;
  for (i = 0; i < pairs.length; i++) {
    var p = pairs[i];
    out.push({
      n: i + 1,
      inSec: p.marker.start,
      outSec: p.marker.end,
      timecode: formatTimecode(p.marker.start) + '–' + formatTimecode(p.marker.end),
      durationSec: Math.round((p.marker.end - p.marker.start) * 100) / 100,
      estilo: p.row.estilo,
      estiloRaw: p.row.estiloRaw,
      manchete: p.row.manchete,
      subtitulo: p.row.subtitulo
    });
  }
  return out;
}

/* ───────── export p/ Node (ignorado pelo ExtendScript) ───────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CANONICAL_STYLES: CANONICAL_STYLES,
    STYLE_MOGRT: STYLE_MOGRT,
    FIELD_MANCHETE: FIELD_MANCHETE,
    FIELD_SUBTITULO: FIELD_SUBTITULO,
    stripBom: stripBom,
    detectDelimiter: detectDelimiter,
    parseDelimited: parseDelimited,
    parseRows: parseRows,
    normalizeStyle: normalizeStyle,
    pairByOrder: pairByOrder,
    validate: validate,
    formatTimecode: formatTimecode,
    buildPreview: buildPreview
  };
}
