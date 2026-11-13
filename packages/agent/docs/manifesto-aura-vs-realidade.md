# Manifesto Aura ↔ Realidade ThinkIac

Documento comparativo por princípio, com evidência (caminho de arquivo + comportamento atual).
Gerado em 2026-08-19 a partir do manifesto original (`uploads/pasted-1787175946593.unkwn`).

---

## Sumário executivo

| # | Princípio do manifesto | Veredito | Nota curta |
|---|---|---|---|
| 1 | Modularidade com contratos | ✅ Seguimos | Packages substituíveis, contratos por tools/routers/hooks |
| 2 | Protocolos antes de plataformas | ✅ Seguimos | HTTP/WebSocket + bus de eventos; nada de RPC proprietário |
| 3 | Linux + Web + AI | ⚠️ Parcial | Linux/Web/AI operacional sim; "aplicações são containers" não |
| 4 | Simplicidade arquitetural | ⚠️ Tensão | Peças simples, mas o todo virou SaaS multi-tenant |
| 5 | Resiliência do sistema | ✅ Seguimos | Falha isolada por package; tetos reais medidos |
| 6 | Local First | ⚠️ Parcial | Presente em peças (bridge/shadow/hermes), não na arquitetura inteira |
| 7 | Dados e privacidade | ❌ Fugimos | Dados locais sim; processamento da IA majoritariamente remoto |
| 8 | IA no Aura | ⚠️ Parcial | IA observadora/adaptativa real; "lado a lado com o kernel" não |

**Conclusão:** o esqueleto filosófico (modularidade, protocolos, resiliência, IA operacional) está vivo e é o que faz o sistema funcionar. A fuga estrutural está na **autonomia**: IA remota virou dependência e o ecossistema pendurou para cloud-first — exatamente o que o manifesto abre denunciando.

---

## 1. Modularidade como fundamento — ✅ Seguimos

> "Pequenas peças, fracamente acopladas, fortemente definidas."

**Realidade:** o runtime é literalmente isso. O workspace tem 100+ packages (`packages/`), cada um expondo contratos explícitos:

- **Tools** registradas — ex.: `agenda/calendar_add`, `tasks`, `memory/memory_recall`, `email-manager/email_send`
- **Routers HTTP** por package — `routes.js` em cada package
- **Hooks de evento** — ex.: `observability` grampeia `tool_before`/`tool_after`/`agent:step`; `bags` e `memory` injetam contexto em `agent:prompt:compose`

**Substituibilidade comprovada (não só declarada):**

- `packages/memory/README.md`: "Este pacote substitui as duas [implementações antigas] por um único grafo em SQLite" — trocou `facts.md` + `embeddings.json` planos por um grafo, sem quebrar quem consumia (`agent` e `agentic` delegaram para `lib/graph.js`).
- `packages/hermes/AGENT.md`: criado "no lugar do relay público do ntfy.sh" — canal próprio substituiu dependência externa.
- `packages/shadow/README.md`: overlays transacionais por sessão — editar → diff → testar → aprovar → promover, sem tocar o workspace ativo.

**Veredito:** aderência máxima. É o princípio mais forte do projeto.

---

## 2. Protocolos antes de plataformas — ✅ Seguimos

> "A Web é o barramento universal do sistema."

**Realidade:**

- Módulos conversam via **HTTP e WebSocket**: routers por package + `hermes` (WebSocket bidirecional autenticado por device, `packages/hermes/`).
- O **bus de eventos** do Lógos (`dispatchEvent`) é o meio de integração entre packages (hooks de `tool_before`/`tool_after`, `agent:step`, `device:emit`, `ntfy:notify`...).
- Sem RPC proprietário, sem wire protocol custom entre módulos.

**Veredito:** fiel ao texto.

---

## 3. Linux + Web + AI — ⚠️ Parcial (um item fugiu)

### O que seguimos

- **Linux Based** — VPS, `tenant-systemd`, `system-monitor`, `process-manager`, `terminal` (PTY real).
- **Web First** — views Svelte em todos os packages; o shell Agent é web (`packages/agent/DESIGN.md`).
- **First IA** — a Agent opera o sistema de verdade: `run_shell`, `terminal`, `process-manager`, `observability` — o "agente que observa, compreende e auxilia" do manifesto, materializado.

### O que fugiu

> "Aplicações são containers. Cada aplicação é isolada, reproduzível e portável."

**Realidade:** o driver real da frota é **systemd units, sem Docker** — `packages/tenant-systemd/AGENT.md`: "Provisiona tenant como unit systemd, sem Docker, sem Portainer e sem NPM. É o driver para VPS pequena — a caixa de referência tem 477 MB de RAM, 1 vCPU."

