import { readFileSync } from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { SystemStats } from '../../shared/types.js';
import { cache } from './cache.js';

const execFileAsync = promisify(execFileCb);
const SYSTEM_STATS_TTL = 10;

/** Read and parse /proc/spl/kstat/zfs/arcstats for ARC statistics */
function parseArcStats(): { size: number; maxSize: number; hits: number; misses: number; hitRatio: number } {
  try {
    const raw = readFileSync('/proc/spl/kstat/zfs/arcstats', 'utf-8');
    const stats: Record<string, number> = {};
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        stats[parts[0]] = Number(parts[2]);
      }
    }

    const hits = stats['hits'] ?? 0;
    const misses = stats['misses'] ?? 0;
    const total = hits + misses;

    return {
      size: stats['size'] ?? 0,
      maxSize: stats['c_max'] ?? 0,
      hits,
      misses,
      hitRatio: total > 0 ? Math.round((hits / total) * 10000) / 100 : 0,
    };
  } catch {
    return { size: 0, maxSize: 0, hits: 0, misses: 0, hitRatio: 0 };
  }
}

/** Read and parse /proc/meminfo for memory statistics */
function parseMemInfo(): { total: number; used: number; free: number } {
  try {
    const raw = readFileSync('/proc/meminfo', 'utf-8');
    const stats: Record<string, number> = {};
    for (const line of raw.split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB/);
      if (match) {
        stats[match[1]] = Number(match[2]) * 1024; // Convert kB to bytes
      }
    }

    const total = stats['MemTotal'] ?? 0;
    const free = stats['MemFree'] ?? 0;
    const buffers = stats['Buffers'] ?? 0;
    const cached = stats['Cached'] ?? 0;
    const sReclaimable = stats['SReclaimable'] ?? 0;
    // "Used" in the sense of not easily available
    const used = total - free - buffers - cached - sReclaimable;

    return { total, used: Math.max(0, used), free };
  } catch {
    return { total: 0, used: 0, free: 0 };
  }
}

/** Get ZFS version */
async function getZfsVersion(): Promise<string> {
  try {
    // Try reading from /sys first (faster, no sudo)
    const version = readFileSync('/sys/module/zfs/version', 'utf-8').trim();
    return version;
  } catch {
    // Fall back to zfs --version
    try {
      const { stdout } = await execFileAsync('zfs', ['version'], { timeout: 5000 });
      const match = stdout.match(/zfs-(\S+)/);
      return match?.[1] ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

/** Get kernel version */
async function getKernelVersion(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('uname', ['-r'], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

// ==========================================================================
// Service method
// ==========================================================================

/** Get system-wide ZFS and memory statistics */
export async function getSystemStats(): Promise<SystemStats> {
  return cache.getOrSet('system:stats', SYSTEM_STATS_TTL, async () => {
    const arc = parseArcStats();
    const memory = parseMemInfo();
    const [zfsVersion, kernelVersion] = await Promise.all([
      getZfsVersion(),
      getKernelVersion(),
    ]);

    return {
      arc,
      memory: {
        ...memory,
        arcPercent: memory.total > 0
          ? Math.round((arc.size / memory.total) * 10000) / 100
          : 0,
      },
      zfsVersion,
      kernelVersion,
    };
  });
}
