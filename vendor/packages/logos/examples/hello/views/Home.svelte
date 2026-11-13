<script>
  export let title = 'Lógos';
  let count = 0;
</script>

<main class="container py-5">
  <h1 class="mb-3">{title}</h1>
  <p class="text-muted">A minimal Svelte view served by Lógos with Bootstrap 5.</p>
  <button class="btn btn-primary" on:click={() => count++}>
    Clicked {count} time{count === 1 ? '' : 's'}
  </button>
</main>
