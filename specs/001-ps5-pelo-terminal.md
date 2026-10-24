# Spec 001 — O PS5 pelo terminal: status, acordar e pôr em repouso

**Status:** aprovada em 24/10/2026; revista no mesmo dia: o jogo rodando passou para a 002 (§3)
**Data:** 2026-10-22
**Origem:** a ideia de 19/10 ("ligar o PS5 e ver o status pela rede"), retomada em 22/10:
*"vamos pegar aquele projetinho do ps5 pela rede"*. A leitura do protocolo no código de referência
(R0) e uma sonda feita à mão já aconteceram, e o PS5 dele respondeu.

---

## 1. Por que esta spec existe

O destino é uma página no celular que mostra se o PS5 está ligado e o que está rodando, e que liga ou põe
o console em repouso. Antes da página, e antes do servidor caseiro que vai hospedá-la, o protocolo tem de
funcionar num comando de terminal, testado no console de verdade. Esta spec é esse comando. A página e o
serviço 24h ficam para a 002.

Também é um projeto de engenharia reversa: descobrir e acordar o console são escritos do zero, a partir
dos pacotes, e não importados de uma biblioteca.

---

## 2. Objetivo

Um comando `ps5`, em Node, que na rede de casa diz o estado do console e o liga ou o põe em repouso.

**Uma frase de sucesso:** no notebook, `ps5 acordar` liga o PS5 da sala, e logo depois `ps5 status`
mostra "ligado", tudo em menos de um minuto.

---

## 3. Fora de escopo desta spec

| Fora | Por quê |
|---|---|
| **Página web e serviço 24h** | É a 002. Depende da base do servidor caseiro (Tailscale, etapa E1 dele) |
| **O jogo rodando** | Medido em 24/10: o PS5 não o manda pela rede local. Com um jogo aberto, a resposta à busca é igual, byte a byte, à da tela inicial. Ele só sai pela presença da conta na API da PSN (token NPSSO, que vale como senha e expira em ~2 meses; limite de 300 consultas a cada 15 min), como faz o `ps5-mqtt`. Vai para a 002, junto com o serviço que consulta e a página que mostra. Decidido por ele em 24/10 |
| **Acesso de fora de casa** | Também é a 002, e vai pelo Tailscale, **nunca por túnel público**: o botão liga o console |
| **Remote Play (vídeo, áudio, controle)** | É o estudo do chiaki-ng (R5). Não é preciso para ligar e desligar |
| **Registro e repouso escritos do zero** | Decisão D2: nesta spec eles vêm do `playactor`. Reescrevê-los fica para a R5, com o resto já funcionando |
| **Automatizar qualquer coisa dentro do jogo** | Fere os termos da PSN. O projeto liga, desliga e lê o status, nada mais |
| **Jailbreak, firmware, qualquer mudança no console** | Decisão de 19/10: o PS5 fica original |
| **PS4** | O protocolo é quase o mesmo (porta 987), mas não há PS4 em casa para testar |
| **API da PSN** (troféus, amigos, tempo de jogo) | É outra ideia, o painel da PSN, e outro projeto. A presença (o jogo rodando) é a exceção, e é da 002 |
| **Mais de um console** | Há um PS5 em casa. O código não deve supor que é só um, mas nada é testado com dois |

---

## 4. Como funciona (o que a R0 achou)

Lido em 22/10 no código do `playactor` (`src/discovery/`, `src/protocol.ts`, `src/waker.ts`,
`src/credentials/oauth/requester.ts`) e conferido no PS5 dele (`PS5-591`, sistema 14.20).

