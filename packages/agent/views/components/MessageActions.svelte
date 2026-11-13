<script>
  import { onDestroy } from 'svelte'
  import { messageActions, listenSessionKey, shouldAutoSpeak } from '../lib/message_actions.js'
  import { StreamingPcmPlayer } from '../lib/pcm_stream_player.js'

  export let message
  export let index
  export let assistantOrdinal
  export let sessionId = null
  export let isLatest = false
  export let previousInputWasAudio = false
  export let justCompleted = false
  export let onFeedback = () => {}

  let copied = false
  let feedbackOpen = false
  let feedbackReason = ''
  let feedbackComment = ''
  let audio = null
  let streamPlayer = null
  let audioUrl = ''
  let audioState = 'idle'
  let audioError = ''
  let controller = null
  let copyTimer = null
  let listenEnabled = false
  let listenAfterIndex = Number.POSITIVE_INFINITY
  let autoAttempted = false
  let autoSeen = false
  $: nativeSpeechId = `${sessionId || 'default'}:${index}`

  $: nativeSpeakerAvailable = typeof window !== 'undefined' && !!window.__android?.call
  $: actions = $messageActions.filter(action =>
    action.roles?.includes(message.role) && (!action.native || nativeSpeakerAvailable)
  )
  $: audioAction = actions.find(action => action.kind === 'audio')
  $: if (!autoAttempted && audioAction && shouldAutoSpeak({
    listenEnabled: listenEnabled && index > listenAfterIndex,
    respondAudioWithAudio: audioAction.respondAudioWithAudio,
    previousInputWasAudio,
    isLatest: isLatest && justCompleted && !autoSeen,
  })) {
    autoAttempted = true
    rememberSeenIndex(index)
    markAutoSeen()
    toggleAudio(audioAction, true)
  }

  function readListenState() {
    try {
      const state = JSON.parse(localStorage.getItem(listenSessionKey(sessionId)) || '{}')
      listenEnabled = state.enabled === true
      listenAfterIndex = Number.isFinite(state.lastIndex) ? state.lastIndex : Number.POSITIVE_INFINITY
    } catch { listenEnabled = false; listenAfterIndex = Number.POSITIVE_INFINITY }
  }

  function autoSeenKey() {
    return `${listenSessionKey(sessionId)}:auto:${index}`
  }

  function markAutoSeen() {
    autoSeen = true
    sessionStorage.setItem(autoSeenKey(), '1')
  }

  function rememberSeenIndex(lastIndex) {
    if (!listenEnabled) return
    listenAfterIndex = lastIndex
    localStorage.setItem(listenSessionKey(sessionId), JSON.stringify({ enabled: true, lastIndex }))
    window.dispatchEvent(new CustomEvent('agent:listen-session-change', { detail: { sessionId, enabled: true, lastIndex } }))
  }

  function onListenChange(event) {
    if (event.detail?.sessionId === sessionId) readListenState()
  }

  function fallbackCopy(text) {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    try { document.execCommand('copy') } catch {}
    document.body.removeChild(area)
  }

  function copy() {
    const text = String(message.content ?? '')
    if (!text) return
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    else fallbackCopy(text)
    copied = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied = false), 2000)
  }

  function like() {
    feedbackOpen = false
    onFeedback({ assistantOrdinal, feedback: { value: 'like' } })
  }

  function dislike() {
    feedbackOpen = true
    feedbackReason = message.feedback?.value === 'dislike' ? message.feedback.reason ?? '' : ''
    feedbackComment = message.feedback?.value === 'dislike' ? message.feedback.comment ?? '' : ''
  }

  function saveDislike() {
    if (!feedbackReason) return
    onFeedback({ assistantOrdinal, feedback: { value: 'dislike', reason: feedbackReason, comment: feedbackComment } })
    feedbackOpen = false
  }

  function clearAudio() {
    controller?.abort()
    controller = null
    streamPlayer?.cancel()
    streamPlayer = null
    audio?.pause()
    audio = null
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    audioUrl = ''
    if (nativeSpeakerAvailable && audioState === 'playing') {
      window.__android.call('output.voice.stop', { sessionId }).catch(() => {})
    }
  }

  async function playNative(automatic) {
    try {
      await window.__android.call('output.voice.speak', {
        text: String(message.content ?? ''), sessionId, requestId: nativeSpeechId,
      })
      audioState = 'playing'
    } catch (error) {
      audioState = 'error'
      audioError = automatic
        ? 'Não foi possível iniciar a voz nativa automaticamente.'
        : error.message
    }
  }

  async function fetchAudio(endpoint, signal) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(message.content ?? '') }), signal,
    })
    if (!response.ok) {
      const result = await response.json().catch(() => null)
      throw new Error(result?.error || `Falha ao gerar áudio (${response.status})`)
    }
    return response
  }

  async function playTraditional(response, automatic) {
    audioUrl = URL.createObjectURL(await response.blob())
    audio = new Audio(audioUrl)
    audio.onended = () => (audioState = 'idle')
    audio.onerror = () => { audioState = 'error'; audioError = 'Não foi possível reproduzir o áudio.' }
    try {
      await audio.play()
      audioState = 'playing'
    } catch (playError) {
      audioState = 'ready'
      audioError = automatic
        ? 'Áudio pronto. O navegador bloqueou a reprodução automática; toque no alto-falante para ouvir.'
        : playError.message
    }
  }

  async function toggleAudio(action, automatic = false) {
    audioError = ''
    if (audioState === 'playing') {
      if (action.native) {
        await window.__android.call('output.voice.stop', { sessionId })
        audioState = 'idle'
        return
      }
      if (streamPlayer) await streamPlayer.pause()
      else audio?.pause()
      audioState = 'paused'
      return
    }
    if (['paused', 'ready'].includes(audioState)) {
      if (streamPlayer) await streamPlayer.resume()
      else await audio?.play()
      audioState = 'playing'
      audioError = ''
      return
    }
    clearAudio()
    if (action.native) {
      audioState = 'loading'
      await playNative(automatic)
      return
    }
    audioState = 'loading'
    controller = new AbortController()
    try {
      const response = await fetchAudio(action.endpoint, controller.signal)
      if (action.streaming && response.body?.getReader) {
        streamPlayer = new StreamingPcmPlayer()
        try {
          await streamPlayer.playResponse(response, {
            onStart: () => { audioState = 'playing'; audioError = '' },
            onBlocked: () => {
              audioState = 'ready'
              audioError = 'Áudio pronto. O navegador bloqueou a reprodução automática; toque no alto-falante para ouvir.'
            },
            onEnd: () => { audioState = 'idle'; streamPlayer = null },
          })
        } catch (streamError) {
          streamPlayer?.cancel()
          streamPlayer = null
          if (!action.fallbackEndpoint || controller.signal.aborted) throw streamError
          await playTraditional(await fetchAudio(action.fallbackEndpoint, controller.signal), automatic)
        }
      } else {
        await playTraditional(response, automatic)
      }
    } catch (error) {
      if (error.name !== 'AbortError') { audioState = 'error'; audioError = error.message }
    } finally { controller = null }
  }

  function run(action) {
    if (action.kind === 'copy') copy()
    else if (action.kind === 'like') like()
    else if (action.kind === 'dislike') dislike()
    else if (action.kind === 'audio') toggleAudio(action)
  }

  if (typeof window !== 'undefined') {
    readListenState()
    autoSeen = sessionStorage.getItem(autoSeenKey()) === '1'
    window.addEventListener('agent:listen-session-change', onListenChange)
    window.addEventListener('thinkiac:android:output.voice.state', onNativeSpeechState)
    window.addEventListener('thinkiac:android:output.voice.error', onNativeSpeechError)
  }
  function onNativeSpeechState(event) {
    if (event.detail?.requestId !== nativeSpeechId) return
    audioState = event.detail?.state === 'speaking' ? 'playing' : 'idle'
  }
  function onNativeSpeechError(event) {
    if (event.detail?.requestId !== nativeSpeechId) return
    audioState = 'error'
    audioError = event.detail?.message || 'Não foi possível reproduzir a resposta.'
  }
  onDestroy(() => {
    clearTimeout(copyTimer)
    clearAudio()
    if (typeof window !== 'undefined') window.removeEventListener('agent:listen-session-change', onListenChange)
    if (typeof window !== 'undefined') window.removeEventListener('thinkiac:android:output.voice.state', onNativeSpeechState)
    if (typeof window !== 'undefined') window.removeEventListener('thinkiac:android:output.voice.error', onNativeSpeechError)
  })
