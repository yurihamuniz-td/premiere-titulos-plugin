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

/* Diagnóstico: lista os display names dos campos do MOGRT no ÚLTIMO clipe da
 * track indicada. Use depois de arrastar 1 instância do .mogrt para a timeline:
 * os nomes listados são exatamente as colunas que o CSV deve ter (o painel monta
 * o cabeçalho pronto a partir daqui). */
function inserirTitulos_dumpParams(trackIndex) {
  try {
    var seq = _activeSeqOrNull();
    if (!seq) return JSON.stringify({ ok: false, error: 'Nenhuma sequência ativa no Premiere.' });

    var ti = parseInt(trackIndex, 10);
    if (isNaN(ti) || ti < 0) ti = 0;
    if (ti >= seq.videoTracks.numTracks) {
      return JSON.stringify({ ok: false, error: 'A track de vídeo V' + (ti + 1) + ' não existe.' });
    }

    var track = seq.videoTracks[ti];
    if (!track.clips || track.clips.numItems === 0) {
      return JSON.stringify({ ok: false, error: 'A track V' + (ti + 1) + ' está vazia. Arraste o .mogrt para ela primeiro.' });
    }

    var clip = track.clips[track.clips.numItems - 1];   // último clipe da track
    var mgt = clip.getMGTComponent();
    var names = [];
    if (mgt) {
      for (var i = 0; i < mgt.properties.numItems; i++) {
        names.push(String(mgt.properties[i].displayName));
      }
    }
    return JSON.stringify({ ok: true, clipName: String(clip.name || ''), isMogrt: !!mgt, params: names });
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'Erro no diagnóstico: ' + e.toString() });
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
      fields: parsed.fields,
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

/* normaliza nome de campo p/ casar de forma tolerante: trim + minúsculo
 * (assim a coluna "manchete" casa com o display name "Manchete"). */
function _normField(s) {
  return String(s == null ? '' : s).replace(/^\s+/, '').replace(/\s+$/, '').toLowerCase();
}

/* Seta TODOS os campos de um clipe MOGRT cujo display name bate (case-insensitive)
 * com uma chave de `values` não-vazia. Genérico: funciona com qualquer MOGRT de AE.
 * Retorna { isMogrt, set:[nomes setados], missing:[colunas sem campo no MOGRT] }. */
function _setAllFields(clip, values) {
  var mgt = clip.getMGTComponent();
  if (!mgt) return { isMogrt: false, set: [], missing: [] };

  var set = [];
  var missing = [];
  var key;
  for (key in values) {
    if (!values.hasOwnProperty(key)) continue;
    if (!values[key] || !values[key].length) continue;   // pula valor vazio (mantém o padrão do MOGRT)
    var target = _normField(key);
    var found = false;
    for (var i = 0; i < mgt.properties.numItems; i++) {
      if (_normField(mgt.properties[i].displayName) === target) {
        mgt.properties[i].setValue(values[key], true);
        set.push(key);
        found = true;
        break;
      }
    }
    if (!found) missing.push(key);
  }
  return { isMogrt: true, set: set, missing: missing };
}

/* Acha o clipe da track cujo início bate com startSec (tolerância 0,5s) — usado
 * logo após importMGT para pegar o clipe recém-inserido independentemente de
 * quantos outros clipes já existam na track. Cai no último como fallback. */
function _clipAtStart(track, startSec) {
  var best = null, bestDiff = 1e9;
  for (var i = 0; i < track.clips.numItems; i++) {
    var c = track.clips[i];
    var d = c.start.seconds - startSec;
    if (d < 0) d = -d;
    if (d < bestDiff) { bestDiff = d; best = c; }
  }
  if (best && bestDiff <= 0.5) return best;
  return track.clips.numItems ? track.clips[track.clips.numItems - 1] : null;
}

/*
 * Aplica os títulos na sequência ativa, usando UM arquivo .mogrt para todas as linhas.
 * Re-lê CSV + markers (não confia em estado do painel), revalida e, para cada par:
 *   importMGT no in do marcador -> ajusta o out ao marcador -> seta os campos por nome.
 * Retorna JSON { ok, appliedCount, failedCount, applied[], failed[] }.
 *
 * NOTA:
 *  - Pega o clipe pelo TEMPO do marcador (_clipAtStart), então a track-alvo pode
 *    ter outros clipes. Evite re-aplicar por cima de títulos antigos nos MESMOS
 *    pontos (apague-os antes).
 *  - A API de scripting do Premiere NÃO agrupa ações em um único undo.
 */
function inserirTitulos_apply(csvPath, trackIndex, mogrtFile) {
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

    var mogrtPath = String(mogrtFile || '');
    if (mogrtPath === '') return JSON.stringify({ ok: false, error: 'Escolha o arquivo .mogrt alvo nas configurações.' });
    if (!(new File(mogrtPath)).exists) return JSON.stringify({ ok: false, error: 'MOGRT não encontrado: ' + mogrtPath });

    var paired = pairByOrder(markers, parsed.rows);
    var applied = [];
    var failed = [];

    for (var i = 0; i < paired.pairs.length; i++) {
      var p = paired.pairs[i];
      try {
        seq.importMGT(mogrtPath, _secondsToTicks(p.marker.start), ti, ti);

        var track = seq.videoTracks[ti];
        /* acha o clipe pelo TEMPO do marcador (não pela posição na lista), para
         * funcionar mesmo com a track-alvo já tendo outros clipes. */
        var clip = _clipAtStart(track, p.marker.start);
        if (!clip) { failed.push({ n: i + 1, error: 'Clipe importado não encontrado na track.' }); continue; }

        /* ajusta o out ao tamanho do range. Setamos a Time via .ticks (caminho
         * confiável; .seconds nem sempre persiste no setter de clip.end). */
        var endT = new Time();
        endT.ticks = _secondsToTicks(p.marker.end);
        clip.end = endT;
        var durOk = (Math.abs(clip.end.seconds - p.marker.end) <= 0.2);   // confere se pegou

        var res = _setAllFields(clip, p.row.values);
        applied.push({ n: i + 1, isMogrt: res.isMogrt, set: res.set, missing: res.missing, durOk: durOk });
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
