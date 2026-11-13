# ThinkIac

ThinkIac é infraestrutura como código para agentes, aplicativos e automações.
Seu Harness operacional reúne interface, ferramentas, terminal, arquivos,
provedores de IA e pacotes sem transformar o núcleo em monólito.

O Lógos descobre os pacotes, aplica o ciclo de vida e conecta eventos. Cada
pacote pode expor HTTP, tools, banco, views e integrações. Especialistas são
capacidades ativadas sob demanda ou condicionadas de forma explícita: uma
arquitetura de especialistas combináveis, semelhante a MoE, mas governada por
contratos e infraestrutura declarada.

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

## Seu primeiro pacote fullstack: notas

O pacote abaixo combina o banco do Scriba, um hook como serviço, rota, tool e
view. `notes:register` recebe o pedido; rota e tool apenas chamam esse evento.
O serviço grava a nota e retorna-a pelo seu evento de ciclo de vida,
`notes:registered`. A view pode ouvir esse mesmo ciclo de vida e atualizar a
lista sem buscar os dados de novo.

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
// packages/notes/realtime.js
import { broadcast } from 'logos';

/**
 * @register_hook notes:registered
**/
export function sendRegisteredNoteToViews(note) {
  broadcast({
    type: 'bus:event',
    event: 'notes:registered',
    detail: note
  });

  return note;
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

```svelte
<!-- packages/notes/views/Home.svelte -->
<script>
  import { onMount } from 'svelte';

  let title = '';
  let text = '';
  let saved = false;
  let notes = [];

  onMount(() => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws?session=notes`);

    function receive(event) {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type !== 'bus:event' || message.event !== 'notes:registered') return;

      const note = message.detail;
      if (!note?.id || notes.some(item => item.id === note.id)) return;
      notes = [note, ...notes];
    }

    socket.addEventListener('message', receive);
    return () => {
      socket.removeEventListener('message', receive);
      socket.close();
    };
  });

  async function submit() {
    const response = await fetch('/notes/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, text })
    });
    saved = response.ok;
  }
</script>

<form on:submit|preventDefault={submit}>
  <label>Título <input bind:value={title} required /></label>
  <label>Texto <textarea bind:value={text} required /></label>
  <button type="submit">Salvar nota</button>
  {#if saved}<p>Nota registrada.</p>{/if}
</form>

<ul>
  {#each notes as note (note.id)}
    <li><strong>{note.title}</strong>: {note.text}</li>
  {/each}
</ul>
```

Assim, uma tool, uma rota, a view Svelte ou outro pacote chamam o mesmo serviço
por `$('notes:register', payload)`. `$()` é a única operação de evento do
exemplo: ela passa o payload pelos hooks e devolve o último valor não nulo. Sem
nenhum hook em `notes:registered`, devolve a própria nota, portanto o evento é
seguro mesmo sem ouvintes. O Scriba reconhece `Note` porque ela foi declarada no
schema e `getProxy('notes').Note` expõe esse model para o pacote. Consulte
[docs/decorators.md](docs/decorators.md) para os decorators ativos e o contrato
de eventos do Harness.

O `fetch` do formulário continua sendo apenas o pedido de criação. Não há novo
`fetch` para atualizar a lista: o hook observador transmite a nota já criada e
a view a insere ao receber `notes:registered`. `broadcast` entrega a todas as
abas conectadas, portanto o payload deve ser apropriado para todos os usuários
que podem ver essas notas. Para dados privados, a entrega deve ser limitada a
uma sessão ou sala autorizada, não transmitida globalmente.

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
