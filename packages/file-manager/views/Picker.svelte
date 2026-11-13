<script>
  import FilePicker from './FilePicker.svelte';

  export let accept = '';
  export let multiple = '';
  export let root = 'uploads';
  export let requestId = '';

  const enabledMultiple = multiple === true || multiple === '1' || multiple === 'true';

  function send(type, detail = {}) {
    if (window.parent === window) return;
    window.parent.postMessage({ type, requestId, ...detail }, window.location.origin);
  }
</script>

<FilePicker
  {accept}
  multiple={enabledMultiple}
  {root}
  on:select={(event) => send('logos:file-picker:selected', { paths: event.detail.paths || [] })}
  on:cancel={() => send('logos:file-picker:cancelled')}
/>
