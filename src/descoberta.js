import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { PORTA, ler, montarBusca } from './ddp.js';

// P4: o broadcast global sai por uma interface só (no Windows, às vezes a da VPN), então a busca vai
// também para o broadcast de cada placa de rede.
export function enderecosDeBroadcast(interfaces = networkInterfaces()) {
  const enderecos = new Set(['255.255.255.255']);
  for (const lista of Object.values(interfaces)) {
    for (const placa of lista ?? []) {
      // Máscara /32 (Tailscale, alguns túneis) não tem vizinho para receber o broadcast.
      if (placa.family !== 'IPv4' || placa.internal || placa.netmask === '255.255.255.255') continue;
      enderecos.add(broadcastDe(placa.address, placa.netmask));
    }
  }
  return [...enderecos];
}

const paraNumero = (ip) => ip.split('.').reduce((total, parte) => total * 256 + Number(parte), 0);
const paraTexto = (n) => [24, 16, 8, 0].map((deslocamento) => (n >>> deslocamento) & 255).join('.');
const broadcastDe = (ip, mascara) => paraTexto((paraNumero(ip) | ~paraNumero(mascara)) >>> 0);

// Manda a busca e junta os PS5 que responderem, um por host-id. Com --ip, para no primeiro; sem ele,
// espera um pouco depois da primeira resposta, caso haja outro console na rede. Ninguém respondeu: [].
// O UDP pode perder pacote, então a busca se repete até o prazo.
export function buscar({ ip, porta = PORTA, destinos, tempoMs = 3000, esperaMs = 300, repetirMs = 1000 } = {}) {
  return new Promise((resolver, rejeitar) => {
    const socket = dgram.createSocket('udp4');
    const achados = new Map();
    const relogios = [];
    let encerrado = false;

    const encerrar = (erro) => {
      if (encerrado) return;
      encerrado = true;
      for (const relogio of relogios) clearTimeout(relogio);
      socket.close();
      if (erro) rejeitar(erro);
      else resolver([...achados.values()]);
    };

    socket.on('error', encerrar);
    socket.on('message', (mensagem, origem) => {
      if (ip && origem.address !== ip) return;
      const ps5 = ler(mensagem);
      if (ps5?.tipo !== 'PS5') return;
      achados.set(ps5.id, { ...ps5, ip: origem.address });
      if (ip) encerrar();
      else if (achados.size === 1) relogios.push(setTimeout(encerrar, esperaMs));
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);
      const busca = montarBusca();
      const alvos = destinos ?? (ip ? [ip] : enderecosDeBroadcast());
      // Um destino que falha (placa sem rota, VPN caída) não derruba a busca pelos outros.
      const enviar = () => alvos.forEach((alvo) => socket.send(busca, porta, alvo, () => {}));
      enviar();
      relogios.push(setInterval(enviar, repetirMs), setTimeout(encerrar, tempoMs));
    });
  });
}
