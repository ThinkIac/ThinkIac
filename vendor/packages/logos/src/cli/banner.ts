// src/cli/banner.ts — the Thinkiac CLI splash banner.
//
// Shown when the CLI is invoked as `thinkiac` (bare, or --help). Kept out of
// index.ts so the ASCII art doesn't clutter the command-dispatch logic.

'use strict';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';

export function renderBanner(version: string): string {
  const tagline = 'CLI for the Lógos runtime · talks to your Agent agent';
  return [
    `${CYAN}${BOLD}  ✳ Thinkiac${RESET} ${DIM}v${version}${RESET}`,
    `  ${DIM}${tagline}${RESET}`,
  ].join('\n');
}

export function printBanner(version: string): void {
  console.log(renderBanner(version) + '\n');
}
