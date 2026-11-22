# Shell controllers

`views/Index.svelte` owns the visual state, reactive derivations, component bindings,
markup and scoped CSS. It delegates behavior to `views/controllers/index.js`.
The exported `handleNewTab` component method and existing event/prop contracts remain
available. This extraction does not introduce a store, another transport, a new
package or a change to the Agent protocol.

## Boundaries

| Controller | Responsibility |
| --- | --- |
| `chat_events` | Live/replayed events, cursors, streaming messages, queue settlement and unread state |
| `chat_commands` | Sending, cancellation, feedback, permissions, structured submissions and clearing |
| `session_loading` | Activation guards, history loading, governance card reconciliation and reconnect replay |
| `session_tabs` | Session creation, model preferences, tab selection, ordering, pinning and closing |
| `recent_sessions` | Recent conversation loading, pagination and selection |
| `workspace_persistence` | Workspace coordinates and tabs, excluding conversation history |
| `mobile_navigation` | Internal back/forward stacks and browser history integration |
| `app_navigation` | Deep links, package/iframe/file opening and existing fallback rules |
| `app_tabs` | App tab state, refresh and iframe loading deadlines |
| `desktop_integration` | Desktop handoff consumption and control commands |
| `desktop_shortcuts` | Keyboard commands and text-editing exceptions |
| `widget_bus` | Existing UI event subscriptions and front/back forwarding |
| `connection_status` | Offline recovery, native status reporting and global loading |
| `mobile_controls` | Drawers, gestures, refresh and launcher controls |
| `chat_tools` | Optional bag/artifact availability and session information actions |
| `app_details` | Catalog metadata, information sheets and contributed header actions |
| `composer_layout` | Composer measurement and dock animation |
| `structured_messages` | Assistant content processing and structured input visibility |
| `shell_lifecycle` | Mount wiring, transport subscriptions, persistence listeners and disposal |

Controllers receive only their declared state accessors and dependencies. The
composition root copies property descriptors without evaluating getters. This
makes construction safe before state initialization and during SSR. Browser globals
are resolved lazily, when a mounted action needs them.

Assignments go through setters declared inside the Svelte component, preserving
Svelte invalidation. Nested writes to reactive maps also reassign the map through
its setter. Do not replace these accessors with destructured state values: that
would capture a stale value and bypass reactive updates. Controllers retain no
shared module-level conversation state.

The runtime adapter still owns transport. The same event processor handles live
messages and replay; sequence numbers are compared only within an epoch. Existing
session activation and reconciliation generation guards remain in place. Approval
cards still require a confirmed HTTP response before they are cleared.

Unmount removes runtime message/reopen/command subscriptions and the exact
visibility listener registered at mount. Deferred background initialization,
composer measurement and readiness callbacks check disposal before updating state.

## Verification

The commits add characterization tests before each corresponding extraction.
`controllers.characterization.test.js` originally executed the functions inside
`Index.svelte`; it now exercises the production controller composition.
`lifecycle.characterization.test.js` followed the same strategy for mount behavior.
Three additional failing tests reproduced lifecycle disposal defects before their
fix. New names and documentation use English; legacy names remain compatible.

The mandatory `shell:vitest` selection in `scripts/test-suites.json` includes the
controller tests, runtime contracts, history, persistence and SSR checks. Run it
through the normal `npm test` workflow after installing lockfile dependencies.
For a focused run:

```sh
npx vitest run --config scripts/test-vitest.config.mjs packages/shell/test/controllers.characterization.test.js packages/shell/test/lifecycle.characterization.test.js packages/shell/test/view-ssr.test.js
node packages/shell/test/controllers.browser.mjs
```

The browser check builds the actual Svelte UI and bus, replaces only the Agent
transport, and serves simulated HTTP responses on a local ephemeral port. It
checks desktop/mobile mount, visible streaming/completion, opening an app, the
public new-session method and unmount, plus mobile back/forward. Each viewport
gets its own browser context. It requires Puppeteer with an installed Chromium.
It does not exercise a deployed Runtime or a real provider.

On the implementation machine, the installed Vitest is 1.6.1 while the repository
requires 4.1.12. The focused suite was run with the project config and explicit
`--pool=forks --minWorkers=1 --maxWorkers=1`: 176 passing tests across 17 files.
The browser scenarios and six test-runner tests also passed. The Node Shell tests
produced 88 passes and the same five failures in both baseline `618d5818` and the
refactored version: app catalog discovery/filtering, legacy tenant menu entries,
public-only view URLs and a settings-field contract. These failures were not
changed or hidden by this refactoring.

The template and scoped CSS after `</script>` are byte-for-byte unchanged from
`618d5818`. The script changed from 2,847 to 620 lines; the complete file changed
from 4,569 lines before the first history extraction to 2,153 lines. Remaining
length primarily belongs to the visual template and scoped styles, rather than
business or transport logic. No Auth files were changed in this continuation.
