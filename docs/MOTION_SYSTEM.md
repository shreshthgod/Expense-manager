# Motion system

Motion in Expense Manager explains a change the person caused: a dialog opening, a value being saved, a row appearing or leaving. It never delays saving, navigation, focus or typing, and nothing moves on its own to decorate a page.

## Tokens — `lib/motion/tokens.ts`

| Token | Value | Used for |
|---|---|---|
| `DURATION.press` | 120 ms | Button press scale (`active:scale-[0.98]`) |
| `DURATION.disclosure` | 190 ms | Overlays, "How is this calculated?" panels, chevrons |
| `DURATION.entry` | 210 ms | Items entering (fade + 6 px rise) |
| `DURATION.modal` | 250 ms | Dialogs and bottom sheets opening |
| `DURATION.exit` | 150 ms | Anything leaving (exits are faster than entries) |
| `DURATION.chart` | 380 ms | Chart series and progress bars settling on new values |
| `EASE.out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Entries (Tailwind `ease-out-soft`) |
| `EASE.in` | `cubic-bezier(0.4, 0, 1, 1)` | Exits |
| `STAGGER` / `MAX_STAGGERED` | 28 ms / 7 items | Only the first few visible items of a list stagger |

Variants: `fadeUp`, `fadeIn`, `dialogVariants` (fade + 2 % scale + 4 px), `sheetVariants` (slide from the bottom on phones), `overlayVariants`.

## Where motion is used

| Moment | Behaviour |
|---|---|
| Dialog / sheet | Centered dialog on ≥ 640 px, bottom sheet on phones. Focus moves into it and is trapped; the rest of the app is `inert`; Esc and the backdrop close it (unless there are unsaved changes, which asks first); focus returns to the trigger. |
| Navigation highlight | The active sidebar item's background slides between items (shared layout). |
| Mobile drawer | Slides in from the left (250 ms), out faster (180 ms). |
| Toasts | Fade in; pause while hovered or focused; actions like **Undo** stay available for 8 s. |
| Progress bars | Width eases to the new value (380 ms) so a change after saving is visible. |
| Charts | Series animate on data change only; disabled when reduced motion applies. |
| Inline errors | Fade in (200 ms) next to the field; nothing shakes. |
| Buttons | 2 % press scale; loading shows a spinner in place and keeps the button width. |

Not animated: page loads, scrolling effects, hover lifts on cards, numbers counting up.

## Preferences

Settings → Appearance → Motion (`UserPreference.motion`, synced across devices):

| Setting | Effect |
|---|---|
| **Match device** (default) | Follows the OS `prefers-reduced-motion`. |
| **Reduced** | Opacity changes only; no movement or scaling; CSS animations shortened to 1 ms. |
| **Off** | No animation or transition at all (Framer Motion duration 0; CSS `animation`/`transition: none`). |

Implementation: `components/providers/app-context.tsx` sets `<html data-motion>` and wraps the app in `MotionConfig`; `app/globals.css` applies the CSS rules; charts read `useReducedMotion()`; spinners use `motion-reduce:animate-none`.

## Rules for new UI

1. Animate only in response to an action, and only to show what changed.
2. Use the tokens; don't invent durations. Exits are shorter than entries.
3. Never await an animation before saving, navigating or moving focus.
4. Every animated element must look correct with motion off.
5. Don't animate money values (no count-ups); show the final figure immediately.
