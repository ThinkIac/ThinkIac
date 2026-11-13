# ThinkIac

Runtime operacional para agentes. Ele reúne interface, ferramentas, terminal,
arquivos, provedores de IA e pacotes que podem ser adicionados ou atualizados
sem transformar o núcleo em um monólito.

O núcleo é o Lógos: ele descobre pacotes, aplica o ciclo de vida e conecta seus
eventos. HTTP, tools, banco, views e integrações são capacidades de pacotes.

## Começar em uma VPS nova

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

Pacotes expõem interfaces pequenas. Aqui, `notes:register` é o serviço: ele é
um hook que recebe o pedido, salva a nota e marca seu próprio ciclo de vida com
`notes:registered`. A rota e a tool não conhecem a implementação, apenas chamam
o evento.

```js
// packages/notes/service.js
import { $ } from 'logos';

/** @register_hook notes:register */
export async function registerNote(payload) {
  const note = { id: crypto.randomUUID(), title: payload.title, text: payload.text };
  Register.push(note); // substitua pelo seu banco ou armazenamento
  await $('notes:registered', note);
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
 */
export function registerNoteTool({ title, text }) {
  return $('notes:register', { title, text });
}
```

```js
// packages/notes/routes.js
import { $ } from 'logos';

/** @register_router notes */
/** @method post */
export async function registerNoteRoute(req) {
  return { data: await $('notes:register', req.body ?? {}) };
}
```

Assim, uma tool, uma rota ou outro pacote usam o mesmo serviço por evento;
outros hooks podem observar `notes:registered`. Consulte
[docs/decorators.md](docs/decorators.md) para os decorators ativos e o contrato
de eventos do runtime.

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

Nesta fase inicial, pague o valor que quiser por uma licença anual. Para apoiar
o desenvolvimento, envie USDC na rede TRON para:

`0x463712863f400dedc8f199d1dab9eb1fd7daf696`

Os termos completos de licença e redistribuição serão publicados com a primeira
versão estável.
