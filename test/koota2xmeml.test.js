'use strict';
/*
 * Testes do conversor Koota → XMEML (tools/koota2xmeml-core.js + CLI).
 * Rodar: npm test
 * Cobre: conversão seg→frames sem drift, pathurl, estrutura do XML, fallback
 * p/ edl.json, validações com erro claro, e a CLI de ponta a ponta.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const core = require('../tools/koota2xmeml-core.js');

/* ───────── fixtures ───────── */

function makeKoota(clips, tl) {
  return {
    timeline: Object.assign(
      { fps: 30, width: 1080, height: 1920, tracks: [{ id: 'v1', kind: 'video', clips }] },
      tl || {}
    ),
    grade: ''
  };
}

function makeEdl(sources, ranges) {
  return { version: 1, sources, ranges: ranges || [], grade: '', overlays: [], subtitles: null, total_duration_s: 0 };
}

const SRC = { R05: 'C:\\Videos\\Melhores da Semana\\R05 (take bom).mp4' };

function clip(inSec, outSec, quote, sourceId) {
  return { id: 'c' + inSec, sourceId: sourceId || 'R05', inSec, outSec, quote: quote || '' };
}

/* checador mínimo de XML bem-formado: pilha de tags (suficiente p/ pegar
 * escaping quebrado e tag não fechada; não valida DTD) */
function assertWellFormed(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*<!DOCTYPE xmeml>\s*/, '');
  const re = /<(\/?)([A-Za-z][\w.]*)((?:"[^"]*"|[^">])*?)(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosing = m[4] === '/';
    if (closing) {
      const top = stack.pop();
      assert.equal(top, name, `tag </${name}> fecha <${top}> (pilha: ${stack.join('>')})`);
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], 'tags não fechadas: ' + stack.join(','));
  /* nenhum & solto (não-entidade) sobrou de escaping esquecido */
  assert.equal(/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml), false, '& não escapado no XML');
}

