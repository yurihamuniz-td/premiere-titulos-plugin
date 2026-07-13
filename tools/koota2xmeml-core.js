'use strict';
/*
 * koota2xmeml-core.js — Lógica pura do conversor Koota → XMEML (XML FCP7).
 *
 * Fase 2 (PRD #14): gera uma sequência do Premiere com o primeiro corte do Koota.
 * NÃO depende do Premiere nem de pacotes externos — só Node builtin — para ser
 * testável com `npm test` como o resto da lógica pura do repo.
 *
 * Entrada (objetos já parseados):
 *   - koota: o koota.json do projeto (`{ timeline: { fps, width, height, tracks } }`).
 *     É a montagem viva (auto-salva a cada edição no Koota). Pode ser null.
 *   - edl:   o edl.json do projeto. Obrigatório: é o único lugar com o mapa
 *     `sources` (nome → caminho absoluto). Os `ranges` dele só são usados como
 *     FALLBACK quando a timeline do koota.json está vazia (projetos de uma época
 *     anterior do Koota guardavam a montagem só no edl.json) — nesse caso sai um
 *     aviso, porque o edl.json só é reescrito ao renderizar e pode estar defasado.
 *
 * Modelo de tempo: o Koota guarda in/out em SEGUNDOS FLOAT na fonte (fronteiras
 * de palavra, nem sempre alinhadas a frame). Aqui cada in/out vira FRAME INTEIRO
 * (arredondamento) no fps escolhido, e os offsets de saída são acumulados EM
 * FRAMES — nunca em segundos — para não acumular drift ao longo do vídeo.
 *
 * Estrutura do XML espelhada do gerador validado no Premiere
 * (ckonteos80/Claude-Soundbite-Editor): bin com um masterclip por fonte,
 * sequência com 1 track de vídeo + 2 de áudio linkadas por clip,
 * pproTicks = frames × (254016000000 ÷ fps), pathurl file://localhost/C%3a/…
 * com espaços como %20.
 */

const TICK_RATE = 254016000000; // ticks por segundo do Premiere
/* enum TimeDisplay do Premiere (MZ.Sequence.VideoTimeDisplayFormat):
 * 100=24, 101=25, 104=30, 105=50, 108=60. Também é a lista de fps aceitos. */
const VIDEO_TIME_FORMAT = { 24: 100, 25: 101, 30: 104, 50: 105, 60: 108 };

/* parser CSV do painel — reusado p/ interpretar o cabeçalho do Diagnóstico e
 * garantir round-trip exato com o que o painel vai ler depois */
const titulos = require('../jsx/titulos-core.js');

/* ───────────────────────── helpers ───────────────────────── */

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* C:\a b\c.mp4 → file://localhost/C%3a/a%20b/c.mp4
 * Regra do gerador de referência: só espaços viram %20; parênteses/acentos
 * ficam literais (confirmado funcionando no import do Premiere). */
function pathToUrl(winPath) {
  const p = String(winPath).replace(/\\/g, '/');
  if (p.length < 2 || p.charAt(1) !== ':') {
    throw new Error(`Caminho de fonte inválido (esperado caminho absoluto do Windows, ex.: C:\\…): "${winPath}"`);
  }
  const drive = p.charAt(0);
  /* % antes dos espaços, senão um "%" literal no nome vira escape inválido */
  const rest = p.slice(2).replace(/%/g, '%25').replace(/ /g, '%20');
  return `file://localhost/${drive}%3a${rest}`;
}

function basename(winPath) {
  const p = String(winPath).replace(/\\/g, '/');
  return p.slice(p.lastIndexOf('/') + 1);
}

/* UUID estável derivado do conteúdo (determinístico → testável).
 * O Premiere só precisa de unicidade dentro do arquivo. */
