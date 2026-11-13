# ThinkIac

## An operating system for agents

ThinkIac is not a chat box with tools glued onto it. It is an operational environment where agents can talk, use a terminal, read and edit files, call models, operate tools, and evolve the system they are running in.

Think of it as ChatGPT with hormones: it can perceive, decide, act, and adapt its own anatomy. A package can be added, repaired, or replaced while the runtime is alive, without turning every change into a stop-the-world deployment.

That does not mean blind hot reloading. Candidate changes are staged and checked before promotion. In-flight work stays on the current version; new work moves to the candidate only after it is ready. When a package fails its checks or becomes unstable, Lógos can keep the active version serving and return the package to its last known checkpoint.

> ThinkIac is for people who want agents that work on a real computer, not merely talk about one.

## Lógos: the dynamic foundation

Lógos is the runtime at ThinkIac's core. Its essential job is deliberately small: discover packages, resolve what they declare, manage their lifecycle, and provide an event bus. It does not hard-code HTTP, views, tools, databases, or MCP into the kernel.

Those capabilities arrive as packages. This makes the runtime composable: an HTTP module can define how applications expose routes, a tools module can define how applications give an agent actions, and a view module can define how applications present an interface. The kernel coordinates them instead of becoming a monolith that owns everything.

```text
                         Lógos
      discovery · resolution · lifecycle · event bus · stabilizer
                            │
             ┌──────────────┼──────────────┐
             │              │              │
       capability modules  capability modules  capability modules
       HTTP / views        tools / MCP         WebSocket / data
             │              │              │
             └──────────────┴──────────────┘
                            │
                       active apps
        agent · shell · terminal · editor · integrations
```

### Two kinds of packages

- **Active packages (apps)** deliver a final capability: an agent, route, interface, specialized event, tool, integration, or service.
- **Passive packages (modules)** provide the protocol or capability that apps build on: HTTP, views, tools, MCP, authentication, data, and more.

Packages communicate through events and do not need to know each other's implementation details. They can also cooperate across processes. The result is a system whose behavior is assembled at runtime rather than welded into a single application.

The [Lógos documentation](vendor/packages/logos/README.md) covers only the
launcher boundary, external-module protocol and the remaining migration. The
application-facing syntax belongs to ThinkIac; start with the
[decorator reference](docs/decorators.md) for routes, tools, hooks, commands
and generic declarations.

## Included package set

The workspace currently includes the following first-party packages. A deployment does not have to use every one of them.

| Area | Packages | What they provide |
| --- | --- | --- |
| Core workspace | `agent`, `shell`, `auth`, `settings`, `redirect`, `reboot` | Agent runtime and CLI workflows, the main shell, sign-in, configuration surfaces, home routing, and supervised restart support. |
| Computer access | `terminal`, `file-manager`, `code-editor`, `system-monitor` | A real PTY terminal, file browsing and previews, code editing, and host resource visibility. |
| Agent intelligence | `providers`, `openrouter`, `openai-bridge`, `mcp`, `memory`, `classification`, `specialists` | Model-provider configuration, OpenRouter and OpenAI-compatible access, MCP discovery, long-term memory, local intent classification, and specialized agents. |
| Runtime safety and composition | `governance`, `ui-schema`, `ui-dialogs`, `pkgmgr` | Deterministic action governance, declarative admin UI contracts, embedded-view dialogs, and package installation and lifecycle management. |
| Connected workflows | `github`, `hermes`, `engineer` | GitHub and Git-over-SSH tools, authenticated paired-device messaging, and an engineering workflow with plan, diff, approval, and rollback. |

The bootstrap entry point is [`index.js`](index.js); packages are discovered from [`packages/`](packages/). Package availability can vary by release profile and local configuration.

## What you can build on it

The interesting part is not only the packages that ship today. They are examples of the kinds of capabilities a ThinkIac workspace can grow into.

| If you need… | Add or build a package that… |
| --- | --- |
| A private internal assistant | combines a custom view, domain tools, local documents, and a provider selected through `providers`. |
| A deployment agent | listens for an event, calls a CI or cloud API through a tool, records its outcome, and renders a small operational view. |
| A new communication channel | provides an authenticated transport module, then lets active packages publish and consume its events. |
| A product-specific control panel | uses `ui-schema` or a custom view while keeping business logic in a separate active package. |
| A new source of agent context | exposes files, databases, or external services through MCP or purpose-built tools, with governance around consequential actions. |

For example, an `http` capability module can establish a route contract. A `deployments` app can then register `/deploy`, expose a `deploy_release` agent tool, and subscribe to deployment events without teaching the Lógos kernel anything about HTTP or your cloud provider. Replace that app, and the rest of the runtime keeps its own responsibilities.

## Build and connect a package

A package exposes capabilities with small JSDoc registrations. The installed
ThinkIac modules discover and interpret them while the runtime is running;
application code stays ordinary ES modules.
The most useful starting point is an event: one package publishes a fact and
any interested package reacts to it.

### Publish and receive an event