function grab(xml, tag) {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/* ───────── conversão feliz ───────── */

test('convert: 2 clips sequenciais a 30fps — frames, ticks e offsets corretos', () => {
  const koota = makeKoota([clip(21.69, 23.68, 'primeiro'), clip(0.34, 9.74, 'segundo')]);
  const { xml, warnings } = core.convert(koota, makeEdl(SRC), { seqName: 'R05' });
  assert.equal(warnings.length, 0);
  assertWellFormed(xml);

  /* clip 1: in=round(21.69*30)=651, out=round(23.68*30)=710, dur=59 */
  /* clip 2: in=round(0.34*30)=10, out=round(9.74*30)=292, dur=282 */
  const ticksPerFrame = core.TICK_RATE / 30;
  assert.match(xml, new RegExp('<in>651</in>'));
  assert.match(xml, new RegExp('<out>710</out>'));
  assert.match(xml, new RegExp(`<pproTicksIn>${651 * ticksPerFrame}</pproTicksIn>`));
  assert.match(xml, new RegExp(`<pproTicksOut>${710 * ticksPerFrame}</pproTicksOut>`));

  /* offsets de saída: clip1 start=0 end=59; clip2 start=59 end=341 */
  const starts = grab(xml, 'start');
  const ends = grab(xml, 'end');
  assert.ok(starts.includes('0') && starts.includes('59'), 'starts: ' + starts.join(','));
  assert.ok(ends.includes('59') && ends.includes('341'), 'ends: ' + ends.join(','));

  /* duração da sequência = 59 + 282 */
  assert.match(xml, /<sequence[^>]*>/);
  assert.ok(grab(xml, 'duration').includes('341'), 'duração da sequência');

  /* 1 fonte: 3 clipitems do masterclip + 3 por segmento na sequência */
  const clipitems = xml.match(/<clipitem id="/g) || [];
  assert.equal(clipitems.length, 3 + 3 * 2);
});

test('convert: pathurl com %20 para espaços, parênteses/acentos literais, escapado p/ XML', () => {
  const koota = makeKoota([clip(0, 1, 'x')]);
  const edl = makeEdl({ R05: 'C:\\Meus Vídeos\\take & corte (v2).mp4' });
  const { xml } = core.convert(koota, edl, { seqName: 'R05' });
  assertWellFormed(xml);
  assert.ok(
    xml.includes('<pathurl>file://localhost/C%3a/Meus%20Vídeos/take%20&amp;%20corte%20(v2).mp4</pathurl>'),
    'pathurl: ' + (xml.match(/<pathurl>[^<]*/) || [''])[0]
  );
});

test('convert: sem drift cumulativo — 1000 clips de 0.7003s a 30fps', () => {
  const clips = [];
  for (let i = 0; i < 1000; i++) clips.push(clip(i * 2, i * 2 + 0.7003, 'q' + i));
  const { xml } = core.convert(makeKoota(clips), makeEdl(SRC), { seqName: 'R05' });
  /* cada clip: dur = round(0.7003*30 + i*60) - round(i*60) = 21 frames */
  /* último start = 999 * 21 = 20979; duração total = 21000 */
  assert.ok(grab(xml, 'start').includes(String(999 * 21)), 'start do último clip');
  assert.ok(grab(xml, 'duration').includes(String(1000 * 21)), 'duração total');
});

test('convert: fps sobrescrevível por opção; default vem do koota.json', () => {
  const koota = makeKoota([clip(0, 1, 'x')], { fps: 25 });
  const r25 = core.convert(koota, makeEdl(SRC), { seqName: 'S' });
  assert.match(r25.xml, /<timebase>25<\/timebase>/);
  const r24 = core.convert(koota, makeEdl(SRC), { seqName: 'S', fps: 24 });
  assert.match(r24.xml, /<timebase>24<\/timebase>/);
  assert.doesNotMatch(r24.xml, /<timebase>25<\/timebase>/);
});

test('convert: nome da sequência com & e acento escapado', () => {
  const { xml } = core.convert(makeKoota([clip(0, 1)]), makeEdl(SRC), { seqName: 'Corte & Título' });
  assertWellFormed(xml);
  assert.ok(xml.includes('<name>Corte &amp; Título</name>'));
});

/* ───────── fallback p/ edl.json (projetos da época anterior) ───────── */

test('convert: koota.json sem clips cai para os ranges do edl.json com aviso', () => {
  const koota = makeKoota([]);
  const edl = makeEdl(SRC, [
    { source: 'R05', start: 21.69, end: 23.68, beat: '', quote: 'E o', reason: '' },
    { source: 'R05', start: 0.34, end: 9.74, beat: '', quote: 'Eu criei', reason: '' }
  ]);
  const { xml, warnings } = core.convert(koota, edl, { seqName: 'R05' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /edl\.json/);
  assert.match(xml, /<in>651<\/in>/);
});

test('convert: koota.json ausente (null) também cai para o edl.json', () => {
  const edl = makeEdl(SRC, [{ source: 'R05', start: 0, end: 2, beat: '', quote: 'x', reason: '' }]);
  const { xml, warnings } = core.convert(null, edl, { seqName: 'R05' });
  assert.equal(warnings.length, 1);
  assert.match(xml, /<timebase>30<\/timebase>/); /* defaults do modelo */
});

test('convert: koota.json COM clips ignora ranges defasados do edl.json (sem aviso)', () => {
  const koota = makeKoota([clip(0, 2, 'vivo')]);
  const edl = makeEdl(SRC, [{ source: 'R05', start: 5, end: 9, beat: '', quote: 'velho', reason: '' }]);
  const { xml, warnings } = core.convert(koota, edl, { seqName: 'R05' });
  assert.equal(warnings.length, 0);
  assert.match(xml, /<in>0<\/in>/);
  assert.doesNotMatch(xml, /<in>150<\/in>/);
});

/* ───────── sequence range markers (#16) ───────── */

function grabMarkers(xml) {
  const out = [];
  const re = /<marker>\s*<name>([^<]*)<\/name>\s*<comment>([^<]*)<\/comment>\s*<in>(\d+)<\/in>\s*<out>(\d+)<\/out>\s*<\/marker>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push({ name: m[1], comment: m[2], in: Number(m[3]), out: Number(m[4]) });
  }
  return out;
}

test('markers: exatamente 1 por clip, dentro de <sequence>, in/out = start/end do clipitem', () => {
  const koota = makeKoota([clip(21.69, 23.68, 'primeiro'), clip(0.34, 9.74, 'segundo')]);
  const { xml } = core.convert(koota, makeEdl(SRC), { seqName: 'R05' });
  const markers = grabMarkers(xml);
  assert.equal(markers.length, 2);
  /* offsets de saída: clip1 [0,59), clip2 [59,341) */
  assert.deepEqual({ in: markers[0].in, out: markers[0].out }, { in: 0, out: 59 });
  assert.deepEqual({ in: markers[1].in, out: markers[1].out }, { in: 59, out: 341 });
  /* todos dentro da <sequence>, não dos clips do bin */
  const seqPart = xml.slice(xml.indexOf('<sequence'));
  assert.equal((seqPart.match(/<marker>/g) || []).length, 2);
});

test('markers: sempre range (out > in), nunca ponto (out = -1)', () => {
  const clips = [];
  for (let i = 0; i < 50; i++) clips.push(clip(i * 3, i * 3 + 1.5, 'q' + i));
  const { xml } = core.convert(makeKoota(clips), makeEdl(SRC), { seqName: 'R05' });
  const markers = grabMarkers(xml);
  assert.equal(markers.length, 50);
  for (const m of markers) assert.ok(m.out > m.in, `marker in=${m.in} out=${m.out}`);
  assert.doesNotMatch(xml, /<out>-1<\/out>/);
});

test('markers: quote com acento/&/<>/aspas escapado; XML segue bem-formado', () => {
  const q = 'Sora & Runway: <corrida> da "IA" à atenção';
  const { xml } = core.convert(makeKoota([clip(0, 2, q)]), makeEdl(SRC), { seqName: 'R05' });
  assertWellFormed(xml);
  const markers = grabMarkers(xml);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].comment, 'Sora &amp; Runway: &lt;corrida&gt; da &quot;IA&quot; à atenção');
});

