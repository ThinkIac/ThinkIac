import jev from './decision-engine.js'

export const skillsMode = () => 'off'

// Para catálogos grandes, só expõe metadados com sobreposição lexical explícita.
// Sem ranking, abstém-se em vez de escolher as primeiras 15 por ordem de disco.
export function shortlistSkills(message, candidates) {
  if (candidates.length <= 15) return candidates
  // The Android Runtime does not guarantee Unicode property escapes. Fold
  // accents first and tokenize with syntax supported by its embedded engine.
  const tokens = value => new Set(String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])
  const query = tokens(message)
  return candidates.map((candidate, index) => ({ candidate, index,
    score: [...tokens(`${candidate.name} ${candidate.description || ''}`)].filter(token => query.has(token)).length,
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 15).map(item => item.candidate)
}

// Só metadados entram na consulta. Corpos dos AGENT.md nunca são enviados.
export async function observeSkills({ message, candidates, selected = [] }, { decide = jev.decide, mode = skillsMode() } = {}) {
  if (!['shadow', 'assist'].includes(mode) || !message || !candidates.length) return null
  const shortlist = shortlistSkills(message, candidates)
  const base = { mode, available: false, recommendation: null, selected: [...selected], agrees: null, error: null }
  if (!shortlist.length) return { ...base, error: 'no_ranked_candidates' }
  try {
    const result = await decide({ intent: message, candidates: shortlist.map(({ name, description }) => ({ name, description })), kind: 'skills', timeoutMs: 1500 })
    const choice = result?.recommendation?.choice
    const confidence = result?.recommendation?.confidence
    const valid = result?.available === true && shortlist.some(candidate => candidate.name === choice)
      && Number.isFinite(confidence) && confidence > 0 && confidence <= 1
    return { ...base, available: valid, recommendation: valid ? choice : null,
      agrees: valid ? selected.includes(choice) : null, error: valid ? null : 'jev_unavailable' }
  } catch {
    return { ...base, error: 'jev_unavailable' }
  }
}
