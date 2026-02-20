# Performance Plan

## Current hotspots

- `src/App.tsx` prop orchestration and derived-action recomputation.
- `src/ui/screens/GameTableScreen.tsx` dense conditional rendering.
- `src/ui/components/StatsDashboard.tsx` heavy table/chart surfaces.

## Practical improvements

1. Keep heavy derived collections memoized.
2. Minimize unnecessary room refresh churn in multiplayer flows.
3. Use focused list truncation/virtualization patterns for long logs/feed surfaces.
4. Keep animation layers lightweight and reduced-motion aware.

## Performance guardrails

- Avoid introducing synchronous expensive operations in render.
- Keep rollout AI compute bounded for hard mode.
- Preserve polling intervals that balance responsiveness and CPU/network cost.
