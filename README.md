# ThinkIac

ThinkIac é infraestrutura como código para agentes, aplicativos e automações.
Seu Harness operacional reúne interface, ferramentas, terminal, arquivos,
provedores de IA e pacotes sem transformar o núcleo em monólito.

O Lógos descobre os pacotes, aplica o ciclo de vida e conecta eventos. Cada
pacote pode expor HTTP, tools, banco, views e integrações. Especialistas são
capacidades ativadas sob demanda ou condicionadas de forma explícita: uma
arquitetura de especialistas combináveis, semelhante a MoE, mas governada por
contratos e infraestrutura declarada.

### Captura de Telas

<img width="720" alt="thinkiac cloud_view_shell_Index" src="https://github.com/user-attachments/assets/215e73db-7f0a-46fd-a081-0500156a83be" />

## Packages

Packages podem ser revisados e instalados separadamente no workspace ativo.

| Package | Descrição |
| --- | --- |
| [Calendar](https://github.com/ThinkIac/calendar) | Calendários, eventos, lembretes e ferramentas MCP para o ThinkIac. |
| [Tasks](https://github.com/ThinkIac/tasks) | Kanban, rotas HTTP, ferramentas MCP e eventos de tarefas para o ThinkIac. |
| [WhatsApp Manager](https://github.com/ThinkIac/whatsapp-manager) | Sessões, QR code, conversas e mensagens pelo WhatsApp. |
| [Flows](https://github.com/ThinkIac/flows) | Editor visual de automações, gatilhos por evento, cron e webhook, com execução durável. |
| [Telegram](https://github.com/ThinkIac/telegram) | Bot do Telegram com sessões, atendimento público controlado, progresso de reasoning e tool MCP para envio de mensagens. |
| [Instagram Bridge](https://github.com/ThinkIac/instagram-bridge) | Integração de conteúdo para Instagram, com geração, agendamento e publicação por Graph API. |
| [GitHub](https://github.com/ThinkIac/github) | Repositórios, branches, Git autenticado, issues e pull requests com credenciais gerenciadas pelo ThinkIac. |
| [Cloudflare](https://github.com/ThinkIac/cloudflare) | Integração Cloudflare para OAuth, catálogo de capacidades, chamadas nativas e auditoria. |

Veja os repositórios públicos da organização ThinkIac marcados com o tópico [packages](https://github.com/orgs/ThinkIac/repositories?type=all&q=topic%3Apackages&language=&sort=).

Antes de instalar um package, peça ao seu assistente de IA para analisar o repositório e as permissões envolvidas.

## Contratos de pacotes e interface

O `package.json` de cada pacote declara contribuições, mas cada host interpreta
somente os campos sob sua responsabilidade. O Lógos descobre o pacote e aplica
seu ciclo de vida; Shell, Agent e Settings materializam as integrações de UI.

| Quero declarar | Campo ou contrato | Responsável | Exemplo | Referência |
| --- | --- | --- | --- | --- |
| Item de menu | `manifest.menu` | Shell | [`pkgmgr`](packages/pkgmgr/package.json) | [Menu do Shell](packages/shell/README.md#menu) |
| Bloco no chat / `MessageList` | `manifest.widget` | Shell e Agent | [`terminal`](packages/terminal/package.json) | [Widgets e UI bus](packages/agent/docs/package-widgets-and-ui-bus.md) |
| Aba administrativa | `manifest.settingsTab` | Settings | [`specialists`](packages/specialists/package.json) | [Settings](packages/settings/README.md#aba-administrativa) |
| Credenciais de integração | `manifest.keysTab` | Settings | pacote de integração | [Integrações](packages/settings/README.md#integrações-e-credenciais) |
| Formulário declarativo | `renderer: "schema"` e `surface` | Settings e `ui-schema` | [`auth`](packages/auth/package.json) | [`ui-schema`](packages/ui-schema/README.md) |
| Confirmação, alerta ou prompt | componente da view | `ui-dialogs` | contrato do pacote | [`ui-dialogs`](packages/ui-dialogs/AGENT.md) |
| Ícone do pacote ou menu | `icon`, `iconDark`, `iconPreset`, `menu.icon` | Shell | [`openai-bridge`](packages/openai-bridge/package.json) | [Ícones](packages/shell/README.md#ícones-do-manifesto) |
| Banco e isolamento | `schema.prisma`, `isolated`, `database` | Lógos e Scriba | pacote com schema | [Persistência](vendor/packages/logos/docs/package-integrations.md#banco-e-isolamento) |

### Menu, widgets e `MessageList`

`manifest.menu` adiciona navegação para uma view local. `manifest.widget` registra
uma linguagem de bloco Markdown que o `MessageList` pode renderizar em uma view
isolada; ele não cria item de menu e não concede permissão para executar o texto
da mensagem. Exemplo mínimo:

```json
{
  "manifest": {
    "widget": {
      "lang": "bash",
      "title": "Terminal",
      "view": "Widget",
      "aliases": ["shell", "sh"]
    }
  }
}
```

Altura, streaming de mensagens parciais e comunicação com a view seguem o
[contrato de widgets e UI bus](packages/agent/docs/package-widgets-and-ui-bus.md).

### Settings, `ui-schema` e diálogos

Use `settingsTab` para configuração administrativa e `keysTab` para credenciais.
Ambos aceitam objeto ou lista. O renderer padrão é uma view em `iframe`;
`renderer: "schema"` exige uma `surface` válida do `ui-schema`. O pacote dono
continua responsável por autenticação, autorização e validação de cada ação.
Segredos não devem aparecer no manifesto nem no schema da interface.

Para fluxos declarativos, consulte [`ui-schema`](packages/ui-schema/README.md).
Para `confirm`, `prompt` e `alert` dentro de views, use
[`ui-dialogs`](packages/ui-dialogs/AGENT.md). Não existe um pacote `ui-modal`
neste repositório.

### Ícones interpretados pelo Shell

1. `manifest.menu.icon` e `menu.iconDark` valem apenas para o item de menu.
2. Sem ícone próprio, o menu herda `manifest.icon` e `iconDark`.
3. `manifest.iconPreset` seleciona um ícone do catálogo, por exemplo
   `{ "pack": "lucide", "name": "Terminal" }`.
4. Sem variante aplicável, o renderer usa seu fallback visual.

`icon` e `iconDark` são caminhos de recursos do pacote. `color` e `bgColor`
devem ser cores CSS válidas. A referência completa fica no
[README do Shell](packages/shell/README.md#ícones-do-manifesto).

### Banco, cifragem e isolamento

Um `schema.prisma` provisiona tenant e diretório de banco por pacote. Para dados
exclusivos do dono, declare no topo do `package.json`:

```json
{
  "isolated": true,
  "database": "private"
}
```

Esse modo executa o pacote em runner filho e usa tenant privado cifrado em
repouso pelo vault SQLCipher. Outros pacotes não recebem acesso direto; o dono
expõe dados por tool, rota ou evento. `runtime.isolation.critical` protege estado
crítico contra reinicializações globais silenciosas. Garantias, chaves, recarga
e rollback estão no [contrato do Lógos](vendor/packages/logos/docs/package-integrations.md).

## Começar a partir de uma VPS

Em Debian ou Ubuntu com `systemd`, execute como usuário com `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/ThinkIac/ThinkIac/main/scripts/install.sh | sudo bash
```

O instalador baixa a versão atual de `main`, instala Node.js 22 e as dependências,
cria `/opt/thinkiac` e inicia o serviço `thinkiac`. Repetir o comando atualiza a
instalação sem sobrescrever edições locais.

```bash
sudo systemctl status thinkiac
sudo journalctl -u thinkiac -f
```

Abra `http://SEU_IP:5040/view/auth/Login`. Antes de expor a instância, configure
firewall, HTTPS e um provedor de IA. Na primeira instalação a senha de administrador
é exibida uma vez; também é possível defini-la com `THINKIAC_ADMIN_EMAIL` e
`THINKIAC_ADMIN_PASSWORD` antes do comando.

## Docker

```bash
git clone https://github.com/ThinkIac/ThinkIac.git
cd ThinkIac
cp .env.example .env
# Edite .env: defina AUTH_ENV_ADMIN_PASSWORD e um provedor de IA.
docker compose up -d --build
```

O Compose mantém dados no volume `thinkiac_data`. Para atualizar:

```bash
git pull --ff-only
docker compose up -d --build
```

Sem Compose:

```bash
docker build -t thinkiac:local .
docker run -d --name thinkiac --restart unless-stopped \
  --env-file .env -e HOST=0.0.0.0 -p 5040:5040 \
  -v thinkiac_data:/data thinkiac:local
```

## Seu primeiro pacote: notas

O pacote abaixo combina o banco do Scriba, um hook como serviço, rota, tool e
um evento de ciclo de vida. `notes:register` recebe o pedido; rota e tool
apenas chamam esse evento.
O serviço grava a nota e retorna-a pelo seu evento de ciclo de vida,
`notes:registered`.

```prisma
// packages/notes/schema.prisma
model Note {
  id    String @id @default(uuid())
  title String
  text  String
}
```

```prisma
// packages/notes/features/pinning.scriba
model Note {
  pinned Boolean @default(false)
}
```

O Scriba compõe esse fragmento ao schema do pacote e provisiona o banco isolado
antes de expor as interfaces.

```js
// packages/notes/service.js
import { $, getProxy } from 'logos';

/**
 * @register_hook notes:register
**/
export async function registerNote(payload) {
  const notes = getProxy('notes');
  const note = await notes.Note.push({
    title: payload.title,
    text: payload.text
  });

  return $('notes:registered', note);
}
```

```js
// packages/notes/tools.js
import { $ } from 'logos';

/**
 * @register_tool registerNote
 * @description Registra uma nota.
 * @param {string} title - Título
 * @param {string} text - Texto
**/
export function registerNoteTool({ title, text }) {
  return $('notes:register', { title, text });
}
```

```js
// packages/notes/routes.js
import { $ } from 'logos';

/**
 * @register_router notes
 * @method post
**/
export async function registerNoteRoute(req) {
  return { data: await $('notes:register', req.body ?? {}) };
}
```

Uma tool, uma rota ou outro pacote chamam o mesmo serviço por
`$('notes:register', payload)`. `$()` passa o payload pelos hooks e devolve o
último valor não nulo. Sem nenhum hook em `notes:registered`, devolve a própria
nota, portanto o evento é seguro mesmo sem ouvintes. O Scriba reconhece `Note`
porque ela foi declarada no schema e `getProxy('notes').Note` expõe esse model
para o pacote.

Consulte a [documentação completa de decorators](docs/decorators.md) para todos
os decorators ativos e o contrato de eventos do Harness.

## Desenvolvimento local

Requer Node.js 22+.

```bash
git clone https://github.com/ThinkIac/ThinkIac.git
cd ThinkIac
cp .env.example .env
npm ci --legacy-peer-deps
npm run start:runtime
```

## Segurança

ThinkIac pode acessar terminal, arquivos e credenciais. Não versione `.env`,
sessões, bancos locais, uploads ou backups. Revise `git status` antes de publicar
e exponha portas apenas quando necessário.

## Licença e apoio

O desenvolvimento do ThinkIac começou bem antes do primeiro commit. Estou há
um longo período sem emprego fixo, priorizando este projeto. Se ele ajudar você
ou se pretender comercializá-lo, considere pagar o valor que quiser por uma
licença anual neste primeiro momento. Para isso, envie USDC na rede Polygon
para:

`0x463712863f400dedc8f199d1dab9eb1fd7daf696`

Os termos completos de licença e redistribuição serão publicados com a primeira
versão estável.
