<script>
  export let progress = 0;
  export let status = 'idle';
  export let size = 40;

  const RADIUS = 16;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  $: safeProgress = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  $: offset = CIRCUMFERENCE * (1 - safeProgress / 100);
</script>

<div
  class="bag-ring"
  class:is-complete={status === 'complete'}
  class:is-paused={status === 'paused'}
  class:is-failed={status === 'failed'}
  style={`--ring-size:${size}px`}
  role="progressbar"
  aria-label="Bag progress"
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={safeProgress}
>
  <svg viewBox="0 0 40 40" aria-hidden="true">
    <circle class="ring-track" cx="20" cy="20" r={RADIUS} />
    <circle
      class="ring-value"
      cx="20"
      cy="20"
      r={RADIUS}
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={offset}
      transform="rotate(-90 20 20)"
    />
    <text x="20" y="23" text-anchor="middle">{safeProgress}</text>
  </svg>
</div>

<style>
  .bag-ring {
    width: var(--ring-size);
    height: var(--ring-size);
    flex: 0 0 var(--ring-size);
    color: var(--tk-text);
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  circle {
    fill: none;
    stroke-width: 3.5;
  }

  .ring-track {
    stroke: var(--tk-border-hi);
  }

  .ring-value {
    stroke: currentColor;
    stroke-linecap: round;
    transition: stroke-dashoffset 250ms ease-out, opacity 200ms ease-out;
  }

  text {
    fill: currentColor;
    font-family: var(--tk-mono);
    font-size: 8.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .is-complete .ring-value {
    stroke-linecap: butt;
  }

  .is-paused,
  .is-failed {
    color: var(--tk-muted);
  }

  .is-paused .ring-value {
    opacity: .72;
  }

  .is-failed .ring-value {
    opacity: .48;
  }
</style>
