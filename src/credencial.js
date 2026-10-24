// P5: a credencial do registro vale como senha. Fica fora do repositório, em ~/.config/ps5-rede/,
// com a pasta em 700 e o arquivo em 600 desde o primeiro byte: grava num temporário já criado com 600 e
// renomeia, então o arquivo nunca existe com permissão mais aberta.
// O formato é o do DiskCredentialsStorage do playactor ({ host-id: credencial }), para a E4 ler o mesmo arquivo.
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const caminhoPadrao = () => process.env.PS5_REDE_CREDENCIAIS ?? join(homedir(), '.config', 'ps5-rede', 'credenciais.json');

export async function lerTodas(caminho = caminhoPadrao()) {
  let texto;
  try {
    texto = await readFile(caminho, 'utf8');
  } catch (erro) {
    if (erro.code === 'ENOENT') return {};
    throw erro;
  }
  return JSON.parse(texto);
}

export async function ler(id, caminho = caminhoPadrao()) {
  return (await lerTodas(caminho))[id] ?? null;
}

export async function gravar(id, credencial, caminho = caminhoPadrao()) {
  const todas = { ...(await lerTodas(caminho)), [id]: credencial };
  const pasta = dirname(caminho);
  await mkdir(pasta, { recursive: true, mode: 0o700 });
  await chmod(pasta, 0o700);
  const temporario = `${caminho}.${process.pid}.tmp`;
  try {
    await writeFile(temporario, JSON.stringify(todas, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temporario, caminho);
  } finally {
    await rm(temporario, { force: true });
  }
  await chmod(caminho, 0o600);
}

// No Windows o modo é quase todo ignorado (quem protege é a ACL da pasta do usuário), então só se
// confere fora dele.
export async function permissaoAberta(caminho = caminhoPadrao()) {
  if (process.platform === 'win32') return false;
  return ((await stat(caminho)).mode & 0o077) !== 0;
}