test('markers: quote vazio ganha nome de fallback com o nº do clip', () => {
  const { xml } = core.convert(makeKoota([clip(0, 1, ''), clip(2, 3, '')]), makeEdl(SRC), { seqName: 'R05' });
  const markers = grabMarkers(xml);
  assert.equal(markers[0].name, 'Clip 1');
  assert.equal(markers[1].name, 'Clip 2');
});

test('markers: quote longo é truncado no name mas inteiro no comment', () => {
  const long = 'palavra '.repeat(20).trim(); /* 159 chars */
  const { xml } = core.convert(makeKoota([clip(0, 2, long)]), makeEdl(SRC), { seqName: 'R05' });
  const m = grabMarkers(xml)[0];
  assert.equal(m.name.length, 60);
  assert.ok(m.name.endsWith('…'));
  assert.equal(m.comment, long);
});

/* ───────── CSV rascunho (#17) ───────── */

const titulos = require('../jsx/titulos-core.js');

test('csv: quote na coluna indicada, demais vazias; nº de linhas = nº de markers', () => {
  const koota = makeKoota([clip(0, 2, 'primeira manchete'), clip(3, 5, 'segunda')]);
  const r = core.convert(koota, makeEdl(SRC), {
    seqName: 'R05', csvHeader: 'Manchete,Subtítulo', csvQuoteCol: 'Manchete'
  });
  assert.ok(r.csv);
  const parsed = titulos.parseRows(r.csv);
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.fields, ['Manchete', 'Subtítulo']);
  assert.equal(parsed.rows.length, grabMarkers(r.xml).length);
  assert.equal(parsed.rows[0].values['Manchete'], 'primeira manchete');
  assert.equal(parsed.rows[0].values['Subtítulo'], '');
  assert.equal(parsed.rows[1].values['Manchete'], 'segunda');
});

test('csv: round-trip — vírgula, aspas e acento sobrevivem ao parser do painel', () => {
  const q1 = 'Sora, Runway e "Pika": à corrida da IA';
  const q2 = 'linha\ncom quebra';
  const r = core.convert(makeKoota([clip(0, 2, q1), clip(3, 5, q2)]), makeEdl(SRC), {
    seqName: 'R05', csvHeader: 'Manchete,Subtítulo'
  });
  const parsed = titulos.parseRows(r.csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows[0].values['Manchete'], q1);
  /* parseRows trima o valor; a quebra interna sobrevive */
  assert.equal(parsed.rows[1].values['Manchete'], q2);
});

