import type { Disk, DiskHealth, SmartAttribute } from '../../shared/types.js';
import { safeExec, isCommandAvailable } from './exec.js';
import { cache } from './cache.js';

// Cache TTL (seconds) — SMART reads are slow
const SMART_TTL = 300;
const DISK_LIST_TTL = 60;

// ==========================================================================
// Mock data fallback
// ==========================================================================

let useMock = false;

/** Detect if smartctl is available. Call once at startup. */
export async function init(): Promise<void> {
  if (!isCommandAvailable('smartctl')) {
    useMock = true;
    console.warn('[litezfs] smartctl not available, using mock data for disk health');
    return;
  }
  const result = await safeExec('smartctl', ['--version']);
  useMock = !result.ok;
  if (useMock) {
    console.warn('[litezfs] smartctl failed, using mock data for disk health');
  }
}

function mockDisks(): Disk[] {
  const mkAttr = (id: number, name: string, value: number, worst: number, thresh: number, rawValue: number, flags: string): SmartAttribute =>
    ({ id, name, value, worst, thresh, rawValue, flags });

  return [
    { device: '/dev/sda', model: 'WDC WD80EFZZ-68BTXN0', serial: 'WD-CA0A1234', firmware: '83.H0A83', capacity: 8001563222016, rotationRate: 5400, transport: 'SAT', zpoolMember: 'zfs',
      health: { passed: true, temperature: 34, powerOnHours: 24567, powerCycleCount: 42, reallocatedSectors: 0, pendingSectors: 0, offlineUncorrectable: 0, errorCount: 0,
        attributes: [mkAttr(1, 'Raw_Read_Error_Rate', 200, 200, 51, 0, 'POSR-K'), mkAttr(5, 'Reallocated_Sector_Ct', 200, 200, 140, 0, 'PO--CK'), mkAttr(9, 'Power_On_Hours', 89, 89, 0, 24567, '-O--CK'), mkAttr(194, 'Temperature_Celsius', 117, 108, 0, 34, '-O---K'), mkAttr(197, 'Current_Pending_Sector', 200, 200, 0, 0, '-O--CK')] }},
    { device: '/dev/sdb', model: 'WDC WD80EFZZ-68BTXN0', serial: 'WD-CA0A5678', firmware: '83.H0A83', capacity: 8001563222016, rotationRate: 5400, transport: 'SAT', zpoolMember: 'zfs',
      health: { passed: true, temperature: 35, powerOnHours: 24570, powerCycleCount: 42, reallocatedSectors: 0, pendingSectors: 0, offlineUncorrectable: 0, errorCount: 0,
        attributes: [mkAttr(5, 'Reallocated_Sector_Ct', 200, 200, 140, 0, 'PO--CK'), mkAttr(9, 'Power_On_Hours', 89, 89, 0, 24570, '-O--CK'), mkAttr(194, 'Temperature_Celsius', 116, 108, 0, 35, '-O---K')] }},
    { device: '/dev/sdc', model: 'ST8000DM004-2U9188', serial: 'ZR1A1234', firmware: '0001', capacity: 8001563222016, rotationRate: 5400, transport: 'SAT', zpoolMember: 'zfs',
      health: { passed: true, temperature: 36, powerOnHours: 18234, powerCycleCount: 38, reallocatedSectors: 0, pendingSectors: 0, offlineUncorrectable: 0, errorCount: 0,
        attributes: [mkAttr(5, 'Reallocated_Sector_Ct', 100, 100, 10, 0, 'PO--CK'), mkAttr(194, 'Temperature_Celsius', 64, 48, 0, 36, '-O---K')] }},
    { device: '/dev/sdd', model: 'ST8000DM004-2U9188', serial: 'ZR1A5678', firmware: '0001', capacity: 8001563222016, rotationRate: 5400, transport: 'SAT', zpoolMember: 'zfs',
      health: { passed: true, temperature: 37, powerOnHours: 18240, powerCycleCount: 38, reallocatedSectors: 2, pendingSectors: 0, offlineUncorrectable: 0, errorCount: 0,
        attributes: [mkAttr(5, 'Reallocated_Sector_Ct', 100, 100, 10, 2, 'PO--CK'), mkAttr(194, 'Temperature_Celsius', 63, 47, 0, 37, '-O---K')] }},
    { device: '/dev/sde', model: 'Samsung SSD 870 EVO 2TB', serial: 'S1234', firmware: 'SVT02B6Q', capacity: 2000398934016, rotationRate: 0, transport: 'SAT', zpoolMember: 'tank',
      health: { passed: true, temperature: 31, powerOnHours: 8760, powerCycleCount: 120, reallocatedSectors: 0, pendingSectors: 0, offlineUncorrectable: 0, errorCount: 0,
        attributes: [mkAttr(5, 'Reallocated_Sector_Ct', 100, 100, 10, 0, 'PO--CK'), mkAttr(194, 'Temperature_Celsius', 69, 56, 0, 31, '-O---K')] }},
    { device: '/dev/sdf', model: 'Samsung SSD 870 EVO 2TB', serial: 'S5678', firmware: 'SVT02B6Q', capacity: 2000398934016, rotationRate: 0, transport: 'SAT', zpoolMember: 'tank',
      health: { passed: true, temperature: 30, powerOnHours: 8755, powerCycleCount: 118, reallocatedSectors: 0, pendingSectors: 0, offlineUncorrectable: 0, errorCount: 0,
        attributes: [mkAttr(5, 'Reallocated_Sector_Ct', 100, 100, 10, 0, 'PO--CK'), mkAttr(194, 'Temperature_Celsius', 70, 57, 0, 30, '-O---K')] }},
  ];
}

