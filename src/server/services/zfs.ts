import type { Dataset, Snapshot, DatasetProperties, SnapshotDiff } from '../../shared/types.js';
import { safeExec, isCommandAvailable } from './exec.js';
import { cache } from './cache.js';

// Cache TTLs (seconds)
const DATASET_LIST_TTL = 5;
const SNAPSHOT_LIST_TTL = 5;
const PROPERTIES_TTL = 30;

// ==========================================================================
// Mock data fallback
// ==========================================================================

let useMock = false;

/** Detect if ZFS is available. Call once at startup. */
export async function init(): Promise<void> {
  if (!isCommandAvailable('zfs')) {
    useMock = true;
    console.warn('[litezfs] zfs command not available, using mock data for datasets/snapshots');
    return;
  }
  const result = await safeExec('zfs', ['version']);
  useMock = !result.ok;
  if (useMock) {
    console.warn('[litezfs] zfs command failed, using mock data for datasets/snapshots');
  }
}

const MOCK_DATASETS: Dataset[] = [
  { name: 'zfs', pool: 'zfs', shortName: 'zfs', type: 'filesystem', used: 7950516674560, available: 7995939733504, refer: 425984, mountpoint: '/zfs', compression: 'lz4', compressratio: 1.23, quota: 0, reservation: 0, recordsize: 131072, atime: 'off', snapdir: 'hidden' },
  { name: 'zfs/backups', pool: 'zfs', shortName: 'backups', type: 'filesystem', used: 2199023255552, available: 7995939733504, refer: 2199023255552, mountpoint: '/zfs/backups', compression: 'lz4', compressratio: 1.45, quota: 0, reservation: 0, recordsize: 131072, atime: 'off', snapdir: 'hidden' },
  { name: 'zfs/claude', pool: 'zfs', shortName: 'claude', type: 'filesystem', used: 536870912000, available: 7995939733504, refer: 536870912000, mountpoint: '/zfs/claude', compression: 'lz4', compressratio: 1.12, quota: 0, reservation: 0, recordsize: 131072, atime: 'off', snapdir: 'hidden' },
  { name: 'zfs/media', pool: 'zfs', shortName: 'media', type: 'filesystem', used: 4107282432000, available: 7995939733504, refer: 4107282432000, mountpoint: '/zfs/media', compression: 'off', compressratio: 1.0, quota: 0, reservation: 0, recordsize: 1048576, atime: 'off', snapdir: 'hidden' },
  { name: 'tank', pool: 'tank', shortName: 'tank', type: 'filesystem', used: 966367641600, available: 1012144316416, refer: 425984, mountpoint: '/tank', compression: 'zstd', compressratio: 2.1, quota: 0, reservation: 0, recordsize: 131072, atime: 'off', snapdir: 'hidden' },
  { name: 'tank/vms', pool: 'tank', shortName: 'vms', type: 'filesystem', used: 644245094400, available: 1012144316416, refer: 644245094400, mountpoint: '/tank/vms', compression: 'zstd', compressratio: 2.3, quota: 0, reservation: 0, recordsize: 65536, atime: 'off', snapdir: 'hidden' },
  { name: 'tank/docker', pool: 'tank', shortName: 'docker', type: 'filesystem', used: 322122547200, available: 1012144316416, refer: 322122547200, mountpoint: '/tank/docker', compression: 'zstd', compressratio: 1.9, quota: 0, reservation: 0, recordsize: 131072, atime: 'off', snapdir: 'hidden' },
];

const MOCK_SNAPSHOTS: Snapshot[] = [
  { fullName: 'zfs/backups@autosnap_2026-03-12', dataset: 'zfs/backups', name: 'autosnap_2026-03-12', used: 1048576, refer: 2199023255552, creation: '2026-03-12T04:00:00Z' },
  { fullName: 'zfs/backups@autosnap_2026-03-11', dataset: 'zfs/backups', name: 'autosnap_2026-03-11', used: 52428800, refer: 2198974827000, creation: '2026-03-11T04:00:00Z' },
  { fullName: 'zfs/claude@autosnap_2026-03-12', dataset: 'zfs/claude', name: 'autosnap_2026-03-12', used: 524288, refer: 536870912000, creation: '2026-03-12T04:00:00Z' },
  { fullName: 'tank/vms@pre-upgrade', dataset: 'tank/vms', name: 'pre-upgrade', used: 10737418240, refer: 644245094400, creation: '2026-03-10T14:30:00Z' },
  { fullName: 'tank/docker@weekly_2026-03-09', dataset: 'tank/docker', name: 'weekly_2026-03-09', used: 2147483648, refer: 322122547200, creation: '2026-03-09T00:00:00Z' },
];

