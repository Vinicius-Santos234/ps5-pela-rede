# PS5 pela rede

Ver pela rede de casa se o PS5 está ligado ou em repouso e o que está rodando, e ligar ou pôr o console em
repouso. O console continua original: nada de jailbreak nem de mudança no firmware, e nada de automatizar
o que acontece dentro do jogo.

O protocolo de descoberta (DDP, UDP 9302) e o `WAKEUP` são reimplementados do zero, a partir do código que
a comunidade já decifrou ([playactor](https://github.com/dhleong/playactor),
[ps5-mqtt](https://github.com/FunkeyFlo/ps5-mqtt)). O registro e o repouso vêm do `playactor` no começo.

## Estado

**Spec 001 em rascunho, aguardando aprovação.** Ainda não há código.

| Spec | O que é | Estado |
|---|---|---|
| [001](specs/001-ps5-pelo-terminal.md) | O comando `ps5`: status, registrar, acordar, repousar | rascunho |
| 002 | Serviço 24h no servidor caseiro + página para o celular, só pelo Tailscale | a escrever |

## Onde roda

Desenvolvido no Windows, versionado no GitHub e executado no notebook Linux da casa (Ubuntu 26.04), o
mesmo que vai virar o servidor caseiro. Precisa estar na mesma rede que o PS5.

No PS5: *Configurações → Sistema → Economia de energia → Recursos disponíveis no modo de repouso*, com
"permanecer conectado à internet" e "ligar o PS5 pela rede" ativados; e a Reprodução Remota ativada para o
registro.

## Segurança

A credencial do registro vale como senha. Ela fica em `~/.config/ps5-rede/`, com permissão 600, e nunca
entra no repositório.
