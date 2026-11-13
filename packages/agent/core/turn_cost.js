















const PRICING_TTL_MS = 60 * 60 * 1000; 
const FALLBACK_PROMPT_USD_PER_TOKEN = 0.0000005;   
const FALLBACK_COMPLETION_USD_PER_TOKEN = 0.0000015; 

let pricingCache = { at: 0, byModel: {} };




async function refreshPricing() {
  const now = Date.now();
  if (now - pricingCache.at < PRICING_TTL_MS) return;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) return;
    const data = await res.json();
    const byModel = {};
    for (const m of data.data || []) {
      byModel[m.id] = {
        prompt: parseFloat(m.pricing?.prompt || '0'),
        completion: parseFloat(m.pricing?.completion || '0'),
        request: parseFloat(m.pricing?.request || '0'),
      };
    }
    pricingCache = { at: now, byModel };
  } catch {
    
  }
}



export function estimateCostUsd(model, usage = {}) {
  
  if (usage && typeof usage.cost === 'number' && usage.cost > 0) {
    return usage.cost;
  }
  const pricing = pricingCache.byModel[model];
  const promptPrice = pricing?.prompt ?? FALLBACK_PROMPT_USD_PER_TOKEN;
  const completionPrice = pricing?.completion ?? FALLBACK_COMPLETION_USD_PER_TOKEN;
  const requestPrice = pricing?.request ?? 0;
  const promptCost = (usage.prompt_tokens || 0) * promptPrice;
  const completionCost = (usage.completion_tokens || 0) * completionPrice;
  return promptCost + completionCost + requestPrice;
}



export function warmPricing() {
  refreshPricing().catch(() => {});
}


export async function refreshPricingNow() {
  await refreshPricing();
}
