# Design System: Slate

## 1. Style Definition

- **Name:** Slate
- **Type:** Dark-ground, object-elevation, dense, utilitarian
- **Keywords:** flat ground, shadow-based elevation (not cards), monochrome, fixed brand chip, OS-style icon grid, high information density
- **Era:** 2020s productivity tooling
- **Light/Dark:** ✓ Full / ✓ Full

Agent is a chat + dock + app-launcher shell — a control surface you operate all
day, not a page you read once. Every visible control should read as a real
object resting on a flat ground, not a decorated rectangle. This replaces the
prior "Zero Interface" (voice-first / ambient / hide-until-needed) framing,
which described a different kind of product and never matched what Agent
actually is: dense, always-visible, keyboard-and-mouse driven.

## 2. Color Palette

Strictly achromatic — no hue anywhere. Every color decision is lightness,
contrast, and shadow, never a tint. The one deliberate exception is the Σ
brand chip, which is pinned to black-on-white regardless of theme (see §9).

## 3. Visual Effects

Object elevation only ("Slate"): a two-layer shadow (a tight contact shadow +
a wider ambient shadow), lift on hover (`translateY(-2px)`), settle on press.
No gradients, no sheen, no glassmorphism, no "floating card over a canvas"
containers. The floating sensation comes entirely from individual objects
(dock icons, window/dock cards, session rows, the New Topic pill, chips, the
InputBar) — the containers around them (the sidebar rail, the content ground,
a mobile drawer) stay flat.

## 4. AI Prompt Keywords

Dark or light flat ground, individual UI objects elevated by a soft double
shadow (not by color or gradient), monochrome palette, dense information
layout, OS-style icon grid for app launchers, fixed-identity brand chip,
push/drawer navigation on mobile (content physically slides to reveal a
panel, no dimmed scrim).

## 5. CSS Technical

```css
elevation: two-layer box-shadow (contact + ambient), translateY(-2px) on hover;
rail: always a step darker/lighter than content depending on theme, never a fixed color;
brand-mark: fixed #050505 background / #ffffff glyph regardless of theme;
mobile-nav: push (content translateX), not overlay+backdrop-blur;
```

## 6. Design System Variables

Defined once in `Home.svelte`'s `.shell` / `.shell[data-theme="light"]` blocks
and consumed via `var()` from every component (Svelte scoping doesn't block
custom-property inheritance, so this is the single source of truth):

```css
/* Rail — Sidebar + mobile drawers. Not a fixed color: dark theme uses a
   near-black rail (--rail-bg: #0a0b0c) against a dark-grey content ground
   (--bg: #111111); light theme uses a white rail (--rail-bg: #ffffff)
   against a soft-grey content ground (--bg: #fafafa), separated by a
   hairline border. An earlier pass tried a fixed dark-charcoal rail
   regardless of theme — it read as an unwanted smudge in light mode and
   was reverted. */
--rail-bg / --rail-surface / --rail-flat / --rail-flat-hover
--rail-border / --rail-border-hi
--rail-txt / --rail-txt-2 / --rail-txt-3
--rail-shadow-rest / --rail-shadow-hover
--rail-active / --rail-active-ring / --rail-emphasis
--push-shadow          /* soft edge shadow when a mobile drawer pushes content aside */

/* Content-area floating objects: InputBar, hero suggestion chips, the
   active desktop tab. Same two-layer shape as the rail shadow, tuned
   softer since the content ground is never as dark as the rail. */
--shadow-soft / --shadow-soft-hover

/* Generic surface-tint ladder — the content-area equivalent of --rail-flat,
   for any component (MessageList, Sessions, SessionTabs, chips, popups,
   scrollbar thumbs, subtle hover backgrounds...) that needs a translucent
   wash rather than a solid surface color. Same alpha in both themes, but
   the color family flips: white wash on the dark ground, black wash on
   the light ground — so a hardcoded rgba(255,255,255,X) copied from one
   theme silently breaks in the other (see §14). Always reference these
   with a same-theme literal fallback, e.g.
   `background: var(--w05, rgba(255, 255, 255, 0.05));`, so the rule still
   renders sanely if the var is ever unavailable (SSR, isolated stories).
   Rungs: --w01 --w015 --w018 --w02 --w025 --w03 --w04 --w045 --w05 --w06
   --w07 --w08 --w09 --w10 --w12 --w13 --w14 --w15 --w18 --w20 --w22 --w25
   --w30 --w35 --w40 --w45 --w50 --w60 --w70 --w75 --w80 --w85 --w90 */
```

## 7. Implementation Checklist

- ☐ Every floating object uses the two-layer shadow + hover lift, nothing else
- ☐ No gradients, sheens, or glow shadows (a hardcoded `rgba(255,255,255,…)` glow was found and removed from InputBar2 — it only ever worked in dark theme)
- ☐ Rail color is theme-derived, never a fixed hex regardless of theme
- ☐ Mobile navigation pushes content (`translateX`), no backdrop scrim
- ☐ Σ brand chip stays fixed black/white everywhere it appears
- ☐ UI copy in English

## 8. Visual Theme & Atmosphere

- Density: 8/10 — Dense, information-forward
- Variance: 3/10 — Structured, few one-off treatments
- Motion: 3/10 — Subtle (hover lift, panel push, nothing decorative)

## 9. The Σ Brand Mark

Agent's identity chip. Fixed **#050505 background, #ffffff glyph**,
regardless of theme — it's identity, not themed UI, the same way a physical
logo doesn't relight itself for dark mode. Very rounded square
(`border-radius: 30%`), Ubuntu font-family with a system-sans fallback, and
the glyph is rendered smaller than the box so it reads as generously padded
rather than filling the tile edge-to-edge.

