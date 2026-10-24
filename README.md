# PS5 pela rede

Ver pela rede de casa se o PS5 está ligado ou em repouso, e ligar ou pôr o console em repouso. O jogo
rodando vem depois, na 002: o PS5 não o manda pela rede local, só pela presença da conta na PSN. O console
continua original: nada de jailbreak nem de mudança no firmware, e nada de automatizar o que acontece
dentro do jogo.

O protocolo de descoberta (DDP, UDP 9302) e o `WAKEUP` são reimplementados do zero, a partir do código que
a comunidade já decifrou ([playactor](https://github.com/dhleong/playactor),
[ps5-mqtt](https://github.com/FunkeyFlo/ps5-mqtt)). O registro e o repouso vêm do `playactor` no começo.

## Estado

**Spec 001 aprovada em 24/10/2026; a E1 (descoberta), a E2 (registro) e a E3 (acordar) estão prontas.**
A próxima é a E4, pôr em repouso.

```
npm ci && npm test
node bin/ps5.js status [--ip 192.168.1.10] [--json]   # 0 ligado, 1 repouso, 2 não encontrado
node bin/ps5.js registrar                             # uma vez, num terminal, com o PS5 ligado
node bin/ps5.js acordar                               # 0 ligou, 3 não acordou em 60 s, 78 sem registro
npm run gabarito                                      # grava a resposta real em test/gabaritos/
```

| Spec | O que é | Estado |
|---|---|---|
| [001](specs/001-ps5-pelo-terminal.md) | O comando `ps5`: status, registrar, acordar, repousar | aprovada, E1 a E3 prontas |
| 002 | Serviço 24h no servidor caseiro + página para o celular, só pelo Tailscale, com o jogo rodando pela presença da PSN | a escrever |

## Onde roda

Desenvolvido no Windows, versionado no GitHub e executado no notebook Linux da casa (Ubuntu 26.04), o
mesmo que vai virar o servidor caseiro. Precisa estar na mesma rede que o PS5.

No PS5: *Configurações → Sistema → Economia de energia → Recursos disponíveis no modo de repouso*, com
"permanecer conectado à internet" e "ligar o PS5 pela rede" ativados; e a Reprodução Remota ativada para o
registro.

## Segurança

A credencial do registro vale como senha. Ela fica em `~/.config/ps5-rede/`, com permissão 600, e nunca
entra no repositório.
