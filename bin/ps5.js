#!/usr/bin/env node
// Spec 001: o PS5 pelo terminal.
//   ps5 status                  busca na rede toda
//   ps5 status --ip 192.168.1.10 --json
import { isIPv4 } from 'node:net';
import { parseArgs } from 'node:util';
import { buscar } from '../src/descoberta.js';

// Os códigos do status são os do `playactor check`, para usar em script. 64 e 70 são os do sysexits.h.
const SAIDA = { ligado: 0, repouso: 1, naoEncontrado: 2, uso: 64, erro: 70 };
const TEMPO_DA_BUSCA_MS = 3000;

const USO = `Uso: ps5 <comando> [opções]

  status [--ip X] [--json]    se o PS5 está ligado ou em repouso
                              sai com 0 ligado, 1 repouso, 2 não encontrado

Ainda por fazer (spec 001): registrar (E2), acordar (E3), repousar (E4).`;

const POR_FAZER = { registrar: 'E2', acordar: 'E3', repousar: 'E4' };

process.exitCode = await principal();

async function principal() {
  let argumentos;
  try {
    argumentos = parseArgs({
      allowPositionals: true,
      options: { ip: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (erro) {
    return falhar(SAIDA.uso, `${erro.message}\n\n${USO}`);
  }
  const { values: opcoes, positionals: [comando, ...sobra] } = argumentos;

  if (opcoes.help) {
    console.log(USO);
    return 0;
  }
  if (!comando) return falhar(SAIDA.uso, USO);
  if (POR_FAZER[comando]) return falhar(SAIDA.uso, `"${comando}" ainda não existe: chega na ${POR_FAZER[comando]} da spec 001.`);
  if (comando !== 'status') return falhar(SAIDA.uso, `Comando desconhecido: ${comando}\n\n${USO}`);
  if (sobra.length) return falhar(SAIDA.uso, `Argumento a mais: ${sobra.join(' ')}`);
  if (opcoes.ip !== undefined && !isIPv4(opcoes.ip)) return falhar(SAIDA.uso, `--ip precisa ser um IPv4, e veio "${opcoes.ip}".`);

  return status(opcoes);
}

async function status({ ip, json }) {
  let consoles;
  try {
    consoles = await buscar({ ip, tempoMs: TEMPO_DA_BUSCA_MS });
  } catch (erro) {
    return falhar(SAIDA.erro, `A busca falhou: ${erro.message}`);
  }

  if (json) {
    // Sempre uma lista, mesmo com um console só ou nenhum: o código não supõe que há um PS5 só.
    console.log(JSON.stringify(consoles.map(({ campos, ...ps5 }) => ps5), null, 2));
  } else if (consoles.length === 0) {
    console.error(`Nenhum PS5 respondeu ${ip ? `em ${ip}` : 'na rede'} em ${TEMPO_DA_BUSCA_MS / 1000} s.`);
    console.error('Ele pode estar desligado de vez, ou em repouso sem "permanecer conectado à internet".');
  } else {
    for (const ps5 of consoles) console.log(descrever(ps5));
  }

  // Com mais de um console, basta um ligado para o status ser "ligado". Um código que o protocolo não
  // documenta cai no 2: o console está lá, mas não dá para dizer em que estado.
  if (consoles.some((ps5) => ps5.estado === 'ligado')) return SAIDA.ligado;
  if (consoles.some((ps5) => ps5.estado === 'repouso')) return SAIDA.repouso;
  return SAIDA.naoEncontrado;
}

function descrever(ps5) {
  const estado = { ligado: 'está ligado', repouso: 'está em repouso' }[ps5.estado]
    ?? `respondeu "${ps5.codigo} ${ps5.motivo}", um estado que não conheço`;
  const detalhes = [ps5.ip, ps5.sistema && `sistema ${ps5.sistema}`].filter(Boolean).join(', ');
  return `${ps5.nome ?? ps5.id} ${estado} (${detalhes})`;
}

function falhar(codigo, mensagem) {
  console.error(mensagem);
  return codigo;
}
