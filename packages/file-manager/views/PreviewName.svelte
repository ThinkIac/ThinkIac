<script>
  export let path = '';
  export let name = '';
  let copied = false;
  let timer;

  async function copyPath() {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      copied = true;
      clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1800);
    } catch {
      copied = false;
    }
  }
</script>

<button class="preview-name" type="button" title={copied ? 'Path copied' : `Copy path: ${path}`} on:click={copyPath}>
  {copied ? 'Path copied' : name}
</button>

<style>
  .preview-name { min-width:0; overflow:hidden; padding:0; border:0; background:transparent; color:inherit; cursor:copy; font:inherit; font-size:.8125rem; font-weight:600; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
  .preview-name:hover, .preview-name:focus-visible { text-decoration:underline; outline:none; }
</style>
