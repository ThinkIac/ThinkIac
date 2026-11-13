








export async function sendProactive(message, _channelOverride = null) {
  console.log(`[Agent notify] ${message}`)
  return [{ channel: 'log', ok: true }]
}
