const fs = require('node:fs');
const path = require('node:path');

const DIMENSIONS = 384;
const TARGET_TYPES = new Set(['response', 'model', 'runtime', 'tool']);

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Embedding local, pequeno e determinístico de palavras + n-grams de caracteres. */
function embedText(text, dimensions = DIMENSIONS) {
  const vector = new Float32Array(dimensions);
  const clean = normalize(text);
  const words = clean.split(/[^a-z0-9]+/).filter(Boolean);
  const features = [...words.map(word => `w:${word}`)];
  for (const word of words) {
    const padded = `^${word}$`;
    for (let size = 3; size <= 5; size++) {
      for (let start = 0; start + size <= padded.length; start++) {
        features.push(`c:${padded.slice(start, start + size)}`);
      }
    }
  }
  for (const feature of features) {
    const value = hash(feature);
    vector[value % dimensions] += (value & 1) === 0 ? 1 : -1;
  }
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (length) for (let index = 0; index < vector.length; index++) vector[index] /= length;
  return vector;
}

function cosine(left, right) {
  let score = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index++) score += left[index] * right[index];
  return score;
}

function validateContribution(pkg, raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new TypeError(`${pkg}: classification.examples deve ser uma lista.`);
  return raw.map((example, index) => {
    if (!example || typeof example !== 'object') throw new TypeError(`${pkg}: exemplo ${index} inválido.`);
    const id = String(example.id || '').trim();
    const utterances = Array.isArray(example.utterances)
      ? example.utterances.map(value => String(value).trim()).filter(Boolean)
      : [];
    const target = example.target;
    if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new TypeError(`${pkg}: id do exemplo ${index} inválido.`);
    if (!utterances.length || utterances.length > 64) throw new TypeError(`${pkg}/${id}: informe 1..64 utterances.`);
    if (!target || !TARGET_TYPES.has(target.type)) throw new TypeError(`${pkg}/${id}: target.type inválido.`);
    if (target.type !== 'runtime' && !String(target.value || '').trim()) {
      throw new TypeError(`${pkg}/${id}: target.value é obrigatório.`);
    }
    const threshold = Number(example.threshold ?? 0.72);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new TypeError(`${pkg}/${id}: threshold inválido.`);
    return { pkg, id, utterances, target: { type: target.type, value: target.value ?? null }, threshold };
  });
}

function discoverContributions(packagesDirectory) {
  const contributions = [];
  if (!fs.existsSync(packagesDirectory)) return contributions;
  for (const entry of fs.readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const manifestPath = path.join(packagesDirectory, entry.name, 'package.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      contributions.push(...validateContribution(manifest.name || entry.name, manifest.classification?.examples));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return contributions;
}

class ExampleRouter {
  constructor(examples = [], { embed = embedText, cacheSize = 128 } = {}) {
    this.cacheSize = Math.max(0, Math.min(1024, Math.floor(cacheSize) || 0));
    this.cache = new Map();
    this.embed = embed;
    this.examples = examples.map(example => ({
      ...example,
      vectors: example.utterances.map(utterance => embed(utterance)),
    }));
  }

  classify(text) {
    const query = String(text || '').trim();
    if (!query) return null;
    if (this.cache.has(query)) {
      const cached = this.cache.get(query);
      this.cache.delete(query);
      this.cache.set(query, cached);
      return cached ? { ...cached, target: { ...cached.target } } : null;
    }
    if (!this.examples.length) return null;
    const vector = this.embed(query);
    let best = null;
    for (const example of this.examples) {
      const score = Math.max(...example.vectors.map(candidate => cosine(vector, candidate)));
      if (score >= example.threshold && (!best || score > best.score)) {
        best = { package: example.pkg, id: example.id, target: { ...example.target }, score };
      }
    }
    if (this.cacheSize && query.length <= 8192) {
      this.cache.set(query, best ? { ...best, target: { ...best.target } } : null);
      if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value);
    }
    return best;
  }
}

/**
 * Reconciles a declarative route with the exact catalog offered in the current
 * ReAct iteration.  This is deliberately schema-aware: a package example can
 * bias selection, but it can never manufacture an executable tool.
 */
function reconcileDecision(decision, availableTools = [], context = {}) {
  if (!decision) return null;
  const metadata = {
    runId: context.runId ?? null,
    iteration: Number.isInteger(context.iteration) ? context.iteration : 0,
    catalogVersion: context.catalogVersion ?? null,
  };
  if (decision.target?.type !== 'tool') return { ...decision, status: 'matched', ...metadata };
  const tool = availableTools.find(candidate => candidate?.name === decision.target.value);
  if (!tool) return { ...decision, status: 'unavailable', tool: null, ...metadata };
  return {
    ...decision,
    status: 'eligible',
    tool: { name: tool.name, package: tool.package ?? null },
    ...metadata,
  };
}

module.exports = {
  DIMENSIONS, ExampleRouter, cosine, discoverContributions, embedText,
  reconcileDecision, validateContribution,
};
