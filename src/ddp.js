// DDP, o protocolo de descoberta do PS5: texto em UDP, no formato de uma requisição HTTP.
// Lido no código do playactor (src/protocol.ts) e conferido no PS5-591 em 22/10.

export const PORTA = 9302;
export const VERSAO = '00030010';

const ESTADOS = { 200: 'ligado', 620: 'repouso' };

// Cada campo numa linha "chave:valor", terminada em \n; a versão do protocolo vai por último.
export function montar(tipo, campos = {}) {
  const linhas = Object.entries(campos).map(([chave, valor]) => `${chave}:${valor}\n`);
  return Buffer.from(`${tipo} * HTTP/1.1\n${linhas.join('')}device-discovery-protocol-version:${VERSAO}\n`, 'utf8');
}

export const montarBusca = () => montar('SRCH');

// Devolve null para o que não é resposta de um console: lixo, outro protocolo, resposta sem host-id.
export function ler(mensagem) {
  const linhas = mensagem.toString('utf8').split(/\r?\n/);
  const status = /^HTTP\/1\.1 (\d{3}) (.*)$/.exec(linhas[0]);
  if (!status) return null;

  const campos = {};
  for (const linha of linhas.slice(1)) {
    // Só o primeiro ":" separa: o nome do console é escolhido por quem tem o PS5 e pode ter dois-pontos.
    const i = linha.indexOf(':');
    if (i <= 0) continue;
    campos[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  if (!campos['host-id']) return null;

  // O app rodando não vem aqui: os campos running-app-* são do PS4. No PS5 (14.20), a resposta com um jogo
  // aberto é igual à da tela inicial, e o jogo só sai pela presença da conta na PSN (spec 002).
  const codigo = Number(status[1]);
  return {
    estado: ESTADOS[codigo] ?? 'desconhecido',
    codigo,
    motivo: status[2].trim(),
    id: campos['host-id'],
    nome: campos['host-name'] ?? null,
    tipo: campos['host-type'] ?? null,
    sistema: lerVersaoDoSistema(campos['system-version']),
    portaDePedido: campos['host-request-port'] ? Number(campos['host-request-port']) : null,
    campos,
  };
}

// "14200007" → "14.20": dois dígitos da versão principal, dois da secundária, o resto é a revisão.
export function lerVersaoDoSistema(bruta) {
  if (!/^\d{8}$/.test(bruta ?? '')) return null;
  return `${Number(bruta.slice(0, 2))}.${bruta.slice(2, 4)}`;
}
