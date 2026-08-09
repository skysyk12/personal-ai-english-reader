# Reading OS — Design System Master

**Project:** Margin · Personal AI English Reader  
**Status:** Selected product direction  
**Updated:** 2026-08-04

## Product thesis

Reading OS is a local-first reading workspace for one person studying English on a Mac. It combines Readwise-like content continuity with Linear-like density, keyboard control, precise states, and quiet surfaces. The interface should feel like a focused operating system for reading—not a marketing site or an admin dashboard.

## Visual language

### Color tokens

| Role | Value | Token |
|---|---:|---|
| App background | `#F5F6F8` | `--bg` |
| Primary surface | `#FAFBFC` | `--surface` |
| Raised surface | `#FFFFFF` | `--surface-raised` |
| Muted surface | `#EEF0F4` | `--surface-muted` |
| Primary text | `#202129` | `--ink` |
| Secondary text | `#5F6370` | `--ink-soft` |
| Tertiary text | `#686D79` | `--ink-faint` |
| Border | `#E1E3E8` | `--line` |
| Strong border | `#C9CBD3` | `--line-strong` |
| Product accent | `#5E6AD2` | `--accent` |
| Accent surface | `#ECEEFD` | `--accent-soft` |
| Accent text | `#3E4DAF` | `--accent-ink` |
| Reading highlight | `#D8B64B` | `--highlight` |
| Destructive | `#B94B45` | `--danger` |

Purple is reserved for current state, primary actions, focus and AI context. Yellow is reserved for source-text highlights. Neither color is decorative.

### Typography

- Product UI: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`
- Long-form book text: `Georgia, "Times New Roman", serif`
- Shortcuts and technical values: system monospace through `kbd`/`code`
- UI headings use the product sans at 600–660 weight; avoid oversized editorial serif headings.
- Body copy: 13–15 px on desktop, at least 16 px for long mobile input text.

### Shape, depth and spacing

- Radius: 5 px controls, 7 px panels, 10 px command palette only.
- Borders carry most hierarchy; shadows are reserved for floating layers.
- Spacing follows 4 / 8 px rhythm, with 12, 16, 24 and 32 px section tiers.
- Desktop content width: 1140 px maximum.

## Layout model

```text
┌ Brand ───────────── Primary destinations ───── Search / ⌘ K ┐
├──────────────────────────────────────────────────────────────┤
│ Page identity                                      Main CTA │
├ Workspace status / context / active role ───────────────────┤
│ Dense, bordered work surface                                  │
└──────────────────────────────────────────────────────────────┘
```

The reader replaces the application navigation with a book-specific top bar, left contents panel, centered text canvas and optional right AI panel.

## Signature interaction

The global `⌘ K` command palette is the product’s memorable element. It opens from every route, supports search, arrow-key movement, Enter to run and Escape to close. It exposes navigation and high-frequency actions without competing with the book text.

## Component rules

- Buttons: 36 px desktop minimum; 44 px touch target on narrow screens.
- Inputs: visible labels or accessible names, explicit focus ring, inline errors.
- Lists: table-like rows with stable columns on desktop; collapse secondary data on mobile.
- Cards: no decorative floating card grids when a scannable list is more useful.
- Navigation: active destination uses accent surface plus `aria-current="page"`.
- Loading: reserve space with skeletons; never block the first readable EPUB frame on background indexing.
- Dialogs: clear close action, Escape support, constrained scrolling and strong scrim.
- Icons: Lucide outline icons only; no emoji UI icons.

## Motion

- Micro-interactions: 150–220 ms.
- Animate color, opacity and transform; do not animate layout for decoration.
- Reader panel transitions express panel entry/exit only.
- Respect `prefers-reduced-motion`; all content remains immediately available.

## Responsive behavior

- 1440/1024 px: full navigation labels, command trigger and stable list columns.
- 768 px: compact command icon, two-column status grid, reduced reader side panels.
- 390/375 px: icon navigation, single-column status, secondary table columns removed.
- No horizontal page overflow; overlays use `100dvh` and contain overscroll.

## Anti-patterns

- Large marketing-style heroes inside the application.
- Purple-to-pink AI gradients, glass decoration or floating bento cards.
- Low-contrast gray utility text.
- Hover-only actions or unnamed icon buttons.
- Multiple competing primary CTAs.
- Showing API keys in browser-rendered markup, logs or SQLite.

## Delivery checklist

- [ ] Reading OS is forced as the product theme; old visual proposals are not in primary navigation.
- [ ] `⌘ K`, arrow keys, Enter and Escape work.
- [ ] Desktop, tablet and phone have no horizontal overflow.
- [ ] Reader, command palette, forms and mobile navigation pass WCAG A/AA automation.
- [ ] Reduced motion is verified in-browser.
- [ ] TypeScript, ESLint and production build pass.
- [ ] Real EPUB and real DeepSeek response path are tested.
