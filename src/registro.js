// E2 (P3): o registro é do playactor — o login na PSN pelo OAuth do app Remote Play para Windows, o PIN
// da tela "Vincular dispositivo" e a troca criptografada com o console, na porta 9295. Aqui só se acha o
// console no formato dele, se conversa em português e se guarda a credencial (src/credencial.js).
import { createRequire } from 'node:module';
import { gravar } from './credencial.js';

const require = createRequire(import.meta.url);
// O pacote não tem ponto de entrada (não existe dist/index.js): os caminhos são os da 0.4.1, fixada no package.json.
const { Discovery } = require('playactor/dist/discovery');
const { OauthCredentialRequester } = require('playactor/dist/credentials/oauth/requester');

// O que o requester do playactor escreve e pergunta, na língua do resto do comando.
const TRADUCOES = {
  'Registering with device via Remote Play.': 'Registrando com o console pela Reprodução Remota...',
  'Go to Settings > System > Remote Play > Link Device': '3. No PS5: Configurações → Sistema → Reprodução Remota → Vincular dispositivo.',
  'Enter PIN here> ': 'PIN da tela> ',
};
const traduzir = (texto) => TRADUCOES[texto] ?? texto;

export function conversaEmPortugues({ escrever, perguntar }) {
  return {
    logInfo: (texto) => escrever(traduzir(texto)),
    logError: (erro) => escrever(String(erro?.message ?? erro)),
    logResult: () => {},
    prompt: (texto) => perguntar(traduzir(texto)),
  };
}

// No lugar da estratégia do playactor, que tenta abrir um navegador: pelo SSH, no notebook, não há
// navegador, então o endereço é mostrado para abrir em outra máquina.
export function loginPeloNavegador({ escrever, perguntar }) {
  return {
    performLogin(url) {
      escrever('1. Abra este endereço num navegador (pode ser o do Windows) e entre na conta PSN:');
      escrever(`\n${url}\n`);
      escrever('2. Quando a página mostrar "redirect", copie o endereço inteiro da barra e cole aqui.');
      escrever('   Ele leva um código de acesso de uso único: não cole em nenhum outro lugar.');
      return perguntar('URL> ');
    },
  };
}

export async function dispositivoDoPlayactor(ip) {
  for await (const dispositivo of new Discovery({ deviceIp: ip, timeoutMillis: 5000 }).discover()) return dispositivo;
  return null;
}

export async function registrar(ps5, { escrever, perguntar, acharDispositivo = dispositivoDoPlayactor, requisitante, guardar = gravar }) {
  const dispositivo = await acharDispositivo(ps5.ip);
  if (!dispositivo) throw new Error(`o playactor não achou o console em ${ps5.ip}`);
  requisitante ??= new OauthCredentialRequester(
    conversaEmPortugues({ escrever, perguntar }),
    loginPeloNavegador({ escrever, perguntar }),
  );
  const credencial = await requisitante.requestForDevice(dispositivo);
  await guardar(ps5.id, credencial);
}

// Os erros que o playactor joga nos passos em que quem erra é a pessoa, com o que fazer.
export function explicarErro(erro) {
  const mensagem = erro?.message ?? String(erro);
  if (mensagem === 'Did not get OAuth Code' || mensagem.includes('Invalid URL')) {
    return 'A URL colada não tem o código de acesso. Copie a da página que mostra "redirect", inteira.';
  }
  if (mensagem === 'Timeout') {
    return 'O console não respondeu ao registro em 30 s. A tela do PIN estava aberta? O PIN expira em poucos minutos.';
  }
  if (mensagem.startsWith('Registration error')) {
    return `O console recusou o registro (${mensagem}). Se o PIN estava errado ou venceu, gere outro na tela e tente de novo.`;
  }
  if (/Response code 40\d/.test(mensagem)) {
    return `A PSN recusou o código de acesso (${mensagem}). Ele vale uma vez e por pouco tempo: faça o login de novo.`;
  }
  return mensagem;
}
