/*
 * inserir-titulos.jsx — Backend ExtendScript do painel "Inserir Títulos".
 *
 * Cola entre o Premiere (objeto `app`) e a lógica pura (titulos-core.js):
 *   - lê o CSV como UTF-8 (acentos do PT)
 *   - lê os range markers da sequência ativa (ordenados por tempo)
 *   - pareia por ordem, valida e monta o preview  (lógica pura)
 *   - aplica: importa o MOGRT do estilo, ajusta o out ao marcador e injeta os textos
 *
 * O painel chama estas funções via CSInterface.evalScript e recebe SEMPRE uma
 * string JSON. Funções públicas: inserirTitulos_env / _getPreview / _apply.
 *
 * Referência de API (CEP + ExtendScript) modelada no graphics.jsx/markers.jsx do
 * repo antipaster/Adobe-Premiere-Pro-MCP (mesma stack).
 */

// json2.js é idempotente: só define JSON se o motor não tiver (ES3).
// Os includes são resolvidos relativos a esta pasta (jsx/).
#include "json2.js"
#include "titulos-core.js"

var TICKS_PER_SECOND = 254016000000;   // Premiere: ticks por segundo (constante da API)

/* ───────────────────────── helpers de ambiente ───────────────────────── */

function _activeSeqOrNull() {
  if (!app.project) return null;
  return app.project.activeSequence ? app.project.activeSequence : null;
}

function _readTextUtf8(path) {
  var f = new File(path);
  if (!f.exists) return null;
  f.encoding = 'UTF-8';                 // decodifica acentos corretamente
  f.open('r');
  var s = f.read();
  f.close();
  return s;                             // BOM (se sobrar) é tratado em parseRows/stripBom
}

function _secondsToTicks(sec) {
  // ticks cabem com folga no inteiro exato do double (< 2^53); String evita notação científica
  return String(Math.round(sec * TICKS_PER_SECOND));
}

/* Lê SÓ os range markers (out > in) da sequência, ordenados por tempo.
 * Markers de ponto (in == out) são ignorados — servem a outros usos.
 * (A API do Premiere não expõe um getter de cor confiável, então não filtramos
 *  por cor; "range marker" já é um filtro estável. Ver README/limitações.) */
function _getRangeMarkers(seq) {
  var out = [];
  var markers = seq.markers;
  var m = markers.getFirstMarker();
  while (m) {
    var st = m.start.seconds;
    var en = m.end.seconds;
    if (en > st + 1e-6) {
      out.push({ start: st, end: en, name: String(m.name || ''), comments: String(m.comments || '') });
    }
    m = markers.getNextMarker(m);
  }
  out.sort(function (a, b) { return a.start - b.start; });
  return out;
}

function _hasBlockingError(problems) {
  for (var i = 0; i < problems.length; i++) {
    if (problems[i].level === 'error') return true;
  }
  return false;
}

/* ───────────────────────── API pública ───────────────────────── */

/* Sonda de ambiente para o painel mostrar o estado (sequência ativa, nº de tracks). */
function inserirTitulos_env() {
  try {
    var seq = _activeSeqOrNull();
    return JSON.stringify({
      ok: true,
      hasProject: !!app.project,
      hasSequence: !!seq,
      sequenceName: seq ? String(seq.name) : null,
      videoTrackCount: seq ? seq.videoTracks.numTracks : 0
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.toString() });
  }
}

/* Monta o preview do pareamento marker<->linha (sem alterar nada na timeline). */
function inserirTitulos_getPreview(csvPath, trackIndex) {
  try {
    var seq = _activeSeqOrNull();
    if (!seq) return JSON.stringify({ ok: false, error: 'Nenhuma sequência ativa no Premiere.' });

    var text = _readTextUtf8(csvPath);
    if (text === null) return JSON.stringify({ ok: false, error: 'Não consegui ler o CSV: ' + csvPath });

    var parsed = parseRows(text);
    var markers = _getRangeMarkers(seq);
    var paired = pairByOrder(markers, parsed.rows);
    var problems = validate(parsed, markers);
    var preview = buildPreview(paired.pairs);

    return JSON.stringify({
      ok: true,
      canApply: !_hasBlockingError(problems),
      delimiter: parsed.delimiter,
      markerCount: paired.markerCount,
      rowCount: paired.rowCount,
      countMatch: paired.countMatch,
      problems: problems,
      preview: preview
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'Erro ao gerar preview: ' + e.toString() });
  }
}

