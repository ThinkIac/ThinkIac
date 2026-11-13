<script>
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { rawUrl } from './lib/api.js';
  import { getTheme, onThemeChange } from './lib/theme.js';
  import PreviewName from './PreviewName.svelte';

  export let path = '';
  let theme = 'dark';
  let unsubscribe;
  let stage;
  let state = 'loading';
  let error = '';
  let renderer, scene, camera, controls, frame, resizeObserver;
  let disposed = false;
  $: name = path ? path.split('/').pop() : '';

  function readableError(cause) {
    const message = cause?.message || String(cause || '');
    return /webgl.*context|error creating webgl/i.test(message)
      ? 'WebGL is unavailable. Close other 3D previews and try again.'
      : message || "Couldn't load this GLB model.";
  }

  function disposeObject(root) {
    root?.traverse?.((node) => {
      node.geometry?.dispose?.();
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material) continue;
        for (const value of Object.values(material)) value?.isTexture && value.dispose?.();
        material.dispose?.();
      }
    });
  }

  function resize() {
    if (!renderer || !camera || !stage) return;
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    const requestFrame = globalThis?.requestAnimationFrame;
    if (disposed || typeof requestFrame !== 'function') return;
    controls?.update();
    renderer?.render(scene, camera);
    frame = requestFrame(render);
  }

  function frameModel(root) {
    const bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.1);
    const distance = radius * 1.8;
    camera.position.set(center.x + distance, center.y + distance * .65, center.z + distance);
    camera.near = Math.max(radius / 100, .01);
    camera.far = Math.max(radius * 100, 100);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  async function load() {
    if (!stage || !path) return;
    state = 'loading'; error = '';
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      stage.replaceChildren(renderer.domElement);
      scene = new THREE.Scene();
      scene.background = new THREE.Color(theme === 'light' ? 0xffffff : 0x111111);
      camera = new THREE.PerspectiveCamera(45, 1, .01, 1000);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = .08;
      controls.screenSpacePanning = false;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
      const key = new THREE.DirectionalLight(0xffffff, 2.8);
      key.position.set(5, 8, 6);
      scene.add(key);
      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(stage);
      const gltf = await new GLTFLoader().loadAsync(rawUrl(path));
      if (disposed) return;
      scene.add(gltf.scene);
      frameModel(gltf.scene);
      state = 'ready';
      render();
    } catch (cause) {
      state = 'error'; error = readableError(cause);
      destroyRenderer();
    }
  }

  function destroyRenderer() {
    // Svelte runs component cleanup during SSR as well. Browser animation APIs
    // do not exist in the Runtime's server renderer.
    const cancelFrame = globalThis?.cancelAnimationFrame;
    if (frame != null && typeof cancelFrame === 'function') {
      cancelFrame(frame);
    }
    frame = null;
    resizeObserver?.disconnect(); resizeObserver = null;
    if (scene) disposeObject(scene);
    controls?.dispose(); renderer?.dispose(); renderer?.domElement?.remove();
    controls = null; renderer = null; scene = null;
  }

  function retry() { destroyRenderer(); load(); }

  onMount(() => {
    theme = getTheme();
    unsubscribe = onThemeChange((next) => {
      theme = next;
      if (scene) scene.background = new THREE.Color(theme === 'light' ? 0xffffff : 0x111111);
    });
    load();
    // `onMount` never runs in SSR, so this browser-only cleanup cannot call
    // animation APIs while the Runtime is rendering a text preview on the server.
    return () => {
      disposed = true;
      unsubscribe?.();
      destroyRenderer();
    };
  });
</script>

<div class="glb" data-theme={theme}>
  <header><PreviewName {path} {name} /><a href={rawUrl(path)} download={name}>Download</a></header>
  <main aria-busy={state === 'loading'}>
    <div class="stage" bind:this={stage} aria-label={`3D model: ${name}`}></div>
    {#if state === 'loading'}<div class="overlay"><span></span><strong>Loading 3D model</strong></div>{/if}
    {#if state === 'error'}<div class="overlay error" role="alert"><strong>Couldn't render this model.</strong><small>{error}</small><button on:click={retry}>Try again</button></div>{/if}
  </main>
  <footer>Drag to orbit · scroll to zoom · click the name to copy its path</footer>
</div>

<style>
  :global(html), :global(body) { margin:0; height:100%; background:#111; }
  :global(html[data-theme="light"]), :global(body[data-theme="light"]) { background:#fff; }
  .glb[data-theme="dark"] { --tk-bg:#111;--tk-surface:#181818;--tk-border:rgba(255,255,255,.09);--tk-text:#f5f5f5;--tk-muted:#888; }
  .glb[data-theme="light"] { --tk-bg:#fff;--tk-surface:#f5f5f5;--tk-border:rgba(0,0,0,.1);--tk-text:#1a1a1a;--tk-muted:#666; }
  .glb { height:100dvh; display:flex; flex-direction:column; color:var(--tk-text); background:var(--tk-bg); font:14px 'Ubuntu',system-ui,sans-serif; }
  header { display:flex; align-items:center; justify-content:space-between; gap:.75rem; padding:.6rem .9rem; background:var(--tk-surface); border-bottom:1px solid var(--tk-border); }
  header :global(.preview-name) { flex:1; } a { color:var(--tk-muted); font-size:12px; text-decoration:none; } a:hover { color:var(--tk-text); }
  main { position:relative; min-height:0; flex:1; overflow:hidden; } .stage { position:absolute; inset:0; } .stage :global(canvas) { display:block; width:100%; height:100%; touch-action:none; }
  .overlay { position:absolute; inset:0; display:grid; place-content:center; justify-items:center; gap:.65rem; padding:1.5rem; background:var(--tk-bg); text-align:center; } .overlay span { width:28px; height:28px; border:2px solid var(--tk-border); border-top-color:var(--tk-text); border-radius:50%; animation:spin .8s linear infinite; } .overlay small { max-width:420px; color:var(--tk-muted); } .overlay button { border:1px solid var(--tk-border); border-radius:8px; padding:.45rem .7rem; background:var(--tk-surface); color:var(--tk-text); cursor:pointer; font:inherit; }
  footer { padding:.5rem .9rem; border-top:1px solid var(--tk-border); color:var(--tk-muted); background:var(--tk-surface); font-size:11px; text-align:center; } @keyframes spin { to { transform:rotate(360deg); } }
</style>
