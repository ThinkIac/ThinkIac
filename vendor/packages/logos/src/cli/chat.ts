// src/cli/chat.ts — the `thinkiac chat` interactive REPL.
//
// A thin terminal client, in the spirit of the Claude Code CLI: it does not
// run any model itself, it just streams Server-Sent Events from a running
// agent's chat endpoint (by default Agent, see apps/runtime/packages/agent)
// and prints tokens as they arrive. Slash commands mirror the ones users of
// Claude Code already know.

'use strict';

import readline from 'readline';
import { readConfig, saveConfig } from '../kernel/config';
import { printBanner } from './banner';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

const DEFAULT_CHAT_URL = 'http://localhost:5040/agent/chat/stream';

interface ChatOptions {
  url?: string;
  session?: string;
  version: string;
}

function resolveChatUrl(options: ChatOptions): string {
  return (
    options.url ||
    process.env.THINKIAC_CHAT_URL ||
    readConfig().thinkiacChatUrl ||
    DEFAULT_CHAT_URL
  );
}

function baseUrl(chatUrl: string): string {
  return chatUrl.replace(/\/chat\/stream\/?$/, '');
}

function randomSessionId(): string {
  return `cli-${Math.random().toString(36).slice(2, 10)}`;
}

function printHelp(): void {
  console.log(`${BOLD}Slash commands${RESET}
  ${CYAN}/help${RESET}             show this help
  ${CYAN}/clear${RESET}            clear the current session's memory
  ${CYAN}/session [id]${RESET}     show or switch the active session id
  ${CYAN}/url [url]${RESET}        show or switch the chat endpoint (persists)
  ${CYAN}/exit${RESET}, /quit      leave the chat
`);
}

async function postJson(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

async function streamChat(
  chatUrl: string,
  message: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }

  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let wroteAnyToken = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      let event = 'message';
      let dataRaw = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataRaw += line.slice(5).trim();
      }
      if (!dataRaw) continue;

      let data: any;
      try { data = JSON.parse(dataRaw); } catch { continue; }

      if (event === 'token') {
        process.stdout.write(data.text ?? '');
        wroteAnyToken = true;
      } else if (event === 'reasoning') {
        process.stdout.write(`${DIM}${data.text ?? ''}${RESET}`);
      } else if (event === 'step') {
        if (data.label) process.stdout.write(`\n${DIM}› ${data.label}${RESET}\n`);
      } else if (event === 'error') {
        process.stdout.write(`\n${RED}${data.error ?? 'error'}${RESET}\n`);
      } else if (event === 'done') {
        if (!wroteAnyToken && data.response) process.stdout.write(data.response);
        process.stdout.write('\n');
      }
    }
  }
}

export async function runChat(rawOptions: Partial<ChatOptions> & { version: string }): Promise<void> {
  const options: ChatOptions = { version: rawOptions.version, url: rawOptions.url, session: rawOptions.session };
  let chatUrl = resolveChatUrl(options);
  let sessionId = options.session || randomSessionId();

  printBanner(options.version);
  console.log(`${DIM}Connected to ${chatUrl} — session ${sessionId}. Type /help for commands, /exit to quit.${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${CYAN}›${RESET} `,
  });

  let inflight: AbortController | null = null;
  const safePrompt = () => { if (!(rl as any).closed) rl.prompt(); };

  rl.on('SIGINT', () => {
    if (inflight) {
      inflight.abort();
      console.log(`\n${YELLOW}(interrupted)${RESET}`);
      safePrompt();
    } else {
      rl.close();
    }
  });

  safePrompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) { safePrompt(); continue; }

    if (input.startsWith('/')) {
      const [cmd, ...rest] = input.slice(1).split(/\s+/);
      const arg = rest.join(' ').trim();

      if (cmd === 'help') {
        printHelp();
      } else if (cmd === 'exit' || cmd === 'quit') {
        rl.close();
        break;
      } else if (cmd === 'clear') {
        try {
          await postJson(`${baseUrl(chatUrl)}/session/clear`, { session_id: sessionId });
          console.log(`${DIM}Session "${sessionId}" cleared.${RESET}`);
        } catch (e: any) {
          console.log(`${RED}Could not clear session: ${e.message}${RESET}`);
        }
      } else if (cmd === 'session') {
        if (arg) { sessionId = arg; console.log(`${DIM}Switched to session "${sessionId}".${RESET}`); }
        else console.log(`${DIM}Current session: ${sessionId}${RESET}`);
      } else if (cmd === 'url') {
        if (arg) {
          chatUrl = arg;
          saveConfig({ thinkiacChatUrl: arg });
          console.log(`${DIM}Chat endpoint set to ${chatUrl} (saved).${RESET}`);
        } else {
          console.log(`${DIM}Chat endpoint: ${chatUrl}${RESET}`);
        }
      } else {
        console.log(`${YELLOW}Unknown command /${cmd}. Try /help.${RESET}`);
      }
      safePrompt();
      continue;
    }

    inflight = new AbortController();
    try {
      await streamChat(chatUrl, input, sessionId, inflight.signal);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.log(`${RED}[thinkiac] ${e.message}${RESET}`);
        console.log(`${DIM}Is the runtime running? Try: cd apps/runtime && npm run dev${RESET}`);
      }
    } finally {
      inflight = null;
    }
    safePrompt();
  }
}
