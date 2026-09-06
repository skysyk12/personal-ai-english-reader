# Margin Living Reader — Design System

**Product:** local-first English reading and learning workspace for long sessions on Mac
**Direction:** Readwise Reader continuity × Linear control precision
**Personality:** quiet, focused, editorial, exact; never gamified or decorative-first

## Experience principles

1. Reading is the primary surface. Controls remain compact and retreat when attention moves to the page.
2. Learning features form a visible loop: read → capture vocabulary → review → see growth → return to source.
3. Every derived item keeps its original context and a direct route back to the book, page, or EPUB location.
4. Data is honest and calm. Show time, consistency, and due work without artificial streak pressure.
5. Motion explains spatial change. It never delays reading, competes with text, or animates continuously.

## Visual signature

The recurring motif is the **Learning Pulse**: thin concentric rings plus one solid center value. Use it only for review readiness, reading time, or learning-loop status. Supporting geometry is limited to fine rules and quiet arcs. Avoid glassmorphism, ambient blobs, gradients used as decoration, oversized rounded cards, and green “success dashboard” conventions.

## Color tokens

| Role | Light | Night | Use |
| --- | --- | --- | --- |
| Background | `#f5f6f8` | `#0b111a` | App canvas |
| Surface | `#fafbfc` | `#101823` | Main panels |
| Raised surface | `#ffffff` | `#151f2d` | Dialogs, active cards |
| Muted surface | `#eef0f4` | `#1b2736` | Hover and secondary zones |
| Primary text | `#202129` | `#f0f2f5` | Headings and body |
| Secondary text | `#5f6370` | `#a6adba` | Supporting copy |
| Faint text | `#686d79` | `#858f9f` | Metadata; keep AA at rendered size |
| Border | `#e1e3e8` | `#263245` | Default separators |
| Strong border | `#c9cbd3` | `#3a4960` | Focused boundaries |
| Accent | `#5e6ad2` | `#5e6ad2` | Primary actions and progress |
| Accent ink | `#3e4daf` | `#b9c0ff` | Links and active labels |
| Accent surface | `#eceefd` | `#222b49` | Selected controls |
| Danger | `#b94b45` | `#ef7772` | Destructive actions only |

White text on the accent passes WCAG AA. Normal body text targets 4.5:1; large display text and data marks target at least 3:1.

## Typography

- UI and display: macOS system stack (`SF Pro` through `-apple-system`) for Linear-like density and native rendering.
- Long-form reading: Georgia by default, with Iowan Old Style and system sans-serif as reader options.
- Display headings: weight `520–650`, tight tracking from `-0.035em` to `-0.045em`, balanced wrapping.
- Body copy: `15–18px`, line height `1.5–1.85`; reader measure stays near `68–76ch` on desktop.
- Metadata: `8–11px`, uppercase only for short English labels, tracking `0.10–0.15em`.
- Timers, progress values, and chart numbers use tabular figures.

## Geometry and density

- Spacing follows a 4px base with primary steps `4, 8, 12, 16, 24, 32, 48, 64`.
- UI radius is `5–7px`; major containers may use `10–12px`. Book covers keep physical book-like asymmetric corners.
- Prefer 1px borders over card shadows. Shadows are reserved for dialogs, command search, and one featured reading card.
- Desktop content max width: `1180px`. Reader text is narrower and centered independently.
- Touch targets: minimum `40px` on desktop controls and `44px` on compact/mobile primary controls.
- Z-index scale: content `0`, sticky navigation `30`, panels `40`, selection tools `60`, dialogs/command palette `100`, skip link `1000`.

## Core component behavior

### Navigation

- Persistent top navigation on workspace pages; active destination uses accent surface plus accent ink.
- On narrow screens, retain all 5 top-level destinations as labelled accessible icons while hiding visual labels.
- Global command search is reachable through the visible trigger and `⌘ K` / `Ctrl K`.

### Buttons and controls

- One primary action per screen. Secondary actions use raised surface plus border.
- Icon-only controls require accessible names.
- Hover increases contrast; press may translate or scale by at most 1–2px without changing layout.
- All keyboard focus uses the shared 3px `:focus-visible` ring.
- Disabled controls keep semantic `disabled`, reduced opacity, and a non-action cursor.

### Reading surfaces

- Continuous vertical scroll is the default. Pagination is an explicit reader setting.
- PDF offers **图文重排** and **PDF 原版** side by side; neither is treated as a hidden fallback.
- Reflow pages preserve page boundaries, image order, headings, paragraphs, and source page links.
- Reader chrome stays compact; AI and settings open as spatial side panels on desktop and contained overlays on narrow screens.

### Learning surfaces

- Vocabulary rows always show term, source context, status, and due signal.
- Review uses reveal-then-rate progression with keyboard shortcuts and four explicit difficulty actions.
- Insights favor direct values and low-ink bars. Charts must have a text summary and useful empty state.
- Search results show type, source, snippet, and the exact return location.

## Motion system

| Token | Duration | Use |
| --- | --- | --- |
| Fast | `150–180ms` | Hover, focus, button press |
| Standard | `220–280ms` | Panels, tabs, content replacement |
| Spatial | `300–340ms` | Page entrance, review answer reveal, chart growth |

- Enter with `opacity` plus `translateY(6–12px)` using `cubic-bezier(.22,1,.36,1)`.
- Exit faster than enter. Only `transform` and `opacity` animate for layout-neutral motion.
- Width transitions are limited to explicit progress indicators; grid panel resizing is short and interruptible.
- No bounce, parallax, autoplay loops, or decorative stagger across dense tables.
- `prefers-reduced-motion: reduce` collapses all animation and smooth scrolling to near-zero duration.

## Responsive rules

- Verify at `375`, `768`, `1024`, and `1440px`, plus short landscape viewports.
- No document-level horizontal scrolling.
- Mobile retains vertical reading, uses a compact icon top bar, and promotes the import action to full width.
- Secondary dashboard columns stack after primary reading and review content.
- Reader images use their intrinsic aspect ratio and never exceed the text column width.

## Accessibility and performance

- Semantic links for navigation, buttons for actions, labelled controls, hierarchical headings, skip link, and polite live regions.
- Every meaningful image has descriptive alt text; decorative SVGs are hidden from assistive technology.
- Use `content-visibility: auto` for long result/vocabulary rows and WebP for extracted PDF images.
- Reserve image dimensions/aspect ratios to prevent layout shift.
- Debounce local full-text search and abort stale requests.
- Avoid `transition: all`, invisible focus, hover-only actions, and color-only status.

## Pre-delivery checks

- [ ] Light and night mode visual QA
- [ ] Keyboard flow and visible focus
- [ ] WCAG 2 A/AA automated audit plus manual contrast review
- [ ] 375px mobile and short landscape with no horizontal overflow
- [ ] Reduced-motion behavior
- [ ] PDF image/text ordering against the original page
- [ ] Full-text search returns to the exact PDF page or EPUB location
- [ ] Typecheck, lint, and production build pass
