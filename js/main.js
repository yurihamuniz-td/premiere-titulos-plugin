/*
 * main.js — Lógica do painel (lado HTML/JS). UI fina: pega o CSV + o MOGRT alvo,
 * pede preview/aplicação ao backend ExtendScript (inserir-titulos.jsx) e desenha
 * a tabela. Toda a regra (parse/pareamento/validação) vive no backend.
 *
 * Modelo genérico: as colunas do CSV são os CAMPOS do MOGRT escolhido. O
 * Diagnóstico lê esses campos e monta o cabeçalho do CSV pronto pra colar.
 */
(function () {
  'use strict';

  var cs = new CSInterface();
  var state = { csvPath: null, csvName: null, canApply: false };

  var $ = function (id) { return document.getElementById(id); };

  /* ---- persistência simples das configurações ---- */
  function settings() {
    return {
      trackIndex: localStorage.getItem('it_track') || '2',
      mogrtFile: localStorage.getItem('it_mogrtfile') || ''
    };
  }
  function saveTrack(v) { localStorage.setItem('it_track', v); }
  function saveMogrt(v) { localStorage.setItem('it_mogrtfile', v); }

  /* ---- chamada ao host, com arg-escaping seguro e parse defensivo ---- */
  function quote(s) { return JSON.stringify(String(s == null ? '' : s)); }

  function callHost(call, cb) {
    cs.evalScript(call, function (raw) {
      var res;
      try { res = JSON.parse(raw); }
      catch (e) { res = { ok: false, error: 'Resposta inválida do backend: ' + raw }; }
      cb(res);
    });
  }

  /* ---- sonda de ambiente ---- */
  function refreshEnv() {
    callHost('inserirTitulos_env()', function (res) {
      var el = $('env');
      if (!res.ok) { el.textContent = 'Erro: ' + res.error; el.className = 'env warn'; return; }
      if (!res.hasSequence) { el.textContent = 'Abra uma sequência no Premiere para começar.'; el.className = 'env warn'; return; }
      el.textContent = 'Sequência: ' + res.sequenceName + ' · ' + res.videoTrackCount + ' tracks de vídeo';
      el.className = 'env ok';
    });
  }

  /* ---- helpers de settings ---- */
  function trackIndex() { return parseInt($('trackIndex').value, 10) || 0; }
  function mogrtFile() { return $('mogrtFile').value.trim(); }

  /* ---- preview ---- */
  function refreshPreview() {
    if (!state.csvPath) return;
    callHost('inserirTitulos_getPreview(' + quote(state.csvPath) + ',' + trackIndex() + ')', renderPreview);
  }

  function renderHead(fields) {
    var ths = '<th>#</th><th>Tempo (in–out)</th>';
    if (fields && fields.length) {
      for (var i = 0; i < fields.length; i++) ths += '<th>' + escapeHtml(fields[i]) + '</th>';
    } else {
      ths += '<th>Campos</th>';
    }
    $('previewHead').innerHTML = '<tr>' + ths + '</tr>';
  }

  function renderPreview(res) {
    var problemsEl = $('problems');
    var body = $('previewBody');
    var counts = $('counts');
    var result = $('result');
    result.textContent = ''; result.className = 'result';

    var fields = res.fields || [];
    var span = 2 + (fields.length || 1);
    renderHead(fields);

    if (!res.ok) {
      problemsEl.hidden = false;
      problemsEl.innerHTML = '<ul><li>' + escapeHtml(res.error) + '</li></ul>';
      body.innerHTML = '<tr class="empty"><td colspan="' + span + '">—</td></tr>';
      counts.textContent = '';
      setCanApply(false);
      return;
    }

    /* contagens */
    counts.textContent = res.markerCount + ' marcadores · ' + res.rowCount + ' linhas'
      + (res.delimiter === ';' ? ' · CSV ;' : '');

    /* problemas */
    if (res.problems && res.problems.length) {
      var items = '';
      for (var i = 0; i < res.problems.length; i++) {
        var p = res.problems[i];
        items += '<li class="' + (p.level === 'warn' ? 'warn' : '') + '">' + escapeHtml(p.message) + '</li>';
      }
      problemsEl.innerHTML = '<ul>' + items + '</ul>';
      problemsEl.hidden = false;
    } else {
      problemsEl.hidden = true;
      problemsEl.innerHTML = '';
    }

    /* tabela (colunas = campos do MOGRT) */
    if (!res.preview || !res.preview.length) {
      body.innerHTML = '<tr class="empty"><td colspan="' + span + '">Sem pares para mostrar.</td></tr>';
    } else {
      var rows = '';
      for (var k = 0; k < res.preview.length; k++) {
        var r = res.preview[k];
        var tds = '<td>' + r.n + '</td><td>' + escapeHtml(r.timecode) + '</td>';
        for (var f = 0; f < fields.length; f++) {
          var v = r.values ? r.values[fields[f]] : '';
          tds += '<td>' + (v ? escapeHtml(v) : '<span class="muted">—</span>') + '</td>';
        }
        rows += '<tr>' + tds + '</tr>';
      }
      body.innerHTML = rows;
    }

    setCanApply(!!res.canApply);
  }

  function setCanApply(v) {
    state.canApply = v;
    $('apply').disabled = !v;
  }

  /* ---- aplicar ---- */
  function apply() {
    if (!state.canApply || !state.csvPath) return;
    if (!mogrtFile()) { setResult('Escolha o arquivo .mogrt alvo nas configurações.', 'err'); return; }
    var n = trackIndex();
    if (!window.confirm('Aplicar os títulos na track V' + (n + 1) + '?')) return;
    $('apply').disabled = true;
    setResult('Aplicando…', '');
    callHost('inserirTitulos_apply(' + quote(state.csvPath) + ',' + n + ',' + quote(mogrtFile()) + ')', function (res) {
      if (!res.ok) { setResult(res.error, 'err'); setCanApply(true); return; }
      var msg = res.appliedCount + ' título(s) aplicado(s)';
      if (res.failedCount) msg += ' · ' + res.failedCount + ' falha(s)';
      /* diagnóstico do resultado: campos setados? duração ajustou? é MOGRT de AE? */
      var anySet = false, anyMogrt = false, durFail = 0;
      for (var i = 0; i < (res.applied || []).length; i++) {
        if (res.applied[i].isMogrt) anyMogrt = true;
        if (res.applied[i].set && res.applied[i].set.length) anySet = true;
        if (res.applied[i].durOk === false) durFail++;
      }
      var warn = false;
      if (res.appliedCount && !anyMogrt) { msg += ' — atenção: não é MOGRT de AE (texto não entra)'; warn = true; }
      else if (res.appliedCount && !anySet) { msg += ' — atenção: nenhum campo casou (confira o cabeçalho via Diagnóstico)'; warn = true; }
      if (durFail) { msg += ' — duração não ajustou em ' + durFail; warn = true; }
      setResult(msg, (res.failedCount || warn) ? 'err' : 'ok');
      refreshPreview();
    });
  }

  function setResult(text, cls) {
    var el = $('result');
    el.textContent = text;
    el.className = 'result' + (cls ? ' ' + cls : '');
  }

  /* ---- escolha de arquivos (API do CEP) ---- */
  function pickCsv() {
    var r = window.cep.fs.showOpenDialog(false, false, 'Selecionar CSV de títulos', '', ['csv']);
    if (r && r.data && r.data.length) {
      state.csvPath = r.data[0];
      state.csvName = r.data[0].replace(/^.*[\\\/]/, '');
      var nameEl = $('csvName');
      nameEl.textContent = state.csvName;
      nameEl.title = state.csvPath;
      refreshPreview();
    }
  }

  function pickMogrt() {
    var r = window.cep.fs.showOpenDialog(false, false, 'Selecionar o .mogrt alvo', '', ['mogrt']);
    if (r && r.data && r.data.length) {
      $('mogrtFile').value = r.data[0];
      saveMogrt(r.data[0]);
    }
  }

  /* ---- diagnóstico: campos do MOGRT + cabeçalho do CSV pronto ---- */
  function csvHeader(names) {
    var parts = [];
    for (var i = 0; i < names.length; i++) {
      var n = String(names[i]);
      if (n.indexOf(',') >= 0 || n.indexOf('"') >= 0) n = '"' + n.replace(/"/g, '""') + '"';
      parts.push(n);
    }
    return parts.join(',');
  }

  function diag() {
    callHost('inserirTitulos_dumpParams(' + trackIndex() + ')', function (res) {
      var out = $('diagOut');
      out.hidden = false;
      if (!res.ok) { out.className = 'diag-out err'; out.textContent = res.error; return; }
      if (!res.isMogrt) {
        out.className = 'diag-out err';
        out.textContent = 'Último clipe ("' + res.clipName + '") não é MOGRT. Arraste o .mogrt para a track V' + (trackIndex() + 1) + ' e tente de novo.';
        return;
      }
      if (!res.params || !res.params.length) {
        out.className = 'diag-out';
        out.textContent = 'MOGRT sem campos expostos no Essential Graphics.';
        return;
      }
      out.className = 'diag-out ok';
      out.innerHTML = 'Campos: ' + escapeHtml(res.params.join(' · '))
        + '<br>Cabeçalho do CSV (copie):<br><code>' + escapeHtml(csvHeader(res.params)) + '</code>';
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- init ---- */
  function init() {
    var s = settings();
    $('trackIndex').value = s.trackIndex;
    $('mogrtFile').value = s.mogrtFile;

    $('trackIndex').addEventListener('change', function () { saveTrack(this.value); refreshPreview(); });
    $('mogrtFile').addEventListener('change', function () { saveMogrt(this.value.trim()); });
    $('browseFile').addEventListener('click', pickMogrt);
    $('loadCsv').addEventListener('click', pickCsv);
    $('apply').addEventListener('click', apply);
    $('diag').addEventListener('click', diag);

    refreshEnv();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
