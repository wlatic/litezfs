import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { accessSync, constants } from 'node:fs';

const execFileAsync = promisify(execFileCb);

/** Maximum output buffer size (10MB) */
const MAX_BUFFER = 10 * 1024 * 1024;

/** Default command timeout (30 seconds) */
const DEFAULT_TIMEOUT = 30_000;

export interface ExecResult {
  ok: true;
  stdout: string;
  stderr: string;
}

export interface ExecError {
  ok: false;
  error: string;
  command: string;
}

/** Resolved command paths, detected at startup */
const resolvedPaths: Record<string, string> = {};

/** Search paths for ZFS/SMART binaries */
const SEARCH_PATHS: Record<string, string[]> = {
  zfs: ['/sbin/zfs', '/usr/sbin/zfs', '/usr/local/sbin/zfs'],
  zpool: ['/sbin/zpool', '/usr/sbin/zpool', '/usr/local/sbin/zpool'],
  smartctl: ['/usr/sbin/smartctl', '/usr/local/sbin/smartctl', '/sbin/smartctl'],
};

/** Detect which paths exist for each command */
export function detectCommandPaths(): void {
  for (const [cmd, paths] of Object.entries(SEARCH_PATHS)) {
    for (const p of paths) {
      try {
        accessSync(p, constants.X_OK);
        resolvedPaths[cmd] = p;
        break;
      } catch {
        // not found at this path
      }
    }
    if (!resolvedPaths[cmd]) {
      console.warn(`[exec] Command '${cmd}' not found in: ${paths.join(', ')}`);
    }
  }
}

/** Check if a specific command is available */
export function isCommandAvailable(cmd: string): boolean {
  return cmd in resolvedPaths;
}

/** Get the resolved path for a command */
export function getCommandPath(cmd: string): string | undefined {
  return resolvedPaths[cmd];
}

/**
 * Safely execute a system command via sudo + execFile.
 * Only whitelisted commands are allowed. Never uses shell interpolation.
 */
export async function safeExec(
  cmd: string,
  args: string[],
  options?: { timeout?: number },
): Promise<ExecResult | ExecError> {
  const fullPath = resolvedPaths[cmd];
  if (!fullPath) {
    return { ok: false, error: `Command '${cmd}' not available`, command: `${cmd} ${args.join(' ')}` };
  }

  // Validate args — no shell metacharacters
  for (const arg of args) {
    if (/[;&|`$(){}]/.test(arg)) {
      return {
        ok: false,
        error: 'Invalid argument: contains shell metacharacters',
        command: `${cmd} ${args.join(' ')}`,
      };
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync('sudo', [fullPath, ...args], {
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
      maxBuffer: MAX_BUFFER,
    });
    return { ok: true, stdout, stderr };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string; stdout?: string };
    // Some commands (smartctl) return non-zero exit codes but still produce valid output
    if (error.stdout) {
      return { ok: true, stdout: error.stdout, stderr: error.stderr ?? '' };
    }
    return {
      ok: false,
      error: error.stderr || error.message || 'Command failed',
      command: `sudo ${fullPath} ${args.join(' ')}`,
    };
  }
}

// Auto-detect on module load
detectCommandPaths();
