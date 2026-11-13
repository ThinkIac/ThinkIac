<script>
    export let code = `
  <h1>Olá, Mundo!</h1>
  <button id="btn">Clique-me</button>

  <script>
    document.getElementById('btn').addEventListener('click', () => {
      alert('Funciona!');
    });
  <\/script>
  `;

    let iframeEl;

    $: srcDoc = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; }
          </style>
        </head>
        <body>
          ${code}
          <script>
            (function() {
              function sendHeight() {
                const h = Math.max(
                  document.body.scrollHeight,
                  document.documentElement.scrollHeight
                );
                window.parent.postMessage({ type: 'iframe-resize', height: h }, '*');
              }
              sendHeight();
              if (window.ResizeObserver) {
                new ResizeObserver(sendHeight).observe(document.body);
              }
            })();
          <\/script>
        </body>
      </html>
    `;

    function onIframeLoad() {
      if (!iframeEl?.contentWindow) return;
      const handler = (event) => {
        if (event.data?.type === 'iframe-resize') {
          const h = Math.max(200, event.data.height);
          iframeEl.style.height = h + 'px';
        }
      };
      window.addEventListener('message', handler);
      iframeEl._resizeHandler = handler;
    }

    function onIframeDestroy() {
      if (iframeEl?._resizeHandler) {
        window.removeEventListener('message', iframeEl._resizeHandler);
      }
    }
  </script>

  <div class="container">
    <iframe
      bind:this={iframeEl}
      class="preview"
      title="HTML Preview"
      sandbox="allow-scripts allow-modals"
      srcdoc={srcDoc}
      on:load={onIframeLoad}
    />
  </div>

  <style>
    .container {
      width: 100%;
      border-radius: var(--r-lg);
      overflow: visible;
      border: 0.75px solid var(--border);
      background: rgba(0, 0, 0, 0.35);
    }

    .preview {
      width: 100%;
      min-height: 200px;
      border: none;
      display: block;
      background: #0a0a0a;
    }
  </style>