#!/usr/bin/env node
'use strict';
/*
 * koota2xmeml.js — CLI do conversor Koota → XMEML (Fase 2, PRD #14).
 *
 * Uso:
 *   node tools/koota2xmeml.js <pasta _edit do projeto Koota> [opções]
 *
 * Opções:
 *   --out <arquivo.xml>   caminho do XML de saída (default: <pasta>\<nome>_koota.xml)
 *   --name <nome>         nome da sequência (default: nome da pasta sem o sufixo _edit)
 *   --fps <n>             timebase inteiro (default: fps do koota.json, senão 30)
 *   --width <n>           largura da sequência (default: do koota.json, senão 1080)
 *   --height <n>          altura da sequência (default: do koota.json, senão 1920)
 *
 * CSV rascunho (opcional — os quotes do Koota viram rascunho dos títulos):
 *   --csv-header "<linha>"  cabeçalho EXATO gerado pelo botão Diagnóstico do painel
 *   --csv-quote-col <col>   coluna que recebe o texto (default: a 1ª do cabeçalho)
 *   --csv <arquivo.csv>     caminho do CSV (default: <pasta>\<nome>_titulos.csv;
 *                           só é gerado se --csv-header for passado)
 *
 * Sai com código 0 em sucesso; 1 em erro (mensagem "Erro: …" no stderr).
 * Avisos não-fatais saem como "Aviso: …" no stderr.
 */

const fs = require('fs');
const path = require('path');
const core = require('./koota2xmeml-core.js');

function fail(msg) {
  process.stderr.write('Erro: ' + msg + '\n');
  process.exit(1);
}

const KNOWN_OPTS = ['out', 'name', 'fps', 'width', 'height', 'csv', 'csv-header', 'csv-quote-col'];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (!KNOWN_OPTS.includes(key)) fail(`Opção desconhecida: --${key}. Opções: ${KNOWN_OPTS.map((k) => '--' + k).join(', ')}.`);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) fail(`Opção --${key} precisa de um valor.`);
      args[key] = val;
      i++;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    /* EACCES/EBUSY etc. NÃO é "ausente" — cair no fallback geraria corte defasado */
    fail(`não consegui ler ${label} (${file}): ${e.message}`);
  }
  try {
    return { data: JSON.parse(text.replace(/^﻿/, '')) };  /* tolera BOM (U+FEFF, invisível) */
  } catch (e) {
    fail(`${label} não é um JSON válido (${file}): ${e.message}`);
  }
}

function intOpt(args, key) {
  if (args[key] === undefined) return undefined;
  const n = Number(args[key]);
  if (!Number.isInteger(n) || n <= 0) fail(`--${key} deve ser um inteiro positivo (recebi "${args[key]}").`);
  return n;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length !== 1) {
    process.stderr.write(
      'Uso: node tools/koota2xmeml.js <pasta _edit do projeto Koota> [--out arquivo.xml] [--name nome] [--fps n] [--width n] [--height n]\n'
    );
    process.exit(1);
  }

  const editDir = path.resolve(args._[0]);
  if (!fs.existsSync(editDir) || !fs.statSync(editDir).isDirectory()) {
    fail(`Pasta não encontrada: ${editDir}`);
  }

  const kootaRes = readJson(path.join(editDir, 'koota.json'), 'koota.json');
  const edlRes = readJson(path.join(editDir, 'edl.json'), 'edl.json');
  if (edlRes.missing) fail(`edl.json não encontrado em ${editDir} — ele é obrigatório (tem os caminhos das fontes).`);
  if (kootaRes.missing) process.stderr.write('Aviso: koota.json não encontrado — usando só o edl.json.\n');

  const dirName = path.basename(editDir);
  const seqName = args.name || (dirName.endsWith('_edit') ? dirName.slice(0, -'_edit'.length) : dirName);

  if ((args.csv !== undefined || args['csv-quote-col'] !== undefined) && args['csv-header'] === undefined) {
    fail('--csv/--csv-quote-col precisam de --csv-header (cole a linha gerada pelo botão Diagnóstico do painel).');
  }

  let result;
  try {
    result = core.convert(kootaRes.data || null, edlRes.data, {
      seqName,
      fps: intOpt(args, 'fps'),
      width: intOpt(args, 'width'),
      height: intOpt(args, 'height'),
      csvHeader: args['csv-header'],
      csvQuoteCol: args['csv-quote-col']
    });
  } catch (e) {
    fail(e.message);
  }

  for (const w of result.warnings) process.stderr.write('Aviso: ' + w + '\n');

  function writeOut(file, content) {
    try {
      fs.writeFileSync(file, content, 'utf8');
    } catch (e) {
      fail(`não consegui escrever ${file}: ${e.message}`);
    }
  }

  const outXml = args.out ? path.resolve(args.out) : path.join(editDir, seqName + '_koota.xml');
  writeOut(outXml, result.xml);
  process.stdout.write(`XML gerado: ${outXml}\n`);
  if (result.csv !== null) {
    const outCsv = args.csv ? path.resolve(args.csv) : path.join(editDir, seqName + '_titulos.csv');
    writeOut(outCsv, result.csv);
    process.stdout.write(`CSV rascunho gerado: ${outCsv}\n`);
  }
  process.stdout.write('Importe no Premiere via File > Import (a sequência chega com o corte e os markers).\n');
}

main();
