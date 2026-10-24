// E4 (P3): pôr em repouso é do playactor — uma sessão Remote Play criptografada (TCP), o login nela e o
// comando Standby (0x50). Aqui se monta o dispositivo dele com a nossa credencial, se limita o tempo (a
// issue #71 do playactor mostra a sessão travando para sempre) e se confirma o repouso pela busca.
import { createRequire } from 'node:module';
import { setTimeout as esperar } from 'node:timers/promises';
import { caminhoPadrao } from './credencial.js';
import { PORTA } from './ddp.js';
import { buscar } from './descoberta.js';

const require = createRequire(import.meta.url);
// Os caminhos são os da 0.4.1, fixada no package.json (o pacote não tem ponto de entrada).
const { PendingDevice } = require('playactor/dist/device/pending');
const { CredentialManager } = require('playactor/dist/credentials');
const { DiskCredentialsStorage } = require('playactor/dist/credentials/disk-storage');
const { RejectingCredentialRequester } = require('playactor/dist/credentials/rejecting-requester');
const { RemotePlayLoginProc } = require('playactor/dist/remoteplay/proc/login');

// O dispositivo do playactor lendo o nosso arquivo. Sem credencial ele recusa, em vez de abrir um registro
// novo no meio do repouso: quem registra é o `ps5 registrar`.
export async function conexaoDoPlayactor(ps5, caminho = caminhoPadrao()) {
  const credenciais = new CredentialManager(
    new RejectingCredentialRequester('este computador não está registrado no console'),
    new DiskCredentialsStorage(caminho),
  );
  const dispositivo = new PendingDevice(ps5.nome, (d) => d.id === ps5.id, {}, { deviceIp: ps5.ip, timeoutMillis: 5000 }, undefined, credenciais);
  return semLoginDaSessao(() => dispositivo.openConnection());
}

// O PS5 (sistema 14.x) não responde ao Login da sessão Remote Play, e o playactor 0.4.1 espera por ele
// para sempre antes de mandar o Standby: medido aqui em 24/10, e descrito na issue #71 dele. A correção de
// lá (pular o login numa sessão que é só para o repouso, testada 10 de 10) ainda não foi aceita, então o
// login é pulado aqui, só enquanto a sessão abre. O Standby não precisa dele.
export async function semLoginDaSessao(abrir) {
  const login = RemotePlayLoginProc.prototype.perform;
  RemotePlayLoginProc.prototype.perform = async () => {};
  try {
    return await abrir();
  } finally {
    RemotePlayLoginProc.prototype.perform = login;
  }
}

// P8: o PS5 não diz pela rede se há alguém jogando, então se pergunta. `--forcar` pula a pergunta; sem
// terminal para perguntar, a resposta é não.
export async function confirmar(ps5, { forcar, interativo, perguntar }) {
  if (forcar) return 'forcado';
  if (!interativo) return 'sem-terminal';
  const resposta = await perguntar(`Alguém pode estar jogando no ${ps5.nome}. Pôr em repouso? [s/N] `);
  return /^\s*s(im)?\s*$/i.test(resposta) ? 'confirmado' : 'recusado';
}

export async function repousar(ps5, { conectar = conexaoDoPlayactor, porta = PORTA, tempoMs = 30000, consultaMs = 1000 } = {}) {
  if (ps5.estado === 'repouso') return { jaEstava: true };

  const inicio = Date.now();
  const passou = () => Date.now() - inicio;
  // Fechar a sessão vale mesmo quando o prazo estoura: uma sessão largada aberta faz o PS5 recusar as
  // próximas por alguns minutos ("Remote is already in use", issue #71).
  let conexao;
  try {
    await comPrazo(async () => {
      conexao = await conectar(ps5);
    }, tempoMs);

    // O standby do playactor manda o pacote e fica esperando o console fechar a conexão, o que o PS5 não
    // faz (24/10: entrou em repouso com a promessa ainda pendente). Quem diz que deu certo é a busca,
    // quando ela responde 620. Uma falha do envio aparece antes disso e sobe.
    let falhou;
    conexao.standby().catch((erro) => {
      falhou ??= erro;
    });
    while (passou() < tempoMs) {
      const volta = Date.now();
      const [atual] = await buscar({ ip: ps5.ip, porta, tempoMs: Math.max(1, Math.min(consultaMs, tempoMs - passou())) });
      if (falhou) throw falhou;
      if (atual?.id === ps5.id && atual.estado === 'repouso') return { repousou: true, segundos: passou() / 1000 };
      await esperar(Math.max(0, Math.min(consultaMs - (Date.now() - volta), tempoMs - passou())));
    }
    return { repousou: false, segundos: passou() / 1000 };
  } finally {
    await comPrazo(async () => conexao?.close(), 5000).catch(() => {});
  }
}

async function comPrazo(trabalho, tempoMs) {
  const relogio = new AbortController();
  const prazo = esperar(tempoMs, null, { signal: relogio.signal }).then(() => {
    throw new Error(`a sessão Remote Play não respondeu em ${tempoMs / 1000} s`);
  });
  try {
    return await Promise.race([trabalho(), prazo]);
  } finally {
    relogio.abort();
    prazo.catch(() => {});
  }
}

// Os erros da sessão em que dá para dizer o que fazer.
export function explicarErro(erro) {
  const mensagem = erro?.message ?? String(erro);
  if (/already in use|IN_USE/i.test(mensagem)) {
    return `O PS5 está com outra sessão de Reprodução Remota, ou com uma que travou há pouco (${mensagem}). Espere alguns minutos e tente de novo.`;
  }
  if (mensagem.includes('não respondeu em')) {
    return `${mensagem}. Se o PS5 está mostrando um aviso na tela (como "o PS5 não foi desligado corretamente"), feche o aviso pelo controle e tente de novo.`;
  }
  return mensagem;
}