test('csv: cabeçalho pt-BR com ; (Excel) mantém o delimitador', () => {
  const r = core.convert(makeKoota([clip(0, 2, 'texto; com ponto-e-vírgula')]), makeEdl(SRC), {
    seqName: 'R05', csvHeader: 'Manchete;Subtítulo'
  });
  const parsed = titulos.parseRows(r.csv);
  assert.equal(parsed.delimiter, ';');
  assert.equal(parsed.rows[0].values['Manchete'], 'texto; com ponto-e-vírgula');
});

test('csv: default da coluna do quote é a 1ª do cabeçalho', () => {
  const r = core.convert(makeKoota([clip(0, 2, 'olá')]), makeEdl(SRC), {
    seqName: 'R05', csvHeader: 'Título,Autor'
  });
  const parsed = titulos.parseRows(r.csv);
  assert.equal(parsed.rows[0].values['Título'], 'olá');
});

test('csv: começa com BOM e usa CRLF (Excel pt-BR)', () => {
  const r = core.convert(makeKoota([clip(0, 2, 'x')]), makeEdl(SRC), {
    seqName: 'R05', csvHeader: 'Manchete'
  });
  assert.equal(r.csv.charCodeAt(0), 0xFEFF);
  assert.match(r.csv, /\r\n/);
});

test('csv: coluna inexistente → erro claro com as colunas disponíveis', () => {
  assert.throws(
    () => core.convert(makeKoota([clip(0, 2, 'x')]), makeEdl(SRC), {
      seqName: 'R05', csvHeader: 'Manchete,Subtítulo', csvQuoteCol: 'Titulo'
    }),
    /Coluna "Titulo" não existe.*Manchete, Subtítulo/
  );
});

test('csv: sem csvHeader não gera CSV (csv = null)', () => {
  const r = core.convert(makeKoota([clip(0, 2, 'x')]), makeEdl(SRC), { seqName: 'R05' });
  assert.equal(r.csv, null);
});

test('buildCsv: cabeçalho vazio → erro', () => {
  assert.throws(() => core.buildCsv('', 'X', ['a']), /Cabeçalho.*vazio/);
});

test('CLI: --csv-header gera o CSV rascunho junto do XML', () => {
  const editDir = tmpProject(makeKoota([clip(0, 2, 'olá, mundo')]), makeEdl(SRC));
  const out = execFileSync(process.execPath,
    [CLI, editDir, '--csv-header', 'Manchete,Subtítulo', '--csv-quote-col', 'Manchete'],
    { encoding: 'utf8' });
  assert.match(out, /CSV rascunho gerado/);
  const csvPath = path.join(editDir, 'R05_titulos.csv');
  const parsed = titulos.parseRows(fs.readFileSync(csvPath, 'utf8'));
  assert.equal(parsed.rows[0].values['Manchete'], 'olá, mundo');
});

