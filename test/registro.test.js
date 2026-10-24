import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { conversaEmPortugues, explicarErro, loginPeloNavegador, registrar } from '../src/registro.js';

const ps5 = { id: '0123456789AB', nome: 'PS5-591', ip: '192.168.1.10', estado: 'ligado' };

function terminalFalso(respostas = []) {
  const escrito = [];
  const perguntas = [];
  return {
    escrito,
    perguntas,
    escrever: (texto) => escrito.push(texto),
    perguntar: async (texto) => (perguntas.push(texto), respostas.shift()),
  };
}

test('as frases do playactor saem em português, e o que não se conhece passa como veio', async () => {
  const terminal = terminalFalso(['12345678']);
  const io = conversaEmPortugues(terminal);
  io.logInfo('Go to Settings > System > Remote Play > Link Device');
  io.logInfo('outra coisa');
  assert.equal(await io.prompt('Enter PIN here> '), '12345678');
  assert.deepEqual(terminal.escrito, ['3. No PS5: Configurações → Sistema → Reprodução Remota → Vincular dispositivo.', 'outra coisa']);
  assert.deepEqual(terminal.perguntas, ['PIN da tela> ']);
});

test('o login mostra o endereço para abrir em outra máquina e devolve a URL colada', async () => {
  const terminal = terminalFalso(['https://remoteplay.dl.playstation.net/remoteplay/redirect?code=abc']);
  const colada = await loginPeloNavegador(terminal).performLogin('https://auth.exemplo/authorize?x=1');
  assert.equal(colada, 'https://remoteplay.dl.playstation.net/remoteplay/redirect?code=abc');
  assert.ok(terminal.escrito.some((linha) => linha.includes('https://auth.exemplo/authorize?x=1')));
  assert.deepEqual(terminal.perguntas, ['URL> ']);
});

test('registrar pede a credencial para o console do playactor e a guarda pelo host-id', async () => {
  const dispositivo = { id: '0123456789AB', type: 'PS5' };
  const guardadas = [];
  await registrar(ps5, {
    ...terminalFalso(),
    acharDispositivo: async (ip) => (assert.equal(ip, '192.168.1.10'), dispositivo),
    requisitante: { requestForDevice: async (d) => (assert.equal(d, dispositivo), { 'user-credential': '42' }) },
    guardar: async (id, credencial) => guardadas.push([id, credencial]),
  });
  assert.deepEqual(guardadas, [['0123456789AB', { 'user-credential': '42' }]]);
});

test('se o playactor não acha o console, nada é pedido nem guardado', async () => {
  const pedidos = [];
  await assert.rejects(
    registrar(ps5, {
      ...terminalFalso(),
      acharDispositivo: async () => null,
      requisitante: { requestForDevice: async () => pedidos.push('pediu') },
      guardar: async () => pedidos.push('guardou'),
    }),
    /não achou o console/,
  );
  assert.deepEqual(pedidos, []);
});

test('se o registro falha, nada é guardado', async () => {
  const guardadas = [];
  await assert.rejects(
    registrar(ps5, {
      ...terminalFalso(),
      acharDispositivo: async () => ({}),
      requisitante: { requestForDevice: async () => { throw new Error('Timeout'); } },
      guardar: async (...args) => guardadas.push(args),
    }),
    /Timeout/,
  );
  assert.deepEqual(guardadas, []);
});

test('os erros em que a pessoa pode agir viram instrução', () => {
  assert.match(explicarErro(new Error('Did not get OAuth Code')), /redirect/);
  assert.match(explicarErro(new TypeError('Invalid URL')), /redirect/);
  assert.match(explicarErro(new Error('Timeout')), /tela do PIN/);
  assert.match(explicarErro(new Error('Registration error: 403: Forbidden')), /PIN estava errado/);
  assert.match(explicarErro(new Error('Response code 400 (Bad Request)')), /vale uma vez/);
  assert.equal(explicarErro(new Error('outra')), 'outra');
});

test('sem terminal, o registro recusa antes de ir à rede', () => {
  const bin = fileURLToPath(new URL('../bin/ps5.js', import.meta.url));
  const inicio = Date.now();
  const r = spawnSync(process.execPath, [bin, 'registrar'], { input: '', encoding: 'utf8' });
  assert.equal(r.status, 64);
  assert.match(r.stderr, /interativo/);
  assert.ok(Date.now() - inicio < 2000, 'não esperou a busca de 3 s');
});
