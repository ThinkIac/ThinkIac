# Process bridge

`@thinkiac/module-process-bridge` connects a long-running Python, Node, Deno, Ruby, Bun or Rust process to a host through newline-delimited JSON on standard input/output. It correlates calls, enforces a timeout, reports process messages, and restarts crashed processes with exponential backoff.

The host supplies callbacks for its own event bus and lifecycle policy. This keeps the transport reusable without coupling it to a specific runtime container.