| Mensagem | Transporte | Conteúdo |
|---|---|---|
| Busca | UDP para a porta **9302**, broadcast ou IP direto | `SRCH * HTTP/1.1` + `device-discovery-protocol-version:00030010` |
| Resposta | UDP de volta para a porta de origem | `HTTP/1.1 200 Ok` (ligado) ou `HTTP/1.1 620 Server Standby` (repouso), e os campos `host-id`, `host-name`, `host-type`, `host-request-port`, `system-version` e a versão do protocolo. **Nada sobre o app rodando**: os campos `running-app-*` são do PS4 (medido em 24/10) |
| Acordar | UDP para a 9302 | `WAKEUP * HTTP/1.1` + `app-type:r`, `auth-type:R`, `client-type:vr`, `model:w`, `user-credential:<credencial>` + a versão |
| Registro | PSN (OAuth) + TCP com o console | Login na PSN para obter o ID da conta, e o PIN da tela *Reprodução Remota → Vincular dispositivo*. Devolve o `PS5-RegistKey` |
| Repouso | TCP, sessão Remote Play criptografada | Login na sessão e o comando `Standby` (`0x50`) |

A credencial do `WAKEUP` sai do `PS5-RegistKey`: cada 2 caracteres viram um byte, os bytes são lidos como
texto UTF-8, esse texto é um número hexadecimal, e o número vai em decimal.

O PS5 só responde em repouso com **"permanecer conectado à internet"** ligado nos recursos do modo de
repouso, e só acorda pela rede com **"ligar o PS5 pela rede"** ligado.

---

## 5. Comandos

| Comando | O que faz | Código de saída |
|---|---|---|
| `ps5 status [--ip X] [--json]` | Busca e mostra o estado, o nome, o IP e o sistema | 0 ligado · 1 repouso · 2 não encontrado (os mesmos do `playactor check`, para usar em script) |
| `ps5 registrar [--ip X]` | Registro pelo `playactor` (login na PSN + PIN), feito uma vez; guarda a credencial | 0 registrado |
| `ps5 acordar [--ip X]` | Manda o `WAKEUP` (escrito do zero) e espera o `200 Ok` | 0 ligou ou já estava ligado · 3 não acordou no tempo |
| `ps5 repousar [--ip X] [--forcar]` | Repouso pelo `playactor`. Com um app aberto, só com `--forcar` | 0 em repouso · 4 recusado (app aberto) |

Estrutura prevista: `src/ddp.js` (montar e ler as mensagens), `src/descoberta.js` (UDP),
`src/acordar.js`, `src/credencial.js`, `bin/ps5.js` (a CLI) e `test/`.

---

## 6. Decisões

| # | Decisão | Por quê |
|---|---|---|
| P1 | **Node ≥ 22, JavaScript ESM, sem TypeScript** | D1 (22/10): tudo o que vai rodar no notebook é Node (agente de notícias, apps do servidor caseiro), e a stack dele é JS puro |
| P2 | **Descoberta e `WAKEUP` do zero, só com `node:dgram`**, sem dependência | D2 (22/10): é a parte de engenharia reversa, e é texto em UDP |
| P3 | **Registro e repouso pelo `playactor`** | D2: o registro é login na PSN + troca criptografada; o repouso, uma sessão Remote Play. Trocar na R5 |
| P4 | A busca vai para `255.255.255.255` **e** para o broadcast de cada interface | Numa máquina com VPN (o Radmin no Windows) ou com mais de uma placa de rede, o broadcast global pode sair pela interface errada. O `ps5-mqtt` faz o mesmo |
| P5 | **A credencial fica fora do repositório**: `~/.config/ps5-rede/`, arquivo com permissão 600, pasta no `.gitignore` | Vale como senha |
| P6 | Nesta spec, roda como comando no Windows e no notebook, **sem Docker** | Em Docker, o broadcast exige `network_mode: host`; como o serviço vai rodar é decisão da 002 |
| P7 | Testes com `node:test`; o leitor de mensagens testado com **respostas reais gravadas** (com o `host-id` trocado) | O molde do agente de notícias; a resposta real do console é o gabarito |
| P8 | **Repousar com um app aberto exige `--forcar`** | Alguém pode estar jogando na sala |
| P9 | Desenvolver no Windows → GitHub → notebook | Decidido no agente de julho: o notebook é só ambiente de execução |
| P10 | `.gitattributes` com `eol=lf` | Lição de julho: CRLF quebra script no Linux |

