# spaceSUITE

spaceSUITE is a Spanish-language social app for group video rooms, live chat, lifestyle posts, and adult connections.

## Run & Operate

- `pnpm --dir artifacts/spacesuite-app run dev` — run the original Node server and vanilla web app.
- `pnpm --dir artifacts/spacesuite-app run build` — check the shipped JavaScript source syntax.
- `pnpm --dir artifacts/spacesuite-app run typecheck` — check all Pages-style API handlers.
- `SESSION_SECRET` is required for account sessions.
- `METERED_DOMAIN` and `METERED_SECRET_KEY` enable SFU video; without them, rooms use the built-in peer-to-peer fallback.
- `GEMINI_API_KEY` enables the optional SUPER KEY assistant.

## Stack

- Vanilla HTML, CSS, and JavaScript. The uploaded `index.html`, `styles.css`, and `js/` app remain the source of truth.
- Node.js 24 server runs the original `functions/api/` handlers and stores local data in `.data/`.
- Group calls use WebRTC with an optional Metered SFU.

## Where things live

- `artifacts/spacesuite-app/index.html`, `styles.css`, and `js/` — original interface and client-side features.
- `artifacts/spacesuite-app/functions/api/` — API routes.
- `artifacts/spacesuite-app/dev-server.mjs` — static hosting and API runtime.
- `artifacts/spacesuite-app/styles-social.css`, `js/social.js`, and `functions/api/social/` — social features added on the original base.

## Architecture decisions

- Do not port this app to React, Vite, or another framework; retain the uploaded vanilla app and its styling.
- Keep the original group-room implementation; use peer-to-peer video when no Metered SFU credentials are configured.
- Keep new social UI and routes alongside the original files instead of replacing the base interface.

## User preferences

The user requires the uploaded spaceSUITE ZIP to remain the definitive project base and asks that its original architecture and design be preserved.

## Gotchas

- The app uses its own Node server and SQLite-backed D1-compatible adapter; the separate API Server artifact should not claim `/api`.
- Media uploads are stored under `.data/uploads`; do not switch the app to another storage/database architecture without explicit direction.
