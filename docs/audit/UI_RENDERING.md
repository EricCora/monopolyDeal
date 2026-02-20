# UI Rendering Audit

## Rendering model

- React component architecture with screen-level composition.
- `App.tsx` routes to screen containers and passes typed props.
- `GameTableScreen` renders table/piles/player zones and in-turn action surfaces.

Key files:
- `src/App.tsx`
- `src/ui/screens/GameTableScreen.tsx`
- `src/ui/components/CardView.tsx`
- `src/ui/components/HandFan.tsx`
- `src/ui/components/RecentEvents.tsx`

## Card rendering

- Cards are DOM/CSS-rendered via `CardView` and themed token classes.
- Hand layout uses responsive fan/rail behavior (`HandFan`).
- Property and payment selections are direct card interactions in table zones.

## Layout model

- Core layout uses CSS grid/flex in `src/ui/theme/components/layout.css` and screen-specific styles.
- Desktop/mobile adjustments are handled by theme screen styles and hand fit modes.

## Motion and feedback

- CSS-driven animations for draw ghosts, table alerts, and transitions.
- Reduced-motion support is wired through preferences and rendering conditions.

## Accessibility baseline

- ARIA regions for status banners, dialogs, and activity panels.
- Keyboard/screen-reader support exists for core controls, with room to deepen keyboard traversal for dense card interactions.

## Rendering hotspots

- `src/App.tsx` prop orchestration breadth.
- `src/ui/screens/GameTableScreen.tsx` conditional rendering density.
- `src/ui/components/StatsDashboard.tsx` table rendering complexity.
