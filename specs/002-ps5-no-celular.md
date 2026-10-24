# Spec 002 — O PS5 no celular: serviço 24h, página só no Tailscale e o jogo rodando

**Status:** rascunho, aguardando aprovação
**Data:** 2026-10-24
**Origem:** a página no celular é o destino desde a ideia de 19/10, e ficou de fora da 001 em 22/10. O jogo
rodando entrou aqui em 24/10, quando a 001 mediu que o PS5 não o manda pela rede local (decisão dele).

---

## 1. Por que esta spec existe

A 001 deixou o protocolo funcionando num comando de terminal, medido no console: status em menos de 1 s,
acordar em ~18 s, repousar em ~8 s. Mas o comando só roda no notebook, por SSH, com quem sabe usá-lo. O
destino sempre foi o celular: abrir uma página, ver se o PS5 está ligado e o que está rodando, e ligar ou
pôr em repouso com um toque, de casa ou de fora dela.

---

## 2. Objetivo

Um serviço que roda o tempo todo no notebook do servidor caseiro e serve uma página para o celular,
alcançável **só pela tailnet** (Tailscale), que mostra o estado do PS5 e o jogo rodando e liga ou põe o
console em repouso.

**Uma frase de sucesso:** no 4G, longe de casa, abro a página, vejo "em repouso", toco em "Ligar", e em
menos de 30 s ela mostra "ligado"; com um jogo aberto, ela mostra o nome dele.

---

## 3. Depende de

| O quê | Onde | Estado em 24/10 |
|---|---|---|
| **Tailscale** no notebook e no celular | E1 do servidor caseiro | não instalado |
| Como o serviço roda 24h (systemd ou painel) | D2 do servidor caseiro | em aberto; ver S1 |
| **Tomada com terra e o carregador original** no notebook | anotado em 22/10, junto com a bateria fraca | pendente; o notebook vai ficar ligado dia e noite |
| O comando `ps5` da 001 (`src/`) | este repositório | pronto |

---

## 4. Fora de escopo

| Fora | Por quê |
|---|---|
| **Acesso público** (túnel, porta aberta, domínio) | A página tem um botão que liga o console. Só a tailnet, nunca a internet aberta |
| Contas e login próprios | Quem está na tailnet é quem pode usar; o Tailscale já é a autenticação |
| Notificações ("o PS5 ligou") | Pode vir depois; esta spec é a página |
| Histórico e tempo de jogo | É o painel da PSN, outro projeto |
| Abrir um jogo pela página | O `playactor` sabe (`start-id`), mas o projeto liga, desliga e mostra; nada além |
| Remote Play (vídeo, controle) | Continua sendo a R5 |
| Mais de um console na página | O código não supõe um só, mas a página mostra o PS5 da casa |

---

## 5. O que a 001 mediu e esta spec usa

| Fato | Valor | Consequência para a página |
|---|---|---|
| Busca (status) | < 1 s, só na rede local | O serviço consulta a cada poucos segundos, de graça |
| Acordar | ~18 s (até ~27 s depois de minutos em repouso) | Mostrar "acordando..." com o tempo passando, não um carregando mudo |
| Repousar | ~8,4 s, pela sessão Remote Play | Idem, "entrando em repouso..." |
| Fases do repouso | `620` na hora; uns 15–40 s depois, **~20 s mudo na rede**; `620` de novo | "Sem resposta" logo depois do repouso é normal: não mostrar "desligado" nesse intervalo |
| O jogo rodando | **não vem pela rede local** | Vem da presença da conta na PSN (§6) |
| A TV | a sessão do repouso não mostra nada na tela; acordar não liga a TV nem troca a entrada | Quem está jogando é cortado sem aviso: a página pergunta antes de repousar, como a P8 da 001 |

---

## 6. O jogo rodando: a presença da PSN

O `ps5-mqtt` faz assim, desde a v1.0.0, e é o caminho proposto:

- **A biblioteca `psn-api`** (npm, MIT, 2.18.1 de 08/2026). Uma vez: o **NPSSO**, o cookie de login da Sony
  (pego em `https://ca.account.sony.com/api/v1/ssocookie` com a conta logada no navegador), é trocado por
  um código e o código por **tokens de acesso e de renovação**. Daí em diante, os tokens se renovam sozinhos;
  o NPSSO só volta a ser pedido se o serviço ficar parado mais de ~2 meses.
- **A presença**: `getBasicPresence` da própria conta, que traz se ela está online, em qual plataforma e o
  jogo (`gameTitleInfoList`: nome, `npTitleId`, plataforma).
- **O limite**: 300 consultas a cada 15 min por conta. O `ps5-mqtt` recomenda uma a cada 5 s e nunca menos
  de 3 s. Aqui: **só com o console ligado**, e no máximo uma a cada 15 s (60 a cada 15 min).
- **O NPSSO e os tokens valem como senha**: ficam com a credencial do registro, em `~/.config/ps5-rede/`, em
  600, fora do git, fora da página e fora dos registros.
- **O limite da ideia**: a presença é **da conta**, não do console. Se outra pessoa da casa jogar com a conta
  dela, a página mostra "ligado", mas não o jogo. A presença também não é instantânea; quanto atrasa, a E3
  mede.

A conferir na E3: os nomes exatos das funções na versão instalada (o README mostra
`exchangeNpssoForAccessCode`; o `ps5-mqtt` ainda usa `exchangeNpssoForCode`).

---

## 7. Como funciona (proposta)

