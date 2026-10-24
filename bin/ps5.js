#!/usr/bin/env node
// Spec 001: o PS5 pelo terminal.
//   ps5 status                  busca na rede toda
//   ps5 status --ip 192.168.1.10 --json
//   ps5 registrar               uma vez, com o PS5 ligado e a tela do PIN à mão
import { isIPv4 } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { buscar } from '../src/descoberta.js';

// Os códigos do status são os do `playactor check`, para usar em script. 64 e 70 são os do sysexits.h.
const SAIDA = { ligado: 0, repouso: 1, naoEncontrado: 2, uso: 64, erro: 70 };
const TEMPO_DA_BUSCA_MS = 3000;

const USO = `Uso: ps5 <comando> [opções]

  status [--ip X] [--json]    se o PS5 está ligado ou em repouso
                              sai com 0 ligado, 1 repouso, 2 não encontrado
  registrar [--ip X]          registra este computador no PS5 (login na PSN + PIN), uma vez só
            [--de-novo]       registra outra vez, mesmo já havendo credencial
                              sai com 0 registrado, 1 em repouso, 2 não encontrado, 70 falhou

Ainda por fazer (spec 001): acordar (E3), repousar (E4).`;

const POR_FAZER = { acordar: 'E3', repousar: 'E4' };
const COMANDOS = { status, registrar: registrarConsole };

process.exitCode = await principal();

async function principal() {
  let argumentos;
  try {
    argumentos = parseArgs({
      allowPositionals: true,
      options: {
        ip: { type: 'string' },
        json: { type: 'boolean' },
        'de-novo': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
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
  if (!COMANDOS[comando]) return falhar(SAIDA.uso, `Comando desconhecido: ${comando}\n\n${USO}`);
  if (sobra.length) return falhar(SAIDA.uso, `Argumento a mais: ${sobra.join(' ')}`);
  if (opcoes.ip !== undefined && !isIPv4(opcoes.ip)) return falhar(SAIDA.uso, `--ip precisa ser um IPv4, e veio "${opcoes.ip}".`);

  try {
    return await COMANDOS[comando](opcoes);
  } catch (erro) {
    return falhar(SAIDA.erro, `Falhou: ${erro.message}`);
  }
}

async function status({ ip, json }) {
  const consoles = await buscar({ ip, tempoMs: TEMPO_DA_BUSCA_MS });

  if (json) {
    // Sempre uma lista, mesmo com um console só ou nenhum: o código não supõe que há um PS5 só.
    console.log(JSON.stringify(consoles.map(({ campos, ...ps5 }) => ps5), null, 2));
  } else if (consoles.length === 0) {
    console.error(naoRespondeu(ip));
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

async function registrarConsole({ ip, 'de-novo': deNovo }) {
  // Antes da rede: sem terminal não há onde colar a URL nem digitar o PIN, e o comando ficaria esperando.
  if (!process.stdin.isTTY) return falhar(SAIDA.uso, 'O registro é interativo: rode num terminal (no notebook, entre com "ssh notebook").');

  const consoles = await buscar({ ip, tempoMs: TEMPO_DA_BUSCA_MS });
  if (consoles.length === 0) return falhar(SAIDA.naoEncontrado, naoRespondeu(ip));
  if (consoles.length > 1) {
    return falhar(SAIDA.uso, `Há mais de um PS5 na rede; escolha com --ip: ${consoles.map((ps5) => `${ps5.nome} (${ps5.ip})`).join(', ')}.`);
  }
  const [ps5] = consoles;
  if (ps5.estado !== 'ligado') {
    return falhar(SAIDA.repouso, `${ps5.nome} está em repouso. O registro precisa dele ligado, para mostrar o PIN: ligue pelo controle (acordar pela rede é a E3, que depende deste registro).`);
  }

  const { caminhoPadrao, ler } = await import('../src/credencial.js');
  if (!deNovo && (await ler(ps5.id))) {
    console.log(`${ps5.nome} já está registrado (${caminhoPadrao()}). Para registrar outra vez: ps5 registrar --de-novo`);
    return 0;
  }

  // Só aqui o playactor é carregado: o status não paga por ele.
  const { explicarErro, registrar } = await import('../src/registro.js');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  // Com o readline aberto e sem quem ouça o SIGINT, o Ctrl+C só pausa a entrada, e o comando fica parado.
  terminal.on('SIGINT', () => {
    terminal.close();
    process.exit(130);
  });
  try {
    console.log(`Registrando este computador no ${ps5.nome} (${ps5.ip}).\n`);
    await registrar(ps5, { escrever: (texto) => console.log(texto), perguntar: (texto) => terminal.question(texto) });
  } catch (erro) {
    return falhar(SAIDA.erro, `O registro falhou: ${explicarErro(erro)}`);
  } finally {
    terminal.close();
  }
  const protecao = process.platform === 'win32' ? 'na pasta do seu usuário' : 'com permissão 600';
  console.log(`\n${ps5.nome} registrado. A credencial está em ${caminhoPadrao()}, ${protecao}. Ela vale como senha.`);
  return 0;
}

function descrever(ps5) {
  const estado = { ligado: 'está ligado', repouso: 'está em repouso' }[ps5.estado]
    ?? `respondeu "${ps5.codigo} ${ps5.motivo}", um estado que não conheço`;
  const detalhes = [ps5.ip, ps5.sistema && `sistema ${ps5.sistema}`].filter(Boolean).join(', ');
  return `${ps5.nome ?? ps5.id} ${estado} (${detalhes})`;
}

function naoRespondeu(ip) {
  return `Nenhum PS5 respondeu ${ip ? `em ${ip}` : 'na rede'} em ${TEMPO_DA_BUSCA_MS / 1000} s.`;
}

function falhar(codigo, mensagem) {
  console.error(mensagem);
  return codigo;
}