function pseudoUuid(str) {
  function fnv(s, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
  const hex = fnv(str, 0x811c9dc5) + fnv(str, 0x01000193) + fnv(str, 0xdeadbeef) + fnv(str, 0xcafebabe);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/* ───────────── extração da montagem (koota.json > edl.json) ───────────── */

/*
 * Devolve { clips: [{ sourceId, inSec, outSec, quote }], usedEdlFallback }.
 * Prioridade: timeline do koota.json (montagem viva). Fallback: ranges do
 * edl.json (projetos antigos / koota.json ausente), com aviso do chamador.
 */
function extractClips(koota, edl) {
  const tracks = (koota && koota.timeline && Array.isArray(koota.timeline.tracks))
    ? koota.timeline.tracks : [];
  const videoTrack = tracks.find((t) => t && t.kind === 'video');
  const kootaClips = (videoTrack && Array.isArray(videoTrack.clips)) ? videoTrack.clips : [];

  if (kootaClips.length > 0) {
    return {
      clips: kootaClips.map((c, i) => {
        if (!c || typeof c !== 'object') {
          throw new Error(`Clip ${i + 1} inválido no koota.json (arquivo truncado/corrompido?).`);
        }
        return {
          sourceId: c.sourceId,
          inSec: c.inSec,
          outSec: c.outSec,
          quote: typeof c.quote === 'string' ? c.quote : ''
        };
      }),
      usedEdlFallback: false
    };
  }

  const ranges = (edl && Array.isArray(edl.ranges)) ? edl.ranges : [];
  if (ranges.length > 0) {
    return {
      clips: ranges.map((r, i) => {
        if (!r || typeof r !== 'object') {
          throw new Error(`Range ${i + 1} inválido no edl.json (arquivo truncado/corrompido?).`);
        }
        return {
          sourceId: r.source,
          inSec: r.start,
          outSec: r.end,
          quote: typeof r.quote === 'string' ? r.quote : ''
        };
      }),
      usedEdlFallback: true
    };
  }

  throw new Error('Timeline vazia: o koota.json não tem clips e o edl.json não tem ranges. Monte o corte no Koota antes de converter.');
}

/* ───────────────── CSV rascunho (formato do Diagnóstico) ───────────────── */

/*
 * buildCsv(headerLine, quoteCol, quotes) -> string CSV (UTF-8 com BOM, CRLF)
 *
 * headerLine: a 1ª linha do CSV EXATAMENTE como o Diagnóstico gerou (é ela que
 *   define os nomes das colunas = display names do MOGRT e o delimitador).
 *   Vai para o arquivo verbatim — o painel exige que o cabeçalho bata.
 * quoteCol: nome da coluna que recebe o texto transcrito (default: a 1ª).
 * quotes: um texto por clip, na MESMA ordem dos markers do XML — assim as
 *   contagens marker↔linha batem por construção.
 */
function buildCsv(headerLine, quoteCol, quotes) {
  const header = titulos.stripBom(String(headerLine || '')).replace(/[\r\n]+$/, '');
  if (header.trim() === '') {
    throw new Error('Cabeçalho do CSV vazio — cole a linha gerada pelo botão Diagnóstico do painel.');
  }
  const delim = titulos.detectDelimiter(header);
  const fields = titulos.parseDelimited(header, delim)[0].map((f) => String(f).trim());
  while (fields.length && fields[fields.length - 1] === '') fields.pop();
  if (fields.length === 0) {
    throw new Error('Cabeçalho do CSV sem colunas — cole a linha gerada pelo Diagnóstico.');
  }

  const target = quoteCol === undefined || quoteCol === null || String(quoteCol).trim() === ''
    ? fields[0]
    : String(quoteCol).trim();
  if (target === '') {
    throw new Error('A 1ª coluna do cabeçalho está sem nome — cole o cabeçalho exato do Diagnóstico ou indique a coluna do texto com --csv-quote-col.');
  }
  const quoteIdx = fields.indexOf(target);
  if (quoteIdx < 0) {
    throw new Error(`Coluna "${target}" não existe no cabeçalho. Colunas disponíveis: ${fields.join(', ')}.`);
  }

  function escapeCell(v) {
    const s = String(v);
    if (s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const lines = quotes.map((q, n) => {
    /* quote vazio vira placeholder ("Clip N", igual ao marker) — uma linha
     * toda vazia seria DESCARTADA pelo parseRows do painel e quebraria a
     * contagem marker↔linha */
    const text = String(q || '').trim() || `Clip ${n + 1}`;
    const cells = fields.map((_, i) => (i === quoteIdx ? escapeCell(text) : ''));
    return cells.join(delim);
  });

  /* BOM (U+FEFF, invisível) p/ o Excel pt-BR abrir como UTF-8; o parser do painel remove */
  return '﻿' + header + '\r\n' + lines.join('\r\n') + '\r\n';
}

/* ───────────────────────── blocos do XML ───────────────────────── */

function rateXml(fps, indent) {
  const i = '\t'.repeat(indent);
  return `${i}<rate>\n${i}\t<timebase>${fps}</timebase>\n${i}\t<ntsc>FALSE</ntsc>\n${i}</rate>`;
}

function loggingXml(indent) {
  const i = '\t'.repeat(indent);
  return `${i}<logginginfo>\n${i}\t<description></description>\n${i}\t<scene></scene>\n${i}\t<shottake></shottake>\n${i}\t<lognote></lognote>\n${i}\t<good></good>\n${i}\t<originalvideofilename></originalvideofilename>\n${i}\t<originalaudiofilename></originalaudiofilename>\n${i}</logginginfo>`;
}

function colorinfoXml(indent) {
  const i = '\t'.repeat(indent);
  return `${i}<colorinfo>\n${i}\t<lut></lut>\n${i}\t<lut1></lut1>\n${i}\t<asc_sop></asc_sop>\n${i}\t<asc_sat></asc_sat>\n${i}\t<lut2></lut2>\n${i}</colorinfo>`;
}

/* três <link> amarrando vídeo + 2 canais de áudio do mesmo segmento */
function linksXml(vId, a1Id, a2Id, clipIndex, indent) {
  const i = '\t'.repeat(indent);
  return (
    `${i}<link>\n${i}\t<linkclipref>clipitem-${vId}</linkclipref>\n${i}\t<mediatype>video</mediatype>\n${i}\t<trackindex>1</trackindex>\n${i}\t<clipindex>${clipIndex}</clipindex>\n${i}</link>\n` +
    `${i}<link>\n${i}\t<linkclipref>clipitem-${a1Id}</linkclipref>\n${i}\t<mediatype>audio</mediatype>\n${i}\t<trackindex>1</trackindex>\n${i}\t<clipindex>${clipIndex}</clipindex>\n${i}\t<groupindex>1</groupindex>\n${i}</link>\n` +
    `${i}<link>\n${i}\t<linkclipref>clipitem-${a2Id}</linkclipref>\n${i}\t<mediatype>audio</mediatype>\n${i}\t<trackindex>2</trackindex>\n${i}\t<clipindex>${clipIndex}</clipindex>\n${i}\t<groupindex>1</groupindex>\n${i}</link>`
  );
}

function clipTailXml(indent) {
  const i = '\t'.repeat(indent);
  return `${loggingXml(indent)}\n${colorinfoXml(indent)}\n${i}<labels>\n${i}\t<label2>Iris</label2>\n${i}</labels>`;
}

/* clipitem de vídeo da SEQUÊNCIA (um por segmento do corte) */
function videoClipitemXml(seg, src, fps, ticksPerFrame) {
  const i = '\t'.repeat(7);
  return (
    `${i}<clipitem id="clipitem-${seg.vId}">\n` +
    `${i}\t<masterclipid>masterclip-${src.index + 1}</masterclipid>\n` +
    `${i}\t<name>${xmlEscape(src.filename)}</name>\n` +
    `${i}\t<enabled>TRUE</enabled>\n` +
    `${i}\t<duration>${src.srcFrames}</duration>\n` +
    `${rateXml(fps, 8)}\n` +
    `${i}\t<start>${seg.startF}</start>\n` +
    `${i}\t<end>${seg.endF}</end>\n` +
    `${i}\t<in>${seg.inF}</in>\n` +
    `${i}\t<out>${seg.outF}</out>\n` +
    `${i}\t<pproTicksIn>${seg.inF * ticksPerFrame}</pproTicksIn>\n` +
    `${i}\t<pproTicksOut>${seg.outF * ticksPerFrame}</pproTicksOut>\n` +
    `${i}\t<alphatype>none</alphatype>\n` +
    `${i}\t<file id="file-${src.index + 1}"/>\n` +
    `${linksXml(seg.vId, seg.a1Id, seg.a2Id, seg.n, 8)}\n` +
    `${clipTailXml(8)}\n` +
    `${i}</clipitem>`
  );
}

/* clipitem de áudio da SEQUÊNCIA (2 por segmento: canais 1 e 2) */
function audioClipitemXml(seg, src, fps, ticksPerFrame, channel) {
  const i = '\t'.repeat(7);
  const cid = channel === 1 ? seg.a1Id : seg.a2Id;
  return (
    `${i}<clipitem id="clipitem-${cid}" premiereChannelType="stereo">\n` +
    `${i}\t<masterclipid>masterclip-${src.index + 1}</masterclipid>\n` +
    `${i}\t<name>${xmlEscape(src.filename)}</name>\n` +
    `${i}\t<enabled>TRUE</enabled>\n` +
    `${i}\t<duration>${src.srcFrames}</duration>\n` +
    `${rateXml(fps, 8)}\n` +
    `${i}\t<start>${seg.startF}</start>\n` +
    `${i}\t<end>${seg.endF}</end>\n` +
    `${i}\t<in>${seg.inF}</in>\n` +
    `${i}\t<out>${seg.outF}</out>\n` +
    `${i}\t<pproTicksIn>${seg.inF * ticksPerFrame}</pproTicksIn>\n` +
    `${i}\t<pproTicksOut>${seg.outF * ticksPerFrame}</pproTicksOut>\n` +
    `${i}\t<file id="file-${src.index + 1}"/>\n` +
    `${i}\t<sourcetrack>\n${i}\t\t<mediatype>audio</mediatype>\n${i}\t\t<trackindex>${channel}</trackindex>\n${i}\t</sourcetrack>\n` +
    `${linksXml(seg.vId, seg.a1Id, seg.a2Id, seg.n, 8)}\n` +
    `${clipTailXml(8)}\n` +
    `${i}</clipitem>`
  );
}

/* masterclip do bin (um por fonte) — é onde o <file> é definido POR COMPLETO
 * (com pathurl); todos os clipitems da sequência só referenciam por id. */
function masterclipXml(src, fps, width, height) {
  const i = '\t'.repeat(3);
  const vId = src.mcVId, a1Id = src.mcA1Id, a2Id = src.mcA2Id;
  const name = xmlEscape(src.filename);
  return (
    `${i}<clip id="masterclip-${src.index + 1}" explodedTracks="true">\n` +
    `${i}\t<uuid>${pseudoUuid(src.path)}</uuid>\n` +
    `${i}\t<masterclipid>masterclip-${src.index + 1}</masterclipid>\n` +
    `${i}\t<ismasterclip>TRUE</ismasterclip>\n` +
    `${i}\t<duration>${src.srcFrames}</duration>\n` +
    `${rateXml(fps, 4)}\n` +
    `${i}\t<name>${name}</name>\n` +
    `${i}\t<media>\n` +
    `${i}\t\t<video>\n` +
    `${i}\t\t\t<track>\n` +
    `${i}\t\t\t\t<clipitem id="clipitem-${vId}">\n` +
    `${i}\t\t\t\t\t<masterclipid>masterclip-${src.index + 1}</masterclipid>\n` +
    `${i}\t\t\t\t\t<name>${name}</name>\n` +
    `${rateXml(fps, 8)}\n` +
    `${i}\t\t\t\t\t<alphatype>none</alphatype>\n` +
    `${i}\t\t\t\t\t<pixelaspectratio>square</pixelaspectratio>\n` +
    `${i}\t\t\t\t\t<anamorphic>FALSE</anamorphic>\n` +
    `${i}\t\t\t\t\t<file id="file-${src.index + 1}">\n` +
    `${i}\t\t\t\t\t\t<name>${name}</name>\n` +
    `${i}\t\t\t\t\t\t<pathurl>${xmlEscape(pathToUrl(src.path))}</pathurl>\n` +
    `${rateXml(fps, 9)}\n` +
    `${i}\t\t\t\t\t\t<duration>${src.srcFrames}</duration>\n` +
    `${i}\t\t\t\t\t\t<timecode>\n` +
    `${rateXml(fps, 10)}\n` +
    `${i}\t\t\t\t\t\t\t<string>00:00:00:00</string>\n` +
    `${i}\t\t\t\t\t\t\t<frame>0</frame>\n` +
    `${i}\t\t\t\t\t\t\t<displayformat>NDF</displayformat>\n` +
    `${i}\t\t\t\t\t\t</timecode>\n` +
    `${i}\t\t\t\t\t\t<media>\n` +
    `${i}\t\t\t\t\t\t\t<video>\n` +
    `${i}\t\t\t\t\t\t\t\t<samplecharacteristics>\n` +
    `${rateXml(fps, 12)}\n` +
    `${i}\t\t\t\t\t\t\t\t\t<width>${width}</width>\n` +
    `${i}\t\t\t\t\t\t\t\t\t<height>${height}</height>\n` +
    `${i}\t\t\t\t\t\t\t\t\t<anamorphic>FALSE</anamorphic>\n` +
    `${i}\t\t\t\t\t\t\t\t\t<pixelaspectratio>square</pixelaspectratio>\n` +
    `${i}\t\t\t\t\t\t\t\t\t<fielddominance>none</fielddominance>\n` +
    `${i}\t\t\t\t\t\t\t\t</samplecharacteristics>\n` +
    `${i}\t\t\t\t\t\t\t</video>\n` +
    `${i}\t\t\t\t\t\t\t<audio>\n` +
    `${i}\t\t\t\t\t\t\t\t<samplecharacteristics>\n` +
    `${i}\t\t\t\t\t\t\t\t\t<depth>16</depth>\n` +
    `${i}\t\t\t\t\t\t\t\t\t<samplerate>48000</samplerate>\n` +
    `${i}\t\t\t\t\t\t\t\t</samplecharacteristics>\n` +
    `${i}\t\t\t\t\t\t\t\t<channelcount>2</channelcount>\n` +
    `${i}\t\t\t\t\t\t\t</audio>\n` +
    `${i}\t\t\t\t\t\t</media>\n` +
    `${i}\t\t\t\t\t</file>\n` +
    `${linksXml(vId, a1Id, a2Id, 1, 8)}\n` +
    `${i}\t\t\t\t</clipitem>\n` +
    `${i}\t\t\t</track>\n` +
    `${i}\t\t</video>\n` +
    `${i}\t\t<audio>\n` +
    `${i}\t\t\t<track>\n` +
    `${i}\t\t\t\t<clipitem id="clipitem-${a1Id}">\n` +
    `${i}\t\t\t\t\t<masterclipid>masterclip-${src.index + 1}</masterclipid>\n` +
    `${i}\t\t\t\t\t<name>${name}</name>\n` +
    `${rateXml(fps, 8)}\n` +
    `${i}\t\t\t\t\t<file id="file-${src.index + 1}"/>\n` +
    `${i}\t\t\t\t\t<sourcetrack>\n${i}\t\t\t\t\t\t<mediatype>audio</mediatype>\n${i}\t\t\t\t\t\t<trackindex>1</trackindex>\n${i}\t\t\t\t\t</sourcetrack>\n` +
    `${linksXml(vId, a1Id, a2Id, 1, 8)}\n` +
    `${i}\t\t\t\t</clipitem>\n` +
    `${i}\t\t\t</track>\n` +
    `${i}\t\t\t<track>\n` +
    `${i}\t\t\t\t<clipitem id="clipitem-${a2Id}">\n` +
    `${i}\t\t\t\t\t<masterclipid>masterclip-${src.index + 1}</masterclipid>\n` +
    `${i}\t\t\t\t\t<name>${name}</name>\n` +
    `${rateXml(fps, 8)}\n` +
    `${i}\t\t\t\t\t<file id="file-${src.index + 1}"/>\n` +
    `${i}\t\t\t\t\t<sourcetrack>\n${i}\t\t\t\t\t\t<mediatype>audio</mediatype>\n${i}\t\t\t\t\t\t<trackindex>2</trackindex>\n${i}\t\t\t\t\t</sourcetrack>\n` +
    `${linksXml(vId, a1Id, a2Id, 1, 8)}\n` +
    `${i}\t\t\t\t</clipitem>\n` +
    `${i}\t\t\t</track>\n` +
    `${i}\t\t</audio>\n` +
    `${i}\t</media>\n` +
    `${loggingXml(4)}\n` +
    `${colorinfoXml(4)}\n` +
    `${i}\t<labels>\n${i}\t\t<label2>Iris</label2>\n${i}\t</labels>\n` +
    `${i}</clip>`
  );
}

/* sequence range marker (um por clip do corte) — é o que o painel consome no
 * Aplicar. Pela spec FCP7: out > in define um RANGE; out = -1 seria ponto.
 * name = quote truncado (legível na timeline), comment = quote inteiro. */
function markerXml(seg) {
  const i = '\t'.repeat(4);
  const quote = String(seg.quote || '').replace(/\s+/g, ' ').trim();
  const name = quote === '' ? `Clip ${seg.n}` : (quote.length > 60 ? quote.slice(0, 59) + '…' : quote);
  return (
    `${i}<marker>\n` +
    `${i}\t<name>${xmlEscape(name)}</name>\n` +
    `${i}\t<comment>${xmlEscape(quote)}</comment>\n` +
    `${i}\t<in>${seg.startF}</in>\n` +
    `${i}\t<out>${seg.endF}</out>\n` +
    `${i}</marker>`
  );
}

const AUDIO_TRACK_ATTRS =
  'TL.SQTrackAudioKeyframeStyle="0" TL.SQTrackShy="0" ' +
  'TL.SQTrackExpandedHeight="41" TL.SQTrackExpanded="0" ' +
  'MZ.TrackTargeted="1" PannerCurrentValue="0.5" ' +
  'PannerIsInverted="true" ' +
  'PannerStartKeyframe="-91445760000000000,0.5,0,0,0,0,0,0" ' +
  'PannerName="Balance" currentExplodedTrackIndex="{ei}" ' +
  'totalExplodedTrackCount="2" premiereTrackType="Stereo"';

function emptyAudioTrackXml(explodedIdx, outCh) {
  const i = '\t'.repeat(6);
  const attrs = AUDIO_TRACK_ATTRS.replace('{ei}', String(explodedIdx));
  return `${i}<track ${attrs}>\n${i}\t<enabled>TRUE</enabled>\n${i}\t<locked>FALSE</locked>\n${i}\t<outputchannelindex>${outCh}</outputchannelindex>\n${i}</track>`;
}

/* ───────────────────────── conversão ───────────────────────── */

/*
 * convert(koota, edl, opts) -> { xml, warnings }
 *
 * opts: {
 *   seqName?  nome da sequência (default 'Koota Cut')
 *   fps?      timebase inteiro (default: timeline.fps do koota.json, senão 30)
 *   width?, height?  dimensões da sequência (default: timeline do koota.json,
 *                    senão 1080×1920 — o default do modelo do Koota)
 *   csvHeader?    cabeçalho do Diagnóstico → gera também o CSV rascunho
 *   csvQuoteCol?  coluna que recebe o quote (default: a 1ª do cabeçalho)
 * }
 * Retorna { xml, csv, warnings } — csv é null sem csvHeader.
 */
function convert(koota, edl, opts) {
  opts = opts || {};
  const warnings = [];

  if (!edl || typeof edl !== 'object') {
    throw new Error('edl.json ausente ou inválido — ele é obrigatório (é o único arquivo com os caminhos das fontes).');
  }
  const sourcesMap = edl.sources;
  if (!sourcesMap || typeof sourcesMap !== 'object' || Object.keys(sourcesMap).length === 0) {
    throw new Error('edl.json sem o mapa "sources" (nome → caminho absoluto da fonte).');
  }

  const { clips, usedEdlFallback } = extractClips(koota, edl);
  if (usedEdlFallback) {
    warnings.push('koota.json sem clips — usando os ranges do edl.json (que só é atualizado ao renderizar no Koota; confira se o corte está atual).');
  }

  const timeline = (koota && koota.timeline) || {};
  const fps = opts.fps !== undefined ? opts.fps : (timeline.fps !== undefined ? timeline.fps : 30);
  if (!Number.isInteger(fps) || VIDEO_TIME_FORMAT[fps] === undefined) {
    throw new Error(`fps inválido: ${fps}. Use um timebase suportado: 24, 25, 30, 50 ou 60. NTSC/29.97 está fora do MVP.`);
  }
  const width = opts.width !== undefined ? opts.width : (timeline.width !== undefined ? timeline.width : 1080);
  const height = opts.height !== undefined ? opts.height : (timeline.height !== undefined ? timeline.height : 1920);
  const seqName = opts.seqName || 'Koota Cut';
  const ticksPerFrame = TICK_RATE / fps;

  /* fontes na ordem de primeira aparição na timeline */
  const srcByld = new Map();
  const sources = [];
  for (const c of clips) {
    if (!srcByld.has(c.sourceId)) {
      const path = sourcesMap[c.sourceId];
      if (typeof path !== 'string' || path === '') {
        throw new Error(`Fonte "${c.sourceId}" usada na timeline não tem caminho no mapa "sources" do edl.json.`);
      }
      const src = {
        id: c.sourceId,
        index: sources.length,
        path,
        filename: basename(path),
        srcFrames: 0,
        mcVId: 0, mcA1Id: 0, mcA2Id: 0
      };
      srcByld.set(c.sourceId, src);
      sources.push(src);
    }
  }

  /* segmentos: seg→frames com offsets cumulativos EM FRAMES (sem drift) */
  const segs = [];
  let cursorF = 0;
  for (let idx = 0; idx < clips.length; idx++) {
    const c = clips[idx];
    const n = idx + 1;
    if (typeof c.inSec !== 'number' || typeof c.outSec !== 'number' || !isFinite(c.inSec) || !isFinite(c.outSec) || c.inSec < 0) {
      throw new Error(`Clip ${n}: in/out inválidos (in=${c.inSec}, out=${c.outSec}).`);
    }
    if (c.outSec <= c.inSec) {
      throw new Error(`Clip ${n}: out (${c.outSec}s) deve ser maior que in (${c.inSec}s).`);
    }
    const inF = Math.round(c.inSec * fps);
    const outF = Math.round(c.outSec * fps);
    const dur = outF - inF;
    if (dur <= 0) {
      throw new Error(`Clip ${n}: duração menor que 1 frame a ${fps} fps (in=${c.inSec}s, out=${c.outSec}s).`);
    }
    const src = srcByld.get(c.sourceId);
    if (outF > src.srcFrames) src.srcFrames = outF;
    segs.push({
      n, src, quote: c.quote,
      inF, outF, dur,
      startF: cursorF, endF: cursorF + dur,
      vId: 0, a1Id: 0, a2Id: 0
    });
    cursorF += dur;
  }
  const seqDurF = cursorF;
  const seqDurTicks = seqDurF * ticksPerFrame;

  /* ids numéricos: primeiro os 3 clipitems do masterclip de cada fonte,
   * depois os da sequência (todos os de vídeo, depois áudio 1, depois áudio 2 —
   * mesmo layout do gerador de referência) */
  let nextId = 1;
  for (const src of sources) { src.mcVId = nextId++; src.mcA1Id = nextId++; src.mcA2Id = nextId++; }
  for (const seg of segs) seg.vId = nextId++;
  for (const seg of segs) seg.a1Id = nextId++;
  for (const seg of segs) seg.a2Id = nextId++;

  const vtf = VIDEO_TIME_FORMAT[fps];
  const masterclips = sources.map((s) => masterclipXml(s, fps, width, height)).join('\n');
  const videoClips = segs.map((s) => videoClipitemXml(s, s.src, fps, ticksPerFrame)).join('\n');
  const audio1Clips = segs.map((s) => audioClipitemXml(s, s.src, fps, ticksPerFrame, 1)).join('\n');
  const audio2Clips = segs.map((s) => audioClipitemXml(s, s.src, fps, ticksPerFrame, 2)).join('\n');
  const a1Attrs = AUDIO_TRACK_ATTRS.replace('{ei}', '0');
  const a2Attrs = AUDIO_TRACK_ATTRS.replace('{ei}', '1');
  const emptyTracks = [
    emptyAudioTrackXml(0, 1), emptyAudioTrackXml(1, 2),
    emptyAudioTrackXml(0, 1), emptyAudioTrackXml(1, 2)
  ].join('\n');
  const markers = segs.map((s) => markerXml(s)).join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE xmeml>\n' +
    '<xmeml version="4">\n' +
    '\t<bin>\n' +
    '\t\t<name>Koota</name>\n' +
    '\t\t<labels>\n' +
    '\t\t\t<label2>Mango</label2>\n' +
    '\t\t</labels>\n' +
    '\t\t<children>\n' +
    `${masterclips}\n` +
    `\t\t\t<sequence id="sequence-1" TL.SQAudioVisibleBase="0" TL.SQVideoVisibleBase="0" TL.SQVisibleBaseTime="0" TL.SQAVDividerPosition="0.5" TL.SQHideShyTracks="0" TL.SQHeaderWidth="204" Monitor.ProgramZoomOut="${seqDurTicks}" Monitor.ProgramZoomIn="0" TL.SQTimePerPixel="0.47076036866359444" MZ.EditLine="0" MZ.Sequence.PreviewFrameSizeHeight="${height}" MZ.Sequence.PreviewFrameSizeWidth="${width}" MZ.Sequence.AudioTimeDisplayFormat="200" MZ.Sequence.PreviewRenderingClassID="1061109567" MZ.Sequence.PreviewRenderingPresetCodec="1634755443" MZ.Sequence.PreviewRenderingPresetPath="EncoderPresets\\SequencePreview\\9678af98-a7b7-4bdb-b477-7ac9c8df4a4e\\QuickTime.epr" MZ.Sequence.PreviewUseMaxRenderQuality="false" MZ.Sequence.PreviewUseMaxBitDepth="false" MZ.Sequence.EditingModeGUID="9678af98-a7b7-4bdb-b477-7ac9c8df4a4e" MZ.Sequence.VideoTimeDisplayFormat="${vtf}" MZ.WorkOutPoint="${seqDurTicks}" MZ.WorkInPoint="0" explodedTracks="true">\n` +
    `\t\t\t\t<uuid>${pseudoUuid(seqName)}</uuid>\n` +
    `\t\t\t\t<duration>${seqDurF}</duration>\n` +
    `${rateXml(fps, 4)}\n` +
    `\t\t\t\t<name>${xmlEscape(seqName)}</name>\n` +
    '\t\t\t\t<media>\n' +
    '\t\t\t\t\t<video>\n' +
    '\t\t\t\t\t\t<format>\n' +
    '\t\t\t\t\t\t\t<samplecharacteristics>\n' +
    `${rateXml(fps, 8)}\n` +
    '\t\t\t\t\t\t\t\t<codec>\n' +
    '\t\t\t\t\t\t\t\t\t<name>Apple ProRes 422</name>\n' +
    '\t\t\t\t\t\t\t\t\t<appspecificdata>\n' +
    '\t\t\t\t\t\t\t\t\t\t<appname>Final Cut Pro</appname>\n' +
    '\t\t\t\t\t\t\t\t\t\t<appmanufacturer>Apple Inc.</appmanufacturer>\n' +
    '\t\t\t\t\t\t\t\t\t\t<appversion>7.0</appversion>\n' +
    '\t\t\t\t\t\t\t\t\t\t<data>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t<qtcodec>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<codecname>Apple ProRes 422</codecname>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<codectypename>Apple ProRes 422</codectypename>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<codectypecode>apcn</codectypecode>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<codecvendorcode>appl</codecvendorcode>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<spatialquality>1024</spatialquality>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<temporalquality>0</temporalquality>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<keyframerate>0</keyframerate>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\t<datarate>0</datarate>\n' +
    '\t\t\t\t\t\t\t\t\t\t\t</qtcodec>\n' +
    '\t\t\t\t\t\t\t\t\t\t</data>\n' +
    '\t\t\t\t\t\t\t\t\t</appspecificdata>\n' +
    '\t\t\t\t\t\t\t\t</codec>\n' +
    `\t\t\t\t\t\t\t\t<width>${width}</width>\n` +
    `\t\t\t\t\t\t\t\t<height>${height}</height>\n` +
    '\t\t\t\t\t\t\t\t<anamorphic>FALSE</anamorphic>\n' +
    '\t\t\t\t\t\t\t\t<pixelaspectratio>square</pixelaspectratio>\n' +
    '\t\t\t\t\t\t\t\t<fielddominance>none</fielddominance>\n' +
    '\t\t\t\t\t\t\t\t<colordepth>24</colordepth>\n' +
    '\t\t\t\t\t\t\t</samplecharacteristics>\n' +
    '\t\t\t\t\t\t</format>\n' +
    '\t\t\t\t\t\t<track TL.SQTrackShy="0" TL.SQTrackExpandedHeight="41" TL.SQTrackExpanded="0" MZ.TrackTargeted="1">\n' +
    `${videoClips}\n` +
    '\t\t\t\t\t\t\t<enabled>TRUE</enabled>\n' +
    '\t\t\t\t\t\t\t<locked>FALSE</locked>\n' +
    '\t\t\t\t\t\t</track>\n' +
    '\t\t\t\t\t\t<track TL.SQTrackShy="0" TL.SQTrackExpandedHeight="41" TL.SQTrackExpanded="0" MZ.TrackTargeted="0">\n' +
    '\t\t\t\t\t\t\t<enabled>TRUE</enabled>\n' +
    '\t\t\t\t\t\t\t<locked>FALSE</locked>\n' +
    '\t\t\t\t\t\t</track>\n' +
    '\t\t\t\t\t\t<track TL.SQTrackShy="0" TL.SQTrackExpandedHeight="41" TL.SQTrackExpanded="0" MZ.TrackTargeted="0">\n' +
    '\t\t\t\t\t\t\t<enabled>TRUE</enabled>\n' +
    '\t\t\t\t\t\t\t<locked>FALSE</locked>\n' +
    '\t\t\t\t\t\t</track>\n' +
    '\t\t\t\t\t</video>\n' +
    '\t\t\t\t\t<audio>\n' +
    '\t\t\t\t\t\t<numOutputChannels>2</numOutputChannels>\n' +
    '\t\t\t\t\t\t<format>\n' +
    '\t\t\t\t\t\t\t<samplecharacteristics>\n' +
    '\t\t\t\t\t\t\t\t<depth>16</depth>\n' +
    '\t\t\t\t\t\t\t\t<samplerate>48000</samplerate>\n' +
    '\t\t\t\t\t\t\t</samplecharacteristics>\n' +
    '\t\t\t\t\t\t</format>\n' +
    '\t\t\t\t\t\t<outputs>\n' +
    '\t\t\t\t\t\t\t<group>\n' +
    '\t\t\t\t\t\t\t\t<index>1</index>\n' +
    '\t\t\t\t\t\t\t\t<numchannels>1</numchannels>\n' +
    '\t\t\t\t\t\t\t\t<downmix>0</downmix>\n' +
    '\t\t\t\t\t\t\t\t<channel>\n' +
    '\t\t\t\t\t\t\t\t\t<index>1</index>\n' +
    '\t\t\t\t\t\t\t\t</channel>\n' +
    '\t\t\t\t\t\t\t</group>\n' +
    '\t\t\t\t\t\t\t<group>\n' +
    '\t\t\t\t\t\t\t\t<index>2</index>\n' +
    '\t\t\t\t\t\t\t\t<numchannels>1</numchannels>\n' +
    '\t\t\t\t\t\t\t\t<downmix>0</downmix>\n' +
    '\t\t\t\t\t\t\t\t<channel>\n' +
    '\t\t\t\t\t\t\t\t\t<index>2</index>\n' +
    '\t\t\t\t\t\t\t\t</channel>\n' +
    '\t\t\t\t\t\t\t</group>\n' +
    '\t\t\t\t\t\t</outputs>\n' +
    `\t\t\t\t\t\t<track ${a1Attrs}>\n` +
    `${audio1Clips}\n` +
    '\t\t\t\t\t\t\t<enabled>TRUE</enabled>\n' +
    '\t\t\t\t\t\t\t<locked>FALSE</locked>\n' +
    '\t\t\t\t\t\t\t<outputchannelindex>1</outputchannelindex>\n' +
    '\t\t\t\t\t\t</track>\n' +
    `\t\t\t\t\t\t<track ${a2Attrs}>\n` +
    `${audio2Clips}\n` +
    '\t\t\t\t\t\t\t<enabled>TRUE</enabled>\n' +
    '\t\t\t\t\t\t\t<locked>FALSE</locked>\n' +
    '\t\t\t\t\t\t\t<outputchannelindex>2</outputchannelindex>\n' +
    '\t\t\t\t\t\t</track>\n' +
    `${emptyTracks}\n` +
    '\t\t\t\t\t</audio>\n' +
    '\t\t\t\t</media>\n' +
    '\t\t\t\t<timecode>\n' +
    `${rateXml(fps, 5)}\n` +
    '\t\t\t\t\t<string>00:00:00:00</string>\n' +
    '\t\t\t\t\t<frame>0</frame>\n' +
    '\t\t\t\t\t<displayformat>NDF</displayformat>\n' +
    '\t\t\t\t</timecode>\n' +
    `${markers}\n` +
    '\t\t\t\t<labels>\n' +
    '\t\t\t\t\t<label2>Forest</label2>\n' +
    '\t\t\t\t</labels>\n' +
    `${loggingXml(4)}\n` +
    '\t\t\t</sequence>\n' +
    '\t\t</children>\n' +
    '\t</bin>\n' +
    '</xmeml>\n';

  /* CSV rascunho (opcional): uma linha por clip, na ordem dos markers */
  const csv = opts.csvHeader !== undefined
    ? buildCsv(opts.csvHeader, opts.csvQuoteCol, segs.map((s) => s.quote))
    : null;

  return { xml, csv, warnings };
}

/* ───────── export p/ Node ───────── */
module.exports = {
  TICK_RATE,
  xmlEscape,
  pathToUrl,
  basename,
  pseudoUuid,
  extractClips,
  buildCsv,
  convert
};