// ==========================================================================
// Validation
// ==========================================================================

const DATASET_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_/.:@-]*$/;
const SNAPSHOT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SETTABLE_PROPS = new Set([
  'compression', 'quota', 'reservation', 'recordsize', 'atime',
  'mountpoint', 'snapdir', 'dedup', 'sync', 'logbias', 'primarycache',
  'secondarycache', 'checksum', 'copies', 'canmount', 'readonly',
  'xattr', 'acltype', 'relatime', 'special_small_blocks',
]);
const PROP_VALUE_RE = /^[a-zA-Z0-9_/.:@=, -]*$/;

function validateDatasetName(name: string): boolean {
  return DATASET_NAME_RE.test(name) && name.length <= 1024 && !name.includes('..');
}

function validateSnapshotName(name: string): boolean {
  return SNAPSHOT_NAME_RE.test(name) && name.length <= 256;
}

function validateProperty(key: string, value: string): boolean {
  return SETTABLE_PROPS.has(key) && PROP_VALUE_RE.test(value) && value.length <= 256;
}

// ==========================================================================
// Parsers
// ==========================================================================

/** Parse `zfs list -Hpo name,used,avail,refer,mountpoint,type` */
function parseZfsList(stdout: string): Omit<Dataset, 'pool' | 'shortName' | 'compression' | 'compressratio' | 'quota' | 'reservation' | 'recordsize' | 'atime' | 'snapdir'>[] {
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [name, used, avail, refer, mountpoint, type] = line.split('\t');
    return {
      name,
      used: Number(used),
      available: Number(avail),
      refer: Number(refer),
      mountpoint: mountpoint || '',
      type: (type === 'volume' ? 'volume' : 'filesystem') as 'filesystem' | 'volume',
    };
  });
}

/** Parse `zfs get -Hp <props> <dataset>` to get specific properties */
function parseZfsGet(stdout: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const [_dataset, name, value] = line.split('\t');
    if (name && value) {
      props[name] = value;
    }
  }
  return props;
}

/** Parse `zfs get -Hp all <dataset>` for full properties */
function parseZfsGetAll(stdout: string): DatasetProperties {
  const props: DatasetProperties = {};
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const [_dataset, name, value, source] = line.split('\t');
    if (name && value !== undefined) {
      props[name] = {
        value,
        source: source as DatasetProperties[string]['source'],
      };
    }
  }
  return props;
}

/** Parse `zfs list -Hpt snapshot -o name,used,refer,creation` */
function parseZfsSnapshots(stdout: string): Snapshot[] {
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [fullName, used, refer, creation] = line.split('\t');
    const atIndex = fullName.indexOf('@');
    const dataset = fullName.substring(0, atIndex);
    const snapName = fullName.substring(atIndex + 1);
    return {
      fullName,
      dataset,
      name: snapName,
      used: Number(used),
      refer: Number(refer),
      creation: new Date(Number(creation) * 1000).toISOString(),
    };
  });
}

/** Parse `zfs diff <snapshot>` output */
function parseZfsDiff(stdout: string): SnapshotDiff[] {
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const type = line.charAt(0) as SnapshotDiff['type'];
    const path = line.substring(2).trim();
    return { type, path };
  });
}

