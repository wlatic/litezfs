import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { randomBytes } from 'node:crypto';
import type { LiteZFSConfig } from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const DEFAULT_CONFIG: LiteZFSConfig = {
  server: {
    port: 26619,
    host: '0.0.0.0',
    sessionSecret: randomBytes(32).toString('hex'),
  },
  auth: {
    username: 'admin',
    passwordHash: '', // set at runtime if empty
  },
  scheduler: {
    snapshots: [],
    scrubs: [],
  },
  alerts: {
    spaceWarningPercent: 80,
    spaceCriticalPercent: 90,
    tempWarningCelsius: 50,
    tempCriticalCelsius: 60,
    scrubMaxAgeDays: 30,
  },
  cache: {
    poolListTtl: 5,
    datasetListTtl: 5,
    propertiesTtl: 30,
    smartTtl: 300,
    systemStatsTtl: 10,
  },
};

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetVal = result[key];
    const sourceVal = source[key];
    if (
      targetVal && sourceVal &&
      typeof targetVal === 'object' && !Array.isArray(targetVal) &&
      typeof sourceVal === 'object' && !Array.isArray(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

/** Load configuration from YAML file with fallback to defaults */
export function loadConfig(): LiteZFSConfig {
  const configPaths = [
    '/etc/litezfs/config.yaml',
    resolve(PROJECT_ROOT, 'config', 'litezfs.yaml'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const parsed = parseYaml(raw) as Record<string, unknown>;
        console.log(`[config] Loaded from ${configPath}`);
        return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed) as unknown as LiteZFSConfig;
      } catch (err) {
        console.warn(`[config] Failed to parse ${configPath}:`, err);
      }
    }
  }

  console.log('[config] No config file found, using defaults');
  return { ...DEFAULT_CONFIG };
}

export { PROJECT_ROOT };