```
celular (4G ou Wi-Fi) ── tailnet ──> tailscale serve (HTTPS) ──> 127.0.0.1:porta ── serviço ps5-rede
                                                                                   ├─ busca DDP a cada 5 s
                                                                                   ├─ presença PSN a cada 15 s, se ligado
                                                                                   └─ acordar / repousar (src/ da 001)
```

- **O serviço** é Node puro (`node:http`), no mesmo repositório, reaproveitando `src/`. Guarda o estado em
  memória: `{ estado, desde, jogo, atualizadoEm }`, com os estados `ligado`, `repouso`, `acordando`,
  `entrando-em-repouso` e `sem-resposta`.
- **Rotas**: `GET /` (a página), `GET /estado` (JSON), `POST /acordar` e `POST /repousar`. Um comando por vez:
  um segundo toque enquanto o primeiro corre recebe "já estou fazendo isso".
- **Escuta só em `127.0.0.1`**: quem publica na tailnet é o `tailscale serve`, que dá HTTPS com o nome da
  máquina. Ninguém na rede de casa, nem na internet, alcança a porta.
- **Defesa contra outro site** disparar o botão: os `POST` só aceitam `Content-Type: application/json`, e o
  serviço não responde a CORS. Um formulário de outro site, aberto no mesmo celular, não consegue ligar o PS5.
- **A página**: um HTML só, feito para 390 px, que consulta `/estado` a cada 3 s. Mostra o estado com as fases,
  o jogo quando há, e os dois botões. "Pôr em repouso" pede confirmação, com o nome do jogo quando se sabe
  ("Alguém pode estar jogando Astro Bot. Pôr em repouso?").

---

## 8. Decisões propostas (para ele decidir)

| # | Pergunta | Proposta | Por quê |
|---|---|---|---|
| S1 | Como o serviço roda 24h | **Unidade do systemd do usuário**, com `Restart=always` (o `linger` já está ligado desde julho) | Em Docker, a busca por broadcast exige `network_mode: host`, e a D2 do servidor caseiro ainda não decidiu o painel. Dá para mudar depois |
| S2 | Como a página chega à tailnet | **`tailscale serve`** com HTTPS, serviço em `127.0.0.1` | HTTPS sem cuidar de certificado, e a porta fica fechada para a rede de casa |
| S3 | O jogo pela PSN | **Na E3 desta spec**, depois de a página funcionar sem ele | A página vale sem o jogo; o jogo é a parte que depende de serviço de terceiro |
| S4 | Atualizar a página | **Consulta a cada 3 s** (e não SSE/WebSocket) | Uma pessoa, um celular: simples ganha |
| S5 | Capa do jogo | **Não** nesta spec | A imagem viria da CDN da Sony a cada abertura; o nome basta |
| S6 | O serviço no código | **Mesmo repositório**, `bin/ps5.js servir` | Reaproveita `src/` e os testes da 001 |

---

## 9. Etapas e critérios de aceite

### E0 — A tailnet (pré-requisito, do servidor caseiro)
- [ ] Notebook e celular na mesma tailnet; do 4G, o celular abre uma página de teste servida pelo notebook

### E1 — O serviço
- [ ] `ps5 servir` responde `GET /estado` com o estado do PS5, e ele muda em **≤ 10 s** quando o console muda
- [ ] Volta sozinho depois de um `reboot` do notebook, em **≤ 2 min**
- [ ] Escuta só em `127.0.0.1`: da rede de casa, a porta não abre
- [ ] Nenhum segredo no `journalctl` do serviço (contado no notebook contra os valores, como na 001)
- [ ] Memória do processo **≤ 100 MB** depois de 24 h ligado

### E2 — A página
- [ ] No celular, a 390 px, pelo 4G: mostra o estado, com "acordando", "entrando em repouso" e o "sem resposta"
  das fases do repouso explicado
- [ ] "Ligar" acorda o PS5 e a página mostra "ligado" em **≤ 30 s**, **5 de 5**
- [ ] "Pôr em repouso" pergunta antes; sem confirmar, nada acontece; confirmado, "em repouso" em **≤ 20 s**
- [ ] Um `POST` sem `Content-Type: application/json`, ou de outra origem, é recusado e não mexe no console

### E3 — O jogo rodando
- [ ] `ps5 psn-login` pede o NPSSO uma vez e guarda os tokens em 600; nada disso no git nem nos registros
- [ ] Com um jogo aberto **na conta registrada**, a página mostra o nome dele; o atraso é medido
- [ ] **≤ 60 consultas à PSN a cada 15 min**, e nenhuma com o console em repouso (contado pelo serviço)
- [ ] Com o token vencido ou a PSN fora do ar, a página continua funcionando e diz "jogo: indisponível"

---

## 10. Riscos

| Risco | Plano |
|---|---|
| A API da PSN não é oficial e pode mudar | A página não depende dela (S3); quebrou, mostra "jogo: indisponível". O `ps5-mqtt` é o termômetro |
| O NPSSO expira (~2 meses) e a renovação falha | O serviço avisa na página e pede um novo `ps5 psn-login` |
| Outra pessoa joga com outra conta | Limite conhecido (§6). Dá para cadastrar mais contas depois |
| O notebook ligado 24h com a bateria fraca | Tomada com terra e carregador original antes da E1 (§3) |
| A correção da issue #71 entra no `playactor` | Tirar o contorno do login (P11 da 001) e conferir o repouso de novo |

---

## 11. Em aberto

| Pergunta | Opções |
|---|---|
| Nome na tailnet | O nome da máquina ou um apelido (`ps5`, `casa`) |
| A página também na rede de casa, sem Tailscale | Não (proposta: tudo pela tailnet) ou sim, só leitura |
