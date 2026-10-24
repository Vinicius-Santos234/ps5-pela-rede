#!/usr/bin/env node
// Grava a resposta crua do PS5 à busca em test/gabaritos/, com o host-id trocado (P7).
//   npm run gabarito                 o primeiro PS5 que responder
//   npm run gabarito -- --ip 192.168.1.10
// Vale gravar de novo a cada atualização do sistema: o nome do arquivo leva a versão.
import dgram from 'node:dgram';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PORTA, ler, montarBusca } from '../src/ddp.js';
import { enderecosDeBroadcast } from '../src/descoberta.js';

const HOST_ID_FALSO = '0123456789AB';

const { values: opcoes } = parseArgs({ options: { ip: { type: 'string' } } });
const socket = dgram.createSocket('udp4');
const prazo = setTimeout(() => {
  console.error('Nenhum PS5 respondeu em 5 s.');
  process.exitCode = 2;
  socket.close();
}, 5000);

socket.on('message', (mensagem, origem) => {
  const ps5 = ler(mensagem);
  if (ps5?.tipo !== 'PS5' || (opcoes.ip && origem.address !== opcoes.ip)) return;
  clearTimeout(prazo);
  socket.close();

  const texto = mensagem.toString('utf8').replace(`host-id:${ps5.id}`, `host-id:${HOST_ID_FALSO}`);
  if (texto.includes(ps5.id)) {
    console.error('O host-id não saiu da resposta; nada foi gravado.');
    process.exitCode = 1;
    return;
  }
  const partes = [ps5.estado, ps5.sistema ?? 'sem-versao'];
  const pasta = new URL('../test/gabaritos/', import.meta.url);
  mkdirSync(pasta, { recursive: true });
  writeFileSync(new URL(`${partes.join('-')}.txt`, pasta), texto);
  console.log(`${ps5.nome} (${origem.address}) ${ps5.estado}: gravado em test/gabaritos/${partes.join('-')}.txt`);
  console.log(texto);
});

socket.bind(0, () => {
  socket.setBroadcast(true);
  for (const alvo of opcoes.ip ? [opcoes.ip] : enderecosDeBroadcast()) socket.send(montarBusca(), PORTA, alvo, () => {});
});
