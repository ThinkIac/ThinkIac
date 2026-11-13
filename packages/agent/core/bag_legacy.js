export async function loadBagForPrompt(getHostProxy, sessionId, { maxItems = 15, maxItemLength = 400, activeTopic = '' } = {}) {
  
  
  
  try {
    const db = getHostProxy('bags')
    const bag = db.plan.findOne({ sessionId }) || {}

    const lines = []
    if (bag.objective) lines.push('Objetivo: ' + bag.objective)

    const steps = db.step.query({ sessionId }, { sort: 'seq ASC' })
    const doneCount = steps.filter(s => s.status === 'done' || s.status === 'skipped').length
    const progress = steps.length ? Math.round((doneCount / steps.length) * 100) : 0
    lines.push('Status: ' + (bag.status || 'idle') + ' | Progresso: ' + progress + '% | Steps: ' + steps.length)

    
    const current = steps.find(s => s.status === 'in_progress') || steps.find(s => s.status === 'pending')

    if (steps.length > 0) {
      lines.push('')
      lines.push('Steps do Plano:')
      for (const step of steps) {
        const tag = step.status === 'done' ? '[✓]' : step.status === 'in_progress' ? '[→]' : step.status === 'failed' ? '[✗]' : '[ ]'
        const result = step.result ? ' -> ' + String(step.result).slice(0, 120) : ''
        lines.push('  ' + tag + ' ' + step.seq + '. ' + step.description + result)
      }
    }

    
    
    lines.push('')
    if (current) {
      lines.push(`>> RETOMADA: o step atual e #${current.seq} ("${String(current.description).slice(0, 120)}"). ` +
        'Quando a mensagem atual depender do contexto imediatamente anterior, use este plano para resolver a referência antes de pedir esclarecimento. ' +
        'Atualize com plan_update_step (in_progress -> done) conforme avanca.')
    } else if (bag.status && bag.status !== 'done') {
      lines.push('>> RETOMADA: nenhum step pendente e o plano nao esta concluido — avalie plan_status e finalize ou replaneje com plan_set.')
    }

    const notes = db.note.query({ sessionId }, { sort: 'createdAt DESC' }) 
    if (!bag.objective && !bag.status && !steps.length && !notes.length) return ''
    
    
    let filteredNotes = notes
    if (activeTopic && activeTopic.length >= 3 && notes.length > maxItems) {
      try {
        const scoredNotes = []
        for (const note of notes) {
          const text = String(note.content ?? '')
          const terms = activeTopic.toLowerCase().match(/[A-Za-z0-9_./\-\u00C0-\u024F]{3,}/g) || []
          const score = terms.reduce((sum, term) => sum + Number(text.toLowerCase().includes(term)), 0)
          scoredNotes.push({ note, score })
        }
        
        scoredNotes.sort((a, b) => b.score - a.score)
        filteredNotes = scoredNotes.slice(0, maxItems).map(s => s.note)
      } catch (e) {
        console.warn('[Agent] Falha ao refinar notas da bag:', e.message)
        filteredNotes = notes.slice(0, maxItems) 
      }
    } else {
      filteredNotes = notes.slice(0, maxItems)
    }

    if (filteredNotes.length > 0) {
      lines.push('')
      lines.push('Notas recentes:')
      for (const note of filteredNotes) {
        const raw = String(note.content ?? '')
        const content = raw.length > maxItemLength ? raw.slice(0, maxItemLength) + '...' : raw
        lines.push('  [' + note.type + '] ' + content)
      }
    }

    return lines.join('\n')
  } catch {
    return 'Bag legada indisponível: plano e notas não puderam ser consultados.'
  }
}
