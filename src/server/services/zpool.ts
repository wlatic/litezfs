import type { Pool, PoolStatus, PoolIOStat, VDev, VDevType, StatusDevice, PoolHealth } from '../../shared/types.js';
import { safeExec, isCommandAvailable } from './exec.js';
import { cache } from './cache.js';

// Cache TTLs (seconds)
const POOL_LIST_TTL = 5;
const POOL_STATUS_TTL = 10;
const POOL_IOSTAT_TTL = 3;
const POOL_VDEV_TTL = 10;

// ==========================================================================
// Mock data fallback — used when ZFS is not available (development)
// ==========================================================================

let useMock = false;

/** Detect if ZFS is available. Call once at startup. */
export async function init(): Promise<void> {
  if (!isCommandAvailable('zpool')) {
    useMock = true;
    console.warn('[litezfs] zpool not available, using mock data');
    return;
  }
  const result = await safeExec('zpool', ['version']);
  useMock = !result.ok;
  if (useMock) {
    console.warn('[litezfs] ZFS not available (zpool version failed), using mock data');
  } else {
    console.log('[litezfs] ZFS detected, using real zpool commands');
  }
}

function mockPools(): Pool[] {
  return [
    { name: 'zfs', size: 15946456408064, allocated: 7950516674560, free: 7995939733504, fragmentation: 8, capacity: 49, dedup: 1.0, health: 'ONLINE' },
    { name: 'tank', size: 1978511958016, allocated: 966367641600, free: 1012144316416, fragmentation: 3, capacity: 48, dedup: 1.0, health: 'ONLINE' },
  ];
}

const MOCK_VDEVS: Record<string, VDev[]> = {
  zfs: [
    { name: 'mirror-0', type: 'mirror', size: 7995939733504, allocated: 3975258337280, free: 4020681396224, health: 'ONLINE', children: [
      { name: 'ata-WDC_WD80EFZZ-68BTXN0_WD-CA0A1234', type: 'disk', health: 'ONLINE', children: [] },
      { name: 'ata-WDC_WD80EFZZ-68BTXN0_WD-CA0A5678', type: 'disk', health: 'ONLINE', children: [] },
    ]},
    { name: 'mirror-1', type: 'mirror', size: 7995939733504, allocated: 3975258337280, free: 4020681396224, health: 'ONLINE', children: [
      { name: 'ata-ST8000DM004-2U9188_ZR1A1234', type: 'disk', health: 'ONLINE', children: [] },
      { name: 'ata-ST8000DM004-2U9188_ZR1A5678', type: 'disk', health: 'ONLINE', children: [] },
    ]},
  ],
  tank: [
    { name: 'mirror-0', type: 'mirror', size: 1978511958016, allocated: 966367641600, free: 1012144316416, health: 'ONLINE', children: [
      { name: 'ata-Samsung_SSD_870_EVO_2TB_S1234', type: 'disk', health: 'ONLINE', children: [] },
      { name: 'ata-Samsung_SSD_870_EVO_2TB_S5678', type: 'disk', health: 'ONLINE', children: [] },
    ]},
  ],
};

const MOCK_STATUS: Record<string, PoolStatus> = {
  zfs: {
    name: 'zfs', state: 'ONLINE',
    scan: 'scrub repaired 0B in 12:34:56 with 0 errors on Sun Mar  8 00:24:01 2026',
    scanParsed: { type: 'scrub', state: 'completed', repaired: '0B', duration: '12:34:56', errors: 0, timestamp: 'Sun Mar  8 00:24:01 2026' },
    config: [{ name: 'zfs', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [
      { name: 'mirror-0', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [
        { name: 'ata-WDC_WD80EFZZ-68BTXN0_WD-CA0A1234', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [] },
        { name: 'ata-WDC_WD80EFZZ-68BTXN0_WD-CA0A5678', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [] },
      ]},
      { name: 'mirror-1', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [
        { name: 'ata-ST8000DM004-2U9188_ZR1A1234', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [] },
        { name: 'ata-ST8000DM004-2U9188_ZR1A5678', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [] },
      ]},
    ]}],
    errors: 'No known data errors',
  },
  tank: {
    name: 'tank', state: 'ONLINE',
    scan: 'scrub repaired 0B in 01:23:45 with 0 errors on Sat Mar  7 12:00:00 2026',
    scanParsed: { type: 'scrub', state: 'completed', repaired: '0B', duration: '01:23:45', errors: 0, timestamp: 'Sat Mar  7 12:00:00 2026' },
    config: [{ name: 'tank', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [
      { name: 'mirror-0', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [
        { name: 'ata-Samsung_SSD_870_EVO_2TB_S1234', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [] },
        { name: 'ata-Samsung_SSD_870_EVO_2TB_S5678', state: 'ONLINE', read: 0, write: 0, cksum: 0, children: [] },
      ]},
    ]}],
    errors: 'No known data errors',
  },
};