Publish an object with a namespaced event name. Use a namespace owned by your
package, such as `tasks:*`; runtime namespaces like `runtime:*`, `package:*`,
and `tool:*` are reserved.

```js
// packages/tasks/create.js
import { dispatchEvent } from 'logos';

export async function createTask({ title }) {
  const task = { id: crypto.randomUUID(), title, done: false };

  // This waits for the event pipeline to finish.
  await dispatchEvent('tasks:created', task);

  return task;
}
```

Receive it from the same package or another one. The registration is inside the
exported function, and the handler receives the payload plus runtime context.

```js
// packages/activity/hooks.js
export function recordTaskCreated(task, context) {
  /**
   * @register_hook tasks:created
   */
  console.log(`Task ${task.id} was created by ${context.pkg}`);
}
```

Hooks can also use `@register_hook tasks:*`. A hook that returns a non-null
object replaces the payload received by the next hook, so observer hooks should
usually return nothing. `dispatchEvent()` is therefore suited to a deliberate
pipeline, not a fire-and-forget notification.

### Expose and consume an HTTP route

Routes live below the package name. This package exposes
`GET /tasks/tasks`; the returned object becomes JSON.

```js
// packages/tasks/routes.js
export function listTasks() {
  /**
   * @register_router tasks
   * @method GET
   */
  return { tasks: [{ id: 't1', title: 'Read the docs', done: false }] };
}
```

Any view or external client consumes the route with normal HTTP. Browser-session
authorization applies when the host has it enabled.

```js
const response = await fetch('/tasks/tasks');
if (!response.ok) throw new Error(`Could not load tasks: ${response.status}`);
const { tasks } = await response.json();
```

```bash
curl http://127.0.0.1:5040/tasks/tasks
```

Keep ordinary routes under the package prefix. A route that begins with `/` is
mounted at the runtime root and is only appropriate for an externally fixed
protocol path.

### Expose a tool to an agent or MCP client

Tools are functions the runtime describes as JSON Schema and offers to the
agent and MCP surface. Use one object argument and declare its fields with
`@param`.

```js
// packages/tasks/tools.js
import { createTask } from './create.js';

export async function addTask({ title }) {
  /**
   * @register_tool addTask
   * @description Creates a task with the supplied title.
   * @param {string} title - Task title
   */
  return createTask({ title });
}
```

After discovery, an agent can call `addTask` when it is relevant, and an MCP
client sees the same name, description, and input schema. The function is not
an HTTP endpoint by default: use its MCP integration to invoke it, or expose a
route when a browser or conventional HTTP client needs that operation. Keep the
shared business logic in plain functions, as above, so a route, a tool, and an
event handler can safely reuse it without importing another package's internals.

For richer integrations, compose these same boundaries: use events for loose
cross-package reactions, routes for request/response clients, tools for
agent/MCP actions, and views to call routes or render their results.

### Standard events and the optional `$` call contract

The composed runtime emits lifecycle and capability events. Their owner is the
module that provides the capability, not the Lógos launcher. Common compatible
entry points in the current ThinkIac host are:

| Event | Use |
| --- | --- |
| `runtime:ready` | Runtime started and HTTP is listening. |
| `http:request` | Observe a request handled by a package. |
| `tool_before` / `tool_after` | Observe tool execution. |
| `reload:validating` | Veto a package hot-swap when a required condition is absent. |
| `reload:stable` / `package:reload_failed` | React to a completed swap or failed candidate. |
| `views:file_changed` / `views:package_reloaded` | React to view source or package changes. |
| `db:schema_changed` / `proc:crashed` | Observe schema edits or process-module failures. |

Own application events should use the package namespace, such as
`orders:created`. Runtime namespaces including `runtime:`, `package:`,
`route:`, `tool:`, `agent:`, `reload:`, `views:`, `db:`, `http:`, `auth:`, and
`proc:` are reserved.

`$()` still exists, but it is not just shorter `dispatchEvent()`. With no
`"$"` field in `package.json`, it keeps the legacy pipeline behavior. When a
package opts in, it receives a contextual, approval-gated event-call contract:

```json
{
  "name": "agenda",
  "$": ["agent::llm:call"]
}
```

```js
import { $ } from 'logos';

await $('task:created', { id: 't1' });       // becomes agenda::task:created
await $('agent::llm:call', { messages: [] }); // must be in the effective contract
```

Use `dispatchEvent()` for normal, backwards-compatible event pipelines. Choose
`$()` or `PackageContext.events.call()` only when package-qualified calls and
host approval are intentional. These remain compatibility APIs while event and
authority ownership moves to external modules.

### Complete hypothetical package: reminders

The following is a hypothetical `reminders` package. It illustrates a useful
service shape: route and tool are interfaces, while the domain request belongs
to an event. It is not a built-in ThinkIac package.

```text
HTTP route ─┐
            ├── requestReminder() ──> reminders:requested ──> service hook
MCP tool ──┘                                             │
                                                          └──> reminders:created
```

