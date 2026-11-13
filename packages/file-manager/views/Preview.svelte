<script>
  import { onMount, onDestroy } from 'svelte';
  import { getTheme, onThemeChange } from './lib/theme.js';
  import TextView from './TextView.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import ImageView from './ImageView.svelte';
  import VideoView from './VideoView.svelte';
  import AudioView from './AudioView.svelte';
  import PdfView from './PdfView.svelte';
  import SpreadsheetView from './SpreadsheetView.svelte';
  import GlbView from './GlbView.svelte';

  export let path = '';
  export let name = '';
  export let type = '';

  let theme = 'dark';
  let unsubscribe;

  const SPREADSHEETS = new Set(['csv', 'tsv', 'xlsx', 'xlsm', 'ods']);
  const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkdn']);
  const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'ogv']);
  const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
  $: extension = (name || path).split('.').pop()?.toLowerCase() || '';
  $: component = type.startsWith('image/') ? ImageView
    : type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension) ? VideoView
      : type.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension) ? AudioView
      : extension === 'glb' ? GlbView
      : type === 'application/pdf' || extension === 'pdf' ? PdfView
        : SPREADSHEETS.has(extension) ? SpreadsheetView
          : MARKDOWN_EXTENSIONS.has(extension) ? MarkdownView
            : TextView;

  onMount(() => {
    theme = getTheme();
    unsubscribe = onThemeChange((next) => (theme = next));
  });
  onDestroy(() => unsubscribe?.());
</script>

<svelte:component this={component} {path} />