function mockIOStat(name: string): PoolIOStat | undefined {
  const pool = mockPools().find(p => p.name === name);
  if (!pool) return undefined;
  return {
    name: pool.name, alloc: pool.allocated, free: pool.free,
    readOps: Math.floor(Math.random() * 100) + 10,
    writeOps: Math.floor(Math.random() * 50) + 5,
    readBw: Math.floor(Math.random() * 10_000_000) + 500_000,
    writeBw: Math.floor(Math.random() * 5_000_000) + 100_000,
  };
}

// ==========================================================================
// Parsers
// ==========================================================================

/** Parse `zpool list -Hpo name,size,allocated,free,fragmentation,capacity,dedup,health` */
function parseZpoolList(stdout: string): Pool[] {
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [name, size, allocated, free, frag, cap, dedup, health] = line.split('\t');
    return {
      name,
      size: Number(size),
      allocated: Number(allocated),
      free: Number(free),
      fragmentation: Number(frag),
      capacity: Number(cap),
      dedup: parseFloat(dedup),
      health: health as PoolHealth,
    };
  });
}

/** Parse `zpool list -vHp <pool>` for vdev tree */
function parseZpoolListV(stdout: string): VDev[] {
  const vdevs: VDev[] = [];
  let currentVdev: VDev | null = null;

  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const depth = line.match(/^\t*/)?.[0].length ?? 0;
    const fields = line.trim().split('\t');
    const name = fields[0];

    if (depth === 0) {
      // Pool level — skip
      continue;
    } else if (depth === 1) {
      // VDev level (mirror-0, raidz1-0, etc.)
      const type = name.replace(/-\d+$/, '') as VDevType;
      currentVdev = {
        name,
        type,
        size: fields[1] !== '-' && fields[1] ? Number(fields[1]) : undefined,
        allocated: fields[2] !== '-' && fields[2] ? Number(fields[2]) : undefined,
        free: fields[3] !== '-' && fields[3] ? Number(fields[3]) : undefined,
        health: fields[9] || 'ONLINE',
        children: [],
      };
      vdevs.push(currentVdev);
    } else if (depth === 2 && currentVdev) {
      // Disk level
      currentVdev.children.push({
        name,
        type: 'disk',
        health: fields[9] || 'ONLINE',
        children: [],
      });
    }
  }
  return vdevs;
}

/** Parse `zpool status <pool>` free-form output */
function parseZpoolStatus(stdout: string): PoolStatus[] {
  const pools: PoolStatus[] = [];
  const poolBlocks = stdout.split(/(?=\s*pool:)/g).filter(b => b.trim());

  for (const block of poolBlocks) {
    const nameMatch = block.match(/pool:\s+(\S+)/);
    const stateMatch = block.match(/state:\s+(\S+)/);
    const scanMatch = block.match(/scan:\s+([\s\S]+?)(?=\nconfig:|$)/);
    const errorsMatch = block.match(/errors:\s+(.+?)$/m);

    // Parse scan info
    const scanRaw = scanMatch?.[1]?.trim().replace(/\n\s+/g, ' ') ?? '';
    const scanParsed = parseScanLine(scanRaw);

    // Parse config section device tree
    const configMatch = block.match(/NAME\s+STATE.*\n([\s\S]*?)(?=\nerrors:|$)/);
    const devices: StatusDevice[] = [];

    if (configMatch) {
      const lines = configMatch[1].split('\n').filter(l => l.trim());
      const stack: { device: StatusDevice; indent: number }[] = [];

      for (const line of lines) {
        const indent = line.search(/\S/);
        const parts = line.trim().split(/\s+/);
        const device: StatusDevice = {
          name: parts[0],
          state: parts[1] || 'UNKNOWN',
          read: Number(parts[2]) || 0,
          write: Number(parts[3]) || 0,
          cksum: Number(parts[4]) || 0,
          message: parts.length > 5 ? parts.slice(5).join(' ') : undefined,
          children: [],
        };

        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        if (stack.length === 0) {
          devices.push(device);
        } else {
          stack[stack.length - 1].device.children.push(device);
        }
        stack.push({ device, indent });
      }
    }

    pools.push({
      name: nameMatch?.[1] ?? '',
      state: (stateMatch?.[1] ?? 'UNKNOWN') as PoolHealth,
      scan: scanRaw,
      scanParsed,
      config: devices,
      errors: errorsMatch?.[1] ?? '',
    });
  }
  return pools;
}

