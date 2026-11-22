# Shell visual composition

Related to #41. This branch builds on the controller and history work in #40;
review and accept that prerequisite independently before merging this stage.
No Auth changes or deployed Runtime acceptance are included.

`Index.svelte` keeps state, reactive derivations, public methods, controller wiring,
window listeners, desktop/sidebar integration and the shell layout/theme tokens.
It composes existing `Sidebar` and `SessionTabs` with five focused visual areas:

| Component | Responsibility | Live bindings |
| --- | --- | --- |
| `ConversationPanel` | History expansion, messages and activity; composer slot | MessageList instance, suggested message |
| `ComposerArea` | Structured input, normal composer and recent conversations | Message draft, measured/animated stage element |
| `AppSurface` | Keyed frames, loading indicators and frame load callbacks | Shared frame registry; its identity remains owned by Index |
| `MobileHeader` | Chat/app navigation and contextual menus | Collapsed header, chat menu, app menu |
| `ShellOverlays` | Canvas, notifications, status and information sheets, dialog host | Open states, notification count, status modal |

Controllers still own business operations. Components receive explicit values,
callbacks and bindings; they do not create another store or transport. Frame load
still applies the current theme, catches cross-origin access and settles loading.
Inactive frames and the chat stay mounted. Refresh keys, sandbox attributes,
classes, visible strings, route names and event payloads remain unchanged.

Each area carries its original scoped CSS. Layout/theme styles stay on the shell
root and reach children through the same inherited custom properties. No wrapper
elements were added. The composer slot preserves its location inside the chat
panel while its element and value remain bound to Index for measurement, animation,
session drafts and suggestion updates. Legacy callback names remain compatible.

## Characterization and review sequence

`7e9de8e2` published browser characterization against the original composed view
before any visual extraction. The following five commits each extract one area.
The desktop/mobile browser scenarios passed after each extraction, comparing
computed layout properties with snapshots captured before the changes.

The final browser coverage also runs against an isolated worktree at prerequisite
commit `5524849f`, then against the candidate. Both pass dark/light at desktop
1440x1000 and mobile 390x844: initial composer, chat information and Escape,
header collapse/restore, streaming/completion, app load, sandbox, refresh retaining
the frame, back/forward, draft retention, new session, structured prompt replacing
the composer and unmount without page errors. Selected computed styles are equal
between baseline and candidate. This is not a full pixel comparison or a manual
check on physical mobile hardware.

## Reproduction

Install lockfile dependencies, including the Chromium required by Puppeteer.
Run `node packages/shell/test/controllers.browser.mjs` for the four scenarios.
For before/after layout comparison, run the same harness on the baseline first:

```sh
SHELL_RECORD_BASELINE=1 SHELL_VISUAL_BASELINE=/tmp/shell-layout node packages/shell/test/controllers.browser.mjs
```

Then run the candidate with the same prefix and without `SHELL_RECORD_BASELINE`:

```sh
SHELL_VISUAL_BASELINE=/tmp/shell-layout node packages/shell/test/controllers.browser.mjs
```

Both runs must use the same browser, environment and harness revision. Snapshots
are optional, local JSON files. The harness serves real compiled Svelte and the
bus with simulated Agent transport/HTTP; it never starts the deployed Runtime.

The mandatory `shell:vitest` file selection in `scripts/test-suites.json` passed:
176 tests across 17 files, including controller/lifecycle characterization, history,
persistence, runtime contracts and SSR. Six test-runner tests also passed.
The installed Vitest is 1.6.1 versus required 4.1.12; focused verification used
`--pool=forks --minWorkers=1 --maxWorkers=1` with the repository config.

All Node-based Shell tests were also compared at `5524849f` and the candidate,
excluding files importing Vitest. Both produced 94 passes and the same six failures:
headless catalog discovery, auxiliary view filtering, retired tenant menu entries,
public-only view URLs, settings field validation, and the stale source assertions in
`mobile_app_topbar.test.js`. Those assertions already expect retired labels and
inline controller functions. They were not rewritten to hide the baseline failure.
Do not run these Node tests under Vitest: it reports missing suites for Node-only
files. Source contracts in the mandatory Vitest suite now inspect the extracted
component directory along with the existing controllers.

## Limits

No merge, deployment or Runtime stability receipt is implied. Real Agent/provider
traffic, physical-device gestures, external cross-origin content, every dialog
state and complete screenshot parity remain outside this simulated browser check.
A physical click on the collapsed left-panel control did not satisfy the added
assertion even before extraction; that scenario was excluded from the passing
harness. Drawer gesture/handler contracts remain covered by the existing tests.
The six baseline Node failures require separate investigation before claiming a
fully green repository. Review #40 and this dependent stage before closing #41.
