/*
 * titulos-core.js — Lógica pura do "Inserir Títulos" (CSV genérico -> MOGRT).
 *
 * NÃO depende do objeto `app` do Premiere, do DOM nem do Node. Tudo aqui opera
 * sobre strings/arrays/objetos simples, para poder ser ao mesmo tempo:
 *   - incluído pelo host ExtendScript via  #include "titulos-core.js"
 *   - exigido pelos testes Node  (require("../jsx/titulos-core.js"))
 *
 * MODELO GENÉRICO (qualquer MOGRT de After Effects):
 *   - O CSV é dirigido pelos CAMPOS do MOGRT. A 1ª linha é o cabeçalho com os
 *     nomes dos campos (= display names expostos no Essential Graphics). Cada
 *     linha seguinte são os valores.
 *   - 1 MOGRT por CSV (o arquivo .mogrt é escolhido no painel).
 *   - O tempo vem dos range markers da sequência, pareados por ordem.
 *
 * Mantido propositalmente ES3-safe (motor ExtendScript): apenas for-loops
 * clássicos, sem Array.map/filter/forEach/indexOf, sem String.trim, sem JSON.
 */

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

function _inArray(x, arr) {
  for (var i = 0; i < arr.length; i++) { if (arr[i] === x) return true; }
  return false;
}

/* sniff do delimitador na 1ª linha NÃO VAZIA: ';' (Excel pt-BR) ou ','. */
function detectDelimiter(text) {
  var lines = String(text).split('\n');
  var firstLine = '';
  var j;
  for (j = 0; j < lines.length; j++) {
    if (_trim(lines[j]) !== '') { firstLine = lines[j]; break; }
  }
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

/*
 * parseRows(text) -> {
 *   delimiter,
 *   fields: [string]                       // nomes das colunas = campos do MOGRT
 *   rows: [{ line, values: {campo: valor} }],
 *   errors: [string]
 * }
 * A 1ª linha não vazia é SEMPRE o cabeçalho (nomes de campos). Sem cabeçalho não
 * dá pra saber os nomes dos campos, então o cabeçalho é obrigatório.
 */
function parseRows(text) {
  text = stripBom(text || '');
  var result = { delimiter: ',', fields: [], rows: [], errors: [] };
  if (_trim(text) === '') { result.errors.push('CSV vazio.'); return result; }

  var delim = detectDelimiter(text);
  result.delimiter = delim;

  var grid = parseDelimited(text, delim);
  var clean = [];
  var r;
  /* guarda o nº de linha FÍSICO (1-based) para mensagens de erro precisas */
  for (r = 0; r < grid.length; r++) {
    if (!_rowIsEmpty(grid[r])) clean.push({ cells: grid[r], line: r + 1 });
  }
  if (clean.length === 0) { result.errors.push('CSV sem linhas de conteúdo.'); return result; }

  /* cabeçalho = nomes dos campos (preservados como vieram, só com trim, pois
   * precisam bater EXATAMENTE com os display names do MOGRT — inclusive acento) */
  var head = clean[0].cells;
  var fields = [];
  var h;
  for (h = 0; h < head.length; h++) fields.push(_trim(head[h]));
  while (fields.length && fields[fields.length - 1] === '') fields.pop();  /* tira colunas-fantasma do fim */
  if (fields.length === 0) { result.errors.push('CSV sem colunas de campos no cabeçalho.'); return result; }
  result.fields = fields;

  if (clean.length === 1) { result.errors.push('CSV tem cabeçalho mas nenhuma linha de dados.'); return result; }

  var dr;
  for (dr = 1; dr < clean.length; dr++) {
    var cells = clean[dr].cells;
    var values = {};
    var c;
    for (c = 0; c < fields.length; c++) {
      if (fields[c] === '') continue;
      values[fields[c]] = c < cells.length ? _trim(cells[c]) : '';
    }
    result.rows.push({ line: clean[dr].line, values: values });
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

/*
 * validate(parseResult, markers, knownFields?) -> [{ level:'error'|'warn', message }]
 * knownFields (opcional): lista de display names reais do MOGRT (vinda do
 * Diagnóstico). Se fornecida, avisa sobre colunas que não existem no MOGRT.
 */
function validate(parseResult, markers, knownFields) {
  var problems = [];
  var i;
  for (i = 0; i < parseResult.errors.length; i++) {
    problems.push({ level: 'error', message: parseResult.errors[i] });
  }
  var rows = parseResult.rows;
  var fields = parseResult.fields;

  if (markers.length === 0) {
    problems.push({ level: 'error', message: 'Nenhum marcador de range (in/out) encontrado na sequência ativa.' });
  }
  if (markers.length !== rows.length) {
    problems.push({
      level: 'error',
      message: 'Nº de marcadores de range (' + markers.length + ') ≠ nº de linhas do CSV (' + rows.length + ').'
    });
  }
  /* range inválido (in >= out). O host já filtra esses, mas a camada pura valida. */
  for (i = 0; i < markers.length; i++) {
    if (markers[i].end <= markers[i].start) {
      problems.push({ level: 'error', message: 'Marcador ' + (i + 1) + ': range inválido (in >= out).' });
    }
  }
  /* colunas do CSV que não existem no MOGRT (só avisa; serão ignoradas).
   * (Linhas totalmente vazias são tratadas como linha em branco e descartadas
   * no parse — por isso não há aviso de "linha sem valores" aqui.) */
  if (knownFields && knownFields.length) {
    for (i = 0; i < fields.length; i++) {
      if (!_inArray(fields[i], knownFields)) {
        problems.push({ level: 'warn', message: 'Coluna "' + fields[i] + '" não existe no MOGRT — será ignorada.' });
      }
    }
  }
  return problems;
}

/* ───────────────────────── preview ───────────────────────── */

function formatTimecode(sec) {
  if (sec === null || sec === undefined || isNaN(sec) || sec < 0 || !isFinite(sec)) return '--:--';
  var s = Math.floor(sec);
  var hh = Math.floor(s / 3600);
  var mm = Math.floor((s % 3600) / 60);
  var ss = s % 60;
  function p2(x) { return x < 10 ? '0' + x : '' + x; }
  return (hh > 0 ? p2(hh) + ':' : '') + p2(mm) + ':' + p2(ss);
}

/* buildPreview(pairs) -> [{ n, timecode, durationSec, values }] */
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
      values: p.row.values
    });
  }
  return out;
}

/* monta o cabeçalho de CSV a partir dos campos do MOGRT (usado pelo Diagnóstico) */
function csvHeaderFromFields(fieldNames, delimiter) {
  var d = delimiter || ',';
  var parts = [];
  var i;
  for (i = 0; i < fieldNames.length; i++) {
    var name = String(fieldNames[i]);
    /* aspas se o nome tiver o delimitador ou aspas */
    if (name.indexOf(d) >= 0 || name.indexOf('"') >= 0) {
      name = '"' + name.replace(/"/g, '""') + '"';
    }
    parts.push(name);
  }
  return parts.join(d);
}

/* ───────── export p/ Node (ignorado pelo ExtendScript) ───────── */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    stripBom: stripBom,
    detectDelimiter: detectDelimiter,
    parseDelimited: parseDelimited,
    parseRows: parseRows,
    pairByOrder: pairByOrder,
    validate: validate,
    formatTimecode: formatTimecode,
    buildPreview: buildPreview,
    csvHeaderFromFields: csvHeaderFromFields
  };
}
