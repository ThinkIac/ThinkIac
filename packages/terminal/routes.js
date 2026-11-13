const {
  issueToken,
  consumeToken,
  listProfiles,
  startPty,
  writePty,
  resizePty,
  killPty,
  detachOwner,
  executeInline,
  createProfile,
  renameProfile,
  deleteProfile,
  profilesInUse,
} = require('.');

const androidEdge = process.env.THINKIAC_RUNTIME_PLATFORM === 'android';
let androidRuntimePromise;
function androidRuntime() {
  androidRuntimePromise ||= import('../android-shell/index.js').then((module) => module.androidShell());
  return androidRuntimePromise;
}

function reply(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function fail(ws, ptyId, message, code) {
  reply(ws, { type: 'terminal:pty:error', ptyId, message, ...(code ? { code } : {}) });
}

async function router_token(req) {
  /**
   * @register_router token
   * @method GET
   */
  // Rota HTTP comum, logo passa pelo accessGate — e /terminal/* não está nos
  // paths públicos, então só admin chega aqui. É este token que prova, do outro
  // lado, que o socket anônimo pertence a um admin. Ver comentário em index.js.
  return { token: issueToken() };
}

async function router_profiles(req) {
  /**
   * @register_router profiles
   * @method GET
   */
  // `inUse` deixa a UI desabilitar renomear/apagar antes de o usuário tentar —
  // o servidor recusa de novo na hora da escrita, então isto é só sinalização.
  if (androidEdge) {
    const runtime = await androidRuntime();
    return { profiles: await runtime.listProfiles(), inUse: runtime.profilesInUse() };
  }
  return { profiles: listProfiles(), inUse: [...profilesInUse()] };
}

async function router_profiles_create(req) {
  /**
   * @register_router profiles
   * @method POST
   */
  try {
    return { ok: true, ...(androidEdge
      ? await (await androidRuntime()).createProfile(req.body?.name)
      : createProfile(req.body?.name)) };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not create profile.' };
  }
}

async function router_profiles_rename(req) {
  /**
   * @register_router profiles/:name
   * @method PATCH
   */
  try {
    return { ok: true, ...(androidEdge
      ? await (await androidRuntime()).renameProfile(req.params?.name, req.body?.name)
      : renameProfile(req.params?.name, req.body?.name)) };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not rename profile.' };
  }
}

async function router_profiles_delete(req) {
  /**
   * @register_router profiles/:name
   * @method DELETE
   */
  try {
    const result = androidEdge
      ? await (await androidRuntime()).deleteProfile(req.params?.name)
      : deleteProfile(req.params?.name);
    // O caminho da lixeira fica no servidor; expor só o nome evita vazar layout de
    // disco para a UI, que não tem o que fazer com ele além de exibir.
    return { ok: true, profileId: result.profileId, profiles: result.profiles };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not delete profile.' };
  }
}

async function router_inline_exec(req) {
  /**
   * @register_router inline-exec
   * @method POST
   */
  try {
    if (androidEdge) {
      return { error: 'Inline execution is unavailable on Android.', code: 'INLINE_EXEC_UNAVAILABLE' };
    }
    return await executeInline(req.body || {});
  } catch (err) {
    return { error: err.message || 'Could not run command.', code: err.code || 'INLINE_EXEC_FAILED' };
  }
}

async function router_capabilities() {
  /**
   * @register_router capabilities
   * @method GET
   */
  if (androidEdge) return (await androidRuntime()).describe();
  try {
    require('node-pty');
    return { provider: 'linux-pty', platform: process.platform, available: true, pty: true };
  } catch (error) {
    return { provider: 'linux-pty', platform: process.platform, available: false, pty: false, code: error.code || 'LINUX_PTY_UNAVAILABLE' };
  }
}

async function router_pty(ws, context, msg) {
  /**
   * @register_router pty
   * @stream
   * @direction bidirectional
   * @channel terminal:pty
   */
  if (!msg) return;

  // O id de sessão do socket é estável entre reconexões (o cliente guarda em
  // sessionStorage), então serve de dono do PTY: é o que permite reencontrar o
  // processo depois de uma queda em vez de abrir outro.
  const owner = context?.sessionId || ws._sessionId || 'default';

  if (!ws._terminalBound) {
    ws._terminalBound = true;
    ws.on('close', () => {
      if (androidEdge) void androidRuntime().then((runtime) => runtime.detachOwner(owner));
      else detachOwner(owner);
    });
  }

  // Um socket pela metade (Wi-Fi que sumiu, aba dormindo no celular) não dispara
  // `close` no cliente: ele só descobre a queda quando um ping fica sem resposta.
  if (msg.action === 'ping') {
    reply(ws, { type: 'terminal:pty:pong', at: Date.now() });
    return;
  }

  if (msg.action === 'auth') {
    ws._terminalAuthed = consumeToken(msg.token);
    if (!ws._terminalAuthed) fail(ws, null, 'Unauthorized session');
    else reply(ws, { type: 'terminal:pty:authenticated' });
    return;
  }

  if (!ws._terminalAuthed) {
    fail(ws, msg.ptyId, 'Unauthorized session');
    return;
  }

  try {
    switch (msg.action) {
      case 'start':
        {
          const args = {
            ptyId: msg.ptyId,
            cols: msg.cols,
            rows: msg.rows,
            profileId: msg.profileId,
            initCommand: msg.initCommand,
            owner,
            onData: data => reply(ws, { type: 'terminal:pty:data', ptyId: msg.ptyId, data }),
            onExit: result => reply(ws, {
              type: 'terminal:pty:exit', ptyId: msg.ptyId,
              exitCode: typeof result === 'object' ? result.exitCode : result,
              signal: typeof result === 'object' ? result.signal : null,
            }),
          };
          const runtime = androidEdge ? await androidRuntime() : null;
          const session = runtime ? await runtime.start(args) : startPty(args);
          reply(ws, {
            type: 'terminal:pty:started',
            ptyId: msg.ptyId,
            label: session.profileId,
          });
        }
        break;
      case 'input':
        if (androidEdge) (await androidRuntime()).write({ ptyId: msg.ptyId, data: msg.data, owner });
        else writePty(msg.ptyId, msg.data, owner);
        break;
      case 'resize':
        if (androidEdge) (await androidRuntime()).resize({ ptyId: msg.ptyId, cols: msg.cols, rows: msg.rows, owner });
        else resizePty(msg.ptyId, msg.cols, msg.rows);
        break;
      case 'kill':
        if (androidEdge) (await androidRuntime()).kill({ ptyId: msg.ptyId, owner });
        else killPty(msg.ptyId, owner);
        break;
    }
  } catch (err) {
    fail(ws, msg.ptyId, err.message, err.code);
  }
}

module.exports = {
  router_token,
  router_profiles,
  router_profiles_create,
  router_profiles_rename,
  router_profiles_delete,
  router_inline_exec,
  router_capabilities,
  router_pty,
};
