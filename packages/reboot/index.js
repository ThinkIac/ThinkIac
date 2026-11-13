// packages/reboot/index.js — Force a full restart of ThinkIac/Agent
// Tool + REST routes + Hook + Views to reboot the whole runtime process.
// @package reboot

import { writeFileSync, readFileSync } from "fs"
import { spawn } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { requestReboot, getDefaultContainer } from "logos"
import { clearCompiledViewCache } from "./cache.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const FLAG_FILE = join(__dirname, ".reboot-flag")
const RESTART_HELPER = join(__dirname, "restart-helper.cjs")
// Give the active request time to send its final response over the socket
// before the supervisor tears down the Runtime process.
const MIN_RESTART_DELAY_MS = 15_000
const MAX_RESTART_DELAY_MS = 60_000
// Same cache dir used by the SvelteEngine (packages/logos/src/modules/views/engine.ts,
// CACHE_DIR = path.join(process.cwd(), '.svelte-cache')) — process.cwd() is the
// same process in both because reboot runs embedded in the main runtime.
const SVELTE_CACHE_DIR = join(process.cwd(), ".svelte-cache")

function writeFlag(reason) {
  writeFileSync(FLAG_FILE, JSON.stringify({ reason, requestedAt: new Date().toISOString(), pid: process.pid }, null, 2), "utf8")
}

function normalizeRestartDelay(value) {
  const requested = Number(value)
  if (!Number.isFinite(requested)) return MIN_RESTART_DELAY_MS
  return Math.min(MAX_RESTART_DELAY_MS, Math.max(MIN_RESTART_DELAY_MS, Math.floor(requested)))
}

function scheduleSupervisorRestart(supervisorRoot, service, delay) {
  const helper = spawn(process.execPath, [RESTART_HELPER, supervisorRoot, service, String(delay)], {
    detached: true,
    stdio: "ignore",
  })
  helper.unref()
  return helper.pid
}

/**
 * Central handler — pure logic, no decorators, testable in isolation.
 *
 * The global reset is the only runtime operation that is not isolated per
 * package: it charges everyone. The Logos guard says what it costs right now
 * and blocks while someone is still hanging on a package that declared itself
 * critical.
 */
export async function requestSystemRestart(input = {}) {
  const reason = input.reason || "Manual restart requested"
  const delay = normalizeRestartDelay(input.delay)

  const verdict = await requestReboot(getDefaultContainer(), { reason, force: input.force === true })
  if (!verdict.allowed) {
    return {
      success: false,
      blocked: true,
      message: "Restart blocked: " + verdict.blockedBy,
      impact: verdict.impact,
      hint: "Reload only the changed package with runtime_commit, or retry with force: true if the user accepts losing live sessions.",
    }
  }

  // A reinicialização global encerra todas as sessões deste processo. Nunca
  // aceite isso como efeito colateral de uma chamada comum: quem pede precisa
  // confirmar depois de receber o impacto acima.
  if (input.confirm !== true) {
    return {
      success: false,
      confirmationRequired: true,
      message: "Restart not scheduled. Confirm the impact with confirm: true.",
      reason,
      impact: verdict.impact,
      forced: verdict.forced,
    }
  }

  const supervisorRoot = process.env.LOGOS_SUPERVISOR_ROOT
  const service = process.env.LOGOS_SUPERVISOR_SERVICE
  if (!supervisorRoot || !service) {
    return {
      success: false,
      blocked: true,
      message: "Restart blocked: this runtime is not controlled by the Logos supervisor.",
      impact: verdict.impact,
    }
  }

  writeFlag(reason)
  // Tools may execute in short-lived workers. A detached helper survives that
  // worker and the runtime process group long enough to reach the supervisor.
  const helperPid = scheduleSupervisorRestart(supervisorRoot, service, delay)
  return {
    success: true,
    message: "Restart scheduled through Logos supervisor in " + delay + "ms",
    reason,
    pid: process.pid,
    helperPid,
    forced: verdict.forced,
    impact: verdict.impact,
  }
}

/** What a restart would cost right now — without restarting anything. */
export async function getRestartImpact() {
  const verdict = await requestReboot(getDefaultContainer(), { reason: "impact check" })
  return {
    allowed: verdict.allowed,
    blockedBy: verdict.blockedBy || null,
    impact: verdict.impact,
  }
}

