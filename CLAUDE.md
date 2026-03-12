# LiteZFS

Lightweight web-based ZFS management UI with embedded terminal and AI assistant.

## Overview

LiteZFS provides a modern dark-themed dashboard for managing ZFS pools, datasets, snapshots, and disk health. It includes an embedded web terminal (xterm.js + node-pty) and is built entirely in TypeScript.

**Port:** 26619 (Z=26, F=6, S=19 — same as WebZFS)
**Stack:** Express.js, EJS templates, htmx, Tailwind CSS (CDN), xterm.js, node-pty, WebSocket (ws)

## How to Build and Run

```bash
cd projects/litezfs
npm install
npm run dev      # Development: build + watch + run
npm run build    # Production build
npm start        # Run production server
```

Default login: `admin` / `litezfs`

## Architecture

- **Server:** Express.js with EJS templates, session auth (bcrypt), helmet security
- **Frontend:** Server-rendered HTML with htmx for live updates, Tailwind CDN for styling
- **Terminal:** xterm.js (client) + node-pty (server) over WebSocket at `/ws/terminal`
- **Services:** Service layer wrapping ZFS/zpool/smartctl CLI commands via `execFile` (never `exec`)
- **Auth:** Session-based with bcrypt password hashing, rate-limited login

See `research/01-technical-foundations.md` and `research/02-architecture.md` for full details.

## Key Design Decisions

- **htmx polling for dashboard, WebSocket only for terminal** — dashboard data polls every 5-10s
- **sudo with NOPASSWD for specific commands** — never runs as root, uses `litezfs` system user
- **TTL-based caching** — pool lists 5s, properties 30s, SMART 5min
- **execFile only** — never uses `exec()` to prevent command injection
- **Mock data for development** — services return realistic mock data; swap to real CLI parsing for production

## Team Structure

- **researcher** (subagent_type: Explore) — codebase exploration, competitive analysis, API research
- **implementer** (subagent_type: general-purpose, isolation: worktree) — code changes, new features, bug fixes
- **builder** (subagent_type: general-purpose, isolation: worktree) — build, deploy, test, validate

## Project Structure

```
litezfs/
├── CLAUDE.md                  # This file
├── package.json               # Dependencies and scripts
├── tsconfig.json              # Server TypeScript config
├── tsconfig.client.json       # Client TypeScript config
├── esbuild.config.ts          # Client bundle build
├── tailwind.config.js         # Tailwind CSS config
├── config/
│   └── litezfs.example.yaml   # Example configuration
├── install/
│   ├── litezfs.service        # systemd unit
│   └── litezfs-sudoers        # sudoers drop-in
├── research/                  # Design documents
├── src/
│   ├── shared/types.ts        # Shared TypeScript interfaces
│   ├── server/
│   │   ├── index.ts           # Entry point
│   │   ├── config.ts          # YAML config loader
│   │   ├── auth.ts            # Session auth
│   │   ├── terminal.ts        # PTY + WebSocket bridge
│   │   ├── routes/            # API + page routes
│   │   ├── services/          # ZFS/zpool/smart/alert/cache
│   │   └── views/helpers.ts   # Template helpers
│   └── client/
│       ├── terminal.ts        # xterm.js client
│       └── dashboard.ts       # UI enhancements
├── templates/                 # EJS templates
│   ├── layout.ejs             # Base layout
│   ├── partials/              # Reusable components
│   └── pages/                 # Full page templates
└── public/                    # Static assets (generated)
```

## Attempted Approaches

(None yet — this is a fresh project)
