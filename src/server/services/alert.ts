import type { Alert, LiteZFSConfig } from '../../shared/types.js';
import * as zpoolService from './zpool.js';
import * as smartService from './smart.js';

const acknowledgedAlerts = new Set<string>();

// Configurable thresholds — set via init()
let thresholds = {
  spaceWarningPercent: 80,
  spaceCriticalPercent: 90,
  tempWarningCelsius: 50,
  tempCriticalCelsius: 60,
  scrubMaxAgeDays: 30,
};

/** Initialize alert thresholds from config */
export function init(config: LiteZFSConfig['alerts']): void {
  thresholds = { ...config };
}

/** Generate alerts from current pool and disk state */
export async function getAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const pools = await zpoolService.listPools();
  const disks = await smartService.listDisks();

  for (const pool of pools) {
    // Pool health alerts
    if (pool.health === 'DEGRADED') {
      alerts.push(makeAlert('warning', 'pool', `Pool '${pool.name}' is degraded`, `Pool '${pool.name}' is running in a degraded state. Check disk status.`, pool.name));
    } else if (pool.health === 'FAULTED') {
      alerts.push(makeAlert('critical', 'pool', `Pool '${pool.name}' is FAULTED`, `Pool '${pool.name}' has faulted and data may be at risk.`, pool.name));
    }

    // Space alerts
    if (pool.capacity >= thresholds.spaceCriticalPercent) {
      alerts.push(makeAlert('critical', 'space', `Pool '${pool.name}' at ${pool.capacity}% capacity`, `Pool '${pool.name}' is critically full. Free space immediately.`, pool.name));
    } else if (pool.capacity >= thresholds.spaceWarningPercent) {
      alerts.push(makeAlert('warning', 'space', `Pool '${pool.name}' at ${pool.capacity}% capacity`, `Pool '${pool.name}' is getting full. Consider freeing space.`, pool.name));
    }

    // Scrub age alerts — check via pool status
    const status = await zpoolService.getPoolStatus(pool.name);
    if (status?.scanParsed) {
      const { type, state, timestamp } = status.scanParsed;
      if (type === 'none') {
        alerts.push(makeAlert('info', 'scrub', `No scrub history for pool '${pool.name}'`, `Pool '${pool.name}' has never been scrubbed. Run a scrub to check data integrity.`, pool.name));
      } else if (state === 'completed' && timestamp) {
        const scrubDate = new Date(timestamp);
        if (!isNaN(scrubDate.getTime())) {
          const daysSinceScrub = Math.floor((Date.now() - scrubDate.getTime()) / (86400 * 1000));
          if (daysSinceScrub > thresholds.scrubMaxAgeDays) {
            alerts.push(makeAlert('info', 'scrub', `Scrub not run in ${daysSinceScrub} days on '${pool.name}'`, `Last scrub was ${daysSinceScrub} days ago. Consider running a scrub.`, pool.name));
          }
        }
      }
      if (status.scanParsed.errors > 0) {
        alerts.push(makeAlert('warning', 'scrub', `Scrub found ${status.scanParsed.errors} errors on '${pool.name}'`, `Last scrub on pool '${pool.name}' reported errors. Investigate immediately.`, pool.name));
      }
    }
  }

  for (const disk of disks) {
    // SMART health
    if (!disk.health.passed) {
      alerts.push(makeAlert('critical', 'smart', `Disk ${disk.device} SMART failed`, `${disk.model} (${disk.serial}) has failed SMART self-assessment.`, disk.device));
    }

    // Reallocated sectors
    if (disk.health.reallocatedSectors > 100) {
      alerts.push(makeAlert('critical', 'disk', `Disk ${disk.device} has ${disk.health.reallocatedSectors} reallocated sectors`, `${disk.model} (${disk.serial}) may be failing.`, disk.device));
    } else if (disk.health.reallocatedSectors > 0) {
      alerts.push(makeAlert('warning', 'disk', `Disk ${disk.device} has ${disk.health.reallocatedSectors} reallocated sectors`, `${disk.model} (${disk.serial}) shows early signs of wear.`, disk.device));
    }

    // Pending sectors
    if (disk.health.pendingSectors > 0) {
      alerts.push(makeAlert('warning', 'disk', `Disk ${disk.device} has ${disk.health.pendingSectors} pending sectors`, `${disk.model} (${disk.serial}) has pending sector reallocations.`, disk.device));
    }

    // Temperature
    if (disk.health.temperature > thresholds.tempCriticalCelsius) {
      alerts.push(makeAlert('critical', 'disk', `Disk ${disk.device} at ${disk.health.temperature}\u00B0C`, `${disk.model} is overheating. Check cooling.`, disk.device));
    } else if (disk.health.temperature > thresholds.tempWarningCelsius) {
      alerts.push(makeAlert('warning', 'disk', `Disk ${disk.device} at ${disk.health.temperature}\u00B0C`, `${disk.model} is running warm.`, disk.device));
    }
  }

  // Mark acknowledged
  for (const alert of alerts) {
    if (acknowledgedAlerts.has(alert.id)) {
      alert.acknowledged = true;
    }
  }

  return alerts;
}

/** Acknowledge an alert */
export function acknowledgeAlert(id: string): void {
  acknowledgedAlerts.add(id);
}

function makeAlert(
  severity: Alert['severity'],
  category: Alert['category'],
  title: string,
  message: string,
  source: string,
): Alert {
  // Deterministic ID based on content so it stays stable across refreshes
  const id = `${category}-${source}-${severity}`.replace(/[^a-z0-9-]/gi, '_');
  return {
    id,
    severity,
    category,
    title,
    message,
    source,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
}
