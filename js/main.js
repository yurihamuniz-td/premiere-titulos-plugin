/*
 * main.js — Lógica do painel (lado HTML/JS). UI fina: pega o CSV, pede preview e
 * aplicação ao backend ExtendScript (inserir-titulos.jsx) e desenha a tabela.
 * Toda a regra (parse/pareamento/validação) vive no backend; aqui é só interface.
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
      mogrtDir: localStorage.getItem('it_mogrtdir') || ''
    };
  }
  function saveTrack(v) { localStorage.setItem('it_track', v); }
  function saveDir(v) { localStorage.setItem('it_mogrtdir', v); }

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

  /* ---- preview ---- */
  function trackIndex() { return parseInt($('trackIndex').value, 10) || 0; }
  function mogrtDir() { return $('mogrtDir').value.trim(); }

  function refreshPreview() {
    if (!state.csvPath) return;
    callHost('inserirTitulos_getPreview(' + quote(state.csvPath) + ',' + trackIndex() + ')', renderPreview);
  }

  function renderPreview(res) {
    var problemsEl = $('problems');
    var body = $('previewBody');
    var counts = $('counts');
    var result = $('result');
    result.textContent = ''; result.className = 'result';

    if (!res.ok) {
      problemsEl.hidden = false;
      problemsEl.innerHTML = '<ul><li>' + escapeHtml(res.error) + '</li></ul>';
      body.innerHTML = '<tr class="empty"><td colspan="4">—</td></tr>';
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

    /* tabela */
    if (!res.preview || !res.preview.length) {
      body.innerHTML = '<tr class="empty"><td colspan="4">Sem pares para mostrar.</td></tr>';
    } else {
      var rows = '';
      for (var k = 0; k < res.preview.length; k++) {
        var r = res.preview[k];
        var styleBadge = r.estilo
          ? '<span class="badge">' + escapeHtml(r.estilo) + '</span>'
          : '<span class="badge unknown">' + escapeHtml(r.estiloRaw || '?') + '</span>';
        var sub = r.subtitulo ? '<div class="subtitulo">' + escapeHtml(r.subtitulo) + '</div>' : '';
        var bad = (!r.estilo || !r.manchete) ? ' class="bad"' : '';
        rows += '<tr' + bad + '>'
          + '<td>' + r.n + '</td>'
          + '<td>' + escapeHtml(r.timecode) + '</td>'
          + '<td>' + styleBadge + '</td>'
          + '<td><div class="manchete">' + escapeHtml(r.manchete || '—') + '</div>' + sub + '</td>'
          + '</tr>';
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
    var n = trackIndex();
    if (!window.confirm('Aplicar os títulos na track V' + (n + 1) + '?')) return;
    $('apply').disabled = true;
    $('result').textContent = 'Aplicando…';
    $('result').className = 'result';
    callHost('inserirTitulos_apply(' + quote(state.csvPath) + ',' + n + ',' + quote(mogrtDir()) + ')', function (res) {
      var el = $('result');
      if (!res.ok) { el.textContent = res.error; el.className = 'result err'; setCanApply(true); return; }
      var msg = res.appliedCount + ' título(s) aplicado(s)';
      if (res.failedCount) msg += ' · ' + res.failedCount + ' falha(s)';
      el.textContent = msg;
      el.className = res.failedCount ? 'result err' : 'result ok';
      refreshPreview();
    });
  }

  /* ---- escolha de arquivos/pastas (API do CEP) ---- */
  function pickCsv() {
    var r = window.cep.fs.showOpenDialog(false, false, 'Selecionar CSV de títulos', settings().mogrtDir || '', ['csv']);
    if (r && r.data && r.data.length) {
      state.csvPath = r.data[0];
      state.csvName = r.data[0].replace(/^.*[\\\/]/, '');
      var nameEl = $('csvName');
      nameEl.textContent = state.csvName;
      nameEl.title = state.csvPath;
      refreshPreview();
    }
  }

  function pickDir() {
    var r = window.cep.fs.showOpenDialog(false, true, 'Pasta dos arquivos .mogrt', mogrtDir() || '', []);
    if (r && r.data && r.data.length) {
      $('mogrtDir').value = r.data[0];
      saveDir(r.data[0]);
      refreshPreview();
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- init ---- */
  function init() {
    var s = settings();
    $('trackIndex').value = s.trackIndex;
    $('mogrtDir').value = s.mogrtDir;

    $('trackIndex').addEventListener('change', function () { saveTrack(this.value); refreshPreview(); });
    $('mogrtDir').addEventListener('change', function () { saveDir(this.value.trim()); refreshPreview(); });
    $('browseDir').addEventListener('click', pickDir);
    $('loadCsv').addEventListener('click', pickCsv);
    $('apply').addEventListener('click', apply);

    refreshEnv();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
