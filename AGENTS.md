<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

```
npm run dev          # Next.js dev server (Turbopack)
npm run build        # Production build (also runs Next's own typecheck)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run format       # Prettier write
npm run format:check # Prettier check
npm test             # Vitest (no-watch)
npm run test:watch   # Vitest watch mode
```

CI runs in this order: `lint → typecheck → test → build`.

## Environment

- Copy `.env.local.example` to `.env.local` before running. Required vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` (64 hex chars = 32 bytes AES-256-GCM), `META_APP_SECRET`.
- `NEXT_PUBLIC_*` vars are inlined at **build time** — changing them requires a rebuild.
- `ENCRYPTION_KEY` rotation orphans all stored WhatsApp tokens; users must re-save settings.
- `WHATSAPP_TEMPLATES_DRY_RUN=true` in CI/dev avoids hitting real Meta API.

## Architecture

- Next.js 16 App Router, React 19, TypeScript 6, Tailwind v4.
- Path alias: `@/*` → `src/*`.
- Supabase (Postgres + Auth + RLS). Service-role key for server-side only.
- Migrations in `supabase/` applied via **Supabase CLI**, not by the container.
- i18n via `next-intl`; messages in `messages/{en,ko}.json`; locale config at `src/i18n/request.ts`.
- Cron endpoints (`/api/automations/cron`, `/api/flows/cron`) require the `x-cron-secret` header (value of `AUTOMATION_CRON_SECRET`).

## Testing

Tests live alongside source as `*.test.ts` / `*.test.tsx`. Vitest injects dummy `ENCRYPTION_KEY` and `META_APP_SECRET` at module load — no real Supabase or Meta needed. Supabase client is hand-mocked (thenable fake returning `.from()` stub); don't add a real Supabase client lib.

## mcp-server

`mcp-server/` is a standalone Node.js 20+ TypeScript package with its own `package.json`. Build it separately: `cd mcp-server && npm install && npm run build`. It wraps the public REST API (`/api/v1`), not the Next.js internals.

## Docker

- Multi-stage `Dockerfile`, outputs `standalone` bundle, runs as non-root `nextjs` user.
- Build args for `NEXT_PUBLIC_*` vars only. Server-only secrets (`ENCRYPTION_KEY`, `META_APP_SECRET`, etc.) come from `.env.local` via `env_file` at runtime.
- Inside the container the server listens on `PORT=3000`. Use `HOST_PORT` env var (defaults to `3009`) to map to a different host port.
- Apply migrations with Supabase CLI before starting the container.

## Security

- CSP ships as `Content-Security-Policy-Report-Only` (logs to console). Flip to enforce once validated.
- Rate limiter is in-memory and per-process (120 req/min per API key). Fine for single-instance; swap for shared store if scaling.
- Outbound webhook delivery has SSRF protection (blocks private/RFC1918 ranges).
- In Docker: use `docker compose --env-file .env.local up --build -d`, not plain `docker run`.

## Production (Traefik)

The production host does **not** use the repo's `docker-compose.yml`. It runs behind a shared Traefik reverse proxy with a separate Compose file:

- `env_file: .env` (not `.env.local`) supplies runtime secrets. `.env` must include `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`, and `AUTOMATION_CRON_SECRET`.
- No `ports:` mapping — only `expose: 3000` plus Traefik labels on an external shared network. Traefik reaches the app on port 3000.
- `NEXT_PUBLIC_*` values are **build args** (inlined at build time). Changing the domain or site URL requires `docker compose up --build`, not just a restart. Setting `NEXT_PUBLIC_SITE_URL` under `environment:` at runtime has no effect on the built bundle.
- Reference shape:

```yaml
services:
  wacrm:
    build:
      context: .
      args:
        NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
        NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL}
        NEXT_PUBLIC_APP_LOCALE: ${NEXT_PUBLIC_APP_LOCALE:-en}
    env_file:
      - .env
    environment:
      PORT: 3000
    expose:
      - 3000
    labels:
      - traefik.enable=true
      - traefik.http.routers.wacrm.rule=Host(`wacrm.hq-salaris.cloud`)
      - traefik.http.routers.wacrm.entrypoints=websecure
      - traefik.http.routers.wacrm.tls=true
      - traefik.http.routers.wacrm.tls.certresolver=letsencrypt
      - traefik.http.services.wacrm.loadbalancer.server.port=3000
    restart: unless-stopped
    networks:
      - hermes-agent-pzw1_default
networks:
  hermes-agent-pzw1_default:
    external: true
```
