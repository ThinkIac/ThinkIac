// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthMonitor = void 0;
exports.normalizeMonitor = normalizeMonitor;
exports.normalizeHealth = normalizeHealth;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const defaults = {
    interval: 30000, timeout: 3000, initialDelay: 10000, failureThreshold: 3,
    successThreshold: 2, recovery: 'report', maxRecoveries: 2, recoveryWindow: 300000, cooldown: 60000,
};
function normalizeMonitor(value) {
    if (value === undefined)
        return null;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.route !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value.route)) {
        throw new Error('runtime.stability.monitor requires a relative GET route');
    }
    const config = { ...defaults, ...value };
    if (!['report', 'reload', 'stop'].includes(config.recovery))
        throw new Error('Invalid monitor recovery policy');
    for (const key of Object.keys(defaults).filter(k => k !== 'recovery')) {
        const min = key === 'initialDelay' || key === 'cooldown' ? 0 : 1;
        if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > 2147483647) {
            throw new Error(`Invalid monitor ${key}`);
        }
    }
    return config;
}
/** Persist only runtime-owned reason codes, never arbitrary response/error text. */
function normalizeHealth(code, body) {
    if (!code)
        return { status: 'unhealthy', reason: 'probe_timeout' };
    if (code < 200 || code >= 300)
        return { status: 'unhealthy', reason: `http_${code}` };
    if (body?.ok === false || body?.status === 'unhealthy')
        return { status: 'unhealthy', reason: 'reported_unhealthy' };
    if (body?.status === 'degraded')
        return { status: 'degraded', reason: 'reported_degraded' };
    if (body?.status !== undefined && body.status !== 'healthy')
        return { status: 'unhealthy', reason: 'invalid_health_status' };
    return { status: 'healthy', reason: null };
}
class HealthMonitor {
    container;
    recover;
    records = new Map();
    timers = new Map();
    pending = new Set();
    timedOut = new Set();
    processing = new Set();
    cancellations = new Set();
    started = false;
    closed = false;
    ledger;
    ledgerReadable = true;
    constructor(container, recover) {
        this.container = container;
        this.recover = recover;
        this.ledger = node_path_1.default.join(container.workspace, '.logos', 'health.json');
        try {
            const saved = JSON.parse(node_fs_1.default.readFileSync(this.ledger, 'utf8'));
            if (saved.version !== 1 || !saved.packages || typeof saved.packages !== 'object')
                throw new Error('invalid ledger');
            for (const [folder, value] of Object.entries(saved.packages)) {
                if (!Array.isArray(value.recoveries) || !value.recoveries.every((n) => Number.isFinite(n) && n >= 0) ||
                    !Number.isFinite(value.cooldownUntil) || !value.health || !Number.isSafeInteger(value.health.consecutiveFailures))
                    throw new Error('invalid ledger');
                // Fresh boot needs fresh health evidence. Keep persistent failure/recovery budget.
                this.records.set(folder, { recoveries: value.recoveries, cooldownUntil: value.cooldownUntil,
                    health: { status: 'unknown', since: Date.now(), lastProbeAt: null,
                        consecutiveFailures: Math.max(0, value.health.consecutiveFailures), consecutiveSuccesses: 0, reason: null } });
            }
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                this.ledgerReadable = false;
        }
    }
    config(folder) { return normalizeMonitor(this.container.registry.getPackage(folder)?.runtime?.stability?.monitor); }
    entry(folder) {
        if (!this.records.has(folder))
            this.records.set(folder, { health: { status: 'unknown', since: Date.now(), lastProbeAt: null,
                    consecutiveFailures: 0, consecutiveSuccesses: 0, reason: null }, recoveries: [], cooldownUntil: 0 });
        return this.records.get(folder);
    }
    persist() {
        if (!this.ledgerReadable)
            return false;
        const tmp = `${this.ledger}.${process.pid}.tmp`;
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.ledger), { recursive: true });
            node_fs_1.default.writeFileSync(tmp, JSON.stringify({ version: 1, packages: Object.fromEntries(this.records) }), { mode: 0o600 });
            node_fs_1.default.renameSync(tmp, this.ledger);
            return true;
        }
        catch {
            try {
                node_fs_1.default.unlinkSync(tmp);
            }
            catch { }
            return false;
        }
    }
    async transition(folder, status, reason) {
        const entry = this.entry(folder);
        const before = entry.health.status;
        entry.health = { ...entry.health, status, reason, since: before === status ? entry.health.since : Date.now() };
        this.container.registry.setHealth(folder, entry.health);
        this.persist();
        if (before !== status)
            await this.container.bus.emit('package:health_changed', { pkg: folder, previous: before, health: { ...entry.health } });
        if (before !== status && status === 'quarantined')
            await this.container.bus.emit('package:quarantined', { pkg: folder, health: { ...entry.health } });
    }
    start() {
        if (this.closed || this.started)
            return;
        this.started = true;
        this.refresh();
    }
    refresh() {
        if (!this.started || this.closed)
            return;
        const folders = new Set(this.container.registry.discover().map(pkg => pkg.folder));
        for (const folder of this.timers.keys())
            if (!folders.has(folder)) {
                clearTimeout(this.timers.get(folder));
                this.timers.delete(folder);
            }
        for (const folder of folders) {
            try {
                const config = this.config(folder);
                if (!config) {
                    clearTimeout(this.timers.get(folder));
                    this.timers.delete(folder);
                    continue;
                }
                this.container.registry.setHealth(folder, this.entry(folder).health);
                if (!this.timers.has(folder))
                    this.schedule(folder, config.initialDelay);
            }
            catch {
                void this.transition(folder, 'quarantined', 'invalid_monitor_config');
            }
        }
    }
    schedule(folder, delay) {
        if (this.closed)
            return;
        const timer = setTimeout(async () => {
            this.timers.delete(folder);
            try {
                await this.probe(folder);
            }
            catch { /* never reject from a timer */ }
            if (this.closed || this.timers.has(folder))
                return;
            try {
                const config = this.config(folder);
                if (config)
                    this.schedule(folder, config.interval);
            }
            catch { }
        }, delay);
        timer.unref?.();
        this.timers.set(folder, timer);
    }
    eligible(folder) {
        return !this.closed && this.container.registry.getState(folder)?.state === 'active' && !this.container.state('packageOperations').has(folder);
    }
    async probe(folder) {
        if (!this.eligible(folder) || this.processing.has(folder) || (this.pending.has(folder) && !this.timedOut.has(folder)))
            return;
        let config;
        try {
            config = this.config(folder);
        }
        catch {
            await this.transition(folder, 'quarantined', 'invalid_monitor_config');
            return;
        }
        if (!config)
            return;
        const router = this.container.state('routers').get(folder);
        const state = this.container.registry.getState(folder);
        this.processing.add(folder);
        let completed = false;
        const result = this.timedOut.has(folder) ? normalizeHealth(0, null) : await new Promise(resolve => {
            this.pending.add(folder);
            let answered = false;
            const answer = (code, body) => { if (!answered) {
                answered = true;
                resolve(normalizeHealth(code, body));
            } };
            const cancel = () => { clearTimeout(timer); this.cancellations.delete(cancel); completed = true; this.pending.delete(folder); this.timedOut.delete(folder); answer(0); };
            const finish = (code, body) => {
                clearTimeout(timer);
                this.cancellations.delete(cancel);
                completed = true;
                // A timed-out handler remains pending until it actually completes.
                if (answered)
                    this.pending.delete(folder);
                this.timedOut.delete(folder);
                answer(code, body);
            };
            const timer = setTimeout(() => { this.timedOut.add(folder); answer(0); }, config.timeout);
            timer.unref?.();
            this.cancellations.add(cancel);
            const url = `/${folder}/${config.route}`;
            const req = { method: 'GET', url, originalUrl: url, headers: {}, body: {}, query: {}, params: {} };
            const res = { statusCode: 200, headersSent: false,
                setHeader() { return this; }, set() { return this; }, getHeader() { return undefined; },
                status(code) { this.statusCode = code; return this; },
                json(body) { finish(this.statusCode, body); }, send(body) { finish(this.statusCode, body); },
                end() { finish(this.statusCode); }, redirect() { finish(302); } };
            try {
                if (!router)
                    finish(404);
                else
                    router.handle(req, res, (error) => finish(error ? 500 : 404));
            }
            catch {
                finish(500);
            }
        });
        try {
            // Ignore observations from a router/lifecycle generation that has been replaced.
            if (!this.eligible(folder) || this.container.registry.getState(folder) !== state || this.container.state('routers').get(folder) !== router)
                return;
            const entry = this.entry(folder);
            entry.health.lastProbeAt = Date.now();
            if (result.status === 'healthy') {
                entry.health.consecutiveFailures = 0;
                entry.health.consecutiveSuccesses++;
                await this.transition(folder, entry.health.consecutiveSuccesses >= config.successThreshold ? 'healthy' : entry.health.status, null);
            }
            else if (result.status === 'degraded') {
                entry.health.consecutiveFailures = 0;
                entry.health.consecutiveSuccesses = 0;
                await this.transition(folder, 'degraded', result.reason);
            }
            else {
                entry.health.consecutiveSuccesses = 0;
                entry.health.consecutiveFailures++;
                if (entry.health.consecutiveFailures < config.failureThreshold) {
                    await this.transition(folder, entry.health.status, result.reason);
                    return;
                }
                const now = Date.now();
                entry.recoveries = entry.recoveries.filter(at => at > now - config.recoveryWindow);
                const exhausted = config.recovery !== 'report' && entry.recoveries.length >= config.maxRecoveries;
                await this.transition(folder, exhausted ? 'quarantined' : 'unhealthy', exhausted ? 'recovery_budget_exhausted' : result.reason);
                if (config.recovery === 'report' || exhausted || now < entry.cooldownUntil || !this.eligible(folder))
                    return;
                if (config.recovery === 'stop' && this.container.registry.getPackage(folder)?.runtime?.isolation?.critical === true) {
                    await this.transition(folder, 'quarantined', 'critical_package');
                    return;
                }
                entry.recoveries.push(now);
                entry.cooldownUntil = now + config.cooldown;
                if (!this.persist()) {
                    await this.transition(folder, 'quarantined', 'ledger_unavailable');
                    return;
                }
                await this.transition(folder, 'recovering', result.reason);
                await this.container.bus.emit('package:recovery_started', { pkg: folder, policy: config.recovery });
                let outcome;
                try {
                    outcome = await this.recover(folder, config.recovery);
                }
                catch {
                    outcome = { ok: false };
                }
                if (this.closed)
                    return;
                await this.container.bus.emit(outcome.ok ? 'package:recovery_completed' : 'package:recovery_failed', { pkg: folder, policy: config.recovery, ok: outcome.ok });
                await this.transition(folder, outcome.ok ? (config.recovery === 'stop' ? 'quarantined' : 'recovering') : 'unhealthy', outcome.ok ? null : 'recovery_failed');
            }
        }
        finally {
            this.processing.delete(folder);
            if (completed)
                this.pending.delete(folder);
        }
    }
    async close() {
        this.closed = true;
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
        for (const cancel of [...this.cancellations])
            cancel();
    }
}
exports.HealthMonitor = HealthMonitor;

};
