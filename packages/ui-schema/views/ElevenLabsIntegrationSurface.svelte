<script>
  import { onDestroy, onMount } from 'svelte';

  export let surface;
  export let state = {};
  export let actionUrl = '';

  const base = '/elevenlabs';
  const formats = ['mp3_44100_128', 'mp3_44100_192', 'mp3_22050_32', 'mp3_24000_48', 'mp3_24000_64', 'pcm_16000', 'pcm_24000', 'pcm_44100', 'ulaw_8000'];
  const defaults = { voiceId: '', modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128', languageCode: 'pt', voiceSettings: { stability: .5, similarity_boost: .75, style: 0, use_speaker_boost: true, speed: 1 } };

  let loaded = '', busy = false, catalogBusy = false, error = '', notice = '', apiKey = '', audioUrl = '', audioName = 'elevenlabs-speech.mp3', voices = [], models = [];
  let config = { ...defaults, voiceSettings: { ...defaults.voiceSettings } };
  let job = { text: '', ...defaults, voiceSettings: { ...defaults.voiceSettings }, latency: '', logging: true };

  $: {
    const next = JSON.stringify(state || {});
    if (next !== loaded) {
      loaded = next;
      config = { ...defaults, ...state, voiceSettings: { ...defaults.voiceSettings, ...(state?.voiceSettings || {}) } };
      job = { ...job, voiceId: config.voiceId, modelId: config.modelId, outputFormat: config.outputFormat, languageCode: config.languageCode, voiceSettings: { ...config.voiceSettings } };
    }
  }

  const request = async (path, options = {}) => {
    const response = await fetch(`${base}/${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || data.mensagem || `HTTP ${response.status}`);
    return data;
  };
  const items = (data, key) => Array.isArray(data?.[key]) ? data[key] : Array.isArray(data) ? data : [];
  function clearAudio() { if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = ''; }
  async function loadCatalog() {
    if (!config.configured) return;
    catalogBusy = true; error = '';
    try {
      const [voiceResult, modelResult] = await Promise.all([request('v1/voices'), request('v1/models')]);
      voices = items(voiceResult, 'voices'); models = items(modelResult, 'models');
      if (!job.voiceId && voices[0]) job = { ...job, voiceId: voices[0].voice_id };
    } catch (cause) { error = cause.message || 'Não foi possível carregar vozes e modelos.'; }
    finally { catalogBusy = false; }
  }
  async function save() {
    busy = true; error = ''; notice = '';
    try {
      const values = { ...config, ...(apiKey.trim() ? { apiKey } : {}) };
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'elevenlabs.save-configuration', values }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Não foi possível salvar a configuração.');
      state = result.state || state;
      config = { ...defaults, ...state, voiceSettings: { ...defaults.voiceSettings, ...(state?.voiceSettings || {}) } };
      job = { ...job, voiceId: config.voiceId, modelId: config.modelId, outputFormat: config.outputFormat, languageCode: config.languageCode, voiceSettings: { ...config.voiceSettings } };
      apiKey = ''; notice = result.notice || 'Configuração salva.';
      await loadCatalog();
    } catch (cause) { error = cause.message || 'Não foi possível salvar a configuração.'; }
    finally { busy = false; }
  }
  async function generate() {
    if (!job.text.trim()) { error = 'Escreva o texto que será narrado.'; return; }
    if (!job.voiceId) { error = 'Escolha uma voz antes de gerar.'; return; }
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(`${base}/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: job.text, voiceId: job.voiceId, options: { model_id: job.modelId, output_format: job.outputFormat, language_code: job.languageCode || undefined, voice_settings: job.voiceSettings, enable_logging: job.logging, optimize_streaming_latency: job.latency === '' ? undefined : Number(job.latency) } }) });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `HTTP ${response.status}`); }
      clearAudio(); audioUrl = URL.createObjectURL(await response.blob());
      audioName = `elevenlabs-${Date.now()}.${job.outputFormat.startsWith('mp3') ? 'mp3' : 'audio'}`;
      notice = 'Áudio gerado. Você pode ouvir ou baixar abaixo.';
    } catch (cause) { error = cause.message || 'Não foi possível gerar o áudio.'; }
    finally { busy = false; }
  }
  function download() { const link = document.createElement('a'); link.href = audioUrl; link.download = audioName; link.click(); }
  onMount(() => { loadCatalog(); });
  onDestroy(clearAudio);
</script>

