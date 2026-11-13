import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import protocol from './protocol.js';

const MODEL = 'multilingual-e5-small';
const REVISION = '8d923955b027282ba975c0a4c825486c9ca4c490';
const copy = value => value ? { ...value, target: { ...value.target } } : null;

export function validateVector(vector) {
  if (!Array.isArray(vector) || vector.length !== 384 || !vector.every(Number.isFinite)) throw new Error('invalid_embedding');
  const norm = Math.hypot(...vector);
  if (norm < 1e-8) throw new Error('empty_embedding');
  return vector.map(value => value / norm);
}

export function createAndroidEncoder({ root = process.env.THINKIAC_MODELS_DIR, token = process.env.THINKIAC_ANDROID_BRIDGE_TOKEN || process.env.ANDROID_SHIZUKU_TOKEN, fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  let tokenizer;
  let loading;
  return async text => {
    if (!root || !token) throw new Error('semantic_bridge_unavailable');
    const directory = join(root, MODEL);
    if (!tokenizer) {
      loading ||= (async () => {
        await stat(join(directory, '.installed'));
        const [{ Tokenizer }, raw, config] = await Promise.all([
          import('@huggingface/tokenizers'),
          readFile(join(directory, 'tokenizer/tokenizer.json'), 'utf8'),
          readFile(join(directory, 'tokenizer/tokenizer_config.json'), 'utf8'),
        ]);
        return new Tokenizer(JSON.parse(raw), JSON.parse(config));
      })().catch(error => { loading = null; throw error; });
      tokenizer = await loading;
    }
    // Symmetric intent similarity: E5 prescribes query: on both sides.
    const ids = tokenizer.encode(`query: ${text.slice(0, 8192)}`).ids;
    const inputIds = ids.length > 256 ? [...ids.slice(0, 255), ids.at(-1)] : ids;
    const response = await fetchImpl('http://127.0.0.1:5042/embed', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: MODEL, inputIds }), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`semantic_bridge_${response.status}`);
    const result = await response.json();
    if (result.model !== MODEL) throw new Error('embedding_model_mismatch');
    return validateVector(result.embedding);
  };
}

export class SemanticRouter {
  constructor(examples, { encode = createAndroidEncoder(), retryMs = 30_000, now = Date.now, budgetMs = 1500 } = {}) {
    this.examples = examples;
    this.fallback = new protocol.ExampleRouter(examples);
    this.encode = encode;
    this.retryMs = retryMs;
    this.now = now;
    this.budgetMs = budgetMs;
    this.retryAt = 0;
    this.cache = new Map();
    this.pending = new Map();
    this.vectors = new Map();
  }

  async vector(text) {
    if (!this.vectors.has(text)) this.vectors.set(text, validateVector(await this.encode(text)));
    return this.vectors.get(text);
  }

  async classify(text) {
    const query = String(text || '').trim().slice(0, 8192);
    if (!query || !this.examples.length) return null;
    if (this.cache.has(query)) {
      const value = this.cache.get(query);
      this.cache.delete(query); this.cache.set(query, value);
      return copy(value);
    }
    if (this.now() < this.retryAt) return this.lexical(query);
    if (!this.pending.has(query)) {
      if (this.pending.size) return this.lexical(query, 'encoder_busy');
      this.pending.set(query, this.classifySemantic(query).finally(() => this.pending.delete(query)));
    }
    let timer;
    try {
      return copy(await Promise.race([
        this.pending.get(query),
        new Promise(resolve => { timer = setTimeout(() => resolve(this.lexical(query, 'encoder_warming')), this.budgetMs); }),
      ]));
    } finally { clearTimeout(timer); }
  }

  lexical(query, reason = this.lastError) {
    const result = this.fallback.classify(query);
    return result ? { ...result, encoder: 'lexical', degraded: true, fallbackReason: reason } : null;
  }

  async classifySemantic(query) {
    try {
      // One prototype build per catalog, with serial inference to bound RAM.
      this.ready ||= (async () => {
        for (const example of this.examples) for (const text of example.utterances) await this.vector(text);
      })().catch(error => { this.ready = null; throw error; });
      await this.ready;
      const vector = validateVector(await this.encode(query));
      let best = null;
      for (const example of this.examples) {
        const score = Math.max(...example.utterances.map(text => protocol.cosine(vector, this.vectors.get(text))));
        if (score >= example.threshold && (!best || score > best.score)) best = {
          package: example.pkg, id: example.id, target: { ...example.target }, score,
          encoder: MODEL, encoderRevision: REVISION, degraded: false,
        };
      }
      this.cache.set(query, copy(best));
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
      return best;
    } catch (error) {
      this.lastError = error.message;
      this.retryAt = this.now() + this.retryMs;
      return this.lexical(query);
    }
  }
}
