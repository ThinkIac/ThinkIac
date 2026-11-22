import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

const output = resolve('dist/runtime')
const archive = (await readdir(output)).find((name) => /^thinkiac-runtime-win-x64-.*\.zip$/.test(name))
if (!archive) throw new Error('ZIP Windows ausente.')
const target = await mkdtemp(join(tmpdir(), 'thinkiac-release-'))
let child
let exited
try {
  execFileSync('7z', ['x', join(output, archive), `-o${target}`], { stdio: 'inherit' })
  const cwd = join(target, 'thinkiac-runtime')
  const port = await freePort()
  const mcpPort = await freePort()
  const email = 'desktop@example.test'
  const password = randomUUID()
  child = spawn(join(cwd, 'node', 'node.exe'), ['index.js'], {
    cwd,
    env: {
      ...process.env,
      THINKIAC_DESKTOP: '1',
      LOGOS_DATA_DIR: join(target, 'data'),
      HOST: '127.0.0.1',
      PORT: String(port),
      MCP_PORT: String(mcpPort),
      INITIAL_AUTH_USER: 'desktopsmoke',
      INITIAL_AUTH_EMAIL: email,
      INITIAL_AUTH_PASSWORD: password,
      INITIAL_AUTH_NAME: 'Desktop Smoke',
    },
    stdio: 'inherit',
    windowsHide: true,
  })
  let failure
  exited = new Promise((done) => {
    child.once('error', (error) => { failure = error; done() })
    child.once('exit', (code, signal) => {
      failure = new Error(`Runtime encerrou (${signal ?? code}).`)
      done()
    })
  })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 90_000
  let ready = false
  while (Date.now() < deadline && !ready) {
    if (failure) throw failure
    try {
      const response = await fetch(`${base}/__ready`, { redirect: 'manual', signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        const status = await response.json()
        ready = status.ready === true && status.failed?.length === 0
      }
      await response.body?.cancel().catch(() => {})
    } catch {}
    if (!ready) await delay(250)
  }
  if (!ready) throw new Error('Runtime extraído não ficou pronto.')
  const localFetch = (path, init = {}) => fetch(`${base}${path}`, {
    redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init,
  })
  const verifyPage = async (path) => {
    const response = await localFetch(path, { headers: { Accept: 'text/html', ...(cookie && { Cookie: cookie }) } })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !(await response.text()).trim()) {
      throw new Error(`A página local ${path} não retornou HTML (${response.status}).`)
    }
  }
  let cookie
  await verifyPage('/view/auth/Login?next=%2Fview%2Fshell%2FIndex')
  const login = await localFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  cookie = login.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ')
  if (!login.ok || !(await login.json()).success || !cookie) {
    throw new Error(`Falha ao autenticar a conta local de teste (${login.status}).`)
  }
  await verifyPage('/view/shell/Index')
} finally {
  child?.kill()
  await exited
  await rm(target, { recursive: true, force: true })
}
