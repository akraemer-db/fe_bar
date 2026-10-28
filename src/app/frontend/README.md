# Fleet Reliability Command Center (frontend)

React 18 + Vite + TypeScript single-page app for the Mesa Ridge Pressure Pumping demo (synthetic data).
Three views: **Ranked Actions** (hero, dispatch flow, pump drawer), **Timeline** (technician Gantt and recent work orders), and **Performance** (opportunity and performance charts from `GET /api/performance`), plus a collapsible **Ask Genie** panel.

## Run

```bash
npm install

# UI only, served from src/mock.ts (no backend needed)
npm run dev:mock          # http://localhost:5173

# Against the FastAPI backend on :8000 (Vite proxies /api)
npm run dev
```

Mock mode sets `VITE_MOCK=1` through `.env.mock`. Mock responses mirror the API contract in `src/types.ts`, and dispatches and status changes persist in memory until the dev server restarts.

## Build

```bash
npm run build
```

Runs `tsc --noEmit`, then writes the production bundle to `../backend/static` (`index.html` plus `assets/`). Asset paths are relative (`base: "./"`), and the app calls the API with relative `/api/...` paths, so the FastAPI app can serve the static folder at `/`.

## Layout

- `src/api.ts`: fetch wrapper. Errors surface as toasts (non-blocking). `IS_MOCK` switches to `src/mock.ts`.
- `src/mock.ts`: mock backend with the hero pumps (F07-P09, F07-P14, F03-P02) and scripted trends.
- `src/components/ActionsView.tsx`: KPI strip and ranked table.
- `src/components/ActionDrawer.tsx`: drivers, options, trend sparklines, re-score.
- `src/components/DispatchModal.tsx`: two-step dispatch (AI draft, then technician and window).
- `src/components/TimelineView.tsx`: Gantt with stage-gap bands, status popover, recent work orders.
- `src/components/PerformanceView.tsx` and `performanceCharts.tsx`: Performance tab (recharts, dataviz palette, table view under each chart). Mock data comes from `src/performance.sample.json`.
- `src/components/GeniePanel.tsx`: Genie chat with SQL and result table (max 20 rows).
- `src/markdown.tsx`: small markdown renderer for drafts (headings, lists, bold, code). No `innerHTML`.

Dependencies are limited to react, react-dom, and recharts (sparklines). Styling is plain CSS in `src/styles.css`.
