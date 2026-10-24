import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gravar, ler, lerTodas, permissaoAberta } from '../src/credencial.js';

const noWindows = process.platform === 'win32';
const credencial = { 'user-credential': '123456789', accountId: 'AAAAAAAAAAA=', registration: { 'RP-Key': 'x' } };

async function pastaTemporaria(t) {
  const pasta = await mkdtemp(join(tmpdir(), 'ps5-rede-'));
  t.after(() => rm(pasta, { recursive: true, force: true }));
  return pasta;
}

test('sem arquivo, não há credencial nenhuma', async (t) => {
  const caminho = join(await pastaTemporaria(t), 'ps5-rede', 'credenciais.json');
  assert.deepEqual(await lerTodas(caminho), {});
  assert.equal(await ler('0123456789AB', caminho), null);
});

test('grava pelo host-id, cria a pasta, e lê de volta', async (t) => {
  const caminho = join(await pastaTemporaria(t), 'ps5-rede', 'credenciais.json');
  await gravar('0123456789AB', credencial, caminho);
  assert.deepEqual(await ler('0123456789AB', caminho), credencial);
});

test('o formato é o do playactor: um mapa por host-id, e gravar um console não apaga o outro', async (t) => {
  const caminho = join(await pastaTemporaria(t), 'credenciais.json');
  await gravar('0123456789AB', credencial, caminho);
  await gravar('BA9876543210', { 'user-credential': '42' }, caminho);
  assert.deepEqual(Object.keys(await lerTodas(caminho)).sort(), ['0123456789AB', 'BA9876543210']);
  const { DiskCredentialsStorage } = (await import('playactor/dist/credentials/disk-storage.js')).default;
  assert.deepEqual(await new DiskCredentialsStorage(caminho).read('0123456789AB'), credencial);
});

test('não sobra arquivo temporário', async (t) => {
  const pasta = await pastaTemporaria(t);
  await gravar('0123456789AB', credencial, join(pasta, 'credenciais.json'));
  assert.deepEqual(await readdir(pasta), ['credenciais.json']);
});

test('arquivo em 600 e pasta em 700', { skip: noWindows && 'no Windows o modo não vale' }, async (t) => {
  const caminho = join(await pastaTemporaria(t), 'ps5-rede', 'credenciais.json');
  await gravar('0123456789AB', credencial, caminho);
  assert.equal((await stat(caminho)).mode & 0o777, 0o600);
  assert.equal((await stat(join(caminho, '..'))).mode & 0o777, 0o700);
  assert.equal(await permissaoAberta(caminho), false);
});

test('um arquivo que já existia com 644 sai em 600', { skip: noWindows && 'no Windows o modo não vale' }, async (t) => {
  const caminho = join(await pastaTemporaria(t), 'credenciais.json');
  await writeFile(caminho, '{}');
  await chmod(caminho, 0o644);
  assert.equal(await permissaoAberta(caminho), true);
  await gravar('0123456789AB', credencial, caminho);
  assert.equal((await stat(caminho)).mode & 0o777, 0o600);
});