/** Enrich a basic dataset listing with extended properties */
async function enrichDataset(basic: ReturnType<typeof parseZfsList>[0]): Promise<Dataset> {
  const propsResult = await safeExec('zfs', [
    'get', '-Hp', 'compression,compressratio,quota,reservation,recordsize,atime,snapdir', basic.name,
  ]);

  let compression = 'off';
  let compressratio = 1.0;
  let quota = 0;
  let reservation = 0;
  let recordsize = 131072;
  let atime: 'on' | 'off' = 'off';
  let snapdir: 'hidden' | 'visible' = 'hidden';

  if (propsResult.ok) {
    const props = parseZfsGet(propsResult.stdout);
    compression = props.compression ?? 'off';
    compressratio = parseFloat(props.compressratio ?? '1.00');
    quota = Number(props.quota ?? '0');
    reservation = Number(props.reservation ?? '0');
    recordsize = Number(props.recordsize ?? '131072');
    atime = (props.atime === 'on' ? 'on' : 'off');
    snapdir = (props.snapdir === 'visible' ? 'visible' : 'hidden');
  }

  return {
    ...basic,
    pool: basic.name.split('/')[0],
    shortName: basic.name.split('/').pop() ?? basic.name,
    compression,
    compressratio,
    quota,
    reservation,
    recordsize,
    atime,
    snapdir,
  };
}

// ==========================================================================
// Service methods — Datasets
// ==========================================================================

/** List all datasets, optionally filtered by pool */
export async function listDatasets(pool?: string): Promise<Dataset[]> {
  if (useMock) {
    return pool ? MOCK_DATASETS.filter(d => d.pool === pool) : MOCK_DATASETS;
  }
  const cacheKey = pool ? `zfs:datasets:${pool}` : 'zfs:datasets:all';
  return cache.getOrSet(cacheKey, DATASET_LIST_TTL, async () => {
    const args = ['list', '-Hpo', 'name,used,avail,refer,mountpoint,type', '-t', 'filesystem,volume'];
    if (pool && validateDatasetName(pool)) {
      args.push('-r', pool);
    }

    const result = await safeExec('zfs', args);
    if (!result.ok) {
      console.error('[zfs] listDatasets failed:', result.error);
      return [];
    }

    const basics = parseZfsList(result.stdout);
    // Batch-fetch common properties for all datasets in one go
    const datasets = await Promise.all(basics.map(b => enrichDataset(b)));
    return datasets;
  });
}

/** Get a single dataset by name with all common properties */
export async function getDataset(name: string): Promise<Dataset | undefined> {
  if (!validateDatasetName(name)) return undefined;
  if (useMock) return MOCK_DATASETS.find(d => d.name === name);

  const result = await safeExec('zfs', [
    'list', '-Hpo', 'name,used,avail,refer,mountpoint,type', name,
  ]);
  if (!result.ok) return undefined;

  const basics = parseZfsList(result.stdout);
  if (basics.length === 0) return undefined;
  return enrichDataset(basics[0]);
}

/** Get all properties for a dataset */
export async function getDatasetProperties(name: string): Promise<DatasetProperties | undefined> {
  if (!validateDatasetName(name)) return undefined;
  if (useMock) return undefined; // No mock property data

  return cache.getOrSet(`zfs:props:${name}`, PROPERTIES_TTL, async () => {
    const result = await safeExec('zfs', ['get', '-Hp', 'all', name]);
    if (!result.ok) {
      console.error(`[zfs] getDatasetProperties(${name}) failed:`, result.error);
      return undefined;
    }
    return parseZfsGetAll(result.stdout);
  });
}

/** Create a new dataset */
export async function createDataset(
  name: string,
  properties?: Record<string, string>,
): Promise<{ ok: boolean; message: string; dataset?: Dataset }> {
  if (!validateDatasetName(name)) {
    return { ok: false, message: 'Invalid dataset name. Must match [a-zA-Z0-9_/.:@-]+' };
  }
  if (useMock) return { ok: true, message: `Dataset '${name}' created (mock)` };

  const args = ['create'];
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (!validateProperty(key, value)) {
        return { ok: false, message: `Invalid property: ${key}=${value}` };
      }
      args.push('-o', `${key}=${value}`);
    }
  }
  args.push(name);

  const result = await safeExec('zfs', args);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  cache.invalidatePrefix('zfs:datasets');
  const dataset = await getDataset(name);
  return { ok: true, message: `Dataset '${name}' created`, dataset };
}

