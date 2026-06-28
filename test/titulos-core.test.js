'use strict';
/*
 * Testes da lógica pura (jsx/titulos-core.js). Rodar:  npm test
 * Cobre exatamente os riscos do PLAN.md: acentos PT, BOM, ; vs , , aspas,
 * descasamento marker<->linha, validação e pareamento por ordem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../jsx/titulos-core.js');

/* helper: marcador de range a partir de in/out em segundos */
function rng(start, end) { return { start, end }; }

test('stripBom remove BOM UTF-8 do início', () => {
  assert.equal(core.stripBom('﻿estilo,manchete'), 'estilo,manchete');
  assert.equal(core.stripBom('sem bom'), 'sem bom');
  assert.equal(core.stripBom(''), '');
});

test('detectDelimiter: vírgula vs ponto-e-vírgula (Excel pt-BR)', () => {
  assert.equal(core.detectDelimiter('estilo,manchete,subtitulo'), ',');
  assert.equal(core.detectDelimiter('estilo;manchete;subtitulo'), ';');
});

test('parseRows: cabeçalho + acentos preservados', () => {
  const csv = 'estilo,manchete,subtitulo\nl3rd,Raciocínio em vídeo,Atenção à acentuação';
  const r = core.parseRows(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].estilo, 'l3rd');
  assert.equal(r.rows[0].manchete, 'Raciocínio em vídeo');
  assert.equal(r.rows[0].subtitulo, 'Atenção à acentuação');
});

test('parseRows: BOM no arquivo não quebra o cabeçalho', () => {
  const csv = '﻿estilo,manchete,subtitulo\nl3rd,Olá,mundo';
  const r = core.parseRows(csv);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].estilo, 'l3rd');
  assert.equal(r.rows[0].manchete, 'Olá');
});

test('parseRows: delimitador ponto-e-vírgula', () => {
  const csv = 'estilo;manchete;subtitulo\ncentered;Pergunta cabível;';
  const r = core.parseRows(csv);
  assert.equal(r.delimiter, ';');
  assert.equal(r.rows[0].estilo, 'centered');
  assert.equal(r.rows[0].manchete, 'Pergunta cabível');
  assert.equal(r.rows[0].subtitulo, '');
});

test('parseRows: campo com vírgula entre aspas', () => {
  const csv = 'estilo,manchete,subtitulo\ncentered,"Sora, Runway e Pika",corrida da IA';
  const r = core.parseRows(csv);
  assert.equal(r.rows[0].manchete, 'Sora, Runway e Pika');
  assert.equal(r.rows[0].subtitulo, 'corrida da IA');
});

test('parseRows: aspas escapadas ("") dentro do campo', () => {
  const csv = 'estilo,manchete,subtitulo\nquestion,"Ele disse ""não"" pra IA",';
  const r = core.parseRows(csv);
  assert.equal(r.rows[0].manchete, 'Ele disse "não" pra IA');
});

test('parseRows: CRLF e linha em branco final são ignorados', () => {
  const csv = 'estilo,manchete,subtitulo\r\nl3rd,A,\r\nl3rd,B,\r\n\r\n';
  const r = core.parseRows(csv);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].manchete, 'B');
});

test('parseRows: subtítulo vazio é permitido', () => {
  const csv = 'estilo,manchete,subtitulo\nl3rd,Só manchete,';
  const r = core.parseRows(csv);
  assert.equal(r.rows[0].subtitulo, '');
});

test('parseRows: sem cabeçalho assume posicional estilo,manchete,subtitulo', () => {
  const csv = 'l3rd,Manchete sem header,Sub';
  const r = core.parseRows(csv);
  assert.equal(r.header, null);
  assert.equal(r.rows[0].estilo, 'l3rd');
  assert.equal(r.rows[0].manchete, 'Manchete sem header');
});

test('normalizeStyle: aliases e desconhecidos', () => {
  assert.equal(core.normalizeStyle('l3rd'), 'l3rd');
  assert.equal(core.normalizeStyle('Lower Third'), 'l3rd');
  assert.equal(core.normalizeStyle('CENTRALIZADO'), 'centered');
  assert.equal(core.normalizeStyle('pergunta'), 'question');
  assert.equal(core.normalizeStyle('ticker'), null);
  assert.equal(core.normalizeStyle(''), null);
});

