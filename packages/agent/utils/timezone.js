



import { getConfig } from './config.js'

/**
 * Retorna o timezone configurado em agent.config.json → agent.timezone
 * Padrão: 'America/Sao_Paulo'
 */
export function getTimezone() {
  try {
    return getConfig().agent?.timezone ?? 'America/Sao_Paulo'
  } catch {
    return 'America/Sao_Paulo'
  }
}

/**
 * Retorna um objeto Date "mentindo" que está em UTC mas com os valores
 * numéricos (horas, minutos, dia da semana) do fuso configurado.
 *
 * Isso funciona porque toLocaleString com timeZone converte o instante
 * para o horário local, e new Date() desse string interpreta como se
 * fosse UTC — dando acesso a .getHours() / .getMinutes() / .getDay()
 * já no fuso correto, sem nenhuma biblioteca.
 *
 * @param {string} [tz] - IANA timezone (ex: 'America/Sao_Paulo')
 * @returns {Date}
 */
export function nowInTz(tz) {
  const timezone = tz ?? getTimezone()
  try {
    const localStr = new Date().toLocaleString('en-US', { timeZone: timezone })
    return new Date(localStr)
  } catch {
    
    console.warn(`[timezone] Timezone inválido: "${timezone}". Usando UTC.`)
    return new Date()
  }
}

/**
 * Formata a data atual no timezone configurado para exibição humana.
 * Ex: "2025-03-19T06:30:00 (America/Sao_Paulo)"
 *
 * @param {string} [tz]
 * @returns {string}
 */
export function nowLabel(tz) {
  const timezone = tz ?? getTimezone()
  try {
    const formatted = new Intl.DateTimeFormat('sv-SE', {
      timeZone:  timezone,
      year:      'numeric',
      month:     '2-digit',
      day:       '2-digit',
      hour:      '2-digit',
      minute:    '2-digit',
      second:    '2-digit',
      hour12:    false,
    }).format(new Date())
    return `${formatted.replace(' ', 'T')} (${timezone})`
  } catch {
    return new Date().toISOString() + ' (UTC)'
  }
}

/**
 * Retorna o nome abreviado do dia da semana no timezone configurado.
 * Ex: 'Mon', 'Tue', ...
 *
 * @param {Date}   [date]
 * @param {string} [tz]
 * @returns {string}
 */
export function dowLabel(date, tz) {
  const timezone = tz ?? getTimezone()
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday:  'short',
    }).format(date ?? new Date())
  } catch {
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()]
  }
}