// ==========================================================================
// Parsers — smartctl uses -j (JSON mode)
// ==========================================================================

/** Parse smartctl -j --scan output */
function parseScanOutput(stdout: string): { name: string; type: string }[] {
  try {
    const data = JSON.parse(stdout);
    return (data.devices ?? []).map((d: { name: string; type: string }) => ({
      name: d.name,
      type: d.type ?? 'sat',
    }));
  } catch {
    console.error('[smart] Failed to parse scan output');
    return [];
  }
}

/** Parse smartctl -j -a /dev/sdX output into DiskHealth */
function parseSmartInfo(stdout: string): {
  model: string;
  serial: string;
  firmware: string;
  capacity: number;
  rotationRate: number;
  transport: string;
  health: DiskHealth;
} | null {
  try {
    const data = JSON.parse(stdout);

    const findAttr = (id: number): number => {
      const attr = data.ata_smart_attributes?.table?.find((a: { id: number }) => a.id === id);
      return attr?.raw?.value ?? 0;
    };

    const attributes: SmartAttribute[] = (data.ata_smart_attributes?.table ?? []).map(
      (a: { id: number; name: string; value: number; worst: number; thresh: number; raw: { value: number }; flags: { string: string } }) => ({
        id: a.id,
        name: a.name ?? `Attribute_${a.id}`,
        value: a.value ?? 0,
        worst: a.worst ?? 0,
        thresh: a.thresh ?? 0,
        rawValue: a.raw?.value ?? 0,
        flags: a.flags?.string ?? '',
      }),
    );

    return {
      model: data.model_name ?? 'Unknown',
      serial: data.serial_number ?? '',
      firmware: data.firmware_version ?? '',
      capacity: data.user_capacity?.bytes ?? 0,
      rotationRate: data.rotation_rate ?? 0,
      transport: data.device?.type ?? 'sat',
      health: {
        passed: data.smart_status?.passed ?? true,
        temperature: data.temperature?.current ?? 0,
        powerOnHours: data.power_on_time?.hours ?? 0,
        powerCycleCount: data.power_cycle_count ?? 0,
        reallocatedSectors: findAttr(5),
        pendingSectors: findAttr(197),
        offlineUncorrectable: findAttr(198),
        errorCount: data.ata_smart_error_log?.summary?.count ?? 0,
        attributes,
      },
    };
  } catch (err) {
    console.error('[smart] Failed to parse SMART info:', err);
    return null;
  }
}

// ==========================================================================
// Pool membership correlation
// ==========================================================================