test('CLI: --csv sem --csv-header → exit 1', () => {
  const editDir = tmpProject(makeKoota([clip(0, 2)]), makeEdl(SRC));
  const r = spawnSync(process.execPath, [CLI, editDir, '--csv', 'x.csv'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--csv-header/);
});

/* ───────── validações ───────── */

test('convert: timeline vazia nos dois arquivos → erro claro', () => {
  assert.throws(() => core.convert(makeKoota([]), makeEdl(SRC, []), {}), /Timeline vazia/);
});

test('convert: fonte sem caminho no edl.json → erro claro com o nome da fonte', () => {
  assert.throws(
    () => core.convert(makeKoota([clip(0, 1, '', 'R99')]), makeEdl(SRC), {}),
    /Fonte "R99".*sources/
  );
});

test('convert: out <= in → erro com o nº do clip', () => {
  assert.throws(() => core.convert(makeKoota([clip(0, 1), clip(5, 5)]), makeEdl(SRC), {}), /Clip 2/);
  assert.throws(() => core.convert(makeKoota([clip(3, 2)]), makeEdl(SRC), {}), /Clip 1/);
});

test('convert: clip menor que 1 frame no fps escolhido → erro', () => {
  assert.throws(
    () => core.convert(makeKoota([clip(1.0, 1.01)]), makeEdl(SRC), { fps: 24 }),
    /menor que 1 frame/
  );
});

test('convert: fps não inteiro ou não divisor do tick rate → erro', () => {
  assert.throws(() => core.convert(makeKoota([clip(0, 1)]), makeEdl(SRC), { fps: 29.97 }), /fps inválido/);
});

test('convert: edl.json sem mapa sources → erro', () => {
  assert.throws(() => core.convert(makeKoota([clip(0, 1)]), { version: 1, ranges: [] }, {}), /sources/);
});

test('pathToUrl: exige caminho absoluto com letra de drive', () => {
  assert.throws(() => core.pathToUrl('videos/take.mp4'), /absoluto/);
  assert.equal(core.pathToUrl('D:\\a b\\c.mp4'), 'file://localhost/D%3a/a%20b/c.mp4');
});

/* ───────── multi-fonte (#18) ───────── */

const SRC2 = {
  R05: 'C:\\Videos\\R05.mp4',
  R09: 'C:\\Videos\\R09 (take extra).mp4'
};

test('multi-fonte: fontes intercaladas → um masterclip/file por fonte, na ordem de 1ª aparição', () => {
  const clips = [
    clip(0, 2, 'a', 'R05'),
    clip(1, 3, 'b', 'R09'),
    clip(4, 6, 'c', 'R05'),
    clip(5, 7, 'd', 'R09')
  ];
  const { xml } = core.convert(makeKoota(clips), makeEdl(SRC2), { seqName: 'Multi' });
  assertWellFormed(xml);

  /* 2 masterclips, na ordem de aparição (R05 primeiro) */
  assert.equal((xml.match(/<clip id="masterclip-/g) || []).length, 2);
  assert.ok(xml.indexOf('masterclip-1') < xml.indexOf('masterclip-2'));
  const mc1 = xml.indexOf('<clip id="masterclip-1"');
  const mc2 = xml.indexOf('<clip id="masterclip-2"');
  assert.ok(xml.slice(mc1, mc2).includes('R05.mp4'), 'masterclip-1 é o R05');
  assert.ok(xml.slice(mc2).includes('R09%20(take%20extra).mp4'), 'masterclip-2 é o R09');

  /* clipitems da sequência: 3 por segmento (v+a1+a2), 4 segmentos, + 6 do bin */
  assert.equal((xml.match(/<clipitem id="/g) || []).length, 6 + 12);
});

test('multi-fonte: cada <file> é definido UMA vez (com pathurl); resto é referência vazia', () => {
  const clips = [clip(0, 2, 'a', 'R05'), clip(1, 3, 'b', 'R09'), clip(4, 6, 'c', 'R05')];
  const { xml } = core.convert(makeKoota(clips), makeEdl(SRC2), { seqName: 'Multi' });

  assert.equal((xml.match(/<pathurl>/g) || []).length, 2, 'um pathurl por fonte');
  assert.equal((xml.match(/<file id="file-1">/g) || []).length, 1, 'file-1 definido 1x');
  assert.equal((xml.match(/<file id="file-2">/g) || []).length, 1, 'file-2 definido 1x');
  /* referências vazias: 3 por clipitem do bin de áudio + 3 por segmento */
  assert.ok((xml.match(/<file id="file-1"\/>/g) || []).length >= 3, 'refs vazias p/ file-1');
  assert.ok((xml.match(/<file id="file-2"\/>/g) || []).length >= 3, 'refs vazias p/ file-2');
});

test('multi-fonte: clipitem da sequência aponta p/ o file e o masterclip da SUA fonte', () => {
  const clips = [clip(0, 2, 'a', 'R05'), clip(1, 3, 'b', 'R09')];
  const { xml } = core.convert(makeKoota(clips), makeEdl(SRC2), { seqName: 'Multi' });

  /* recorta a track de vídeo da sequência e pega os 2 clipitems na ordem */
  const track = xml.slice(xml.indexOf('MZ.TrackTargeted="1">'));
  const items = track.split('<clipitem id="').slice(1, 3);
  assert.match(items[0], /<masterclipid>masterclip-1<\/masterclipid>/);
  assert.match(items[0], /<file id="file-1"\/>/);
  assert.match(items[0], /<name>R05\.mp4<\/name>/);
  assert.match(items[1], /<masterclipid>masterclip-2<\/masterclipid>/);
  assert.match(items[1], /<file id="file-2"\/>/);
});

test('multi-fonte: srcFrames por fonte = maior out usado daquela fonte', () => {
  const clips = [clip(0, 2, 'a', 'R05'), clip(1, 9.5, 'b', 'R09'), clip(4, 6, 'c', 'R05')];
  const { xml } = core.convert(makeKoota(clips), makeEdl(SRC2), { seqName: 'Multi' });
  const mc2 = xml.slice(xml.indexOf('<clip id="masterclip-2"'), xml.indexOf('<sequence'));
  assert.match(mc2, /<duration>285<\/duration>/); /* round(9.5*30) */
});

test('multi-fonte: fonte fora do mapa sources continua sendo erro claro', () => {
  const clips = [clip(0, 2, 'a', 'R05'), clip(1, 3, 'b', 'R77')];
  assert.throws(() => core.convert(makeKoota(clips), makeEdl(SRC2), {}), /Fonte "R77"/);
});

/* ───────── CLI de ponta a ponta ───────── */

const CLI = path.join(__dirname, '..', 'tools', 'koota2xmeml.js');

function tmpProject(koota, edl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'koota2xmeml-'));
  const editDir = path.join(dir, 'R05_edit');
  fs.mkdirSync(editDir);
  if (koota) fs.writeFileSync(path.join(editDir, 'koota.json'), JSON.stringify(koota), 'utf8');
  if (edl) fs.writeFileSync(path.join(editDir, 'edl.json'), JSON.stringify(edl), 'utf8');
  return editDir;
}

test('CLI: gera o XML na pasta do projeto com o nome da sequência', () => {
  const editDir = tmpProject(makeKoota([clip(0, 2, 'olá')]), makeEdl(SRC));
  const out = execFileSync(process.execPath, [CLI, editDir], { encoding: 'utf8' });
  assert.match(out, /XML gerado/);
  const xmlPath = path.join(editDir, 'R05_koota.xml');
  assert.ok(fs.existsSync(xmlPath), 'R05_koota.xml existe');
  const xml = fs.readFileSync(xmlPath, 'utf8');
  assert.match(xml, /<name>R05<\/name>/); /* _edit removido do nome */
  assertWellFormed(xml);
});

test('CLI: --out e --name personalizados', () => {
  const editDir = tmpProject(makeKoota([clip(0, 2)]), makeEdl(SRC));
  const outPath = path.join(editDir, 'custom.xml');
  execFileSync(process.execPath, [CLI, editDir, '--out', outPath, '--name', 'Melhores 01'], { encoding: 'utf8' });
  const xml = fs.readFileSync(outPath, 'utf8');
  assert.match(xml, /<name>Melhores 01<\/name>/);
});

test('CLI: sem edl.json → exit 1 e mensagem de erro', () => {
  const editDir = tmpProject(makeKoota([clip(0, 2)]), null);
  const r = spawnSync(process.execPath, [CLI, editDir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Erro: .*edl\.json/);
});

test('CLI: timeline vazia → exit 1 e "Timeline vazia"', () => {
  const editDir = tmpProject(makeKoota([]), makeEdl(SRC, []));
  const r = spawnSync(process.execPath, [CLI, editDir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Timeline vazia/);
});

test('CLI: fallback p/ edl.json imprime aviso mas gera o XML', () => {
  const edl = makeEdl(SRC, [{ source: 'R05', start: 0, end: 2, beat: '', quote: 'x', reason: '' }]);
  const editDir = tmpProject(makeKoota([]), edl);
  const r = spawnSync(process.execPath, [CLI, editDir], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Aviso: .*edl\.json/);
  assert.ok(fs.existsSync(path.join(editDir, 'R05_koota.xml')));
});

test('CLI: pasta inexistente → exit 1', () => {
  const r = spawnSync(process.execPath, [CLI, 'C:\\nao\\existe\\aqui_edit'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Pasta não encontrada/);
});