---

## 7. Etapas e critérios de aceite

Os tempos são estimativas e serão calibrados no console.

### E1 — Descoberta (R1) ✅ 24/10
- [x] `ps5 status` acha o PS5 em **≤ 3 s**, no Windows e no notebook, em repouso e ligado. Medido em 24/10:
  Windows 0,88 s ligado e 0,91 s em repouso; notebook 0,66 s ligado e 0,61–0,81 s em repouso
- [x] As respostas reais `200 Ok` e `620` são gravadas como gabarito de teste
  (`test/gabaritos/ligado-14.20.txt` e `repouso-14.20.txt`). Até 24/10 este item também pedia o nome do
  jogo aberto, que o PS5 não manda pela rede local: foi para a 002 (§3)
- [x] Sem resposta, sai com o código 2 em **≤ 5 s**: 3,3 s no Windows e 3,05 s no notebook. Medido com um
  IP onde não há ninguém, que passa pelo mesmo prazo da busca; com o console desligado de vez, só a sonda
  de 22/10 e a de 24/10 (nenhuma resposta), não o `ps5 status`
- [x] O leitor de mensagens passa nos testes com as respostas reais (`620` e `200`) e com respostas
  malformadas (linha sem `:`, vazia, de outro aparelho): 20 testes

### E2 — Registro (R2) ✅ 24/10
- [x] `ps5 registrar` cria a credencial; o arquivo tem permissão 600. Registrado no notebook em 24/10, com
  o `playactor` 0.4.1: `~/.config/ps5-rede/credenciais.json` em 600, a pasta em 700. Vieram a credencial do
  `WAKEUP`, o ID da conta e o registro do Remote Play (`PS5-RegistKey`, `RP-Key`) que a E4 usa. O
  `playactor` sozinho gravaria em 644: o arquivo nasce num temporário já em 600 e é renomeado
- [x] `git status` limpo e nenhuma credencial no histórico: o `git log -p --all` e a árvore inteira,
  contados no notebook contra os valores da credencial, sem que eles saiam de lá: zero ocorrências de cada um
- [x] (a mais) Registrar de novo um console já registrado não faz nada sem `--de-novo`; sem terminal
  interativo, o comando recusa antes de ir à rede

### E3 — Acordar (R3a)
- [ ] De repouso a ligado em **≤ 60 s**, **5 de 5** tentativas, a partir do notebook
- [ ] Já ligado: não manda nada, diz "já estava ligado" e sai com o código 0
- [ ] A credencial não aparece em nenhuma saída nem em log

### E4 — Repouso (R3b)
- [ ] De ligado a repouso em **≤ 30 s**, **5 de 5** tentativas
- [ ] Com um app aberto e sem `--forcar`: recusa com o código 4 e não mexe no console

---

## 8. Riscos

| Risco | Plano |
|---|---|
| **O login na PSN pelo `playactor` pode ter quebrado** com mudanças da Sony | Plano B: registrar pelo chiaki-ng e ler o `RegistKey` que ele guarda. **Não quebrou**: o registro com a 0.4.1 (de 2022) funcionou em 24/10 |
| Uma atualização do sistema muda o protocolo (hoje 14.20) | Os gabaritos guardam a `system-version`; um teste quebrado aponta a mudança |
| O IP do PS5 muda (DHCP) | A busca não depende do IP; `--ip` é só um atalho |
| A sessão Remote Play do repouso aparece na TV ou atrapalha quem está jogando | Medir na E4; o `--forcar` (P8) já cobre o pior caso |

---

## 9. Em aberto

| Pergunta | Opções |
|---|---|
| Repositório no GitHub | Público (portfólio) ou privado. Em nenhum dos dois casos a credencial vai para o repositório (P5). Decidir antes do primeiro push; não trava a E1 |

O nome do comando ficou `ps5`, o que a spec já usava (24/10).