/** Map disk serials/IDs to pool names using zpool status output */
async function getPoolMembership(): Promise<Map<string, string>> {
  const membership = new Map<string, string>();

  const result = await safeExec('zpool', ['status']);
  if (!result.ok) return membership;

  let currentPool = '';
  for (const line of result.stdout.split('\n')) {
    const poolMatch = line.match(/^\s*pool:\s+(\S+)/);
    if (poolMatch) {
      currentPool = poolMatch[1];
      continue;
    }
    // Lines in config section with disk IDs
    const trimmed = line.trim();
    if (currentPool && trimmed && !trimmed.startsWith('NAME') && !trimmed.startsWith('pool:') &&
        !trimmed.startsWith('state:') && !trimmed.startsWith('scan:') &&
        !trimmed.startsWith('config:') && !trimmed.startsWith('errors:') &&
        !trimmed.startsWith(currentPool)) {
      const diskName = trimmed.split(/\s+/)[0];
      // Match disk identifiers (ata-, scsi-, nvme-, sd*, etc.)
      if (diskName && (diskName.startsWith('ata-') || diskName.startsWith('scsi-') ||
          diskName.startsWith('nvme-') || diskName.startsWith('wwn-') ||
          /^sd[a-z]/.test(diskName) || /^nvme\d/.test(diskName))) {
        membership.set(diskName, currentPool);
      }
    }
  }

  return membership;
}

/** Try to match a disk device to a pool by checking serial/model against pool vdev names */
function findPoolForDisk(device: string, serial: string, membership: Map<string, string>): string | undefined {
  // Direct device name match (e.g., sda in pool status)
  const shortDevice = device.replace('/dev/', '');
  for (const [diskId, pool] of membership) {
    if (diskId === shortDevice || diskId.includes(serial)) {
      return pool;
    }
  }
  return undefined;
}

// ==========================================================================
// Service methods
// ==========================================================================

/** List all disks with SMART data */
export async function listDisks(): Promise<Disk[]> {
  if (useMock) return mockDisks();
  return cache.getOrSet('smart:disks', DISK_LIST_TTL, async () => {
    // Enumerate disks
    const scanResult = await safeExec('smartctl', ['-j', '--scan']);
    if (!scanResult.ok) {
      console.error('[smart] scan failed:', scanResult.error);
      return [];
    }

    const devices = parseScanOutput(scanResult.stdout);
    if (devices.length === 0) return [];

    // Get pool membership for correlation
    const membership = await getPoolMembership();

    // Fetch SMART data for each disk in parallel
    const disks = await Promise.all(
      devices.map(async (dev): Promise<Disk | null> => {
        const info = await getDiskSmartInfo(dev.name);
        if (!info) return null;

        const poolMember = findPoolForDisk(dev.name, info.serial, membership);

        return {
          device: dev.name,
          model: info.model,
          serial: info.serial,
          firmware: info.firmware,
          capacity: info.capacity,
          rotationRate: info.rotationRate,
          transport: info.transport,
          health: info.health,
          zpoolMember: poolMember,
        };
      }),
    );

    return disks.filter((d): d is Disk => d !== null);
  });
}

/** Get SMART info for a single disk (cached) */
async function getDiskSmartInfo(device: string): Promise<ReturnType<typeof parseSmartInfo>> {
  return cache.getOrSet(`smart:info:${device}`, SMART_TTL, async () => {
    const result = await safeExec('smartctl', ['-j', '-a', device]);
    // smartctl can return non-zero exit codes for warnings but still produce valid JSON
    const stdout = result.ok ? result.stdout : '';
    if (!stdout) {
      console.error(`[smart] getDiskSmartInfo(${device}) failed:`, result.ok ? 'empty output' : (result as { error: string }).error);
      return null;
    }
    return parseSmartInfo(stdout);
  });
}

/** Get a single disk by device name (e.g. "sda" or "/dev/sda") */
export async function getDisk(deviceName: string): Promise<Disk | undefined> {
  // Validate device path
  const fullPath = deviceName.startsWith('/dev/') ? deviceName : `/dev/${deviceName}`;
  if (!/^\/dev\/[a-zA-Z0-9]+$/.test(fullPath)) return undefined;

  const disks = await listDisks();
  return disks.find(d => d.device === fullPath || d.device === deviceName);
}
