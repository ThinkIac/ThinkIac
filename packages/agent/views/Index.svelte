<script>
  import { onMount } from 'svelte'

  // Agent não é mais um shell visual. Mantemos esta view como ponto de
  // compatibilidade para favoritos, notificações e links publicados antigos.
  // A query inteira é preservada para que sessão, handoff e agente sobrevivam.
  export let open
  export let session
  export let app
  export let pkg
  export let file
  export let handoff
  export let desktopSession
  export let agentId

  let destination = '/view/shell/Index'
  let theme = 'dark'

  onMount(() => {
    theme = localStorage.getItem('think:theme') === 'light' ? 'light' : 'dark'
    const query = window.location.search
    window.location.replace(`${destination}${query}`)
  })
</script>

<svelte:head><title>ThinkIac</title></svelte:head>

<main data-theme={theme} aria-busy="true" aria-live="polite">
  <p>Redirecionando para o ThinkIac Shell…</p>
</main>

<style>
  [data-theme='dark'] { --tk-bg:#111111; --tk-text:#f5f5f5; --tk-font:'Ubuntu',system-ui,sans-serif; }
  [data-theme='light'] { --tk-bg:#ffffff; --tk-text:#1a1a1a; --tk-font:'Ubuntu',system-ui,sans-serif; }
  main { min-height:100dvh; display:grid; place-items:center; margin:0; background:var(--tk-bg); color:var(--tk-text); font:400 14px var(--tk-font); }
</style>
