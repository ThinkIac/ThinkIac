import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const TELEMETRY = fileURLToPath(new URL('../data/metacognition.jsonl', import.meta.url));
import { searchEmbeddings } from '../memory/session.js';
import { sendProactive } from '../channels/channels.js';
import { listToolSchemas } from './registry.js';

class Metacognition {
  constructor() {
    this.metrics = {
      toolUsage: {},
      successRate: {},
      averageLatency: {},
      reflectionHistory: []
    };
    this.config = {
      reflectionInterval: 100,
      minCyclesBeforeReflection: 10,
      maxInsightsPerReflection: 5,
      
      ignoreUnusedToolPatterns: [
        /^mcp_/,
        /^stitch_/,
        /^surge_/,
        /^registry_/,
        /^reset_infra$/,
        /^reload_config$/,
        /^health$/,
        /^list_tools$/,
        /^list_runtime_tools$/,
        /^list_runtime_routes$/,
        /^get_provider$/,
        /^set_provider$/,
        /^set_model$/,
        /^list_models$/,
        /^remember$/,
        /^recall$/,
        /^forget$/,
        /^notify$/,
        /^trigger_tick$/,
        /^file_history$/,
        /^file_restore$/,
        /^create_runtime_package$/
      ]
    };
    this.cycleCount = 0;
  }

  recordToolUse(toolName, success, latencyMs) {
    if (!this.metrics.toolUsage[toolName]) {
      this.metrics.toolUsage[toolName] = { calls: 0, success: 0, failures: 0, totalLatency: 0 };
    }
    const stats = this.metrics.toolUsage[toolName];
    stats.calls++;
    if (success) { stats.success++; } else { stats.failures++; }
    stats.totalLatency += latencyMs;
    this.metrics.averageLatency[toolName] = stats.totalLatency / stats.calls;
    this.metrics.successRate[toolName] = stats.success / stats.calls;
  }

  shouldReflect() {
    this.cycleCount++;
    return this.cycleCount >= this.config.reflectionInterval &&
           this.cycleCount >= this.config.minCyclesBeforeReflection;
  }

  resetCycleCount() { this.cycleCount = 0; }

  captureMetricsSnapshot() {
    return {
      timestamp: new Date().toISOString(),
      cycleCount: this.cycleCount,
      toolUsage: JSON.parse(JSON.stringify(this.metrics.toolUsage)),
      successRate: JSON.parse(JSON.stringify(this.metrics.successRate)),
      averageLatency: JSON.parse(JSON.stringify(this.metrics.averageLatency))
    };
  }

  async generateInsights(snapshot) {
    const insights = [];

    for (const [tool, rate] of Object.entries(snapshot.successRate)) {
      if (rate < 0.7 && snapshot.toolUsage[tool].calls >= 5) {
        insights.push({ type: 'low_success_rate', tool, rate: `${(rate * 100).toFixed(1)}%`, severity: 'high', suggestion: `Revisar implementação ou parâmetros de ${tool}` });
      }
    }

    for (const [tool, latency] of Object.entries(snapshot.averageLatency)) {
      if (latency > 5000) {
        insights.push({ type: 'high_latency', tool, latency: `${latency.toFixed(0)}ms`, severity: 'medium', suggestion: `Otimizar chamadas a ${tool} ou considerar cache` });
      }
    }

    const allTools = await this.getAllRegisteredTools();
    
    const ignoredPatterns = this.config.ignoreUnusedToolPatterns || [];
    const filteredAllTools = allTools.filter(t => {
      
      
      return !ignoredPatterns.some(pattern => pattern.test(t));
    });
    const unusedTools = filteredAllTools.filter(t => !Object.keys(snapshot.toolUsage).includes(t));
    if (unusedTools.length > 0) {
      insights.push({ type: 'unused_tools', tools: unusedTools, severity: 'low', suggestion: `Ferramentas não utilizadas: ${unusedTools.join(', ')}` });
    }

    const highVolumeTools = Object.entries(snapshot.toolUsage)
      .filter(([_, s]) => s.calls > 50).map(([t]) => t);
    if (highVolumeTools.length > 0) {
      insights.push({ type: 'high_volume', tools: highVolumeTools, severity: 'info', suggestion: `Considerar run_parallel para: ${highVolumeTools.join(', ')}` });
    }

    const severityOrder = { high: 0, medium: 1, low: 2, info: 3 };
    insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    return insights.slice(0, this.config.maxInsightsPerReflection);
  }

  async getAllRegisteredTools() {
    try {
      return listToolSchemas().filter(t => !t.name.startsWith('_') && t.mode !== 'builtin').map(t => t.name);
    } catch (e) {
      console.error('Metacognition: falha ao listar ferramentas', e);
      return [];
    }
  }

  async getRecentReflections(limit = 5) {
    try {
      let recent = [];
      try { recent = readFileSync(TELEMETRY, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).slice(-limit).reverse(); } catch {}
      if (recent.length >= limit) return recent;
      const facts = await searchEmbeddings('METACOGNITION', limit - recent.length);
      return [...recent, ...facts
        .filter(f => f.text && f.text.startsWith('METACOGNITION |'))
        .map(f => {
          try { return JSON.parse(f.text.split(' | ')[1] || '{}'); } catch { return null; }
        })
        .filter(Boolean)];
    } catch { return []; }
  }

  composeReflectionMessage(insights, snapshot) {
    const lines = [`🧠 Reflexão Ciclo #${this.cycleCount}`, `📈 Snapshot: ${Object.keys(snapshot.toolUsage).length} ferramentas ativas`, ''];
    if (insights.length === 0) {
      lines.push('✅ Nenhum insight crítico. Desempenho estável.');
    } else {
      lines.push('🔎 Insights:');
      insights.forEach((insight, idx) => {
        lines.push(`${idx + 1}. [${insight.severity.toUpperCase()}] ${insight.type}`);
        if (insight.tool) lines.push(`   • ${insight.tool}`);
        lines.push(`   💡 ${insight.suggestion}`);
        lines.push('');
      });
    }
    return lines.join('\n');
  }

  async reflect() {
    const snapshot = this.captureMetricsSnapshot();
    const insights = await this.generateInsights(snapshot);
    const message  = this.composeReflectionMessage(insights, snapshot);

    const metadata = {
      timestamp: snapshot.timestamp,
      cycleCount: snapshot.cycleCount,
      insightsCount: insights.length,
      insights: insights.map(i => ({ type: i.type, tool: i.tool, severity: i.severity })),
      toolCount: Object.keys(snapshot.toolUsage).length
    };

    try { mkdirSync(fileURLToPath(new URL('../data', import.meta.url)), { recursive: true }); appendFileSync(TELEMETRY, JSON.stringify({ kind: 'telemetry', source: 'metacognition', ...metadata }) + '\n'); } catch {}
    try { await sendProactive(`Metacognition cycle complete. ${insights.length} insights.`, 'log'); } catch {}

    this.resetCycleCount();
    return { insights, message };
  }
}

let instance = null;
export function getMetacognition() {
  if (!instance) instance = new Metacognition();
  return instance;
}

export { Metacognition };
