import { createRuntimeModule, notifyReady } from '@logos/supervisor/runtime.cjs';
import { bootstrap, dispatchEvent as $, recoverIsolatedPackage } from 'logos';
import { existsSync } from 'fs';
import { installGracefulShutdown } from './lib/runtime-lifecycle.js';
import { applyRuntimeBootstrapExtensions } from './lib/runtime-bootstrap-extensions.js';
import { normalizeViewAlias } from './lib/view-alias.js';
import { corsOptions, setSecurityHeaders } from './lib/http-security.js';

// Auth é uma extensão do host, não uma dependência do kernel Lógos. Uma
// instalação mínima pode não carregar esse pacote e, nesse caso, não instala
// nenhum gate de sessão, MCP ou WebSocket.
async function loadIdentity() {
  const moduleUrl = new URL('./packages/auth/index.js', import.meta.url);
  if (!existsSync(moduleUrl)) return null;
  return import(moduleUrl.href);
}

const main = async () => {
  try {
    const desktop = process.env.THINKIAC_DESKTOP === '1';
    const identity = await loadIdentity();
    const accessGate = (req, res, next) => {
      if (desktop && req.method === 'GET' && req.path === '/__ready' && req.socket.remoteAddress === '127.0.0.1') return next();
      return identity.accessGate(req, res, next);
    };
    const runtimeConfig = await applyRuntimeBootstrapExtensions({
      workspace: './packages',
      environment: process.env,
      config: {
        workspace: './packages',
        // The host selects capabilities; Logos owns no product module list.
        externalModules: ['commands', 'credentials', 'db', 'env', 'hooks', 'http',
          'isolated-runtime', 'legacy-entry', 'mcp', 'proc', 'repo', 'stabilizer', 'storage', 'svelte',
          'tools', 'websocket-runtime', 'workers'],
        modules: [createRuntimeModule({ recoverIsolatedPackage })],
        port: Number(process.env.PORT) || 5040,
        host: process.env.HOST || '127.0.0.1',
        http: { public: 'public' },              // static files next to packages/
        cors: corsOptions(process.env.THINKIAC_CORS_ORIGINS),
        // Porta do transporte MCP. Fixa em 3333 no logos, o que impede duas
        // instâncias na mesma máquina: a segunda morre com EADDRINUSE, e o
        // erro vem por evento 'error' do server, fora do alcance do try/catch
        // do bootstrap — derruba o processo. Com vários tenants por VPS
        // (packages/tenant-systemd) isso deixa de ser hipótese, então a porta
        // acompanha a do runtime por padrão.
        // O default 3333 é mantido de propósito: clientes MCP já apontam para
        // ele, e mudá-lo por conta da variável PORT quebraria as instalações
        // existentes. Só um MCP_PORT explícito desvia.
        mcp: { http: true, port: Number(process.env.MCP_PORT) || 3333,
          host: process.env.MCP_HOST || '127.0.0.1',
          allowRemote: process.env.MCP_ALLOW_REMOTE === '1',
          ...(identity ? { auth: identity.mcpAuth } : {}) },
        // Com Auth instalado, preserva o controle de acesso atual. Sem ele,
        // omitimos os três adaptadores para o Runtime continuar público.
        middleware: [normalizeViewAlias, setSecurityHeaders, ...(identity ? [accessGate] : [])],
        ...(identity ? {
          ws: { authorize: async req => {
            const resolved = await identity.identityProvider.resolve(req);
            return Boolean(resolved?.user.role === 'admin' && !resolved.session.delegatedSubject);
          } },
        } : {}),
        views: {
          precompileCss: true,
          warmup: process.env.THINKIAC_VIEW_WARMUP === '0' ? [] : [
            desktop ? { package: 'auth', page: 'Login' } : { package: 'desktop', page: 'Index' },
            { package: 'shell', page: 'Index' },
          ],
          bootstrap5: false,                     // conflita com o CSS próprio de main-site/auth
          tailwind: true,                        // agent inteira depende de classes utilitárias Tailwind — sem isso nada delas gera CSS de verdade
          theme: { 'bs-primary': '#6d28d9', 'border': '#000' },       // CSS variables into every page
          index: { package: 'main-site', page: 'Index' }
        },
      },
    });

    await bootstrap(runtimeConfig);

    console.log("Runtime is ready.")

    await $('boot', {})
    installGracefulShutdown({ dispatch: $ })
    notifyReady()
  } catch (err) {
    console.error("Runtime bootstrap failed:", err)
    process.exit(1)
  }
}

main();
