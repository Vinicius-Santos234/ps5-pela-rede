import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { test } from 'node:test';
import { confirmar, explicarErro, repousar, semLoginDaSessao } from '../src/repousar.js';

const resposta = (ligado) =>
  Buffer.from(`HTTP/1.1 ${ligado ? '200 Ok' : '620 Server Standby'}\nhost-id:0123456789AB\nhost-type:PS5\nhost-name:PS5-591\nsystem-version:14200007\n`);

// Um PS5 falso ligado no localhost, que responde à busca e passa ao repouso quando `dormir()` é chamado.
async function ps5Falso({ descidaMs = 50 } = {}) {
  const socket = dgram.createSocket('udp4');
  let ligado = true;
  socket.on('message', (mensagem, origem) => {
    if (mensagem.toString().startsWith('SRCH')) socket.send(resposta(ligado), origem.port, origem.address);
  });
  await new Promise((pronto) => socket.bind(0, '127.0.0.1', pronto));
  return {
    porta: socket.address().port,
    dormir: () => setTimeout(() => (ligado = false), descidaMs),
    fechar: () => socket.close(),
  };
}

// A sessão do playactor, falsa: anota o que foi chamado.
function sessaoFalsa(ps5, { standby, abrir } = {}) {
  const chamadas = [];
  const conectar = async () => {
    chamadas.push('abriu');
    if (abrir) await abrir();
    return {
      standby: async () => {
        chamadas.push('standby');
        if (standby) return standby();
        ps5.dormir();
      },
      close: async () => chamadas.push('fechou'),
    };
  };
  return { chamadas, conectar };
}

const ligado = { id: '0123456789AB', nome: 'PS5-591', ip: '127.0.0.1', estado: 'ligado' };
const nunca = () => new Promise(() => {});

test('confirmar: --forcar não pergunta; sem terminal é não; só "s" ou "sim" confirma', async () => {
  const perguntou = [];
  const perguntar = (resposta) => async (texto) => (perguntou.push(texto), resposta);
  assert.equal(await confirmar(ligado, { forcar: true, interativo: true, perguntar: perguntar('n') }), 'forcado');
  assert.equal(await confirmar(ligado, { forcar: false, interativo: false, perguntar: perguntar('s') }), 'sem-terminal');
  assert.deepEqual(perguntou, []);
  for (const sim of ['s', 'S', 'sim', ' Sim ']) assert.equal(await confirmar(ligado, { interativo: true, perguntar: perguntar(sim) }), 'confirmado', sim);
  for (const nao of ['', 'n', 'não', 'ss', 'sim!', 'yes']) assert.equal(await confirmar(ligado, { interativo: true, perguntar: perguntar(nao) }), 'recusado', nao);
  assert.match(perguntou[0], /Alguém pode estar jogando no PS5-591/);
});

test('repousa: abre a sessão, manda o standby, fecha, e volta quando a busca responde 620', async (t) => {
  const ps5 = await ps5Falso({ descidaMs: 150 });
  t.after(ps5.fechar);
  const sessao = sessaoFalsa(ps5);
  const r = await repousar(ligado, { conectar: sessao.conectar, porta: ps5.porta, consultaMs: 50, tempoMs: 2000 });
  assert.equal(r.repousou, true);
  assert.ok(r.segundos >= 0.15 && r.segundos < 1, `${r.segundos} s`);
  assert.deepEqual(sessao.chamadas, ['abriu', 'standby', 'fechou']);
});

test('já em repouso: não abre sessão nenhuma', async () => {
  const sessao = sessaoFalsa(null);
  assert.deepEqual(await repousar({ ...ligado, estado: 'repouso' }, { conectar: sessao.conectar }), { jaEstava: true });
  assert.deepEqual(sessao.chamadas, []);
});

test('se o standby falha, a sessão é fechada e o erro sobe', async (t) => {
  const ps5 = await ps5Falso();
  t.after(ps5.fechar);
  const sessao = sessaoFalsa(ps5, { standby: async () => { throw new Error('Registration error: 403: Forbidden: Remote is already in use'); } });
  await assert.rejects(repousar(ligado, { conectar: sessao.conectar, porta: ps5.porta }), /already in use/);
  assert.deepEqual(sessao.chamadas, ['abriu', 'standby', 'fechou']);
});

test('sessão que não abre nunca: desiste no prazo (issue #71 do playactor)', async () => {
  const sessao = sessaoFalsa(null, { abrir: nunca });
  const inicio = Date.now();
  await assert.rejects(repousar(ligado, { conectar: sessao.conectar, tempoMs: 300 }), /não respondeu em 0.3 s/);
  assert.ok(Date.now() - inicio < 1000);
});

test('standby que não volta nunca, como o do PS5 real: vale a busca, e a sessão é fechada', async (t) => {
  const ps5 = await ps5Falso();
  t.after(ps5.fechar);
  const sessao = sessaoFalsa(ps5, { standby: () => (ps5.dormir(), nunca()) });
  const r = await repousar(ligado, { conectar: sessao.conectar, porta: ps5.porta, consultaMs: 50, tempoMs: 2000 });
  assert.equal(r.repousou, true);
  assert.deepEqual(sessao.chamadas, ['abriu', 'standby', 'fechou']);
});

test('standby que não volta e console que não dorme: não finge que repousou, e fecha a sessão', async (t) => {
  const ps5 = await ps5Falso();
  t.after(ps5.fechar);
  const sessao = sessaoFalsa(ps5, { standby: nunca });
  const r = await repousar(ligado, { conectar: sessao.conectar, porta: ps5.porta, consultaMs: 50, tempoMs: 400 });
  assert.equal(r.repousou, false);
  assert.deepEqual(sessao.chamadas, ['abriu', 'standby', 'fechou']);
});

test('comando aceito, mas o console continua respondendo ligado: não finge que repousou', async (t) => {
  const ps5 = await ps5Falso();
  t.after(ps5.fechar);
  const sessao = sessaoFalsa(ps5, { standby: async () => {} });
  const r = await repousar(ligado, { conectar: sessao.conectar, porta: ps5.porta, consultaMs: 50, tempoMs: 400 });
  assert.equal(r.repousou, false);
});

test('o login da sessão é pulado só enquanto ela abre, e volta depois, mesmo com erro', async () => {
  const { RemotePlayLoginProc } = (await import('playactor/dist/remoteplay/proc/login.js')).default;
  const original = RemotePlayLoginProc.prototype.perform;
  assert.equal(typeof original, 'function', 'o método que se pula existe na versão instalada do playactor');

  let duranteAAbertura;
  await semLoginDaSessao(async () => {
    duranteAAbertura = RemotePlayLoginProc.prototype.perform;
    assert.equal(await new RemotePlayLoginProc({}).perform(null), undefined, 'não manda nada pelo socket');
  });
  assert.notEqual(duranteAAbertura, original);
  assert.equal(RemotePlayLoginProc.prototype.perform, original);

  await assert.rejects(semLoginDaSessao(async () => { throw new Error('caiu'); }), /caiu/);
  assert.equal(RemotePlayLoginProc.prototype.perform, original);
});

test('os erros da sessão em que dá para agir viram instrução', () => {
  assert.match(explicarErro(new Error('Registration error: 403: Forbidden: Remote is already in use')), /Espere alguns minutos/);
  assert.match(explicarErro(new Error('a sessão Remote Play não respondeu em 30 s')), /aviso na tela/);
  assert.equal(explicarErro(new Error('outra')), 'outra');
});
