'use strict';
/*
 * Testes da lógica pura (jsx/titulos-core.js) — modelo genérico (CSV dirigido
 * pelos campos do MOGRT). Rodar:  npm test
 * Cobre os riscos do PLAN.md: acentos PT, BOM, ; vs , , aspas, descasamento
 * marker<->linha, validação e pareamento por ordem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../jsx/titulos-core.js');

function rng(start, end) { return { start, end }; }

test('stripBom remove BOM UTF-8 do início', () => {
  assert.equal(core.stripBom('﻿Manchete,Subtítulo'), 'Manchete,Subtítulo');
  assert.equal(core.stripBom('sem bom'), 'sem bom');
  assert.equal(core.stripBom(''), '');
});

test('detectDelimiter: vírgula vs ponto-e-vírgula (Excel pt-BR)', () => {
  assert.equal(core.detectDelimiter('Manchete,Subtítulo'), ',');
  assert.equal(core.detectDelimiter('Manchete;Subtítulo'), ';');
});

test('parseRows: cabeçalho vira os campos; valores acentuados preservados', () => {
  const csv = 'Manchete,Subtítulo\nRaciocínio em vídeo,Atenção à acentuação';
  const r = core.parseRows(csv);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.fields, ['Manchete', 'Subtítulo']);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].values['Manchete'], 'Raciocínio em vídeo');
  assert.equal(r.rows[0].values['Subtítulo'], 'Atenção à acentuação');
});

test('parseRows: campos arbitrários (qualquer MOGRT)', () => {
  const csv = 'Título,Autor,Data\nLançamento,Maria,2026';
  const r = core.parseRows(csv);
  assert.deepEqual(r.fields, ['Título', 'Autor', 'Data']);
  assert.equal(r.rows[0].values['Autor'], 'Maria');
  assert.equal(r.rows[0].values['Data'], '2026');
});

test('parseRows: BOM no arquivo não quebra o cabeçalho', () => {
  const r = core.parseRows('﻿Manchete,Subtítulo\nOlá,mundo');
  assert.equal(r.errors.length, 0);
  assert.equal(r.fields[0], 'Manchete');
  assert.equal(r.rows[0].values['Manchete'], 'Olá');
});

test('parseRows: delimitador ponto-e-vírgula', () => {
  const r = core.parseRows('Manchete;Subtítulo\nPergunta cabível;');
  assert.equal(r.delimiter, ';');
  assert.equal(r.rows[0].values['Manchete'], 'Pergunta cabível');
  assert.equal(r.rows[0].values['Subtítulo'], '');
});

test('parseRows: campo com vírgula entre aspas', () => {
  const r = core.parseRows('Manchete,Subtítulo\n"Sora, Runway e Pika",corrida da IA');
  assert.equal(r.rows[0].values['Manchete'], 'Sora, Runway e Pika');
  assert.equal(r.rows[0].values['Subtítulo'], 'corrida da IA');
});

test('parseRows: aspas escapadas ("") dentro do campo', () => {
  const r = core.parseRows('Manchete,Subtítulo\n"Ele disse ""não""",');
  assert.equal(r.rows[0].values['Manchete'], 'Ele disse "não"');
});

test('parseRows: CRLF e linha em branco final são ignorados', () => {
  const r = core.parseRows('Manchete,Subtítulo\r\nA,\r\nB,\r\n\r\n');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].values['Manchete'], 'B');
});

test('parseRows: valor vazio é permitido', () => {
  const r = core.parseRows('Manchete,Subtítulo\nSó manchete,');
  assert.equal(r.rows[0].values['Subtítulo'], '');
});

test('parseRows: campo NFD (Mac) é só trimado, sem perder o nome', () => {
  const csv = ('Manchete,Subtítulo\nA,B').normalize('NFD');
  const r = core.parseRows(csv);
  // o nome do campo precisa bater EXATAMENTE com o display name do MOGRT;
  // preservamos como veio (NFD), apenas com trim — o valor é acessível por ele.
  assert.equal(r.fields.length, 2);
  assert.equal(r.rows[0].values[r.fields[0]], 'A');
  assert.equal(r.rows[0].values[r.fields[1]], 'B');
});

test('parseRows: nº de linha aponta a linha física mesmo com linhas em branco', () => {
  const r = core.parseRows('Manchete,Subtítulo\nA,\n\n\nB,');
  assert.equal(r.rows[1].line, 5);   // header=1, A=2, blanks=3&4, B=5
});

test('parseRows: cabeçalho sem dados avisa', () => {
  const r = core.parseRows('Manchete,Subtítulo');
  assert.equal(r.rows.length, 0);
  assert.ok(r.errors.some(e => /nenhuma linha de dados/.test(e)));
});

test('parseRows: CSV vazio / só espaços avisa', () => {
  assert.ok(core.parseRows('').errors.some(e => /vazio/.test(e)));
  assert.ok(core.parseRows('\n\n  \n').errors.length > 0);
});

test('pairByOrder: contagens iguais pareiam 1:1', () => {
  const markers = [rng(1, 3), rng(5, 8), rng(10, 12)];
  const rows = [{ values: { Manchete: 'A' } }, { values: { Manchete: 'B' } }, { values: { Manchete: 'C' } }];
  const p = core.pairByOrder(markers, rows);
  assert.equal(p.countMatch, true);
  assert.equal(p.pairs[2].marker.start, 10);
  assert.equal(p.pairs[2].row.values.Manchete, 'C');
});

test('pairByOrder: descasamento pareia até o menor e marca countMatch=false', () => {
  const p = core.pairByOrder([rng(1, 2), rng(3, 4)], [{ values: {} }]);
  assert.equal(p.countMatch, false);
  assert.equal(p.pairs.length, 1);
  assert.equal(p.markerCount, 2);
  assert.equal(p.rowCount, 1);
});

test('validate: descasamento de contagem é erro', () => {
  const r = core.parseRows('Manchete,Subtítulo\nA,\nB,');
  const problems = core.validate(r, [rng(1, 2)]);
  assert.ok(problems.some(p => p.level === 'error' && /≠/.test(p.message)));
});

test('validate: sem marcadores é erro', () => {
  const r = core.parseRows('Manchete,Subtítulo\nA,sub');
  assert.ok(core.validate(r, []).some(p => /Nenhum marcador/.test(p.message)));
});

test('validate: marcador com range invertido (in >= out) é erro', () => {
  const r = core.parseRows('Manchete,Subtítulo\nA,');
  assert.ok(core.validate(r, [{ start: 10, end: 5 }]).some(p => /range inválido/.test(p.message)));
});

test('validate: coluna que não existe no MOGRT é warn (knownFields)', () => {
  const r = core.parseRows('Manchete,Inexistente\nA,B');
  const problems = core.validate(r, [rng(1, 2)], ['Manchete', 'Subtítulo']);
  assert.ok(problems.some(p => p.level === 'warn' && /Inexistente/.test(p.message)));
});

test('validate: caso feliz não retorna erros', () => {
  const r = core.parseRows('Manchete,Subtítulo\nA,sub\nB,');
  assert.equal(core.validate(r, [rng(1, 3), rng(5, 8)]).filter(p => p.level === 'error').length, 0);
});

test('formatTimecode: segundos -> HH:MM:SS / MM:SS, e sentinela', () => {
  assert.equal(core.formatTimecode(83), '01:23');
  assert.equal(core.formatTimecode(3661), '01:01:01');
  assert.equal(core.formatTimecode(0), '00:00');
  assert.equal(core.formatTimecode(-5), '--:--');
  assert.equal(core.formatTimecode(Infinity), '--:--');
});

test('buildPreview: timecode, duração e valores por campo', () => {
  const markers = [rng(83, 91)];
  const rows = [{ values: { Manchete: 'GPT-5.6', Subtítulo: 'OpenAI' } }];
  const preview = core.buildPreview(core.pairByOrder(markers, rows).pairs);
  assert.equal(preview[0].n, 1);
  assert.equal(preview[0].timecode, '01:23–01:31');
  assert.equal(preview[0].durationSec, 8);
  assert.equal(preview[0].values.Manchete, 'GPT-5.6');
});

test('csvHeaderFromFields: monta cabeçalho, com aspas quando precisa', () => {
  assert.equal(core.csvHeaderFromFields(['Manchete', 'Subtítulo'], ','), 'Manchete,Subtítulo');
  assert.equal(core.csvHeaderFromFields(['Nome, completo', 'X'], ','), '"Nome, completo",X');
  assert.equal(core.csvHeaderFromFields(['A', 'B'], ';'), 'A;B');
});

test('integração: CSV pt-BR (;) com acento, 3 linhas pareadas e validadas', () => {
  const csv = '﻿Manchete;Subtítulo\n'
    + 'GPT-5.6 chega com raciocínio em vídeo;OpenAI mira edição\n'
    + '"Sora, Runway e Pika: a corrida da IA";\n'
    + 'Será que a IA vai substituir editores?;Especialistas divergem';
  const r = core.parseRows(csv);
  const markers = [rng(5, 13), rng(20, 27), rng(40, 49)];
  assert.equal(r.delimiter, ';');
  assert.equal(r.rows.length, 3);
  assert.equal(core.validate(r, markers).filter(p => p.level === 'error').length, 0);
  const preview = core.buildPreview(core.pairByOrder(markers, r.rows).pairs);
  assert.equal(preview[1].values['Manchete'], 'Sora, Runway e Pika: a corrida da IA');
  assert.equal(preview[2].values['Subtítulo'], 'Especialistas divergem');
});

test('regressão: linha em branco inicial não engana a detecção de ; (pt-BR)', () => {
  const r = core.parseRows('\nManchete;Subtítulo\nOlá;mundo');
  assert.equal(r.delimiter, ';');
  assert.equal(r.rows[0].values['Manchete'], 'Olá');
  assert.equal(r.rows[0].values['Subtítulo'], 'mundo');
});