</script>

<div class="message-actions" data-message-index={index}>
  {#each actions as action (action.id)}
    <button class:active={message.feedback?.value === action.kind || (action.kind === 'audio' && ['playing', 'paused', 'ready'].includes(audioState))} class:loading={action.kind === 'audio' && audioState === 'loading'} on:click={() => run(action)} title={action.label} aria-label={action.label} disabled={action.kind === 'audio' && audioState === 'loading'}>
      {#if action.kind === 'copy' && copied}
        <svg viewBox="0 0 16 16" fill="none"><path d="M13.5 3.5L6 11 2.5 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="tooltip">Copiado!</span>
      {:else if action.kind === 'copy'}
        <svg viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M11.5 5.5V4A1.5 1.5 0 0010 2.5H4A1.5 1.5 0 002.5 4v6A1.5 1.5 0 004 11.5h1.5" stroke="currentColor" stroke-width="1.3"/></svg>
      {:else if action.kind === 'like'}
        <svg viewBox="0 0 16 16" fill="none"><path d="M5.5 13.25H3.75a1 1 0 01-1-1V7.5a1 1 0 011-1H5.5m0 6.75h5.1a1.5 1.5 0 001.46-1.16l.8-3.5A1.5 1.5 0 0011.4 6.75H9.75l.19-2.05A1.7 1.7 0 008.25 2.85L5.5 6.5v6.75z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else if action.kind === 'dislike'}
        <svg viewBox="0 0 16 16" fill="none"><path d="M5.5 2.75H3.75a1 1 0 00-1 1V8.5a1 1 0 001 1H5.5m0-6.75h5.1a1.5 1.5 0 011.46 1.16l.8 3.5a1.5 1.5 0 01-1.46 1.84H9.75l.19 2.05a1.7 1.7 0 01-1.69 1.85L5.5 9.5V2.75z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else}
        <svg viewBox="0 0 16 16" fill="none"><path d="M2.5 6.25h2.25L8 3.5v9L4.75 9.75H2.5zM10.5 6a3 3 0 010 4M12.25 4.25a5.5 5.5 0 010 7.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {/if}
    </button>
  {/each}
</div>
{#if audioError}<div class="action-error" role="status">{audioError}</div>{/if}
{#if feedbackOpen}
  <form class="feedback-panel" on:submit|preventDefault={saveDislike}>
    <label for="feedback-reason-{index}">O que não funcionou?</label>
    <select id="feedback-reason-{index}" bind:value={feedbackReason} required><option value="" disabled>Selecione um motivo</option><option>Resposta incorreta</option><option>Não resolveu o pedido</option><option>Faltou clareza</option><option>Outro</option></select>
    <textarea bind:value={feedbackComment} maxlength="1000" placeholder="Comentário opcional" aria-label="Comentário opcional"></textarea>
    <div class="panel-actions"><button type="button" on:click={() => (feedbackOpen = false)}>Cancelar</button><button type="submit" disabled={!feedbackReason}>Enviar feedback</button></div>
  </form>
{/if}

<style>
  .message-actions{display:inline-flex;align-items:center;gap:2px;margin-top:2px}.message-actions button{position:relative;width:26px;height:26px;padding:0;border:.75px solid transparent;border-radius:6px;background:transparent;color:var(--txt-3);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;opacity:.45;transition:transform 200ms ease-out,opacity 200ms ease-out,background 200ms ease-out,border-color 200ms ease-out,color 200ms ease-out}.message-actions button:hover,.message-actions button.active{opacity:1;color:var(--txt);background:var(--w05,rgba(255,255,255,.05));border-color:var(--border)}.message-actions button:active{transform:scale(.9)}.message-actions button:disabled{cursor:wait}.message-actions button.loading{animation:pulse 1s ease-out infinite}.message-actions svg{width:13px;height:13px}.tooltip{position:absolute;bottom:calc(100% + 5px);left:50%;transform:translateX(-50%);font-size:10px;font-family:var(--font-mono);background:var(--bg-elevated);border:1px solid var(--border);color:var(--txt);padding:3px 8px;border-radius:4px;white-space:nowrap;pointer-events:none}.action-error{max-width:360px;margin-top:4px;color:var(--txt-2);font-size:11px}.feedback-panel{display:grid;gap:8px;max-width:360px;margin-top:5px;padding:10px;border:1px solid var(--border);border-radius:var(--tk-radius-md,8px);background:var(--surface);color:var(--txt-2);font:12px var(--font-body,system-ui,sans-serif)}.feedback-panel label{color:var(--txt);font-weight:500}.feedback-panel select,.feedback-panel textarea{width:100%;box-sizing:border-box;border:1px solid var(--border-hi);border-radius:6px;padding:7px 8px;background:var(--bg-elevated);color:var(--txt);font:inherit}.feedback-panel textarea{min-height:54px;resize:vertical}.panel-actions{display:flex;justify-content:flex-end;gap:7px}.panel-actions button{border:1px solid var(--border-hi);border-radius:6px;padding:5px 8px;background:transparent;color:var(--txt-2);font:inherit;cursor:pointer}.panel-actions button[type=submit]{background:var(--accent,var(--txt));color:var(--tk-on-accent,var(--bg))}.panel-actions button:disabled{cursor:not-allowed;opacity:.45}@keyframes pulse{50%{opacity:.2}}@media(hover:none) and (pointer:coarse){.message-actions button{opacity:.6;width:32px;height:32px}.message-actions svg{width:14px;height:14px}}
</style>