export async function rebootAgent(input) {
  /**
   * @register_tool rebootAgent
   * @description LAST RESORT: restarts the WHOLE process, killing the live state of every package (terminal sessions, streams). To apply changes to a single package use runtime_commit, which reloads only that one. Blocked while a live session exists in a critical package — use force only with the user fully aware.
   * @param {object?} input - Optional parameters
   * @param {string?} input.reason - Reason for the restart (default: "Manual restart requested")
   * @param {number?} input.delay - Delay in ms before restarting (minimum/default: 15000; maximum: 60000)
   * @param {boolean?} input.force - Restart even with a critical package alive (default: false)
   * @param {boolean} input.confirm - Required acknowledgement of the reported impact
   */
  return requestSystemRestart(input)
}

export async function rebootImpact() {
  /**
   * @register_tool rebootImpact
   * @description Shows what a full restart would cost right now: critical packages and live sessions that would go down. Check this before suggesting a restart.
   */
  return getRestartImpact()
}

/**
 * One-call maintenance entry point for Agent. It can clear every compiled
 * view or only the artifacts belonging to one package, and optionally request
 * a supervised restart. Restart keeps the existing impact/confirmation guard.
 */
export async function runtimeMaintenance(input = {}) {
  /**
   * @register_tool runtimeMaintenance
   * @description Clears the compiled Svelte view cache for all packages or one named package, and can restart the Runtime in the same call. Use for requests such as "limpe o cache", "limpe o cache do Andar" or "limpe o cache e resete". Source files and persisted package data are never removed. A restart requires confirm: true and remains subject to impact protection.
   * @reach always
   * @param {string?} package - Package folder to clear; omit to clear all compiled views
   * @param {boolean?} restart - Also restart the full Runtime after clearing (default: false)
   * @param {boolean?} confirm - Required when restart is true
   * @param {string?} reason - Reason recorded for the restart
   * @param {number?} delay - Delay in ms before restart (minimum/default: 15000; maximum: 60000)
   * @param {boolean?} force - Restart even when impact protection blocks it
   */
  if (input?.restart === true) {
    // Do not create the partial result "cache cleared, restart pending". First
    // obtain confirmation/impact clearance, then perform both operations.
    if (input.confirm !== true) {
      return requestSystemRestart({ ...input, reason: input.reason || "Cache maintenance and restart" })
    }

    const verdict = await requestReboot(getDefaultContainer(), {
      reason: input.reason || "Cache maintenance and restart",
      force: input.force === true,
    })
    if (!verdict.allowed) {
      return {
        success: false,
        blocked: true,
        message: "Maintenance blocked before cache cleanup: " + verdict.blockedBy,
        impact: verdict.impact,
      }
    }
    if (!process.env.LOGOS_SUPERVISOR_ROOT || !process.env.LOGOS_SUPERVISOR_SERVICE) {
      return {
        success: false,
        blocked: true,
        message: "Maintenance blocked before cache cleanup: this runtime is not controlled by the Logos supervisor.",
        impact: verdict.impact,
      }
    }
  }

  const cache = clearCompiledViewCache(SVELTE_CACHE_DIR, input?.package ?? null)
  if (!cache.success || input?.restart !== true) {
    return { ...cache, restart: { requested: false } }
  }

  const restart = await requestSystemRestart({
    reason: input.reason || `Cache maintenance${input.package ? ` for ${input.package}` : ""}`,
    delay: input.delay,
    force: input.force,
    confirm: true,
  })
  return {
    success: cache.success && restart.success,
    cache,
    restart: { requested: true, ...restart },
    message: `${cache.message}. ${restart.message}`,
  }
}

/** Hook — lets any package dispatch `reboot:requested` to restart the runtime. */
export async function onResetRequested(payload = {}) {
  /**
   * @register_hook reboot:requested
   * @description Triggers a full runtime restart. Dispatch this event to reboot the whole process just like the tool and the route do.
   * @param {object?} payload - Optional parameters
   * @param {string?} payload.reason - Reason for the restart
   * @param {number?} payload.delay - Delay in ms before restarting (minimum/default: 15000; maximum: 60000)
   * @param {boolean?} payload.force - Restart even with a critical package alive
   */
  return requestSystemRestart(payload)
}