/** Parse the scan line into structured data */
function parseScanLine(scan: string): PoolStatus['scanParsed'] {
  if (!scan || scan === 'none requested') {
    return { type: 'none', state: 'completed', repaired: '0B', errors: 0 };
  }

  const isScrub = scan.includes('scrub');
  const isResilver = scan.includes('resilver');
  const type = isScrub ? 'scrub' : isResilver ? 'resilver' : 'none';

  // In progress: "scrub in progress since..."
  if (scan.includes('in progress')) {
    const progressMatch = scan.match(/(\d+\.\d+)%\s+done/);
    return {
      type: type as 'scrub' | 'resilver',
      state: 'in_progress',
      repaired: '0B',
      errors: 0,
      progress: progressMatch ? parseFloat(progressMatch[1]) : undefined,
    };
  }

  // Completed: "scrub repaired 0B in 12:34:56 with 0 errors on Sun Mar 8 00:24:01 2026"
  const repairedMatch = scan.match(/repaired\s+(\S+)/);
  const durationMatch = scan.match(/in\s+(\d+:\d+:\d+)/);
  const errorsMatch = scan.match(/with\s+(\d+)\s+errors/);
  const dateMatch = scan.match(/on\s+(.+)$/);

  // Canceled
  if (scan.includes('canceled')) {
    return {
      type: type as 'scrub' | 'resilver',
      state: 'canceled',
      repaired: repairedMatch?.[1] ?? '0B',
      errors: Number(errorsMatch?.[1]) || 0,
    };
  }

  return {
    type: type as 'scrub' | 'resilver',
    state: 'completed',
    repaired: repairedMatch?.[1] ?? '0B',
    duration: durationMatch?.[1],
    errors: Number(errorsMatch?.[1]) || 0,
    timestamp: dateMatch?.[1],
  };
}

/** Parse `zpool iostat -Hp <pool>` */
function parseZpoolIOStat(stdout: string): PoolIOStat[] {
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [name, alloc, free, readOps, writeOps, readBw, writeBw] = line.split('\t');
    return {
      name,
      alloc: Number(alloc),
      free: Number(free),
      readOps: Number(readOps),
      writeOps: Number(writeOps),
      readBw: Number(readBw),
      writeBw: Number(writeBw),
    };
  });
}

// ==========================================================================
// Validation
// ==========================================================================

const POOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

function validatePoolName(name: string): boolean {
  return POOL_NAME_RE.test(name) && name.length <= 256;
}

// ==========================================================================
// Service methods
// ==========================================================================

/** List all pools with summary information */
export async function listPools(): Promise<Pool[]> {
  if (useMock) return mockPools();
  return cache.getOrSet('zpool:list', POOL_LIST_TTL, async () => {
    const result = await safeExec('zpool', [
      'list', '-Hpo', 'name,size,allocated,free,fragmentation,capacity,dedup,health',
    ]);
    if (!result.ok) {
      console.error('[zpool] listPools failed:', result.error);
      return [];
    }
    return parseZpoolList(result.stdout);
  });
}

/** Get a single pool by name */
export async function getPool(name: string): Promise<Pool | undefined> {
  if (!validatePoolName(name)) return undefined;
  if (useMock) return mockPools().find(p => p.name === name);
  const pools = await listPools();
  return pools.find(p => p.name === name);
}

