/**
 * Som curto para notificações do Shell.
 *
 * Navegadores exigem que o AudioContext seja criado a partir de um gesto do
 * usuário. Por isso `unlock` deve ser chamado na primeira interação, antes de
 * qualquer notificação chegar pelo WebSocket ou EventSource.
 */
export function createNotificationSoundPlayer(browserWindow = window) {
  let context = null

  function audioContextClass() {
    return browserWindow.AudioContext || browserWindow.webkitAudioContext
  }

  async function unlock() {
    const AudioContextClass = audioContextClass()
    if (!AudioContextClass) return false
    try {
      context ||= new AudioContextClass()
      if (context.state === 'suspended') await context.resume()
      return context.state === 'running'
    } catch {
      return false
    }
  }

  function play(priority = 3) {
    if (!context || context.state !== 'running') return false
    try {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = Number(priority) >= 4 ? 780 : 620
      gain.gain.setValueAtTime(0.035, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.14)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.14)
      return true
    } catch {
      return false
    }
  }

  function dispose() {
    context?.close?.()
    context = null
  }

  return { unlock, play, dispose }
}