/** Destroy a dataset */
export async function destroyDataset(
  name: string,
  recursive = false,
): Promise<{ ok: boolean; message: string }> {
  if (!validateDatasetName(name)) {
    return { ok: false, message: 'Invalid dataset name' };
  }
  if (useMock) return { ok: true, message: `Dataset '${name}' destroyed (mock)` };

  const args = ['destroy'];
  if (recursive) args.push('-r');
  args.push(name);

  const result = await safeExec('zfs', args);
  if (!result.ok) {
    if (result.error.includes('has children')) {
      return { ok: false, message: 'Dataset has children. Use recursive=true to destroy them.' };
    }
    return { ok: false, message: result.error };
  }

  cache.invalidatePrefix('zfs:datasets');
  cache.invalidatePrefix('zfs:props');
  return { ok: true, message: `Dataset '${name}' destroyed` };
}

/** Set properties on a dataset */
export async function setDatasetProperties(
  name: string,
  properties: Record<string, string>,
): Promise<{ ok: boolean; message: string; dataset?: Dataset }> {
  if (!validateDatasetName(name)) {
    return { ok: false, message: 'Invalid dataset name' };
  }
  if (useMock) return { ok: true, message: 'Properties updated (mock)' };

  for (const [key, value] of Object.entries(properties)) {
    if (!validateProperty(key, value)) {
      return { ok: false, message: `Invalid property: ${key}=${value}` };
    }
    const result = await safeExec('zfs', ['set', `${key}=${value}`, name]);
    if (!result.ok) {
      return { ok: false, message: `Failed to set ${key}: ${result.error}` };
    }
  }

  cache.invalidate(`zfs:props:${name}`);
  cache.invalidatePrefix('zfs:datasets');
  const dataset = await getDataset(name);
  return { ok: true, message: 'Properties updated', dataset };
}

// ==========================================================================
// Service methods — Snapshots
// ==========================================================================

/** List all snapshots, optionally filtered by dataset */
export async function listSnapshots(dataset?: string): Promise<Snapshot[]> {
  if (useMock) {
    return dataset ? MOCK_SNAPSHOTS.filter(s => s.dataset === dataset) : MOCK_SNAPSHOTS;
  }
  const cacheKey = dataset ? `zfs:snapshots:${dataset}` : 'zfs:snapshots:all';
  return cache.getOrSet(cacheKey, SNAPSHOT_LIST_TTL, async () => {
    const args = ['list', '-Hpt', 'snapshot', '-o', 'name,used,refer,creation'];
    if (dataset && validateDatasetName(dataset)) {
      args.push('-r', dataset);
    }

    const result = await safeExec('zfs', args);
    if (!result.ok) {
      // "no datasets available" is not an error — just no snapshots
      if (result.error.includes('no datasets available')) return [];
      console.error('[zfs] listSnapshots failed:', result.error);
      return [];
    }

    return parseZfsSnapshots(result.stdout);
  });
}

/** Get a single snapshot by full name (dataset@snapname) */
export async function getSnapshot(fullName: string): Promise<Snapshot | undefined> {
  if (!fullName.includes('@')) return undefined;
  const [dataset] = fullName.split('@');
  if (!validateDatasetName(dataset)) return undefined;
  if (useMock) return MOCK_SNAPSHOTS.find(s => s.fullName === fullName);

  const snapshots = await listSnapshots(dataset);
  return snapshots.find(s => s.fullName === fullName);
}

/** Create a new snapshot */
export async function createSnapshot(
  dataset: string,
  name: string,
  recursive = false,
): Promise<{ ok: boolean; message: string; snapshot?: Snapshot }> {
  if (!validateDatasetName(dataset)) {
    return { ok: false, message: 'Invalid dataset name' };
  }
  if (!validateSnapshotName(name)) {
    return { ok: false, message: 'Invalid snapshot name. Must match [a-zA-Z0-9_.-]+' };
  }
  if (useMock) return { ok: true, message: `Snapshot '${dataset}@${name}' created (mock)` };

  const fullName = `${dataset}@${name}`;
  const args = ['snapshot'];
  if (recursive) args.push('-r');
  args.push(fullName);

  const result = await safeExec('zfs', args);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  cache.invalidatePrefix('zfs:snapshots');
  const snapshot = await getSnapshot(fullName);
  return { ok: true, message: `Snapshot '${fullName}' created`, snapshot };
}