/** Get vdev tree for a pool */
export async function getPoolVDevs(name: string): Promise<VDev[] | undefined> {
  if (!validatePoolName(name)) return undefined;
  if (useMock) return MOCK_VDEVS[name];
  return cache.getOrSet(`zpool:vdevs:${name}`, POOL_VDEV_TTL, async () => {
    const result = await safeExec('zpool', ['list', '-vHp', name]);
    if (!result.ok) {
      console.error(`[zpool] getPoolVDevs(${name}) failed:`, result.error);
      return [];
    }
    return parseZpoolListV(result.stdout);
  });
}

/** Get detailed status for a pool */
export async function getPoolStatus(name: string): Promise<PoolStatus | undefined> {
  if (!validatePoolName(name)) return undefined;
  if (useMock) return MOCK_STATUS[name];
  return cache.getOrSet(`zpool:status:${name}`, POOL_STATUS_TTL, async () => {
    const result = await safeExec('zpool', ['status', name]);
    if (!result.ok) {
      console.error(`[zpool] getPoolStatus(${name}) failed:`, result.error);
      return undefined;
    }
    const statuses = parseZpoolStatus(result.stdout);
    return statuses.find(s => s.name === name);
  });
}

/** Get I/O stats for a pool */
export async function getPoolIOStat(name: string): Promise<PoolIOStat | undefined> {
  if (!validatePoolName(name)) return undefined;
  if (useMock) return mockIOStat(name);
  return cache.getOrSet(`zpool:iostat:${name}`, POOL_IOSTAT_TTL, async () => {
    const result = await safeExec('zpool', ['iostat', '-Hp', name]);
    if (!result.ok) {
      console.error(`[zpool] getPoolIOStat(${name}) failed:`, result.error);
      return undefined;
    }
    const stats = parseZpoolIOStat(result.stdout);
    return stats.find(s => s.name === name);
  });
}

/** Start a scrub on a pool */
export async function startScrub(name: string): Promise<{ ok: boolean; message: string }> {
  if (!validatePoolName(name)) {
    return { ok: false, message: 'Invalid pool name' };
  }
  if (useMock) return { ok: true, message: `Scrub started on pool '${name}' (mock)` };
  const result = await safeExec('zpool', ['scrub', name]);
  if (!result.ok) {
    // Check if scrub is already in progress
    if (result.error.includes('already')) {
      return { ok: false, message: 'Scrub already in progress' };
    }
    return { ok: false, message: result.error };
  }
  cache.invalidate(`zpool:status:${name}`);
  return { ok: true, message: `Scrub started on pool '${name}'` };
}

/** Cancel a scrub on a pool */
export async function cancelScrub(name: string): Promise<{ ok: boolean; message: string }> {
  if (!validatePoolName(name)) {
    return { ok: false, message: 'Invalid pool name' };
  }
  if (useMock) return { ok: true, message: `Scrub canceled on pool '${name}' (mock)` };
  const result = await safeExec('zpool', ['scrub', '-s', name]);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }
  cache.invalidate(`zpool:status:${name}`);
  return { ok: true, message: `Scrub canceled on pool '${name}'` };
}

/** Import a pool */
export async function importPool(name: string, force = false): Promise<{ ok: boolean; message: string }> {
  if (!validatePoolName(name)) {
    return { ok: false, message: 'Invalid pool name' };
  }
  if (useMock) return { ok: true, message: `Pool '${name}' imported (mock)` };
  const args = force ? ['import', '-f', name] : ['import', name];
  const result = await safeExec('zpool', args);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }
  cache.invalidatePrefix('zpool:');
  return { ok: true, message: `Pool '${name}' imported` };
}

/** Export a pool */
export async function exportPool(name: string, force = false): Promise<{ ok: boolean; message: string }> {
  if (!validatePoolName(name)) {
    return { ok: false, message: 'Invalid pool name' };
  }
  if (useMock) return { ok: true, message: `Pool '${name}' exported (mock)` };
  const args = force ? ['export', '-f', name] : ['export', name];
  const result = await safeExec('zpool', args);
  if (!result.ok) {
    return { ok: false, message: result.error };
  }
  cache.invalidatePrefix('zpool:');
  return { ok: true, message: `Pool '${name}' exported` };
}
