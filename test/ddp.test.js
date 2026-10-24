import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lerVersaoDoSistema, ler, montar, montarBusca } from '../src/ddp.js';

const mensagem = (...linhas) => Buffer.from(linhas.join('\n') + '\n');
const repouso = (...extras) =>
  mensagem('HTTP/1.1 620 Server Standby', 'host-id:0123456789AB', 'host-type:PS5', 'host-name:PS5-591', ...extras);

test('a busca é o SRCH com a versão do protocolo do PS5, nada mais', () => {
  assert.equal(montarBusca().toString(), 'SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n');
});

test('montar põe os campos na ordem dada, cada um na sua linha, e a versão por último', () => {
  assert.equal(
    montar('WAKEUP', { 'client-type': 'vr', 'auth-type': 'R' }).toString(),
    'WAKEUP * HTTP/1.1\nclient-type:vr\nauth-type:R\ndevice-discovery-protocol-version:00030010\n',
  );
});

test('620 é repouso, 200 é ligado, e o resto é desconhecido mas ainda é um console', () => {
  assert.equal(ler(repouso()).estado, 'repouso');
  assert.equal(ler(mensagem('HTTP/1.1 200 Ok', 'host-id:0123456789AB', 'host-type:PS5')).estado, 'ligado');
  const estranho = ler(mensagem('HTTP/1.1 500 Server Error', 'host-id:0123456789AB', 'host-type:PS5'));
  assert.equal(estranho.estado, 'desconhecido');
  assert.equal(estranho.codigo, 500);
  assert.equal(estranho.motivo, 'Server Error');
});

test('lê os campos do console e a versão do sistema', () => {
  const ps5 = ler(repouso('host-request-port:997', 'system-version:14200007'));
  assert.equal(ps5.id, '0123456789AB');
  assert.equal(ps5.nome, 'PS5-591');
  assert.equal(ps5.tipo, 'PS5');
  assert.equal(ps5.portaDePedido, 997);
  assert.equal(ps5.sistema, '14.20');
  assert.equal(ps5.campos['system-version'], '14200007');
});

test('o nome do console pode ter dois-pontos: só o primeiro separa a chave do valor', () => {
  const ps5 = ler(mensagem('HTTP/1.1 200 Ok', 'host-id:0123456789AB', 'host-type:PS5', 'host-name:PS5: Sala'));
  assert.equal(ps5.nome, 'PS5: Sala');
});

test('aceita \\r\\n e espaço em volta do valor', () => {
  const ps5 = ler(Buffer.from('HTTP/1.1 620 Server Standby\r\nhost-id: 0123456789AB \r\nhost-type:PS5\r\n'));
  assert.equal(ps5.id, '0123456789AB');
  assert.equal(ps5.estado, 'repouso');
});

test('linha sem ":" ou começando com ":" é ignorada, e o resto da resposta vale', () => {
  const ps5 = ler(repouso('linha solta sem separador', ':sem-chave', '', 'system-version:14200007'));
  assert.equal(ps5.sistema, '14.20');
  assert.deepEqual(Object.keys(ps5.campos), ['host-id', 'host-type', 'host-name', 'system-version']);
});

test('o que não é resposta de console vira null', () => {
  assert.equal(ler(Buffer.alloc(0)), null, 'vazia');
  assert.equal(ler(Buffer.from('\n\n')), null, 'só quebras de linha');
  assert.equal(ler(montarBusca()), null, 'uma busca, não uma resposta');
  assert.equal(ler(Buffer.from([0xff, 0x00, 0x13, 0x37])), null, 'binário');
  assert.equal(ler(mensagem('HTTP/1.1 200 OK', 'SERVER: roteador/1.0', 'ST: upnp:rootdevice')), null, 'outro aparelho, sem host-id');
  assert.equal(ler(mensagem('HTTP/1.1 OK', 'host-id:0123456789AB')), null, 'linha de status sem código');
});

test('de outro tipo de aparelho, a resposta é lida com o tipo dele: quem filtra é a descoberta', () => {
  assert.equal(ler(mensagem('HTTP/1.1 620 Server Standby', 'host-id:0123456789AB', 'host-type:PS4')).tipo, 'PS4');
});

test('versão do sistema fora do formato vira null', () => {
  assert.equal(lerVersaoDoSistema('14200007'), '14.20');
  assert.equal(lerVersaoDoSistema('07000000'), '7.00');
  for (const bruta of [undefined, '', '1420', 'abcdefgh', '142000070']) assert.equal(lerVersaoDoSistema(bruta), null, bruta);
});

// P7: as respostas reais do PS5-591, gravadas com `npm run gabarito` e com o host-id trocado.
// O nome do arquivo diz o que a resposta tem de dar: <estado>-<sistema>.txt
// Em 24/10, a resposta com um jogo aberto saiu igual, byte a byte, à de ligado-14.20.txt (tela inicial).
const pasta = new URL('./gabaritos/', import.meta.url);
const gabaritos = existsSync(pasta) ? readdirSync(pasta).filter((nome) => nome.endsWith('.txt')) : [];
const todo = (estado) => !gabaritos.some((nome) => nome.startsWith(`${estado}-`)) && `falta gravar a resposta real do console ${estado}`;

for (const estado of ['repouso', 'ligado']) {
  test(`gabarito real: console ${estado}`, { todo: todo(estado) }, () => {
    for (const nome of gabaritos.filter((n) => n.startsWith(`${estado}-`))) {
      const [, sistema] = nome.replace(/\.txt$/, '').split('-');
      const ps5 = ler(readFileSync(new URL(nome, pasta)));
      assert.ok(ps5, nome);
      assert.equal(ps5.tipo, 'PS5', nome);
      assert.equal(ps5.estado, estado, nome);
      assert.equal(ps5.sistema, sistema, nome);
      assert.equal(ps5.id, '0123456789AB', `${nome}: o host-id real não pode ir para o repositório`);
      assert.ok(ps5.nome, nome);
      const doPs4 = Object.keys(ps5.campos).filter((chave) => chave.startsWith('running-app'));
      assert.deepEqual(doPs4, [], `${nome}: o PS5 não manda o app rodando; se mandar, a spec 002 muda`);
    }
  });
}