Docker **existe** (`docker-registry`, `workloads`, `aura-system`) mas não é o caminho de produção dos tenants. É uma fuga **consciente e documentada** (custo: `dockerd` ~100 MB + agent ~40 MB + NPM ~200 MB comem a máquina antes do primeiro tenant), mas é uma fuga do texto do manifesto.

---

## 4. Simplicidade arquitetural — ⚠️ Tensão (peças simples, todo pesado)

> "Simplicidade deve vencer abstração excessiva." / "Performance é uma feature."

**Realidade a favor:**

- Cada package é uma peça pequena e substituível — o princípio se mantém.
- **Performance como feature é real e medida:** `tenant-systemd` faz scale-to-zero por `systemctl` ("Parar tenant ocioso passa a ser `systemctl stop`"), teto de memória real com `swapaccount=1` (medido: oom-kill em ~384 MB em vez de 2.5 GB), roteador acorda tenant parado com **HTTP 200 em 1.3 s**.
- O design system Agent (`DESIGN.md`) é explícito contra decoração: "No decorative gradients, sheens, or specular hover sweeps" — simplicidade visual levada a sério.

**Realidade contra:**

- O todo acumulou para um **SaaS multi-tenant**: `billing`, `checkout`, `store`, `upgrade`, `fleet`, `vps`, `machine-registry`, `tenant-s3`, `custom-domains`, `email-manager`, `whatsapp-manager`, `flutter-studio`... 100+ packages e camadas de infraestrutura que o manifesto ("rodar em hardware pequeno") não previa.

**Veredito:** a tensão não é hipocrisia — cada peça é simples; o que cresceu foi o escopo do produto, não a complexidade das partes.

---

## 5. Resiliência do sistema — ✅ Seguimos

> "O sistema deve sobreviver à falha."

**Realidade:**

- **Falha isolada por módulo:** `process-manager` ("package state, sessions and memory, with isolated stop, start and reload controls") — um package cai sem derrubar o runtime; `reboot` é um package discreto.
- **Teto coletivo:** `tenant-systemd` slice "protege o host" — num pico simultâneo sobra memória para sshd e runtime de controle; sem ela a máquina sai da rede.
- **Limites que são reais, não decorativos:** o `doctor` do tenant-systemd imprime "TETO DE MEMÓRIA É REAL: NÃO — o limite é decorativo" quando o kernel não criou `memory.swap.max` — resiliência verificada, não assumida.

**Veredito:** fiel, com rigor acima da média (medição e sondagem de capacidades reais).

---

## 6. Local First — ⚠️ Parcial (presente em peças, não no todo)

> "Offline é um modo de primeira classe." / "Tudo deve ser capaz de rodar em hardware pequeno."

**Realidade a favor (peças):**

- `packages/bridge`: "sincronização offline-first e resolução de conflitos por campo, **sempre decidida no local**".
- `packages/shadow`: teste sem tocar o workspace ativo (overlay transacional).
- `packages/hermes`: fila offline para aparelho desconectado (24h de validade, teto 200, entrega integral ao reconectar).
- `packages/memory`: embeddings são best-effort — sem rede, `recall()` degrada para substring ("nunca quebra o fluxo").

**Realidade contra:**

- O sistema **principal** (chat, IA, apps) depende de rede o tempo todo. "Offline de primeira classe" está concentrado em poucos packages, não na arquitetura como um todo.
- "Tudo deve rodar em hardware pequeno": a referência é a VPS de 477 MB, que roda o **runtime**, mas o cérebro (IA) e o ecossistema cloud (registry, store, billing central) não cabem nessa régua.

---

## 7. Dados e privacidade — ❌ Fugimos no ponto mais sensível

> "Dados pertencem ao usuário." / "Sempre que possível, o processamento deve ocorrer localmente."

**Realidade a favor:**

- Dados em **SQLite local** (`memory`, `bags`, `whatsapp-manager` via `getProxy`), arquivos em disco, secrets por provider.

**Realidade contra (a fuga estrutural):**

- O cérebro do sistema é **majoritariamente remoto**: `packages/agent/agent.config.json` — pools ativos: `deepseek-direct` (API DeepSeek) e `codex-engineer` (CLI com conta paga); habilitados: `openrouter-primary`, `novita`, `claude-engineer`, `maritaca`, `anthropic-api`, `openai-api`, `free-groq`, `free-cerebras`, `free-google`, `free-nvidia`, `free-mistral`...
- `packages/free-pool/DESIGN.md` otimiza **cota de providers remotos** (Groq, Cerebras, Google AI Studio, NVIDIA, Mistral, Cloudflare) — o sistema vive de APIs externas gratuitas/pagas.
- O próprio config reconhece o risco: Google free tem `allows_training: true` — "**TREINA COM O QUE RECEBE** no plano gratuito. Fica fora de qualquer conteúdo de cliente — só carga sintética/interna." Ou seja: a arquitetura impõe dependência externa que o manifesto dizia que deveria ser *escolha consciente*, não *obrigação*.