Used in exactly three places — don't add a fourth without reconsidering
whether it dilutes the mark:
- The Sidebar header (`.sigma-mark` on `.sb-mark`, defined globally in Home.svelte)
- The Agent entry in the Apps grid and the Dock cards (`app.name === 'Agent'`)
- Nowhere else. It was tried above the Home hero headline and removed — it
  competed with the greeting instead of supporting it.

## 10. Typography Rules

- **Display / Hero:** Ubuntu (system-ui fallback) — Weight 700, tight tracking, used for headline impact
- **Body:** Ubuntu (system-ui fallback) — Weight 400, 16px/1.6 line-height, max 72ch per line
- **UI Labels / Captions:** Ubuntu (system-ui fallback) — 0.875rem, weight 500, slight letter-spacing
- **Monospace:** Ubuntu Mono / JetBrains Mono — code, metadata, technical values, `<kbd>` key hints
- **Brand mark (§9):** also Ubuntu — now the same family as the rest of the UI, not a departure

Scale:
- Hero: clamp(2.5rem, 5vw, 4rem)
- H1: 2.25rem
- H2: 1.5rem
- Body: 1rem / 1.6
- Small: 0.875rem

## 11. Component Stylings

- **Rail (Sidebar, mobile drawers):** Flat background, theme-derived (§6). Never elevated as a container — no shadow, no separate "panel card" floating over a canvas. Separated from content by a hairline border only.
- **Floating objects (dock icons, Dock/window cards, session rows, New Topic pill, InputBar, hero chips, active tab):** Flat surface color + the two-layer Slate shadow. `translateY(-2px)` and a wider/softer shadow on hover; settle back on press. No gradient, no inner sheen, no specular hover sweep — all three were tried and rejected as reading "AI-generated."
- **Dock / window cards:** The one exception to the floating-object rule above — these stay *flat* (border + faint tint, small hover shadow only), not full Slate elevation. A wide floating shadow on the thumbnail-preview cards specifically read wrong in review.
- **New Topic:** An emphasized pill sitting directly above the Sessions list (not a standalone button elsewhere in the sidebar). Icon in a small dark circle that rotates 90° on hover — the one deliberate micro-interaction in the sidebar.
- **Sessions list:** Collapses to 3 by default with a dashed "Show N more" toggle. The active/current session can expand to show its bag's step progress (segmented bar or percentage, existing real functionality — not reinvented).
- **Apps grid (sidebar, compact):** Search input + paginated 3-column grid with dot pagination, matching the real `Apps.svelte` compact variant. The mobile launcher variant (`variant="launcher"`) stays unpaginated by design — it already shows everything.
- **Primary Button:** Subtly rounded (0.5rem) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600.
- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. No floating labels.
- **Empty States:** Icon-based composition with descriptive text and action button.

## 12. Layout Principles

- **Grid:** CSS Grid primary. Max-width containment: 1280px centered with 1.5rem side padding.
- **Spacing rhythm:** Balanced. Base unit: 0.5rem (8px).
- **Mobile navigation:** Push, not overlay. Opening a Sidebar drawer translates the main content sideways by exactly the drawer's own width, revealing the (always-rendered, lower z-index) drawer underneath — a soft edge shadow (`--push-shadow`) on the shifted content instead of a dimmed backdrop scrim. Tapping the shifted content closes the drawer.
- **z-index contract:** rail panels (mobile, `z-10`) / main content (`z-20`, shifts to reveal panels) / push-catcher overlay (`z-30`) / modal (300) / toast (500).

## 13. Motion & Interaction

- **Physics:** Ease-out curves, 160-320ms duration.
- **Object hover:** `translateY(-2px)` + shadow grows from `--rail-shadow-rest`/`--shadow-soft` to the `-hover` variant. Settle on `:active`.
- **Mobile push:** `transform: translateX(...)` over 320ms, `cubic-bezier(0.32, 0.72, 0, 1)` (a slight overshoot-settle feel, matching a physical drawer).
- **Sidebar collapse/expand:** width transition, 250ms, `cubic-bezier(0.4,0,0.2,1)`.
- **Performance:** Only `transform`, `opacity`, and `box-shadow` animated. No layout-triggering properties.

## 14. Anti-Patterns (Banned)

- No emojis in UI — icon system only
- No decorative gradients, sheens, or specular hover sweeps on any surface — tried during design exploration, consistently read as "AI-generated," removed
- No "floating card over a canvas" container treatment for the rail or main content — tried, rejected; elevation lives on individual objects only
- No fixed rail color regardless of theme — tried (dark charcoal rail even in light mode), rejected as an unwanted smudge; rail color must derive from the active theme
- No pure black (#000000) outside the Σ brand chip, which is deliberately fixed
- No `h-screen` — use `min-h-[100dvh]`
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No mobile overlay-with-backdrop-scrim navigation — push mechanic only
- No generic lorem ipsum in demos; use real package/session data shapes
- No standalone `rgba(255,255,255,X)`/`rgba(0,0,0,X)` surface tint — it only renders correctly in the theme it was eyeballed in (found scattered across MessageList, SessionTabs, Sessions, Home's toast/overlay rules); use the `--wXX` ladder from §6 instead, which flips color family per theme

## Historical Context

Superseded "Zero Interface" (voice-first, ambient, minimal-visible-UI), which
was a generic AI-era landing-page template that never matched Agent's actual
shape: a dense, always-visible chat + dock + launcher shell. This system was
arrived at through iterative visual review — several directions (metallic
sheen, floating-card islands, a fixed-dark rail, decorative Σ placement) were
built, reviewed, and explicitly rejected before landing here; see §14 for
what not to reintroduce.

## Use Case

Agent's own shell (Sidebar, mobile drawers, Home/Hero, InputBar, session
tabs). Not intended as a general marketing/landing-page system.
