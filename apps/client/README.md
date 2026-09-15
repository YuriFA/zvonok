# ZvonOK Client

React 19 + Vite SPA: video rooms over a mediasoup SFU, chat, whiteboard, and a developer console.

## Setup

Setup and the full command table live in the root [README](../../README.md). Client-specific facts:

- `pnpm dev` serves the app at http://localhost:5173 (Vite + HMR)

## Architecture

- **Media:** SFU path via `mediasoup-client` over Socket.io signalling — no P2P. Behavior: [openspec/specs/sfu/](../../openspec/specs/sfu/spec.md).
- **Routing:** React Router v7, file-based in `src/routes/` (home, auth, room, history, console).
- **UI:** Base UI primitives (`@base-ui/react`) in `src/components/ui/`, styled with Tailwind CSS v4.
- **State/data:** TanStack React Query; forms via React Hook Form + Zod.

## Project Structure

```
src/
├── routes/           # File-based routes (home, login, register, room, history, console*)
├── features/         # auth, room, media, sfu, chat, whiteboard, console, history
├── hooks/            # Shared React hooks
├── components/       # Shared UI (room/, ui/ primitives)
└── lib/
    ├── config/       # routes.ts, themes.ts, app.ts
    ├── react-query/  # Query client + query keys
    ├── api/          # API client + error handling
    ├── constants/
    └── utils/
```

## Environment

Copy [`.env.example`](.env.example) to `.env.local`. Both variables are required in dev; in a production build each defaults to same-origin (empty string):

```bash
VITE_API_BASE_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```