export async function routerReboot(req, res) {
  /**
   * @register_router reboot
   * @method POST
   * @body { reason?: string, delay?: number, force?: boolean, confirm?: boolean }
   */
  const { reason, delay, force, confirm } = req.body || {}
  const result = await requestSystemRestart({ reason, delay, force, confirm })
  res.status(result.blocked ? 409 : result.confirmationRequired ? 428 : 200).json(result)
}

export async function routerImpact(req, res) {
  /**
   * @register_router impact
   * @method GET
   */
  res.json(await getRestartImpact())
}

export function routerHealth(req, res) {
  /**
   * @register_router health
   * @method GET
   */
  let lastReboot = null
  try {
    lastReboot = JSON.parse(readFileSync(FLAG_FILE, "utf8"))
  } catch {
    // no previous reboot (or unreadable flag) — continue without lastReboot
  }
  res.json({ pid: process.pid, uptime: process.uptime(), lastReboot })
}

export function routerClearCache(req, res) {
  /**
   * @register_router clear-cache
   * @method POST
   * @body { package?: string }
   *
   * Clears the SvelteEngine build cache (.svelte-cache): compiled bundles
   * (.cjs/.mjs) and manifests (.manifest.json). NEVER removes .svelte files
   * from the folder — WidgetRegistry.svelte and Widget.svelte live there as
   * part of the build pipeline itself (not disposable artifacts); deleting
   * them would break the next build without a restart.
   */
  const result = clearCompiledViewCache(SVELTE_CACHE_DIR, req.body?.package ?? null)
  res.status(result.success ? 200 : 400).json(result)
}

export function routerRebootView(req, res) {
  /**
   * @register_router reboot/view
   * @method GET
   */
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Restart Agent</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#f0f0f0;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:rgba(255,255,255,0.04);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:48px 40px;max-width:420px;width:90%;text-align:center}h1{font-size:22px;font-weight:600;margin-bottom:8px}p{color:#888;font-size:14px;line-height:1.6;margin-bottom:28px}button{background:#e74c3c;color:white;border:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;transition:background 0.2s}button:hover{background:#c0392b}button:disabled{opacity:0.5;cursor:not-allowed}.status{margin-top:20px;font-size:13px;color:#666}.status.ok{color:#2ecc71}.status.err{color:#e74c3c}</style></head><body><div class="card"><h1>Restart Agent</h1><p>This ends the runtime process. The manager (Logos supervisor/Docker/systemd) will start it again automatically.</p><button id="rebootBtn" onclick="doRestart()">Restart Now</button><div id="status" class="status"></div></div><script>async function doRestart(force){var btn=document.getElementById("rebootBtn");var st=document.getElementById("status");btn.disabled=true;st.className="status";st.textContent="Requesting...";try{var r=await fetch("/reboot/reboot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({force:!!force})});var d=await r.json();if(d.blocked){st.className="status err";var s=(d.impact&&d.impact.liveSessions||[]).length;st.innerHTML="Restart blocked: "+(d.message||"")+"<br><small>"+s+" live session(s) would go down.</small>";btn.disabled=false;btn.textContent="Restart anyway";btn.onclick=function(){doRestart(true)};return}st.className="status ok";st.textContent=d.message||"Restart scheduled";setTimeout(function(){location.reload()},3000)}catch(e){st.className="status err";st.textContent="Error: "+e.message;btn.disabled=false}}</script></body></html>'
  // The legacy inline view predates the explicit confirmation field. Override
  // its handler at the document tail so a deliberate button click remains a
  // confirmation, while API callers still must send `confirm: true`.
  const confirmationScript = '<script>window.doRestart=async function(force){var btn=document.getElementById("rebootBtn"),st=document.getElementById("status");btn.disabled=true;st.className="status";st.textContent="Restarting through Logos supervisor...";try{var r=await fetch("/reboot/reboot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({force:!!force,confirm:true})}),d=await r.json();if(!r.ok||!d.success)throw new Error(d.message||"Restart was not scheduled");st.className="status ok";st.textContent=d.message;setTimeout(function(){location.reload()},3000)}catch(e){st.className="status err";st.textContent="Error: "+e.message;btn.disabled=false}}</script>'
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.end(html.replace('</body>', confirmationScript + '</body>'))
}