```js
// packages/reminders/service.js
import { dispatchEvent } from 'logos';

export function requestReminder({ title, dueAt }) {
  if (!title?.trim()) throw new Error('title is required');
  return dispatchEvent('reminders:requested', { title: title.trim(), dueAt });
}
```

```js
// packages/reminders/hooks.js
import { dispatchEvent, emit } from 'logos';

/**
 * @register_hook reminders:requested
 */
export async function createReminder({ title, dueAt }) {
  const reminder = { id: crypto.randomUUID(), title, dueAt: dueAt ?? null };
  await emit('reminders:created', reminder);
  return reminder; // result for the route and tool
}

/**
 * @register_hook reminders:created
 */
export function observeReminder(reminder) {
  console.log(`Reminder created: ${reminder.id}`);
  // No return: observer hooks do not transform the payload.
}
```

```js
// packages/reminders/routes.js
import { requestReminder } from './service.js';

/**
 * @register_router reminders
 * @method post
 */
export async function createReminderRoute(req) {
  return { data: await requestReminder(req.body ?? {}) };
}
```

```js
// packages/reminders/tools.js
import { requestReminder } from './service.js';

/**
 * @register_tool createReminder
 * @description Creates a scheduled reminder.
 * @param {string} title - Reminder text
 * @param {string?} dueAt - ISO-8601 due date and time
 */
export function createReminderTool({ title, dueAt }) {
  return requestReminder({ title, dueAt });
}
```

`POST /reminders/reminders` and the `createReminder` tool return the same
created reminder. Another package can subscribe to `reminders:created` without
importing this package. The decorators used by each interface are catalogued in
the [ThinkIac decorator reference](docs/decorators.md).

## Quick start on a fresh VPS

The direct installer supports Debian/Ubuntu with systemd. It downloads the
current `main` revision from this GitHub repository, installs Node.js 22 and
the native build toolchain, creates `/opt/thinkiac`, and starts a persistent
`thinkiac` service. Run it as a privileged user:

```bash
curl -fsSL https://raw.githubusercontent.com/ThinkIac/Think/main/scripts/install.sh | sudo bash
```

On the first install it generates an administrator password and prints it once.
Set `THINKIAC_ADMIN_EMAIL` and `THINKIAC_ADMIN_PASSWORD` before the command if
you prefer to choose the initial credentials. The installer is idempotent: run
the same command again to fetch the current version and restart the service.
It stops instead of overwriting local source edits.

```bash
sudo systemctl status thinkiac
sudo journalctl -u thinkiac -f
```

The service binds HTTP to port `5040`; open
`http://YOUR_SERVER_IP:5040/view/auth/Login`. Configure a firewall and HTTPS
reverse proxy before exposing the instance to the internet.

## Docker and Docker Compose

Docker Compose is the recommended container installation. It builds the image
locally, loads configuration from `.env`, and persists package SQLite databases
and Lógos state in the `thinkiac_data` named volume.

```bash
git clone https://github.com/ThinkIac/Think.git
cd Think
cp .env.example .env
# Edit .env: at least change AUTH_ENV_ADMIN_PASSWORD and configure an LLM provider.
docker compose up -d --build
```

Use `docker compose logs -f` to follow startup. To update, pull the repository
and rebuild with `git pull --ff-only && docker compose up -d --build`.

The standalone Docker equivalent is:

```bash
docker build -t thinkiac:local .
docker run -d --name thinkiac --restart unless-stopped \
  --env-file .env -e HOST=0.0.0.0 -p 5040:5040 \
  -v thinkiac_data:/data thinkiac:local
```

## Run locally

Requires Node.js **22+**. `node-pty` may require a native compiler toolchain for your platform.

```bash
git clone <your-fork-or-repository> thinkiac
cd thinkiac
cp .env.example .env
npm ci --legacy-peer-deps
npm run start:runtime
```

Open `http://127.0.0.1:5040/view/auth/Login`. A fresh installation guides you through creating the first administrator.

To start with an agent, configure at least a provider and an admin account:

```dotenv
AGENT_LLM_PROVIDER=openrouter
AGENT_LLM_API_KEY=your-key
AGENT_LLM_MODEL=your-model
AUTH_ENV_ADMIN_EMAIL=you@example.com
AUTH_ENV_ADMIN_PASSWORD=use-a-strong-password
```

HTTP uses port `5040` and MCP's HTTP transport uses port `3333` by default. Review `.env.example` before exposing a port or configuring OAuth, cloud services, billing, or external storage.

## Safety and current limits

ThinkIac can use a terminal, access files, and handle your model credentials. Treat it as a privileged environment. Never commit `.env` files, sessions, local databases, uploads, backups, or terminal profiles; inspect `git status` before publishing.

This is an evolving development foundation. Individual integrations may require
their own setup. Binaries and large media belong in Releases, a CDN, or Git LFS
rather than the primary Git history.

## Coffee for the builder

I put a lot of time into this project. If it helps you, consider buying me a coffee for the effort 😅

USDC on TRON: address to be added.

License and redistribution terms will be published with the initial release.
