# Margin AI Router — Design System

## Product direction

Margin is a personal reading command center, not a generic chatbot or an analytics dashboard. The home screen gives one context-aware input the visual priority; the sidebar keeps deterministic destinations available without competing with the current reading goal.

The initial automated recommendation (pink/purple marketing palette, handwritten typography, App Store landing pattern) was rejected because it did not fit a focused long-form reading product. This system keeps the established Margin reading language and borrows only the useful AI-native traits: ambient context, visible tool execution, typed results, and fast routing.

## Visual language

- Use existing semantic tokens from `src/app/globals.css`.
- Light: quiet cool gray canvas, white raised surfaces, restrained violet accent.
- Night: navy-black canvas and raised blue-gray surfaces; preserve reading contrast.
- UI typography: system/SF stack. Reading typography: Iowan/Georgia only inside book content or quotations.
- Use Lucide icons. No decorative emoji, mascot, neon glow, or gradient wash.
- Prefer hairline dividers and open space over a grid of dashboard cards.

## Layout

- Desktop sidebar: 232 px, collapsible to 68 px.
- Main router: one large composer, response area, and a narrow live-context rail.
- Reader remains distraction-free and does not inherit the application sidebar.
- Under 820 px, sidebar becomes an off-canvas panel and the router stacks above context.

## Interaction

- The router must produce an action, structured result, or destination—not chat bubbles.
- High-frequency intents route locally and immediately; ambiguous requests may use the configured model.
- Show a compact execution trace on demand: intent, environment, tool.
- Motion is limited to 150–260 ms opacity/translation transitions for results and panels.
- Every control has visible focus, 36–44 px targets where space permits, and reduced-motion support.

## Product safeguards

- Never imply that the model can use a tool outside the allowlist.
- Keep book files and the full search index local; only user-requested AI work reaches the configured provider.
- Expose failure and local fallback states in plain language.
- Preserve a visible path to Library, Review, Vocabulary, Notes, Insights, Roles, Settings, and Import.
