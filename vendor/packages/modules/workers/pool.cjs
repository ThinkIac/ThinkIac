"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CpuWorkerPool = exports.CpuTaskTimeoutError = exports.CpuQueueFullError = void 0;
const node_worker_threads_1 = require("node:worker_threads");
const node_path_1 = __importDefault(require("node:path"));
class CpuQueueFullError extends Error {
    capacity;
    code = 'CPU_QUEUE_FULL';
    constructor(capacity) {
        super(`CPU worker queue is full (${capacity})`);
        this.capacity = capacity;
        this.name = 'CpuQueueFullError';
    }
}
exports.CpuQueueFullError = CpuQueueFullError;
class CpuTaskTimeoutError extends Error {
    timeoutMs;
    code = 'CPU_TASK_TIMEOUT';
    constructor(timeoutMs) {
        super(`CPU task timed out after ${timeoutMs}ms`);
        this.timeoutMs = timeoutMs;
        this.name = 'CpuTaskTimeoutError';
    }
}
exports.CpuTaskTimeoutError = CpuTaskTimeoutError;
/** Bounded pool for trusted, CPU-bound modules. Workers are reused; overload is rejected. */
class CpuWorkerPool {
    size;
    maxQueue;
    taskTimeoutMs;
    slots = [];
    queue = [];
    sequence = 0;
    closed = false;
    totals = { submitted: 0, completed: 0, failed: 0, rejected: 0, timedOut: 0, cancelled: 0 };
    constructor(options = {}) {
        this.size = positiveInteger(options.size, Math.max(1, Math.min(4, Number(process.env.UV_THREADPOOL_SIZE) || 4)));
        this.maxQueue = nonNegativeInteger(options.maxQueue, this.size * 8);
        this.taskTimeoutMs = positiveInteger(options.taskTimeoutMs, 30_000);
    }
    run(modulePath, args = [], options = {}) {
        if (this.closed)
            return Promise.reject(new Error('CPU worker pool is closed'));
        if (!node_path_1.default.isAbsolute(modulePath))
            return Promise.reject(new TypeError('CPU worker module path must be absolute'));
        if (!Array.isArray(args))
            return Promise.reject(new TypeError('CPU worker arguments must be an array'));
        if (options.signal?.aborted)
            return Promise.reject(abortError());
        const idle = this.slots.find(slot => !slot.task);
        if (!idle && this.slots.length >= this.size && this.queue.length >= this.maxQueue) {
            this.totals.rejected++;
            return Promise.reject(new CpuQueueFullError(this.maxQueue));
        }
        this.totals.submitted++;
        return new Promise((resolve, reject) => {
            const task = {
                id: ++this.sequence, module: modulePath, exportName: options.exportName ?? 'default', args,
                timeoutMs: positiveInteger(options.timeoutMs, this.taskTimeoutMs), signal: options.signal, resolve, reject,
            };
            task.abort = () => this.cancel(task);
            task.signal?.addEventListener('abort', task.abort, { once: true });
            if (idle)
                this.assign(idle, task);
            else if (this.slots.length < this.size) {
                const slot = this.createSlot();
                this.assign(slot, task);
            }
            else
                this.queue.push(task);
        });
    }
    snapshot() {
        return { size: this.size, running: this.slots.filter(slot => slot.task).length, queued: this.queue.length, maxQueue: this.maxQueue, ...this.totals };
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        for (const task of this.queue.splice(0))
            this.finishTask(task, new Error('CPU worker pool closed'));
        const slots = this.slots.splice(0);
        for (const slot of slots) {
            if (slot.timer)
                clearTimeout(slot.timer);
            if (slot.task)
                this.finishTask(slot.task, new Error('CPU worker pool closed'));
        }
        await Promise.all(slots.map(slot => slot.worker.terminate().catch(() => undefined)));
    }
    createSlot() {
        const slot = { worker: null, task: null, timer: null };
        const workerPath = node_path_1.default.join(__dirname, 'cpu-worker.js');
        slot.worker = new node_worker_threads_1.Worker(workerPath);
        slot.worker.on('message', message => this.onMessage(slot, message));
        slot.worker.on('error', error => this.replace(slot, error));
        slot.worker.on('exit', code => { if (!this.closed && code !== 0)
            this.replace(slot, new Error(`CPU worker exited (${code})`)); });
        this.slots.push(slot);
        return slot;
    }
    assign(slot, task) {
        slot.task = task;
        slot.timer = setTimeout(() => {
            this.totals.timedOut++;
            this.replace(slot, new CpuTaskTimeoutError(task.timeoutMs));
        }, task.timeoutMs);
        slot.timer.unref?.();
        slot.worker.postMessage({ id: task.id, module: task.module, exportName: task.exportName, args: task.args });
    }
    onMessage(slot, message) {
        const task = slot.task;
        if (!task || message?.id !== task.id)
            return;
        if (slot.timer)
            clearTimeout(slot.timer);
        slot.timer = null;
        slot.task = null;
        if (message.error) {
            const error = new Error(message.error.message);
            error.name = message.error.name;
            if (message.error.stack)
                error.stack = message.error.stack;
            this.finishTask(task, error);
            this.totals.failed++;
        }
        else {
            this.finishTask(task, null, message.result);
            this.totals.completed++;
        }
        this.drain(slot);
    }
    cancel(task) {
        const queued = this.queue.indexOf(task);
        if (queued >= 0) {
            this.queue.splice(queued, 1);
            this.totals.cancelled++;
            this.finishTask(task, abortError());
            return;
        }
        const slot = this.slots.find(candidate => candidate.task === task);
        if (slot) {
            this.totals.cancelled++;
            this.replace(slot, abortError());
        }
    }
    replace(slot, error) {
        if (!this.slots.includes(slot))
            return;
        if (slot.timer)
            clearTimeout(slot.timer);
        const task = slot.task;
        slot.task = null;
        slot.timer = null;
        if (task) {
            this.finishTask(task, error);
            if (!(error.name === 'AbortError') && !(error instanceof CpuTaskTimeoutError))
                this.totals.failed++;
        }
        void slot.worker.terminate().catch(() => undefined);
        if (this.closed)
            return;
        const index = this.slots.indexOf(slot);
        const replacement = { worker: null, task: null, timer: null };
        const workerPath = node_path_1.default.join(__dirname, 'cpu-worker.js');
        replacement.worker = new node_worker_threads_1.Worker(workerPath);
        replacement.worker.on('message', message => this.onMessage(replacement, message));
        replacement.worker.on('error', next => this.replace(replacement, next));
        replacement.worker.on('exit', code => { if (!this.closed && code !== 0)
            this.replace(replacement, new Error(`CPU worker exited (${code})`)); });
        this.slots[index] = replacement;
        this.drain(replacement);
    }
    drain(slot) { const next = this.queue.shift(); if (next)
        this.assign(slot, next); }
    finishTask(task, error, result) {
        if (task.abort)
            task.signal?.removeEventListener('abort', task.abort);
        error ? task.reject(error) : task.resolve(result);
    }
}
exports.CpuWorkerPool = CpuWorkerPool;
function positiveInteger(value, fallback) { return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback; }
function nonNegativeInteger(value, fallback) { return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback; }
function abortError() { const error = new Error('CPU task aborted'); error.name = 'AbortError'; return error; }