test('parseRows: estilo desconhecido vira null (sinalizado depois)', () => {
  const csv = 'estilo,manchete,subtitulo\nbanana,X,';
  const r = core.parseRows(csv);
  assert.equal(r.rows[0].estilo, null);
  assert.equal(r.rows[0].estiloRaw, 'banana');
});

test('pairByOrder: contagens iguais pareiam 1:1', () => {
  const markers = [rng(1, 3), rng(5, 8), rng(10, 12)];
  const rows = [{ manchete: 'A' }, { manchete: 'B' }, { manchete: 'C' }];
  const p = core.pairByOrder(markers, rows);
  assert.equal(p.countMatch, true);
  assert.equal(p.pairs.length, 3);
  assert.equal(p.pairs[2].marker.start, 10);
  assert.equal(p.pairs[2].row.manchete, 'C');
});

test('pairByOrder: descasamento pareia até o menor e marca countMatch=false', () => {
  const p = core.pairByOrder([rng(1, 2), rng(3, 4)], [{ manchete: 'A' }]);
  assert.equal(p.countMatch, false);
  assert.equal(p.pairs.length, 1);
  assert.equal(p.markerCount, 2);
  assert.equal(p.rowCount, 1);
});

test('validate: descasamento de contagem é erro', () => {
  const r = core.parseRows('estilo,manchete,subtitulo\nl3rd,A,\nl3rd,B,');
  const problems = core.validate(r, [rng(1, 2)]);
  assert.ok(problems.some(p => p.level === 'error' && /≠/.test(p.message)));
});

test('validate: manchete vazia e estilo desconhecido são erros', () => {
  const r = core.parseRows('estilo,manchete,subtitulo\nbanana,,');
  const problems = core.validate(r, [rng(1, 2)]);
  assert.ok(problems.some(p => /estilo desconhecido/.test(p.message)));
  assert.ok(problems.some(p => /manchete vazia/.test(p.message)));
});

test('validate: sem marcadores é erro', () => {
  const r = core.parseRows('estilo,manchete,subtitulo\nl3rd,A,');
  const problems = core.validate(r, []);
  assert.ok(problems.some(p => /Nenhum marcador/.test(p.message)));
});

test('validate: caso feliz não retorna erros', () => {
  const r = core.parseRows('estilo,manchete,subtitulo\nl3rd,A,sub\ncentered,B,');
  const problems = core.validate(r, [rng(1, 3), rng(5, 8)]);
  assert.equal(problems.filter(p => p.level === 'error').length, 0);
});

test('formatTimecode: segundos -> HH:MM:SS / MM:SS', () => {
  assert.equal(core.formatTimecode(83), '01:23');
  assert.equal(core.formatTimecode(3661), '01:01:01');
  assert.equal(core.formatTimecode(0), '00:00');
});

test('buildPreview: timecode, duração e textos', () => {
  const markers = [rng(83, 91)];
  const rows = [{ estilo: 'l3rd', estiloRaw: 'l3rd', manchete: 'GPT-5.6', subtitulo: 'OpenAI' }];
  const preview = core.buildPreview(core.pairByOrder(markers, rows).pairs);
  assert.equal(preview[0].n, 1);
  assert.equal(preview[0].timecode, '01:23–01:31');
  assert.equal(preview[0].durationSec, 8);
  assert.equal(preview[0].manchete, 'GPT-5.6');
});

test('integração: CSV pt-BR (;) com acento + 3 linhas pareadas e validadas', () => {
  const csv = '﻿estilo;manchete;subtitulo\n'
    + 'l3rd;GPT-5.6 chega com raciocínio em vídeo;OpenAI mira edição\n'
    + 'centered;"Sora, Runway e Pika: a corrida da IA";\n'
    + 'question;Será que a IA vai substituir editores?;Especialistas divergem';
  const r = core.parseRows(csv);
  const markers = [rng(5, 13), rng(20, 27), rng(40, 49)];
  assert.equal(r.delimiter, ';');
  assert.equal(r.rows.length, 3);
  assert.equal(core.validate(r, markers).filter(p => p.level === 'error').length, 0);
  const preview = core.buildPreview(core.pairByOrder(markers, r.rows).pairs);
  assert.equal(preview[1].manchete, 'Sora, Runway e Pika: a corrida da IA');
  assert.equal(preview[2].estilo, 'question');
});
