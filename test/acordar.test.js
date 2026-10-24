import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { test } from 'node:test';
import { acordar, montarWakeup } from '../src/acordar.js';

const CREDENCIAL = '1234567890';
const resposta = (ligado) =>
  Buffer.from(`HTTP/1.1 ${ligado ? '200 Ok' : '620 Server Standby'}\nhost-id:0123456789AB\nhost-type:PS5\nhost-name:PS5-591\nsystem-version:14200007\n`);

// Um PS5 falso em repouso no localhost. Responde à busca com 620 ou 200 e liga `subidaMs` depois de um
// WAKEUP com a credencial certa. `perder` WAKEUPs são ignorados, como pacotes que a rede perdeu; durante
// a subida, `mudoNaSubida` faz ele não responder à busca.
async function ps5Falso({ subidaMs = 50, perder = 0, mudoNaSubida = false } = {}) {
  const socket = dgram.createSocket('udp4');
  const recebido = { buscas: 0, wakeups: [] };
  let estado = 'repouso';
  socket.on('message', (mensagem, origem) => {
    const texto = mensagem.toString();
    if (texto.startsWith('SRCH')) {
      recebido.buscas++;
      if (estado === 'subindo' && mudoNaSubida) return;
      socket.send(resposta(estado === 'ligado'), origem.port, origem.address);
    } else if (texto.startsWith('WAKEUP')) {
      recebido.wakeups.push(texto);
      if (recebido.wakeups.length <= perder || estado !== 'repouso') return;
      if (texto.includes(`user-credential:${CREDENCIAL}\n`)) {
        estado = 'subindo';
        setTimeout(() => (estado = 'ligado'), subidaMs);
      }
    }
  });
  await new Promise((pronto) => socket.bind(0, '127.0.0.1', pronto));
  return { porta: socket.address().port, recebido, fechar: () => socket.close() };
}

const emRepouso = { id: '0123456789AB', nome: 'PS5-591', ip: '127.0.0.1', estado: 'repouso' };

test('o WAKEUP leva os campos do playactor, na ordem dele, e a versão por último', () => {
  assert.equal(
    montarWakeup(CREDENCIAL).toString(),
    'WAKEUP * HTTP/1.1\napp-type:r\nauth-type:R\nclient-type:vr\nmodel:w\nuser-credential:1234567890\ndevice-discovery-protocol-version:00030010\n',
  );
});

test('acorda: manda o WAKEUP e volta quando a busca responde 200', async (t) => {
  const ps5 = await ps5Falso({ subidaMs: 150 });
  t.after(ps5.fechar);
  const r = await acordar(emRepouso, CREDENCIAL, { porta: ps5.porta, consultaMs: 50, tempoMs: 2000 });
  assert.equal(r.ligou, true);
  assert.ok(r.segundos >= 0.15 && r.segundos < 1, `${r.segundos} s`);
  assert.equal(ps5.recebido.wakeups.length, 1, 'um WAKEUP basta quando ele pega');
});

test('já ligado: não manda nada', async (t) => {
  const ps5 = await ps5Falso();
  t.after(ps5.fechar);
  const r = await acordar({ ...emRepouso, estado: 'ligado' }, CREDENCIAL, { porta: ps5.porta });
  assert.deepEqual(r, { jaEstava: true });
  assert.deepEqual(ps5.recebido, { buscas: 0, wakeups: [] });
});

test('um WAKEUP perdido é reenviado', async (t) => {
  const ps5 = await ps5Falso({ perder: 1 });
  t.after(ps5.fechar);
  const r = await acordar(emRepouso, CREDENCIAL, { porta: ps5.porta, consultaMs: 50, reenviarMs: 200, tempoMs: 2000 });
  assert.equal(r.ligou, true);
  assert.equal(ps5.recebido.wakeups.length, 2);
});

test('o console mudo durante a subida não é tomado por falha', async (t) => {
  const ps5 = await ps5Falso({ subidaMs: 300, mudoNaSubida: true });
  t.after(ps5.fechar);
  const r = await acordar(emRepouso, CREDENCIAL, { porta: ps5.porta, consultaMs: 50, tempoMs: 2000 });
  assert.equal(r.ligou, true);
});

test('credencial errada: não acorda, e desiste no prazo', async (t) => {
  const ps5 = await ps5Falso();
  t.after(ps5.fechar);
  const inicio = Date.now();
  const r = await acordar(emRepouso, '999', { porta: ps5.porta, consultaMs: 50, reenviarMs: 200, tempoMs: 600 });
  const levou = Date.now() - inicio;
  assert.equal(r.ligou, false);
  assert.ok(levou >= 590 && levou < 1500, `levou ${levou} ms`);
  assert.ok(ps5.recebido.wakeups.length >= 2, 'reenviou enquanto esperava');
});

test('a consulta não martela o console: uma busca por intervalo', async (t) => {
  const ps5 = await ps5Falso({ subidaMs: 10000 });
  t.after(ps5.fechar);
  await acordar(emRepouso, CREDENCIAL, { porta: ps5.porta, consultaMs: 100, tempoMs: 1000 });
  assert.ok(ps5.recebido.buscas >= 8 && ps5.recebido.buscas <= 12, `${ps5.recebido.buscas} buscas em 1 s`);
});

test('a credencial não aparece no que acordar devolve', async (t) => {
  const ps5 = await ps5Falso();
  t.after(ps5.fechar);
  const r = await acordar(emRepouso, CREDENCIAL, { porta: ps5.porta, consultaMs: 50, tempoMs: 2000 });
  assert.ok(!JSON.stringify(r).includes(CREDENCIAL));
});
