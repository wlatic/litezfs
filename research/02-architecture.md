# LiteZFS — Architecture Document

**Date:** 2026-03-12
**Status:** Design complete — ready for implementation
**Based on:** [01-technical-foundations.md](./01-technical-foundations.md)

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Project Structure](#2-project-structure)
3. [TypeScript Type Definitions](#3-typescript-type-definitions)
4. [Complete API Specification](#4-complete-api-specification)
5. [Frontend Page Structure](#5-frontend-page-structure)
6. [Component Architecture](#6-component-architecture)
7. [Service Layer Architecture](#7-service-layer-architecture)
8. [WebSocket Architecture](#8-websocket-architecture)
9. [Authentication Flow](#9-authentication-flow)
10. [Configuration](#10-configuration)
11. [Security Architecture](#11-security-architecture)
12. [Caching Strategy](#12-caching-strategy)
13. [Error Handling](#13-error-handling)

---

## 1. System Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  htmx pages  │  │  xterm.js    │  │  AI chat      │ │
│  │  (dashboard, │  │  (terminal)  │  │  (assistant)  │ │
│  │   pools, etc)│  │              │  │               │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
│         │ HTTP/htmx       │ WebSocket         │ HTTP    │
└─────────┼─────────────────┼───────────────────┼─────────┘
          │                 │                   │
┌─────────┼─────────────────┼───────────────────┼─────────┐
│         ▼                 ▼                   ▼         │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Express.js + ws Server               │   │
│  │         (single process, single port)           │   │
│  └──────┬──────────┬──────────┬──────────┬─────────┘   │
│         │          │          │          │              │
│  ┌──────▼───┐ ┌────▼────┐ ┌──▼──────┐ ┌▼──────────┐  │
│  │  Route   │ │Terminal │ │  Auth   │ │  Alert     │  │
│  │  Handler │ │  (pty)  │ │ Middle- │ │  Monitor   │  │
│  │  Layer   │ │         │ │  ware   │ │            │  │
│  └──────┬───┘ └────┬────┘ └─────────┘ └──────┬─────┘  │
│         │          │                          │        │
│  ┌──────▼──────────▼──────────────────────────▼─────┐  │
│  │              Service Layer                       │  │
│  │  ZpoolService │ ZfsService │ SmartService │ ...  │  │
│  └──────────────────────┬───────────────────────────┘  │
│                         │                              │
│  ┌──────────────────────▼───────────────────────────┐  │
│  │          Command Executor (execFile)              │  │
│  │    sudo /sbin/zpool | sudo /sbin/zfs | smartctl  │  │
│  └──────────────────────────────────────────────────┘  │
│                     Node.js Process                    │
└────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Single process, single port** — no microservices, no reverse proxy needed
2. **Server-rendered HTML** — htmx for interactivity, minimal client JS
3. **TypeScript everywhere** — shared types between server and client
4. **CLI wrapping, not library binding** — shell out to `zfs`/`zpool` via `execFile`
5. **Least privilege** — run as `litezfs` user with targeted sudoers rules
6. **Cache aggressively** — ZFS commands are fast but not free

---

## 2. Project Structure

```
litezfs/
├── CLAUDE.md                       # Project docs, team structure, build instructions
├── package.json
├── tsconfig.json
├── tsconfig.client.json            # Separate tsconfig for client bundle
├── esbuild.config.ts               # Build configuration
├── tailwind.config.js              # Tailwind CSS configuration
├── research/                       # Research documents (not shipped)
│   ├── 01-technical-foundations.md
│   └── 02-architecture.md          # THIS FILE
├── config/
│   └── litezfs.example.yaml        # Example configuration file
├── install/
│   ├── litezfs.service             # systemd unit file
│   └── litezfs-sudoers             # sudoers.d drop-in file
├── src/
│   ├── shared/
│   │   └── types.ts                # Shared TypeScript interfaces (server + client)
│   ├── server/
│   │   ├── index.ts                # Entry point — Express + WS setup, server bootstrap
│   │   ├── config.ts               # Configuration loader (YAML → typed config)
│   │   ├── auth.ts                 # Session middleware, login/logout handlers
│   │   ├── terminal.ts             # node-pty + WebSocket bridge
│   │   ├── routes/
│   │   │   ├── api.ts              # REST API endpoints (JSON responses)
│   │   │   └── pages.ts            # HTML page routes (full pages + htmx partials)
│   │   ├── services/
│   │   │   ├── exec.ts             # Safe command execution wrapper (execFile + sudo)
│   │   │   ├── zpool.ts            # Pool operations: list, status, iostat, scrub, import/export
│   │   │   ├── zfs.ts              # Dataset + snapshot operations: list, create, destroy, properties
│   │   │   ├── smart.ts            # smartctl integration (JSON mode)
│   │   │   ├── alert.ts            # Alert generation: degraded pools, SMART warnings, space thresholds
│   │   │   ├── scheduler.ts        # Cron-like scheduler for snapshots and scrubs
│   │   │   └── cache.ts            # TTL-based in-memory cache
│   │   └── views/
│   │       └── helpers.ts          # Template helper functions (format bytes, dates, etc.)
│   └── client/
│       ├── terminal.ts             # xterm.js setup + WebSocket connection
│       ├── dashboard.ts            # Minimal JS enhancements for htmx pages
│       └── ai-chat.ts              # AI assistant chat panel (future)
├── templates/                      # EJS templates (server-rendered)
│   ├── layout.ejs                  # Base layout: head, sidebar, main content area, terminal drawer
│   ├── partials/
│   │   ├── header.ejs              # Top bar: logo, alerts badge, user menu
│   │   ├── sidebar.ejs             # Navigation sidebar
│   │   ├── terminal-drawer.ejs     # Slide-up terminal panel
│   │   ├── pool-card.ejs           # Single pool summary card (htmx fragment)
│   │   ├── pool-status.ejs         # Pool status detail (htmx fragment)
│   │   ├── pool-iostat.ejs         # Pool I/O stats (htmx fragment)
│   │   ├── dataset-row.ejs         # Dataset table row (htmx fragment)
│   │   ├── snapshot-row.ejs        # Snapshot table row (htmx fragment)
│   │   ├── disk-card.ejs           # Disk health card (htmx fragment)
│   │   ├── alert-list.ejs          # Alerts list (htmx fragment)
│   │   └── confirm-modal.ejs       # Confirmation dialog for destructive ops
│   ├── pages/
│   │   ├── login.ejs               # Login page (no sidebar)
│   │   ├── dashboard.ejs           # Overview: pool cards, alerts, system stats
│   │   ├── pool-detail.ejs         # Single pool: vdev tree, status, iostat
│   │   ├── datasets.ejs            # Dataset list/tree with create/edit/destroy
│   │   ├── snapshots.ejs           # Snapshot list with create/rollback/destroy
│   │   ├── disks.ejs               # Disk health overview with SMART details
│   │   ├── terminal.ejs            # Full-screen terminal page
│   │   └── settings.ejs            # Configuration: scheduled tasks, alert thresholds
│   └── errors/
│       ├── 404.ejs
│       └── 500.ejs
└── public/
    ├── css/
    │   └── app.css                 # Tailwind output (generated)
    ├── js/
    │   ├── terminal.bundle.js      # xterm.js bundle (generated by esbuild)
    │   └── dashboard.bundle.js     # Dashboard JS bundle (generated by esbuild)
    └── favicon.ico
```

---

## 3. TypeScript Type Definitions

These types live in `src/shared/types.ts` and are shared between server and client.

```typescript
// ============================================================================
// src/shared/types.ts — Shared type definitions for LiteZFS
// ============================================================================

// ---------------------------------------------------------------------------
// Pool Types
// ---------------------------------------------------------------------------

export type PoolHealth = 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED';

export interface Pool {
  name: string;
  size: number;           // bytes
  allocated: number;      // bytes
  free: number;           // bytes
  fragmentation: number;  // percentage (0-100)
  capacity: number;       // percentage (0-100)
  dedup: number;          // dedup ratio (1.00 = no dedup)
  health: PoolHealth;
}

export type VDevType =
  | 'mirror' | 'raidz1' | 'raidz2' | 'raidz3'
  | 'stripe' | 'disk'
  | 'spare' | 'log' | 'cache' | 'special';

export interface VDev {
  name: string;
  type: VDevType;
  size?: number;          // bytes (undefined for leaf disks)
  allocated?: number;
  free?: number;
  health: string;
  children: VDev[];
}

export interface PoolStatus {
  name: string;
  state: PoolHealth;
  scan: string;           // raw scan line (e.g. "scrub repaired 0B in 12:34:56...")
  scanParsed?: {
    type: 'scrub' | 'resilver' | 'none';
    state: 'completed' | 'in_progress' | 'canceled';
    repaired: string;
    duration?: string;
    errors: number;
    timestamp?: string;
    progress?: number;    // percentage, only when in_progress
  };
  config: StatusDevice[];
  errors: string;
}

export interface StatusDevice {
  name: string;
  state: string;
  read: number;           // error count
  write: number;          // error count
  cksum: number;          // error count
  message?: string;       // e.g. "was /dev/sda1" for replaced devices
  children: StatusDevice[];
}

export interface PoolIOStat {
  name: string;
  alloc: number;          // bytes
  free: number;           // bytes
  readOps: number;        // operations per interval
  writeOps: number;
  readBw: number;         // bytes/sec
  writeBw: number;        // bytes/sec
}

// ---------------------------------------------------------------------------
// Dataset Types
// ---------------------------------------------------------------------------

export interface Dataset {
  name: string;
  pool: string;           // derived: name.split('/')[0]
  shortName: string;      // derived: name.split('/').pop()
  type: 'filesystem' | 'volume';
  used: number;           // bytes
  available: number;      // bytes
  refer: number;          // bytes
  mountpoint: string;
  compression: string;
  compressratio: number;
  quota: number;          // 0 = none
  reservation: number;    // 0 = none
  recordsize: number;
  atime: 'on' | 'off';
  snapdir: 'hidden' | 'visible';
  children?: Dataset[];   // for tree view
}

export interface DatasetProperties {
  [key: string]: {
    value: string;
    source: 'local' | 'default' | 'inherited' | 'temporary' | 'received' | '-';
  };
}

export interface CreateDatasetRequest {
  name: string;           // full path: pool/parent/name
  properties?: {
    compression?: string;
    quota?: string;       // e.g. "10G", "none"
    reservation?: string;
    recordsize?: string;
    atime?: 'on' | 'off';
    mountpoint?: string;
  };
}

export interface SetPropertiesRequest {
  properties: Record<string, string>;  // key-value pairs to set
}

// ---------------------------------------------------------------------------
// Snapshot Types
// ---------------------------------------------------------------------------

export interface Snapshot {
  fullName: string;       // dataset@snapname
  dataset: string;
  name: string;           // just the snap name (after @)
  used: number;           // bytes
  refer: number;          // bytes
  creation: string;       // ISO 8601 date string
}

export interface CreateSnapshotRequest {
  dataset: string;
  name: string;           // snapshot name (without dataset@ prefix)
  recursive?: boolean;
}

export interface RollbackRequest {
  force?: boolean;        // destroy more recent snapshots if needed (-rf)
}

export interface SnapshotDiff {
  path: string;
  type: '+' | '-' | 'M' | 'R';  // added, removed, modified, renamed
}

// ---------------------------------------------------------------------------
// Disk / SMART Types
// ---------------------------------------------------------------------------

export interface Disk {
  device: string;         // /dev/sda
  model: string;
  serial: string;
  firmware: string;
  capacity: number;       // bytes
  rotationRate: number;   // RPM (0 for SSD)
  transport: string;      // SAT, NVMe, etc.
  health: DiskHealth;
  zpoolMember?: string;   // which pool this disk belongs to, if any
}

export interface DiskHealth {
  passed: boolean;        // SMART overall assessment
  temperature: number;    // Celsius
  powerOnHours: number;
  powerCycleCount: number;
  reallocatedSectors: number;
  pendingSectors: number;
  offlineUncorrectable: number;
  errorCount: number;     // from SMART error log
  attributes: SmartAttribute[];
}

export interface SmartAttribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  rawValue: number;
  flags: string;
}

// ---------------------------------------------------------------------------
// Alert Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertCategory = 'pool' | 'disk' | 'space' | 'scrub' | 'smart';

export interface Alert {
  id: string;             // generated unique ID
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  source: string;         // e.g. pool name, disk device
  timestamp: string;      // ISO 8601
  acknowledged: boolean;
}

// Alert conditions that generate alerts:
// - Pool health != ONLINE → critical (FAULTED) or warning (DEGRADED)
// - Pool capacity > 80% → warning, > 90% → critical
// - SMART passed = false → critical
// - Reallocated sectors > 0 → warning, > 100 → critical
// - Pending sectors > 0 → warning
// - Temperature > 50°C → warning, > 60°C → critical
// - Scrub found errors → warning
// - Scrub not run in > 30 days → info

// ---------------------------------------------------------------------------
// System Types
// ---------------------------------------------------------------------------

export interface SystemStats {
  arc: {
    size: number;         // bytes — current ARC size
    maxSize: number;      // bytes — maximum ARC size
    hitRatio: number;     // percentage (0-100)
    hits: number;
    misses: number;
  };
  memory: {
    total: number;        // bytes
    used: number;
    free: number;
    arcPercent: number;   // how much of memory ARC uses
  };
  zfsVersion: string;     // e.g. "2.2.4"
  kernelVersion: string;
}

// ---------------------------------------------------------------------------
// API Response Wrappers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  timestamp: string;      // ISO 8601 — when this data was fetched
  cached: boolean;        // whether this came from cache
}

export interface ApiError {
  error: string;
  detail?: string;
  command?: string;       // the ZFS command that failed (for debugging)
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Auth Types
// ---------------------------------------------------------------------------

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthStatus {
  authenticated: boolean;
  username?: string;
}

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export interface LiteZFSConfig {
  server: {
    port: number;
    host: string;           // bind address
    sessionSecret: string;
  };
  auth: {
    username: string;
    passwordHash: string;   // bcrypt hash
  };
  scheduler: {
    snapshots: ScheduledSnapshot[];
    scrubs: ScheduledScrub[];
  };
  alerts: {
    spaceWarningPercent: number;   // default: 80
    spaceCriticalPercent: number;  // default: 90
    tempWarningCelsius: number;    // default: 50
    tempCriticalCelsius: number;   // default: 60
    scrubMaxAgeDays: number;       // default: 30
  };
  cache: {
    poolListTtl: number;          // seconds, default: 5
    datasetListTtl: number;       // seconds, default: 5
    propertiesTtl: number;        // seconds, default: 30
    smartTtl: number;             // seconds, default: 300
    systemStatsTtl: number;       // seconds, default: 10
  };
}

export interface ScheduledSnapshot {
  dataset: string;
  schedule: string;         // cron expression
  nameTemplate: string;     // e.g. "auto_%Y-%m-%d_%H%M"
  recursive: boolean;
  retain: number;           // number of snapshots to keep (auto-prune)
}

export interface ScheduledScrub {
  pool: string;
  schedule: string;         // cron expression
}

// ---------------------------------------------------------------------------
// WebSocket Message Types (Terminal)
// ---------------------------------------------------------------------------

export type WsClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export type WsServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };
```

---

## 4. Complete API Specification

All API routes are prefixed with `/api`. All require authentication (session cookie) except `/api/auth/login` and `/api/auth/status`.

All responses use `Content-Type: application/json`. Error responses use the `ApiError` shape.

### 4.1 Authentication

#### `POST /api/auth/login`
**Auth required:** No

**Request body:**
```json
{ "username": "admin", "password": "secret" }
```

**Response `200`:**
```json
{ "data": { "authenticated": true, "username": "admin" }, "timestamp": "...", "cached": false }
```

**Response `401`:**
```json
{ "error": "Invalid credentials" }
```

**Behavior:** Sets a session cookie (`litezfs.sid`). Rate-limited to 5 attempts per minute per IP.

---

#### `POST /api/auth/logout`
**Auth required:** Yes

**Response `200`:**
```json
{ "data": { "authenticated": false }, "timestamp": "...", "cached": false }
```

**Behavior:** Destroys the session.

---

#### `GET /api/auth/status`
**Auth required:** No

**Response `200`:**
```json
{ "data": { "authenticated": true, "username": "admin" }, "timestamp": "...", "cached": false }
```

---

### 4.2 Pools

#### `GET /api/pools`
**Description:** List all pools with summary info.

**Query params:** none

**ZFS command:** `zpool list -Hpo name,size,allocated,free,fragmentation,capacity,dedup,health`

**Response `200`:**
```json
{
  "data": [
    {
      "name": "zfs",
      "size": 15946456408064,
      "allocated": 7950516674560,
      "free": 7995939733504,
      "fragmentation": 8,
      "capacity": 49,
      "dedup": 1.0,
      "health": "ONLINE"
    }
  ],
  "timestamp": "2026-03-12T04:30:00Z",
  "cached": false
}
```

---

#### `GET /api/pools/:name`
**Description:** Single pool with vdev tree.

**ZFS commands:**
1. `zpool list -Hpo name,size,allocated,free,fragmentation,capacity,dedup,health <name>` — pool summary
2. `zpool list -vHp <name>` — vdev tree

**Response `200`:**
```json
{
  "data": {
    "pool": { "name": "zfs", "size": 15946456408064, "...": "..." },
    "vdevs": [
      {
        "name": "mirror-0",
        "type": "mirror",
        "size": 7995939733504,
        "health": "ONLINE",
        "children": [
          { "name": "ata-WDC_WD80EFZZ-...", "type": "disk", "health": "ONLINE", "children": [] }
        ]
      }
    ]
  },
  "timestamp": "...",
  "cached": false
}
```

**Response `404`:**
```json
{ "error": "Pool not found", "detail": "No pool named 'nonexistent'" }
```

---

#### `GET /api/pools/:name/status`
**Description:** Detailed pool status including device tree, scan info, and error counts.

**ZFS command:** `zpool status <name>`

**Response `200`:** `ApiResponse<PoolStatus>`

---

#### `GET /api/pools/:name/iostat`
**Description:** Current I/O statistics for a pool.

**ZFS command:** `zpool iostat -Hp <name>`

**Response `200`:** `ApiResponse<PoolIOStat>`

---

#### `POST /api/pools/:name/scrub`
**Description:** Start a scrub on the pool.

**ZFS command:** `zpool scrub <name>`

**Response `200`:**
```json
{ "data": { "message": "Scrub started on pool 'zfs'" }, "timestamp": "...", "cached": false }
```

**Response `409`:**
```json
{ "error": "Scrub already in progress" }
```

---

#### `DELETE /api/pools/:name/scrub`
**Description:** Cancel a running scrub.

**ZFS command:** `zpool scrub -s <name>`

**Response `200`:**
```json
{ "data": { "message": "Scrub canceled on pool 'zfs'" }, "timestamp": "...", "cached": false }
```

---

#### `POST /api/pools/import`
**Description:** Import a pool.

**Request body:**
```json
{ "name": "tank", "force": false }
```

**ZFS command:** `zpool import <name>` (or `zpool import -f <name>` if force=true)

**Response `200`:** `ApiResponse<{ message: string }>`

---

#### `POST /api/pools/:name/export`
**Description:** Export a pool.

**Request body:**
```json
{ "force": false }
```

**ZFS command:** `zpool export <name>` (or `zpool export -f <name>`)

**Response `200`:** `ApiResponse<{ message: string }>`

---

### 4.3 Datasets

#### `GET /api/datasets`
**Description:** List all datasets.

**Query params:**
- `pool` (optional) — filter by pool name
- `type` (optional) — `filesystem` or `volume` (default: both)

**ZFS command:** `zfs list -Hpo name,used,avail,refer,mountpoint -t filesystem,volume` (add `-r <pool>` if pool filter)

Additional properties fetched: `zfs get -Hp compression,compressratio,quota,reservation,recordsize,atime,snapdir <dataset>`

**Response `200`:** `ApiResponse<Dataset[]>`

---

#### `GET /api/datasets/:name`
**Description:** Single dataset with all common properties.

**URL encoding:** Dataset names contain `/`, so the `:name` param is a wildcard — e.g. `GET /api/datasets/zfs/claude/system`.

**Response `200`:** `ApiResponse<Dataset>`

---

#### `POST /api/datasets`
**Description:** Create a new dataset.

**Request body:** `CreateDatasetRequest`
```json
{
  "name": "zfs/backups/newdata",
  "properties": {
    "compression": "lz4",
    "quota": "100G"
  }
}
```

**ZFS command:** `zfs create -o compression=lz4 -o quota=100G zfs/backups/newdata`

**Response `201`:** `ApiResponse<Dataset>` (fetches and returns the newly created dataset)

**Response `400`:**
```json
{ "error": "Invalid dataset name", "detail": "Dataset names must match [a-zA-Z0-9_/.:-]+" }
```

---

#### `DELETE /api/datasets/:name`
**Description:** Destroy a dataset.

**Query params:**
- `recursive` (optional, boolean) — `-r` flag to destroy children too

**ZFS command:** `zfs destroy <name>` (or `zfs destroy -r <name>`)

**Response `200`:** `ApiResponse<{ message: string }>`

**Response `409`:**
```json
{ "error": "Dataset has children", "detail": "Use ?recursive=true to destroy children" }
```

---

#### `PATCH /api/datasets/:name`
**Description:** Set properties on a dataset.

**Request body:** `SetPropertiesRequest`
```json
{ "properties": { "compression": "zstd", "quota": "200G" } }
```

**ZFS command:** `zfs set compression=zstd <name>` + `zfs set quota=200G <name>` (one per property)

**Response `200`:** `ApiResponse<Dataset>` (returns updated dataset)

---

#### `GET /api/datasets/:name/properties`
**Description:** Get all properties for a dataset.

**ZFS command:** `zfs get -Hp all <name>`

**Response `200`:** `ApiResponse<DatasetProperties>`

---

### 4.4 Snapshots

#### `GET /api/snapshots`
**Description:** List all snapshots.

**Query params:**
- `dataset` (optional) — filter by dataset name
- `sort` (optional) — `creation` (default), `name`, `used`
- `order` (optional) — `asc` or `desc` (default: `desc`)
- `limit` (optional) — max results (default: 100)
- `offset` (optional) — pagination offset

**ZFS command:** `zfs list -Hpt snapshot -o name,used,refer,creation` (add `-r <dataset>` if filter)

**Response `200`:** `PaginatedResponse<Snapshot>`

---

#### `POST /api/snapshots`
**Description:** Create a snapshot.

**Request body:** `CreateSnapshotRequest`
```json
{ "dataset": "zfs/data", "name": "manual-2026-03-12", "recursive": false }
```

**ZFS command:** `zfs snapshot zfs/data@manual-2026-03-12` (or `zfs snapshot -r ...`)

**Response `201`:** `ApiResponse<Snapshot>`

**Validation:**
- Snapshot name must match `[a-zA-Z0-9_.-]+`
- Dataset must exist

---

#### `DELETE /api/snapshots/:name`
**Description:** Destroy a snapshot.

**URL note:** The `:name` includes the `@` — e.g. `DELETE /api/snapshots/zfs/data@manual-backup` (URL-encoded: `zfs%2Fdata%40manual-backup`)

**ZFS command:** `zfs destroy <fullName>`

**Response `200`:** `ApiResponse<{ message: string }>`

---

#### `POST /api/snapshots/:name/rollback`
**Description:** Rollback a dataset to a snapshot.

**Request body:** `RollbackRequest`
```json
{ "force": false }
```

**ZFS command:** `zfs rollback <name>` (or `zfs rollback -rf <name>` if force=true)

**Response `200`:** `ApiResponse<{ message: string }>`

**Response `409`:**
```json
{ "error": "More recent snapshots exist", "detail": "Use force=true to destroy them and rollback" }
```

---

#### `GET /api/snapshots/:name/diff`
**Description:** Show files changed between this snapshot and the current dataset state.

**ZFS command:** `zfs diff <snapshot>`

**Response `200`:** `ApiResponse<SnapshotDiff[]>`

---

#### `GET /api/snapshots/:name/send-size`
**Description:** Estimate send stream size (useful for replication planning).

**ZFS command:** `zfs send -nv <snapshot> 2>&1` (parse the "size" line from stderr)

**Response `200`:**
```json
{ "data": { "estimatedSize": 1073741824 }, "timestamp": "...", "cached": false }
```

---

### 4.5 Disks

#### `GET /api/disks`
**Description:** List all disks with SMART summary and pool membership.

**Commands:**
1. `smartctl -j --scan` — enumerate disks
2. `smartctl -j -a /dev/sdX` — per-disk health (cached 5min)
3. `zpool status` — correlate disk device IDs to pools

**Response `200`:** `ApiResponse<Disk[]>`

---

#### `GET /api/disks/:device`
**Description:** Full SMART details for a single disk.

**URL encoding:** Device paths like `/dev/sda` → `:device` = `sda`

**Command:** `smartctl -j -a /dev/<device>`

**Response `200`:** `ApiResponse<Disk>` (with full `health.attributes` array)

---

### 4.6 System

#### `GET /api/system/stats`
**Description:** System-wide ZFS statistics.

**Commands:**
1. Read `/proc/spl/kstat/zfs/arcstats` — ARC stats
2. Read `/proc/meminfo` — memory stats
3. `zfs --version` or `cat /sys/module/zfs/version` — ZFS version
4. `uname -r` — kernel version

**Response `200`:** `ApiResponse<SystemStats>`

---

#### `GET /api/alerts`
**Description:** Current active alerts. Alerts are computed on-the-fly from pool status, disk health, and space usage.

**Query params:**
- `severity` (optional) — filter by severity
- `category` (optional) — filter by category
- `acknowledged` (optional, boolean) — filter by ack state

**Response `200`:** `ApiResponse<Alert[]>`

---

#### `POST /api/alerts/:id/acknowledge`
**Description:** Acknowledge an alert (hides it from the default view).

**Response `200`:** `ApiResponse<{ message: string }>`

---

### 4.7 htmx Partial Endpoints

These endpoints return **HTML fragments** (not JSON) for htmx to swap into the page. They use the same service layer as the JSON API.

| Endpoint | Returns | Used by |
|----------|---------|---------|
| `GET /partials/pool-cards` | All pool summary cards | Dashboard (polls every 5s) |
| `GET /partials/pool/:name/status` | Pool status detail | Pool detail page (polls every 10s) |
| `GET /partials/pool/:name/iostat` | Pool iostat display | Pool detail page (polls every 5s) |
| `GET /partials/alerts` | Alert list | Header badge + dashboard (polls every 10s) |
| `GET /partials/alert-count` | Just the count badge | Header (polls every 10s) |
| `GET /partials/datasets?pool=X` | Dataset table rows | Datasets page |
| `GET /partials/snapshots?dataset=X` | Snapshot table rows | Snapshots page |
| `GET /partials/disk-cards` | Disk health cards | Disks page (polls every 60s) |
| `GET /partials/system-stats` | ARC + memory stats | Dashboard sidebar (polls every 10s) |

---

## 5. Frontend Page Structure

### 5.1 Login Page (`/login`)

- Simple centered form: username + password
- No sidebar or navigation
- Redirects to dashboard on success
- Shows error message on failure

### 5.2 Dashboard (`/`)

The default landing page. Gives an at-a-glance overview.

```
┌──────────────────────────────────────────────────────┐
│ [LiteZFS logo]              🔔 3 alerts    [admin ▾] │
├────────┬─────────────────────────────────────────────┤
│        │                                             │
│  Nav   │  ┌─── Pool Cards (hx-get every 5s) ──────┐ │
│        │  │ ┌──────────┐ ┌──────────┐              │ │
│ 🏠 Dash│  │ │ zfs      │ │ tank     │              │ │
│ 💾 Pools│ │ │ 14.5T    │ │ 1.8T     │              │ │
│ 📁 Data│  │ │ ██████░░ │ │ █████░░░ │              │ │
│ 📸 Snap│  │ │ 49% used │ │ 48% used │              │ │
│ 🔧 Disk│  │ │ ONLINE ● │ │ ONLINE ● │              │ │
│ >_ Term│  │ └──────────┘ └──────────┘              │ │
│ ⚙ Set  │  └────────────────────────────────────────┘ │
│        │                                             │
│        │  ┌─── Alerts (hx-get every 10s) ──────────┐ │
│        │  │ ⚠ Pool 'zfs' capacity at 85%           │ │
│        │  │ ℹ Scrub not run in 35 days on 'tank'   │ │
│        │  └────────────────────────────────────────┘ │
│        │                                             │
│        │  ┌─── System Stats (hx-get every 10s) ────┐ │
│        │  │ ARC: 4.2 GB / 8 GB (52%)   Hit: 94%   │ │
│        │  │ Memory: 12 GB / 32 GB                  │ │
│        │  │ ZFS 2.2.4 • Linux 6.17.9              │ │
│        │  └────────────────────────────────────────┘ │
│        │                                             │
├────────┴─────────────────────────────────────────────┤
│ [▲ Terminal]     (collapsed terminal drawer)          │
└──────────────────────────────────────────────────────┘
```

**htmx endpoints hit:**
- `GET /partials/pool-cards` — every 5s
- `GET /partials/alerts` — every 10s
- `GET /partials/system-stats` — every 10s

### 5.3 Pool Detail (`/pools/:name`)

Shows full detail for one pool.

**Sections:**
1. **Header** — Pool name, health badge, size bar
2. **VDev Tree** — Visual tree of mirrors/raidz with disk children, health indicators, error counts
3. **Scan Status** — Current/last scrub/resilver info, start scrub button
4. **I/O Stats** — Live read/write ops and bandwidth (polls every 5s)
5. **Actions** — Start scrub, export pool

**htmx endpoints:**
- `GET /partials/pool/:name/status` — every 10s
- `GET /partials/pool/:name/iostat` — every 5s

### 5.4 Datasets (`/datasets`)

**Sections:**
1. **Pool filter dropdown** — select pool or "All"
2. **Dataset table** — sortable columns: Name, Used, Available, Refer, Mountpoint, Compression
3. **Create button** — opens modal form
4. **Row actions** — Edit properties, Destroy (with confirmation)

**Table updates on:**
- Pool filter change: `hx-get="/partials/datasets?pool=X" hx-trigger="change"`
- After create/destroy: `hx-get` on success triggers table refresh

### 5.5 Snapshots (`/snapshots`)

**Sections:**
1. **Dataset filter** — dropdown or search
2. **Create snapshot** — inline form: dataset selector + name input + recursive toggle
3. **Snapshot table** — columns: Name, Dataset, Used, Refer, Created
4. **Row actions** — Rollback (with confirmation), Diff, Destroy (with confirmation)

**Pagination:** Server-side, 50 per page, load more via htmx.

### 5.6 Disks (`/disks`)

**Sections:**
1. **Disk cards** — one card per physical disk showing: model, serial, capacity, temperature, SMART status, pool membership
2. **Expand** — click card to show full SMART attributes table

**Polling:** Every 60 seconds (SMART data changes slowly).

### 5.7 Terminal (`/terminal`)

**Full-screen terminal page** — minimal UI, maximum terminal real estate.

- xterm.js fills the viewport (minus a thin header bar)
- Header shows: "Terminal" title, "Disconnect" button, "Back to Dashboard" link
- WebSocket connection to `/ws/terminal`
- Supports resize, 256-color, mouse events

**Also available as a drawer** from any page — the terminal drawer at the bottom of the layout can be expanded. This uses a separate xterm.js instance sharing the same WebSocket session concept.

### 5.8 Settings (`/settings`)

**Sections:**
1. **Scheduled Snapshots** — list of snapshot schedules with CRUD
2. **Scheduled Scrubs** — list of scrub schedules with CRUD
3. **Alert Thresholds** — space %, temperature, scrub age
4. **Account** — change password

---

## 6. Component Architecture

### 6.1 Layout Template Structure

```
layout.ejs
├── <head> — meta, Tailwind CSS, htmx script, Alpine.js (minimal)
├── <body class="flex h-screen">
│   ├── sidebar.ejs (fixed left, 64px wide collapsed / 240px expanded)
│   │   ├── Logo
│   │   ├── Nav links (with active state from current URL)
│   │   └── Collapse toggle
│   ├── <main class="flex-1 flex flex-col">
│   │   ├── header.ejs (fixed top bar)
│   │   │   ├── Page title (from route)
│   │   │   ├── Alert badge (hx-get="/partials/alert-count" hx-trigger="every 10s")
│   │   │   └── User menu dropdown
│   │   ├── <div id="content" class="flex-1 overflow-auto p-6">
│   │   │   └── <%- body %> (page content injected here)
│   │   └── terminal-drawer.ejs (fixed bottom, expandable)
│   │       ├── Drag handle / toggle button
│   │       ├── <div id="terminal-container"> (xterm.js mounts here)
│   │       └── Height: 0px (collapsed) → 300px (open) → 100vh-header (maximized)
```

### 6.2 htmx Patterns

**Polling for live data:**
```html
<div id="pool-cards"
     hx-get="/partials/pool-cards"
     hx-trigger="every 5s"
     hx-swap="innerHTML">
  <!-- server-rendered pool cards -->
</div>
```

**Form submission with confirmation:**
```html
<button hx-delete="/api/datasets/zfs/old-data"
        hx-confirm="Destroy dataset 'zfs/old-data'? This cannot be undone."
        hx-target="#dataset-table"
        hx-swap="innerHTML"
        hx-headers='{"Accept": "text/html"}'
        hx-on::after-request="htmx.trigger('#dataset-table', 'refresh')">
  Destroy
</button>
```

**Modal forms (create dataset):**
```html
<!-- Trigger button -->
<button hx-get="/partials/create-dataset-form"
        hx-target="#modal-container"
        hx-swap="innerHTML">
  Create Dataset
</button>

<!-- Modal container (in layout) -->
<div id="modal-container"></div>
```

**Flash messages after actions:**
```html
<!-- Server returns this partial on success -->
<div class="alert alert-success"
     hx-swap-oob="true"
     id="flash-message"
     x-data="{ show: true }"
     x-init="setTimeout(() => show = false, 3000)"
     x-show="show">
  Dataset created successfully
</div>
```

### 6.3 Client JavaScript Modules

Only two JS bundles are needed:

1. **`terminal.bundle.js`** (~200KB gzipped with xterm.js)
   - xterm.js + FitAddon + WebglAddon + WebLinksAddon
   - WebSocket connection management
   - Resize handling
   - Loaded only on terminal page and for the terminal drawer

2. **`dashboard.bundle.js`** (~5KB)
   - Terminal drawer toggle logic
   - Chart rendering for iostat (optional, can use CSS bars instead)
   - Alpine.js inline handlers if needed
   - Byte formatting utility (shared with server via types)

### 6.4 Polling Intervals Summary

| Component | Endpoint | Interval | Rationale |
|-----------|----------|----------|-----------|
| Pool cards | `/partials/pool-cards` | 5s | Pool health can change during scrub/resilver |
| Pool iostat | `/partials/pool/:name/iostat` | 5s | I/O is real-time data |
| Pool status | `/partials/pool/:name/status` | 10s | Status changes less frequently |
| Alert count | `/partials/alert-count` | 10s | Lightweight, just a number |
| Alerts list | `/partials/alerts` | 10s | Same as count |
| System stats | `/partials/system-stats` | 10s | ARC stats are interesting but not urgent |
| Disk cards | `/partials/disk-cards` | 60s | SMART data changes slowly |
| Datasets | Manual refresh | — | Only changes on user action |
| Snapshots | Manual refresh | — | Only changes on user action |

---

## 7. Service Layer Architecture

### 7.1 Service Modules

```typescript
// src/server/services/exec.ts
// Safe command execution wrapper — the ONLY way to run system commands

export class CommandExecutor {
  private allowedCommands = new Map([
    ['zfs', '/sbin/zfs'],
    ['zpool', '/sbin/zpool'],
    ['smartctl', '/usr/sbin/smartctl'],
  ]);

  async execute(cmd: 'zfs' | 'zpool' | 'smartctl', args: string[], options?: {
    timeout?: number;    // default: 30000ms
    maxBuffer?: number;  // default: 10MB
  }): Promise<{ stdout: string; stderr: string }>;

  // Validates all args against allowlists before execution
  // Uses execFile (NOT exec) to prevent command injection
  // Prepends 'sudo' to all commands
  // Logs all commands for audit trail
}
```

```typescript
// src/server/services/zpool.ts

export class ZpoolService {
  constructor(private exec: CommandExecutor, private cache: CacheService);

  async listPools(): Promise<Pool[]>;
  async getPool(name: string): Promise<Pool>;
  async getPoolVdevs(name: string): Promise<VDev[]>;
  async getPoolStatus(name: string): Promise<PoolStatus>;
  async getPoolIOStat(name: string): Promise<PoolIOStat>;
  async startScrub(name: string): Promise<void>;
  async cancelScrub(name: string): Promise<void>;
  async importPool(name: string, force?: boolean): Promise<void>;
  async exportPool(name: string, force?: boolean): Promise<void>;

  // Internal parsing methods
  private parsePoolList(stdout: string): Pool[];
  private parsePoolListV(stdout: string): VDev[];
  private parsePoolStatus(stdout: string): PoolStatus;
  private parsePoolIOStat(stdout: string): PoolIOStat;
}
```

```typescript
// src/server/services/zfs.ts

export class ZfsService {
  constructor(private exec: CommandExecutor, private cache: CacheService);

  // Datasets
  async listDatasets(pool?: string): Promise<Dataset[]>;
  async getDataset(name: string): Promise<Dataset>;
  async createDataset(req: CreateDatasetRequest): Promise<Dataset>;
  async destroyDataset(name: string, recursive?: boolean): Promise<void>;
  async setProperties(name: string, props: Record<string, string>): Promise<void>;
  async getAllProperties(name: string): Promise<DatasetProperties>;

  // Snapshots
  async listSnapshots(dataset?: string, options?: { limit?: number; offset?: number }): Promise<Snapshot[]>;
  async createSnapshot(req: CreateSnapshotRequest): Promise<Snapshot>;
  async destroySnapshot(fullName: string): Promise<void>;
  async rollbackSnapshot(fullName: string, force?: boolean): Promise<void>;
  async diffSnapshot(fullName: string): Promise<SnapshotDiff[]>;
  async estimateSendSize(fullName: string): Promise<number>;

  // Internal
  private parseDatasetList(stdout: string): Dataset[];
  private parseSnapshotList(stdout: string): Snapshot[];
  private parseProperties(stdout: string): DatasetProperties;
  private parseDiff(stdout: string): SnapshotDiff[];
}
```

```typescript
// src/server/services/smart.ts

export class SmartService {
  constructor(private exec: CommandExecutor, private cache: CacheService);

  async listDisks(): Promise<Disk[]>;
  async getDisk(device: string): Promise<Disk>;

  // Correlates disk serials with zpool status output
  async mapDisksToPoolsInternal(): Promise<Map<string, string>>;

  // smartctl -j output is already JSON — minimal parsing needed
  private parseSmartJson(json: any, device: string): Disk;
}
```

```typescript
// src/server/services/alert.ts

export class AlertService {
  constructor(
    private zpoolService: ZpoolService,
    private smartService: SmartService,
    private config: LiteZFSConfig['alerts'],
  );

  // Computes alerts from current system state
  async getAlerts(): Promise<Alert[]>;

  // Acknowledged alerts stored in-memory (lost on restart — acceptable for v1)
  acknowledge(alertId: string): void;

  private checkPoolHealth(pools: Pool[]): Alert[];
  private checkSpaceUsage(pools: Pool[]): Alert[];
  private checkDiskHealth(disks: Disk[]): Alert[];
  private checkScrubAge(statuses: PoolStatus[]): Alert[];
}
```

```typescript
// src/server/services/scheduler.ts
// Uses node-cron or croner for cron expression parsing

export class SchedulerService {
  constructor(
    private zfsService: ZfsService,
    private zpoolService: ZpoolService,
    private config: LiteZFSConfig['scheduler'],
  );

  start(): void;   // Initialize all scheduled jobs
  stop(): void;     // Clean up on shutdown

  // Auto-snapshot: create snapshot with template name, prune old ones
  private runScheduledSnapshot(schedule: ScheduledSnapshot): Promise<void>;

  // Auto-scrub: start scrub on pool
  private runScheduledScrub(schedule: ScheduledScrub): Promise<void>;

  // Retention: delete snapshots beyond the retain count
  private pruneSnapshots(dataset: string, prefix: string, retain: number): Promise<void>;
}
```

```typescript
// src/server/services/cache.ts

export class CacheService {
  // Simple TTL-based in-memory cache using Map

  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlSeconds: number): void;
  invalidate(key: string): void;
  invalidatePrefix(prefix: string): void;  // e.g. invalidatePrefix('pools:') after scrub start

  // Cache keys follow convention:
  // pools:list, pools:zfs, pools:zfs:status, pools:zfs:iostat
  // datasets:list, datasets:list:zfs, datasets:zfs/data:props
  // snapshots:list, snapshots:list:zfs/data
  // disks:list, disks:sda
  // system:stats
}
```

### 7.2 Service Dependency Graph

```
CommandExecutor (no deps)
    ↑
    ├── ZpoolService(exec, cache)
    ├── ZfsService(exec, cache)
    └── SmartService(exec, cache)
              ↑
              ├── AlertService(zpool, smart, config)
              └── SchedulerService(zfs, zpool, config)

CacheService (no deps) ← used by Zpool, Zfs, Smart services
```

### 7.3 Input Validation

All user-provided values must be validated before being passed to CLI commands:

```typescript
// src/server/services/validation.ts

// Pool/dataset name: alphanumeric, _, -, ., /, :
const DATASET_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.\/:@-]*$/;

// Snapshot name (the part after @): alphanumeric, _, -, .
const SNAPSHOT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

// Property name: lowercase alpha with dots
const PROPERTY_NAME_RE = /^[a-z][a-z0-9:.]*$/;

// Property value: printable ASCII, no shell metacharacters
const PROPERTY_VALUE_RE = /^[a-zA-Z0-9_.\/:@=+-]+$/;

// Device name: letters and numbers only
const DEVICE_NAME_RE = /^[a-z]{2,4}\d*$/;

export function validateDatasetName(name: string): boolean;
export function validateSnapshotName(name: string): boolean;
export function validatePropertyName(name: string): boolean;
export function validatePropertyValue(value: string): boolean;
export function validatePoolName(name: string): boolean;
export function validateDeviceName(device: string): boolean;
```

---

## 8. WebSocket Architecture

### 8.1 Terminal WebSocket

**Endpoint:** `ws://host:port/ws/terminal`

**Authentication:** Session cookie is validated on WebSocket upgrade. No cookie or invalid session → reject with 4001.

**Protocol:**
- Client → Server: raw text (terminal input) or JSON control messages
- Server → Client: raw text (terminal output) or JSON control messages
- Control messages are distinguished by attempting JSON parse; if it fails, it's terminal data

**Control messages:**

Client → Server:
```json
{ "type": "resize", "cols": 120, "rows": 40 }
```

Server → Client:
```json
{ "type": "exit", "code": 0 }
{ "type": "error", "message": "PTY allocation failed" }
```

**Lifecycle:**
1. Client connects, server validates session cookie
2. Server spawns PTY (`node-pty`) with the user's shell
3. Bidirectional streaming: PTY ↔ WebSocket ↔ xterm.js
4. On disconnect: kill PTY process, clean up session
5. On PTY exit: notify client, close WebSocket

**Session management:**
- One PTY per WebSocket connection
- Maximum 3 concurrent terminal sessions per authenticated user
- Idle timeout: 30 minutes (configurable) — kill PTY if no input received
- Terminal drawer and full-screen terminal can share the same session if desired (future enhancement)

### 8.2 Future: Live iostat WebSocket

Not in v1, but the architecture supports it:

**Endpoint:** `ws://host:port/ws/iostat/:pool`

Would spawn `zpool iostat -Hp <pool> 5` and stream parsed `PoolIOStat` objects to the client every 5 seconds. More efficient than polling for high-frequency data.

---

## 9. Authentication Flow

### 9.1 Session-Based Auth (v1)

```
  ┌──────────┐          ┌──────────┐
  │  Browser  │          │  Server   │
  └────┬─────┘          └────┬─────┘
       │                      │
       │  GET /               │
       │─────────────────────>│
       │                      │ No session cookie
       │  302 → /login        │
       │<─────────────────────│
       │                      │
       │  GET /login          │
       │─────────────────────>│
       │  HTML login page     │
       │<─────────────────────│
       │                      │
       │  POST /api/auth/login│
       │  { user, pass }      │
       │─────────────────────>│
       │                      │ bcrypt.compare(pass, hash)
       │  200 + Set-Cookie:   │
       │  litezfs.sid=abc123  │
       │<─────────────────────│
       │                      │
       │  GET / (with cookie) │
       │─────────────────────>│
       │                      │ Session valid
       │  HTML dashboard      │
       │<─────────────────────│
```

### 9.2 Session Configuration

```typescript
import session from 'express-session';

app.use(session({
  name: 'litezfs.sid',
  secret: config.server.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,       // true if behind HTTPS reverse proxy
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
  },
}));
```

### 9.3 Auth Middleware

```typescript
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session?.authenticated) {
    return next();
  }

  // htmx requests get a 401 (htmx will handle redirect)
  if (req.headers['hx-request']) {
    res.status(401).set('HX-Redirect', '/login').send();
    return;
  }

  // API requests get JSON error
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Page requests redirect
  res.redirect('/login');
}
```

### 9.4 Password Setup

On first run, if no password hash exists in config:

```bash
$ litezfs setup-password
Enter password: ****
Confirm password: ****
Password hash written to /etc/litezfs/config.yaml
```

Or via environment variable: `LITEZFS_PASSWORD_HASH=...`

---

## 10. Configuration

### 10.1 Config File Format

File: `/etc/litezfs/config.yaml` (default) or specified via `--config` flag or `LITEZFS_CONFIG` env var.

```yaml
# /etc/litezfs/config.yaml

server:
  port: 26619                    # Z=26, F=6, S=19 (matching WebZFS convention)
  host: "0.0.0.0"               # bind address
  sessionSecret: "change-me-to-a-random-string"

auth:
  username: "admin"
  passwordHash: "$2b$12$..."    # bcrypt hash — generate with: litezfs setup-password

scheduler:
  snapshots:
    - dataset: "zfs/data"
      schedule: "0 */6 * * *"   # every 6 hours
      nameTemplate: "auto_%Y-%m-%d_%H%M"
      recursive: true
      retain: 28                # keep 7 days worth (4/day × 7)

    - dataset: "zfs/backups"
      schedule: "0 0 * * *"    # daily at midnight
      nameTemplate: "daily_%Y-%m-%d"
      recursive: false
      retain: 30

  scrubs:
    - pool: "zfs"
      schedule: "0 2 * * 0"   # Sundays at 2 AM
    - pool: "tank"
      schedule: "0 2 * * 0"

alerts:
  spaceWarningPercent: 80
  spaceCriticalPercent: 90
  tempWarningCelsius: 50
  tempCriticalCelsius: 60
  scrubMaxAgeDays: 30

cache:
  poolListTtl: 5
  datasetListTtl: 5
  propertiesTtl: 30
  smartTtl: 300
  systemStatsTtl: 10
```

### 10.2 Config Loading

```typescript
// src/server/config.ts

import { readFileSync } from 'fs';
import { parse } from 'yaml';

const CONFIG_PATHS = [
  process.env.LITEZFS_CONFIG,
  '/etc/litezfs/config.yaml',
  './config/litezfs.yaml',
].filter(Boolean);

export function loadConfig(): LiteZFSConfig {
  for (const path of CONFIG_PATHS) {
    try {
      const raw = readFileSync(path!, 'utf-8');
      const parsed = parse(raw);
      return validateConfig(parsed);
    } catch { continue; }
  }
  // Return sensible defaults if no config found
  return getDefaultConfig();
}

function getDefaultConfig(): LiteZFSConfig {
  return {
    server: { port: 26619, host: '0.0.0.0', sessionSecret: crypto.randomUUID() },
    auth: { username: 'admin', passwordHash: '' },
    scheduler: { snapshots: [], scrubs: [] },
    alerts: {
      spaceWarningPercent: 80, spaceCriticalPercent: 90,
      tempWarningCelsius: 50, tempCriticalCelsius: 60,
      scrubMaxAgeDays: 30,
    },
    cache: {
      poolListTtl: 5, datasetListTtl: 5, propertiesTtl: 30,
      smartTtl: 300, systemStatsTtl: 10,
    },
  };
}
```

### 10.3 Environment Variable Overrides

Key settings can be overridden via env vars (useful for Docker):

| Env Var | Config Path | Example |
|---------|-------------|---------|
| `LITEZFS_PORT` | `server.port` | `8080` |
| `LITEZFS_HOST` | `server.host` | `127.0.0.1` |
| `LITEZFS_SESSION_SECRET` | `server.sessionSecret` | `random-string` |
| `LITEZFS_USERNAME` | `auth.username` | `admin` |
| `LITEZFS_PASSWORD_HASH` | `auth.passwordHash` | `$2b$12$...` |

---

## 11. Security Architecture

### 11.1 Sudo Strategy

Create a dedicated system user and sudoers rules:

```bash
# Create system user (no login shell, no home)
useradd -r -s /usr/sbin/nologin litezfs
```

```sudoers
# /etc/sudoers.d/litezfs
# Allow litezfs user to run specific ZFS and SMART commands without password

# Read-only ZFS commands
litezfs ALL=(ALL) NOPASSWD: /sbin/zpool list *
litezfs ALL=(ALL) NOPASSWD: /sbin/zpool status *
litezfs ALL=(ALL) NOPASSWD: /sbin/zpool iostat *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs list *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs get *

# Write ZFS commands (snapshot, property management)
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs snapshot *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs destroy *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs rollback *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs set *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs create *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs diff *
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs send *

# Pool management
litezfs ALL=(ALL) NOPASSWD: /sbin/zpool scrub *
litezfs ALL=(ALL) NOPASSWD: /sbin/zpool import *
litezfs ALL=(ALL) NOPASSWD: /sbin/zpool export *

# SMART monitoring
litezfs ALL=(ALL) NOPASSWD: /usr/sbin/smartctl *
```

### 11.2 Command Injection Prevention

1. **Always use `execFile`**, never `exec` — `execFile` does not invoke a shell
2. **Validate all inputs** against strict regexes before passing to commands
3. **Whitelist command paths** — only allow `/sbin/zfs`, `/sbin/zpool`, `/usr/sbin/smartctl`
4. **No user input in command strings** — arguments are passed as array elements

```typescript
// SAFE — arguments are separate array elements, no shell interpretation
execFile('sudo', ['/sbin/zfs', 'snapshot', `${validatedDataset}@${validatedName}`]);

// DANGEROUS — NEVER DO THIS
exec(`sudo zfs snapshot ${userInput}`);
```

### 11.3 CSRF Protection

htmx sends an `HX-Request: true` header by default. For state-changing operations:

```typescript
import csurf from 'csurf';

// CSRF token embedded in layout template
app.use(csurf({ cookie: false }));  // session-based CSRF

// In layout.ejs:
// <meta name="csrf-token" content="<%= csrfToken() %>">

// htmx configuration (in dashboard.bundle.js):
// document.body.addEventListener('htmx:configRequest', (e) => {
//   e.detail.headers['X-CSRF-Token'] = document.querySelector('meta[name="csrf-token"]').content;
// });
```

### 11.4 Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

// Strict rate limit on login endpoint
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,               // 5 attempts per minute
  message: { error: 'Too many login attempts, try again in 1 minute' },
});

app.post('/api/auth/login', loginLimiter, loginHandler);

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,             // 120 requests per minute (2/sec)
});

app.use('/api/', apiLimiter);
```

### 11.5 Security Headers

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",     // needed for htmx inline handlers
        "https://cdn.tailwindcss.com",  // only if using CDN
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],  // WebSocket
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
    },
  },
  referrerPolicy: { policy: 'same-origin' },
}));
```

### 11.6 Terminal Security

The embedded terminal is the highest-risk feature — it provides shell access.

1. **Authentication required** — WebSocket upgrade validates session cookie
2. **Terminal runs as the `litezfs` system user** — NOT root
3. **Session limit** — max 3 concurrent terminals per user
4. **Idle timeout** — 30 minutes of no input → PTY killed
5. **Audit logging** — log terminal session start/stop with timestamps

Note: The terminal provides a shell as the `litezfs` user. For ZFS commands that need sudo, the sudoers rules apply. The terminal user cannot do anything the `litezfs` user can't do on the system.

---

## 12. Caching Strategy

### 12.1 Cache Implementation

Simple in-memory Map with TTL:

```typescript
interface CacheEntry<T> {
  value: T;
  expiresAt: number;  // Date.now() + ttl
}

export class CacheService {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}
```

### 12.2 Cache TTLs

| Data | Cache Key Pattern | TTL | Invalidation Trigger |
|------|-------------------|-----|----------------------|
| Pool list | `pools:list` | 5s | Scrub start/stop, import/export |
| Pool detail | `pools:<name>` | 5s | Same |
| Pool status | `pools:<name>:status` | 10s | Scrub start/stop |
| Pool iostat | `pools:<name>:iostat` | 5s | Never (always fresh-ish) |
| Dataset list | `datasets:list` | 5s | Create, destroy, set property |
| Dataset list (pool) | `datasets:list:<pool>` | 5s | Same |
| Dataset props | `datasets:<name>:props` | 30s | Set property |
| Snapshot list | `snapshots:list` | 5s | Create, destroy, rollback |
| SMART scan | `disks:list` | 300s | Never (manual refresh) |
| SMART detail | `disks:<device>` | 300s | Never |
| System stats | `system:stats` | 10s | Never |

### 12.3 Write-Through Invalidation

When a write operation succeeds, invalidate related cache entries:

```typescript
async createSnapshot(req: CreateSnapshotRequest): Promise<Snapshot> {
  await this.exec.execute('zfs', ['snapshot', `${req.dataset}@${req.name}`]);
  this.cache.invalidatePrefix('snapshots:');
  // Return fresh data
  return this.getSnapshot(`${req.dataset}@${req.name}`);
}
```

---

## 13. Error Handling

### 13.1 Error Response Format

All errors return the `ApiError` shape:

```typescript
interface ApiError {
  error: string;       // human-readable message
  detail?: string;     // additional context
  command?: string;    // the failed command (only in development mode)
}
```

### 13.2 HTTP Status Codes

| Code | Meaning | When |
|------|---------|------|
| 200 | Success | Normal response |
| 201 | Created | After dataset/snapshot creation |
| 400 | Bad Request | Invalid input (bad name, invalid property) |
| 401 | Unauthorized | No valid session |
| 404 | Not Found | Pool/dataset/snapshot doesn't exist |
| 409 | Conflict | Dataset has children (can't delete), scrub already running |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Error | ZFS command failed unexpectedly |

### 13.3 ZFS Command Error Mapping

```typescript
function mapZfsError(stderr: string, command: string): { status: number; error: ApiError } {
  if (stderr.includes('dataset does not exist'))
    return { status: 404, error: { error: 'Dataset not found' } };
  if (stderr.includes('dataset already exists'))
    return { status: 409, error: { error: 'Dataset already exists' } };
  if (stderr.includes('has children'))
    return { status: 409, error: { error: 'Dataset has children', detail: 'Use recursive=true' } };
  if (stderr.includes('permission denied'))
    return { status: 500, error: { error: 'Permission denied', detail: 'Check sudoers configuration' } };
  if (stderr.includes('no such pool'))
    return { status: 404, error: { error: 'Pool not found' } };
  // Default
  return { status: 500, error: { error: 'Command failed', detail: stderr.trim() } };
}
```

### 13.4 htmx Error Handling

For htmx partial requests, errors should return HTML that can be swapped in:

```typescript
function handlePartialError(res: Response, error: Error) {
  res.status(200).send(`
    <div class="bg-red-900/50 border border-red-500 rounded p-4 text-red-200">
      <strong>Error:</strong> ${escapeHtml(error.message)}
    </div>
  `);
}
```

Note: htmx by default doesn't swap error responses (4xx/5xx). We either return 200 with error HTML, or configure htmx to swap error responses:

```javascript
document.body.addEventListener('htmx:beforeSwap', (e) => {
  if (e.detail.xhr.status >= 400) {
    e.detail.shouldSwap = true;
    e.detail.isError = false;
  }
});
```

---

## Appendix A: Package Dependencies

```json
{
  "name": "litezfs",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server/index.ts",
    "build": "tsup src/server/index.ts --format esm && esbuild src/client/*.ts --bundle --outdir=public/js",
    "start": "node dist/index.js",
    "setup-password": "tsx src/server/setup-password.ts"
  },
  "dependencies": {
    "express": "^4.21.0",
    "express-session": "^1.18.0",
    "express-rate-limit": "^7.4.0",
    "bcrypt": "^5.1.1",
    "ws": "^8.16.0",
    "node-pty": "^1.0.0",
    "ejs": "^3.1.10",
    "yaml": "^2.5.0",
    "croner": "^8.1.0",
    "helmet": "^7.1.0",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/addon-web-links": "^0.11.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.19.0",
    "tsup": "^8.3.0",
    "esbuild": "^0.24.0",
    "@types/express": "^4.17.21",
    "@types/express-session": "^1.18.0",
    "@types/ws": "^8.5.12",
    "@types/bcrypt": "^5.0.2",
    "tailwindcss": "^3.4.0"
  }
}
```

## Appendix B: systemd Unit File

```ini
# /etc/systemd/system/litezfs.service
[Unit]
Description=LiteZFS — Web-based ZFS Management
After=network.target zfs.target
Wants=zfs.target

[Service]
Type=simple
User=litezfs
Group=litezfs
ExecStart=/usr/bin/node /opt/litezfs/dist/index.js
WorkingDirectory=/opt/litezfs
Restart=on-failure
RestartSec=5

# Security hardening
NoNewPrivileges=false  # needed for sudo
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/litezfs
PrivateTmp=true

# Environment
Environment=NODE_ENV=production
EnvironmentFile=-/etc/litezfs/env

[Install]
WantedBy=multi-user.target
```

## Appendix C: Quick Reference — Implementation Order

Recommended build order for implementers:

1. **Scaffold** — `package.json`, `tsconfig.json`, project structure, shared types
2. **Server bootstrap** — Express, session, EJS templates, layout
3. **Auth** — login page, session middleware, bcrypt
4. **Command executor** — `exec.ts` with sudo + validation
5. **Pool service + API** — `zpool.ts`, `GET /api/pools`, pool card partial
6. **Dashboard page** — layout, sidebar, pool cards with htmx polling
7. **Dataset service + API** — `zfs.ts`, dataset list/create/destroy
8. **Snapshot service + API** — snapshot list/create/destroy/rollback
9. **SMART service** — `smart.ts`, disk cards
10. **Terminal** — node-pty + WebSocket + xterm.js client bundle
11. **Alerts** — alert service, badge, alert list
12. **Scheduler** — cron jobs for auto-snapshots and scrubs
13. **Settings page** — schedule management UI
14. **Polish** — error handling, loading states, mobile responsiveness
