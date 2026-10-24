// E3 (P2): acordar é um pacote só, escrito do zero — o WAKEUP, no mesmo formato da busca, com a
// credencial do registro, para a porta 9302 do console. O console não responde ao WAKEUP: quem diz que
// deu certo é a busca, quando a resposta passa de 620 para 200.
import dgram from 'node:dgram';
import { setTimeout as esperar } from 'node:timers/promises';
import { PORTA, montar } from './ddp.js';
import { buscar } from './descoberta.js';

// Os campos e a ordem do playactor (src/waker.ts): app Remote Play, autenticação pelo registro, cliente "vr".
export function montarWakeup(credencial) {
  return montar('WAKEUP', { 'app-type': 'r', 'auth-type': 'R', 'client-type': 'vr', model: 'w', 'user-credential': credencial });
}

// Manda o WAKEUP e consulta o console a cada `consultaMs` até ele responder ligado. O UDP pode perder o
// pacote, e o playactor manda uma vez só: aqui ele é reenviado a cada `reenviarMs` enquanto o console
// continua em repouso. Durante a subida o console às vezes não responde à busca; isso conta como "ainda não".
export async function acordar(ps5, credencial, { porta = PORTA, tempoMs = 60000, consultaMs = 1000, reenviarMs = 10000 } = {}) {
  if (ps5.estado === 'ligado') return { jaEstava: true };

  const inicio = Date.now();
  const passou = () => Date.now() - inicio;
  const socket = dgram.createSocket('udp4');
  await new Promise((pronto, falhou) => {
    socket.once('error', falhou);
    socket.bind(0, pronto);
  });
  const wakeup = montarWakeup(credencial);
  const enviar = () => new Promise((pronto, falhou) => socket.send(wakeup, porta, ps5.ip, (erro) => (erro ? falhou(erro) : pronto())));

  try {
    let ultimoEnvio = -Infinity;
    while (passou() < tempoMs) {
      const volta = Date.now();
      if (volta - ultimoEnvio >= reenviarMs) {
        await enviar();
        ultimoEnvio = volta;
      }
      const [atual] = await buscar({ ip: ps5.ip, porta, tempoMs: Math.max(1, Math.min(consultaMs, tempoMs - passou())) });
      if (atual?.id === ps5.id && atual.estado === 'ligado') return { ligou: true, segundos: passou() / 1000 };
      // Com o IP, a busca volta na primeira resposta (o 620): espera o resto do intervalo para não martelar o console.
      await esperar(Math.max(0, Math.min(consultaMs - (Date.now() - volta), tempoMs - passou())));
    }
    return { ligou: false, segundos: passou() / 1000 };
  } finally {
    socket.close();
  }
}