/** Destroy a snapshot */
export async function destroySnapshot(fullName: string): Promise<{ ok: boolean; message: string }> {
  if (!fullName.includes('@')) {
    return { ok: false, message: 'Invalid snapshot name — must include @' };
  }
  const [dataset] = fullName.split('@');
  if (!validateDatasetName(dataset)) {
    return { ok: false, message: 'Invalid dataset name in snapshot' };
  }
  if (useMock) return { ok: true, message: `Snapshot '${fullName}' destroyed (mock)` };

  const result = await safeExec('zfs', ['destroy', fullName]);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  cache.invalidatePrefix('zfs:snapshots');
  return { ok: true, message: `Snapshot '${fullName}' destroyed` };
}

/** Rollback a dataset to a snapshot */
export async function rollbackSnapshot(
  fullName: string,
  force = false,
): Promise<{ ok: boolean; message: string }> {
  if (!fullName.includes('@')) {
    return { ok: false, message: 'Invalid snapshot name — must include @' };
  }
  const [dataset] = fullName.split('@');
  if (!validateDatasetName(dataset)) {
    return { ok: false, message: 'Invalid dataset name in snapshot' };
  }

  if (useMock) return { ok: true, message: `Rolled back to '${fullName}' (mock)` };

  const args = ['rollback'];
  if (force) args.push('-rf');
  args.push(fullName);

  const result = await safeExec('zfs', args);
  if (!result.ok) {
    if (result.error.includes('more recent snapshots')) {
      return { ok: false, message: 'More recent snapshots exist. Use force=true to destroy them.' };
    }
    return { ok: false, message: result.error };
  }

  cache.invalidatePrefix('zfs:');
  return { ok: true, message: `Rolled back to '${fullName}'` };
}

/** Get files changed since a snapshot */
export async function diffSnapshot(fullName: string): Promise<{ ok: boolean; diff?: SnapshotDiff[]; message?: string }> {
  if (!fullName.includes('@')) {
    return { ok: false, message: 'Invalid snapshot name' };
  }
  const [dataset] = fullName.split('@');
  if (!validateDatasetName(dataset)) {
    return { ok: false, message: 'Invalid dataset name in snapshot' };
  }
  if (useMock) return { ok: true, diff: [] };

  const result = await safeExec('zfs', ['diff', fullName]);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }

  return { ok: true, diff: parseZfsDiff(result.stdout) };
}

/** Estimate send stream size for a snapshot */
export async function sendSize(fullName: string): Promise<{ ok: boolean; estimatedSize?: number; message?: string }> {
  if (!fullName.includes('@')) {
    return { ok: false, message: 'Invalid snapshot name' };
  }
  const [dataset] = fullName.split('@');
  if (!validateDatasetName(dataset)) {
    return { ok: false, message: 'Invalid dataset name in snapshot' };
  }
  if (useMock) return { ok: true, estimatedSize: 1073741824 }; // 1 GB mock

  const result = await safeExec('zfs', ['send', '-nv', fullName]);
  // zfs send -nv writes the size info to stderr
  const output = result.ok ? (result.stderr || result.stdout) : '';

  // Parse "total estimated size is <size>" from output
  const sizeMatch = output.match(/total estimated size is\s+(\S+)/i);
  if (!sizeMatch) {
    // Try parsing the "size" line directly
    const altMatch = output.match(/size\s+(\d+)/);
    if (altMatch) {
      return { ok: true, estimatedSize: Number(altMatch[1]) };
    }
    return { ok: false, message: result.ok ? 'Could not parse send size' : (result as { error: string }).error };
  }

  // Parse human-readable size like "1.23G" to bytes
  const sizeStr = sizeMatch[1];
  const estimatedSize = parseHumanSize(sizeStr);
  return { ok: true, estimatedSize };
}

/** Parse human-readable sizes like "1.23G" to bytes */
function parseHumanSize(str: string): number {
  const match = str.match(/^([\d.]+)([BKMGTPE]?)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3,
    T: 1024 ** 4, P: 1024 ** 5, E: 1024 ** 6,
  };
  return Math.round(value * (multipliers[unit] || 1));
}
