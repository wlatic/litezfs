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
  scan: string;           // raw scan line
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
  message?: string;
  children: StatusDevice[];
}

export interface PoolIOStat {
  name: string;
  alloc: number;          // bytes
  free: number;           // bytes
  readOps: number;
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
  name: string;
  properties?: {
    compression?: string;
    quota?: string;
    reservation?: string;
    recordsize?: string;
    atime?: 'on' | 'off';
    mountpoint?: string;
  };
}

export interface SetPropertiesRequest {
  properties: Record<string, string>;
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
  name: string;
  recursive?: boolean;
}

export interface RollbackRequest {
  force?: boolean;
}

export interface SnapshotDiff {
  path: string;
  type: '+' | '-' | 'M' | 'R';
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
  transport: string;
  health: DiskHealth;
  zpoolMember?: string;
}

export interface DiskHealth {
  passed: boolean;
  temperature: number;    // Celsius
  powerOnHours: number;
  powerCycleCount: number;
  reallocatedSectors: number;
  pendingSectors: number;
  offlineUncorrectable: number;
  errorCount: number;
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
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  source: string;
  timestamp: string;
  acknowledged: boolean;
}

// ---------------------------------------------------------------------------
// System Types
// ---------------------------------------------------------------------------

export interface SystemStats {
  arc: {
    size: number;
    maxSize: number;
    hitRatio: number;
    hits: number;
    misses: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    arcPercent: number;
  };
  zfsVersion: string;
  kernelVersion: string;
}

// ---------------------------------------------------------------------------
// API Response Wrappers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  data: T;
  timestamp: string;
  cached: boolean;
}

export interface ApiError {
  error: string;
  detail?: string;
  command?: string;
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
    host: string;
    sessionSecret: string;
  };
  auth: {
    username: string;
    passwordHash: string;
  };
  scheduler: {
    snapshots: ScheduledSnapshot[];
    scrubs: ScheduledScrub[];
  };
  alerts: {
    spaceWarningPercent: number;
    spaceCriticalPercent: number;
    tempWarningCelsius: number;
    tempCriticalCelsius: number;
    scrubMaxAgeDays: number;
  };
  cache: {
    poolListTtl: number;
    datasetListTtl: number;
    propertiesTtl: number;
    smartTtl: number;
    systemStatsTtl: number;
  };
}

export interface ScheduledSnapshot {
  dataset: string;
  schedule: string;
  nameTemplate: string;
  recursive: boolean;
  retain: number;
}

export interface ScheduledScrub {
  pool: string;
  schedule: string;
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
