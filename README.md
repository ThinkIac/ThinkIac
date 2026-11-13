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
