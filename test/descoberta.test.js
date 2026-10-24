import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { test } from 'node:test';
import { montarBusca } from '../src/ddp.js';
import { buscar, enderecosDeBroadcast } from '../src/descoberta.js';

const resposta = (id, { codigo = '620 Server Standby', tipo = 'PS5' } = {}) =>
  Buffer.from(`HTTP/1.1 ${codigo}\nhost-id:${id}\nhost-type:${tipo}\nhost-name:PS5-${id.slice(-3)}\nsystem-version:14200007\n`);

// Um "console" no localhost: a cada busca recebida, `responder` diz o que mandar de volta (uma lista de mensagens).
async function consoleFalso(responder) {
  const socket = dgram.createSocket('udp4');
  const buscas = [];
  socket.on('message', (mensagem, origem) => {
    buscas.push(mensagem.toString());
    for (const volta of responder(buscas.length)) socket.send(volta, origem.port, origem.address);
  });
  await new Promise((pronto) => socket.bind(0, '127.0.0.1', pronto));
  return { porta: socket.address().port, buscas, fechar: () => socket.close() };
}

test('acha o console pelo IP, com o estado, o nome e de onde veio', async (t) => {
  const ps5 = await consoleFalso(() => [resposta('0123456789AB')]);
  t.after(ps5.fechar);
  const [achado, ...outros] = await buscar({ ip: '127.0.0.1', porta: ps5.porta });
  assert.equal(outros.length, 0);
  assert.equal(achado.estado, 'repouso');
  assert.equal(achado.nome, 'PS5-9AB');
  assert.equal(achado.ip, '127.0.0.1');
  assert.equal(ps5.buscas[0], montarBusca().toString());
});

test('com o IP, para na primeira resposta, sem esperar o prazo', async (t) => {
  const ps5 = await consoleFalso(() => [resposta('0123456789AB', { codigo: '200 Ok' })]);
  t.after(ps5.fechar);
  const inicio = Date.now();
  const [achado] = await buscar({ ip: '127.0.0.1', porta: ps5.porta, tempoMs: 2000 });
  assert.equal(achado.estado, 'ligado');
  assert.ok(Date.now() - inicio < 500, `levou ${Date.now() - inicio} ms`);
});

test('ignora lixo e aparelho que não é PS5, e fica com o PS5', async (t) => {
  const ps5 = await consoleFalso(() => [
    Buffer.from('lixo'),
    Buffer.from('HTTP/1.1 200 OK\nSERVER: roteador/1.0\n'),
    resposta('PS4000000000', { tipo: 'PS4' }),
    resposta('0123456789AB'),
  ]);
  t.after(ps5.fechar);
  const achados = await buscar({ destinos: ['127.0.0.1'], porta: ps5.porta, esperaMs: 100 });
  assert.deepEqual(achados.map((a) => a.id), ['0123456789AB']);
});

test('sem IP, junta os consoles que responderem e não repete o mesmo console', async (t) => {
  const ps5 = await consoleFalso(() => [resposta('0123456789AB'), resposta('0123456789AB'), resposta('BA9876543210', { codigo: '200 Ok' })]);
  t.after(ps5.fechar);
  const achados = await buscar({ destinos: ['127.0.0.1'], porta: ps5.porta, esperaMs: 100 });
  assert.deepEqual(achados.map((a) => [a.id, a.estado]).sort(), [['0123456789AB', 'repouso'], ['BA9876543210', 'ligado']]);
});

test('repete a busca se a primeira se perder', async (t) => {
  const ps5 = await consoleFalso((n) => (n === 1 ? [] : [resposta('0123456789AB')]));
  t.after(ps5.fechar);
  const achados = await buscar({ ip: '127.0.0.1', porta: ps5.porta, repetirMs: 100, tempoMs: 1000 });
  assert.equal(achados.length, 1);
  assert.ok(ps5.buscas.length >= 2);
});

test('ninguém responde: lista vazia, perto do prazo', async (t) => {
  const ps5 = await consoleFalso(() => []);
  t.after(ps5.fechar);
  const inicio = Date.now();
  assert.deepEqual(await buscar({ ip: '127.0.0.1', porta: ps5.porta, tempoMs: 300 }), []);
  const levou = Date.now() - inicio;
  assert.ok(levou >= 290 && levou < 1000, `levou ${levou} ms`);
});

test('com o IP, resposta de outro endereço não conta', async (t) => {
  const ps5 = await consoleFalso(() => [resposta('0123456789AB')]);
  t.after(ps5.fechar);
  // A busca vai para 127.0.0.1, mas o filtro pede 127.0.0.2: a resposta chega e é descartada.
  assert.deepEqual(await buscar({ ip: '127.0.0.2', destinos: ['127.0.0.1'], porta: ps5.porta, tempoMs: 300 }), []);
});

test('broadcast: o global e o de cada placa IPv4, sem loopback, IPv6 nem /32', () => {
  const placa = (address, netmask, extra = {}) => ({ address, netmask, family: 'IPv4', internal: false, ...extra });
  const enderecos = enderecosDeBroadcast({
    Ethernet: [placa('192.168.1.9', '255.255.255.0'), { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false }],
    Radmin: [placa('26.12.34.56', '255.0.0.0')],
    WSL: [placa('172.19.64.1', '255.255.240.0')],
    Tailscale: [placa('100.101.102.103', '255.255.255.255')],
    Loopback: [placa('127.0.0.1', '255.0.0.0', { internal: true })],
    Repetida: [placa('192.168.1.20', '255.255.255.0')],
  });
  assert.deepEqual(enderecos, ['255.255.255.255', '192.168.1.255', '26.255.255.255', '172.19.79.255']);
});