/* Injeta um texto num clipe MOGRT, casando pelo display name do parâmetro
 * exposto no Essential Graphics. Retorna true se encontrou e setou. */
function _setMogrtText(clip, displayName, value) {
  var mgt = clip.getMGTComponent();
  if (!mgt) return false;
  for (var i = 0; i < mgt.properties.numItems; i++) {
    if (mgt.properties[i].displayName === displayName) {
      mgt.properties[i].setValue(value, true);
      return true;
    }
  }
  return false;
}

/*
 * Aplica os títulos na sequência ativa.
 * Re-lê CSV + markers (não confia em estado do painel), revalida e, para cada par:
 *   importMGT(estilo) no in do marcador -> ajusta o out ao marcador -> injeta textos.
 * Retorna JSON { ok, appliedCount, failedCount, applied[], failed[] }.
 *
 * NOTA (a confirmar no Premiere real — issue needs-human de teste end-to-end):
 *  - `clip.end = Time` ajusta o ponto de saída do clipe de gráfico.
 *  - A API de scripting do Premiere NÃO agrupa ações em um único undo; desfazer
 *    pode exigir vários Ctrl+Z. Ver README (limitações).
 */
function inserirTitulos_apply(csvPath, trackIndex, mogrtDir) {
  try {
    var seq = _activeSeqOrNull();
    if (!seq) return JSON.stringify({ ok: false, error: 'Nenhuma sequência ativa no Premiere.' });

    var text = _readTextUtf8(csvPath);
    if (text === null) return JSON.stringify({ ok: false, error: 'Não consegui ler o CSV: ' + csvPath });

    var parsed = parseRows(text);
    var markers = _getRangeMarkers(seq);
    var problems = validate(parsed, markers);
    if (_hasBlockingError(problems)) {
      var first = '';
      for (var pi = 0; pi < problems.length; pi++) { if (problems[pi].level === 'error') { first = problems[pi].message; break; } }
      return JSON.stringify({ ok: false, error: 'Validação falhou: ' + first });
    }

    var ti = parseInt(trackIndex, 10);
    if (isNaN(ti) || ti < 0) ti = 0;
    if (ti >= seq.videoTracks.numTracks) {
      return JSON.stringify({ ok: false, error: 'A track de vídeo V' + (ti + 1) + ' não existe nesta sequência.' });
    }

    var dir = String(mogrtDir || '').replace(/[\\\/]+$/, '');   // sem barra final
    if (dir === '') return JSON.stringify({ ok: false, error: 'Defina a pasta dos .mogrt nas configurações.' });

    var paired = pairByOrder(markers, parsed.rows);
    var applied = [];
    var failed = [];

    for (var i = 0; i < paired.pairs.length; i++) {
      var p = paired.pairs[i];
      var fname = STYLE_MOGRT[p.row.estilo];
      var mogrtPath = dir + '/' + fname;

      if (!(new File(mogrtPath)).exists) {
        failed.push({ n: i + 1, error: 'MOGRT não encontrado: ' + mogrtPath });
        continue;
      }

      try {
        seq.importMGT(mogrtPath, _secondsToTicks(p.marker.start), ti, ti);

        var track = seq.videoTracks[ti];
        var clip = track.clips[track.clips.numItems - 1];   // o recém-importado é o último da track

        var endT = new Time();
        endT.seconds = p.marker.end;
        clip.end = endT;                                    // ajusta o out ao tamanho do range

        var mancheteOk = _setMogrtText(clip, FIELD_MANCHETE, p.row.manchete);
        var subOk = true;
        if (p.row.subtitulo && p.row.subtitulo.length) {
          subOk = _setMogrtText(clip, FIELD_SUBTITULO, p.row.subtitulo);
        }

        applied.push({ n: i + 1, estilo: p.row.estilo, mancheteSet: mancheteOk, subtituloSet: subOk });
      } catch (exItem) {
        failed.push({ n: i + 1, error: exItem.toString() });
      }
    }

    return JSON.stringify({
      ok: true,
      appliedCount: applied.length,
      failedCount: failed.length,
      applied: applied,
      failed: failed
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'Erro ao aplicar: ' + e.toString() });
  }
}