**Detalhe importante:** o pool `local` (Ollama, `qwen2.5:3b`, `nomic-embed-text`) **existe e está habilitado** no config — mas o comentário do próprio config diz: "`auto` **não** escolhe local por conta própria: o catálogo entra com um prior de qualidade por tamanho do modelo — selecione na InputBar para usar." A infraestrutura local existe; a política de seleção ainda prioriza remoto.

---

## 8. IA no Aura — ⚠️ Parcial (observadora sim; "lado a lado com o kernel" não)

> "A IA é orientada, mas também adaptativa." / "opera lado a lado com o kernel Linux."

**Realidade a favor:**

- **IA operacional e adaptativa:** a Agent observa e opera o sistema via tools (`run_shell`, `terminal`, `process-manager`, `system-monitor`); `observability` grava cada tool call; a stack cognitiva mais `governance` é exatamente o "agente que observa, compreende e auxilia" — e foi construída **sem** controlar o agente (recomendações, não comandos).
- **Orientada:** catálogo de modelos por `purpose` (geral, raciocínio, auxiliar), `benchmark/evidence.json`, slots com cooldown/failover (`llm_keys.js`).

**Realidade contra:**

- "Lado a lado com o kernel Linux" — a IA **tem acesso** ao sistema (processos, módulos), mas o **cérebro roda na nuvem** (DeepSeek, OpenRouter, Codex...), não no kernel nem em hardware local. O que é `lado a lado` hoje é o agente; o raciocínio é remoto.

---

## Tensões estruturais (resumo das fugas)

### A. IA remota como dependência estrutural (a maior fuga)
Manifesto: "dependência de serviços externos deve ser escolha consciente, não obrigação imposta pela arquitetura."
Realidade: `strategy: "fallback"` com pools remotos habilitados por default; o pool local existe mas não é priorizado pelo `auto`.

### B. "Aplicações são containers" → systemd units
Fuga pragmática **consciente e documentada** (`tenant-systemd/AGENT.md`) — Docker não cabe na VPS de 477 MB. O encapsulamento por tenant ficou, o isolamento por container não.

### C. Cloud-first multi-tenant vs "hardware pequeno"
Deriva, não fuga: as peças continuam simples e substituíveis; o que mudou foi o produto (de um sistema pessoal para um SaaS com `billing`, `store`, `fleet`, `machine-registry`).

---

## O futuro: LLM local + ThinkIac Local (nota do usuário, 2026-08-19)

O usuário apontou que novas versões com **LLM local** e **ThinkIac Local** serão lançadas. Leitura honesta do estado atual para essa rota:

- **LLM local: a infra já existe.** O pool Ollama (`qwen2.5:3b`, `nomic-embed-text`) está no `agent.config.json`, habilitado, com descoberta de modelos via `/api/tags`. O que falta é **política**: o `auto` não escolhe local (prior de qualidade por tamanho). A rota natural é o local entrar como primeira opção nas cargas `auxiliar` (título de sessão, sumarização, classificação, extração) — antes dos free tiers remotos — e o remoto ficar para raciocínio pesado, como escolha.
- **ThinkIac Local: o embrião está em `bridge` + `shadow` + `hermes`.** Sync offline-first decidida no local, overlay transacional, fila offline de aparelhos. O que falta é o sistema inteiro rodar sem rede: LLM local como cérebro default, apps locais por padrão, e cloud como espelho opcional (exatamente o que `bridge` já faz com resolução de conflitos no local).

---

## Recomendações práticas

1. **Subir o pool local no catálogo** para as cargas `auxiliar` (antes dos free remotos) — reduz dependência sem perder qualidade na carga pesada. Decisão já suportada pela separação de `purpose` do `free-pool`.
2. **Medir o que `qwen2.5:3b` aguenta** (tool calling, contexto, latência) e registrar em `benchmark/evidence.json` — decisão baseada em evidência, no estilo do projeto.
3. **Definir o contrato do ThinkIac Local** explicitamente: runtime que opera sem rede, com sync via `bridge` quando a rede voltar — e o manifesto atualizado deve refletir isso (não containers, mas encapsulamento; IA híbrida local-first).
4. **Revisitar o manifesto** com a linguagem do que o projeto realmente virou — ou realinhar a arquitetura com o manifesto. O documento atual serve de base para as duas decisões.