<section class="surface" aria-busy={busy}>
  <header><div><p class="eyebrow">{surface?.eyebrow || 'INTEGRAÇÃO DE VOZ'}</p><h2>{surface?.title || 'ElevenLabs'}</h2><p class="muted">{surface?.description}</p></div><span>{config.configured ? 'Configurada' : 'Sem chave'}</span></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}

  <section class="card" aria-labelledby="generation-title">
    <div class="heading"><div><h3 id="generation-title">Gerar áudio</h3><p class="muted">Opções válidas apenas para esta geração.</p></div><button class="secondary" on:click={loadCatalog} disabled={!config.configured || catalogBusy}>{catalogBusy ? 'Atualizando…' : 'Atualizar vozes e modelos'}</button></div>
    <label>Texto<textarea bind:value={job.text} maxlength="40000" placeholder="Digite o texto que a voz deve narrar." rows="7"></textarea></label>
    <div class="grid"><label>Voz<select bind:value={job.voiceId} disabled={!config.configured}><option value="">Selecione uma voz</option>{#each voices as voice}<option value={voice.voice_id}>{voice.name} · {voice.labels?.accent || voice.voice_id}</option>{/each}</select></label><label>Modelo<select bind:value={job.modelId}>{#each models as model}<option value={model.model_id || model.id}>{model.name || model.model_id || model.id}</option>{/each}<option value={job.modelId}>{job.modelId}</option></select></label><label>Formato<select bind:value={job.outputFormat}>{#each formats as format}<option value={format}>{format}</option>{/each}</select></label><label>Idioma<input bind:value={job.languageCode} placeholder="pt" /></label></div>
    <fieldset><legend>Interpretação da voz</legend><div class="grid"><label>Estabilidade<input type="number" min="0" max="1" step=".01" bind:value={job.voiceSettings.stability} /></label><label>Similaridade<input type="number" min="0" max="1" step=".01" bind:value={job.voiceSettings.similarity_boost} /></label><label>Estilo<input type="number" min="0" max="1" step=".01" bind:value={job.voiceSettings.style} /></label><label>Velocidade<input type="number" min=".7" max="1.2" step=".01" bind:value={job.voiceSettings.speed} /></label><label>Latência<select bind:value={job.latency}><option value="">Padrão</option>{#each [0, 1, 2, 3, 4] as latency}<option value={latency}>{latency}</option>{/each}</select></label><label class="toggle"><input type="checkbox" bind:checked={job.voiceSettings.use_speaker_boost} /> Melhorar semelhança</label><label class="toggle"><input type="checkbox" bind:checked={job.logging} /> Registrar na conta</label></div></fieldset>
    <button class="primary" on:click={generate} disabled={busy || !config.configured}>{busy ? 'Gerando áudio…' : 'Gerar áudio'}</button>
    {#if audioUrl}<div class="result"><audio controls src={audioUrl}></audio><button class="secondary" on:click={download}>Baixar áudio</button></div>{/if}
  </section>

  <details><summary>Configuração padrão da bridge</summary><form on:submit|preventDefault={save}><label>API key<input type="password" bind:value={apiKey} placeholder={config.configured ? `Salva: ${config.apiKeyMasked}` : 'xi-…'} autocomplete="off" /></label><div class="grid"><label>Voice ID<input bind:value={config.voiceId} /></label><label>Modelo<input bind:value={config.modelId} /></label><label>Formato<input bind:value={config.outputFormat} /></label><label>Idioma<input bind:value={config.languageCode} /></label></div><button class="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar configuração'}</button></form></details>
  <aside><code>POST /elevenlabs/speech</code><code>POST /elevenlabs/v1/text-to-speech/:voiceId</code><code>GET /elevenlabs/v1/voices</code><code>GET /elevenlabs/v1/models</code></aside>
</section>

<style>
  .surface,.card,form{display:grid;gap:1rem}.surface *{box-sizing:border-box}.surface{max-width:980px}header,.heading,.result{display:flex;justify-content:space-between;gap:1rem}h2,h3,p{margin:0}h2{font-size:1.35rem;letter-spacing:-.03em}.eyebrow{color:var(--tk-muted);font-size:.72rem;font-weight:700;letter-spacing:.12em;margin-bottom:.4rem}.muted,header>span{color:var(--tk-muted);font-size:.85rem;line-height:1.45}.card,details{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);padding:1rem}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}input,select,textarea{width:100%;min-height:2.55rem;background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);font:inherit;padding:.6rem .7rem}textarea{min-height:8rem;resize:vertical}input:focus,select:focus,textarea:focus{background:var(--tk-surface);border-color:var(--tk-border-hi);outline:2px solid var(--tk-border);outline-offset:1px}fieldset{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);display:grid;gap:.8rem;padding:1rem}legend{color:var(--tk-muted);font-size:.85rem;padding:0 .3rem}.toggle{align-items:center;display:flex;min-height:2.55rem}.toggle input{min-height:auto;width:auto}button{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);cursor:pointer;font:inherit;padding:.65rem .9rem;background:transparent}button.primary{background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-on-accent);font-weight:700}button:disabled{cursor:wait;opacity:.6}.secondary{width:max-content}.result{align-items:center}.result audio{max-width:100%;width:580px}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}summary{cursor:pointer;color:var(--tk-text)}details form{border-top:1px solid var(--tk-border);margin-top:1rem;padding-top:1rem}aside{display:grid;gap:.3rem;color:var(--tk-muted);font-size:.8rem}@media(max-width:680px){header,.heading,.result{align-items:stretch;flex-direction:column}.grid{grid-template-columns:1fr}.heading .secondary,.primary{width:100%}}
</style>
