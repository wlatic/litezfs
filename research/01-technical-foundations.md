# LiteZFS — Technical Foundations Research

**Date:** 2026-03-12
**Purpose:** Research document for building a lightweight web-based ZFS management UI with embedded terminal and AI assistant.

---

## 1. ZFS CLI Output Formats & Parsing

### Key Parsing Flags

ZFS provides three critical flags that make parsing reliable:

| Flag | Effect | Use case |
|------|--------|----------|
| `-H` | Tab-separated output, no headers | Scripting mode — machine parsing |
| `-o` | Select specific columns | Reduce output to needed fields |
| `-p` | Parseable (exact byte values, no units) | Avoid parsing "1.5T" → use raw bytes |

**Golden rule:** Always use `-Hp` together for reliable parsing. Never parse human-readable output.

### 1.1 `zpool list` — Pool Overview

**Human-readable:**
```
NAME    SIZE  ALLOC   FREE  CKPOINT  EXPANDSZ   FRAG    CAP  DEDUP    HEALTH  ALTROOT
zfs    14.5T  7.23T  7.30T        -         -     8%    49%  1.00x    ONLINE  -
tank    1.8T   900G   950G        -         -     3%    48%  1.00x    ONLINE  -
```

**Scripting mode (`-Hp`):**
```
zfs\t15946456408064\t7950516674560\t7995939733504\t-\t-\t8\t49\t1.00\tONLINE\t-
tank\t1978511958016\t966367641600\t1012144316416\t-\t-\t3\t48\t1.00\tONLINE\t-
```

**Recommended columns:** `-o name,size,allocated,free,fragmentation,capacity,dedup,health`

**TypeScript parser:**
```typescript
interface Pool {
  name: string;
  size: number;       // bytes
  allocated: number;
  free: number;
  fragmentation: number; // percentage
  capacity: number;      // percentage
  dedup: number;
  health: 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED';
}

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
      health: health as Pool['health'],
    };
  });
}

// Command: zpool list -Hpo name,size,allocated,free,fragmentation,capacity,dedup,health
```

### 1.2 `zpool list -v` — VDev Details

**Human-readable:**
```
NAME                                      SIZE  ALLOC   FREE  CKPOINT  EXPANDSZ   FRAG    CAP  DEDUP    HEALTH  ALTROOT
zfs                                      14.5T  7.23T  7.30T        -         -     8%    49%  1.00x    ONLINE  -
  mirror-0                               7.27T  3.62T  3.65T        -         -     8%    49%      -    ONLINE
    ata-WDC_WD80EFZZ-68BTXN0_WD-CA0xxxxx     -      -      -        -         -      -      -      -    ONLINE
    ata-WDC_WD80EFZZ-68BTXN0_WD-CA0yyyyy     -      -      -        -         -      -      -      -    ONLINE
  mirror-1                               7.27T  3.61T  3.66T        -         -     8%    49%      -    ONLINE
    ata-ST8000DM004-2U9188_ZR1xxxxx          -      -      -        -         -      -      -      -    ONLINE
    ata-ST8000DM004-2U9188_ZR1yyyyy          -      -      -        -         -      -      -      -    ONLINE
```

**Scripting mode (`-vHp`):** Tab-separated but with leading tabs for indentation hierarchy.

**Parsing strategy:** The indentation (leading tabs) indicates hierarchy: pool → vdev type → disk. Count leading tabs to determine the nesting level.

```typescript
interface VDev {
  name: string;
  type: 'mirror' | 'raidz1' | 'raidz2' | 'raidz3' | 'stripe' | 'disk' | 'spare' | 'log' | 'cache' | 'special';
  size?: number;
  allocated?: number;
  free?: number;
  health: string;
  children: VDev[];
}

function parseZpoolListV(stdout: string): Record<string, VDev[]> {
  const pools: Record<string, VDev[]> = {};
  let currentPool = '';
  let currentVdev: VDev | null = null;

  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const depth = line.match(/^\t*/)?.[0].length ?? 0;
    const fields = line.trim().split('\t');
    const name = fields[0];

    if (depth === 0) {
      // Pool level
      currentPool = name;
      pools[currentPool] = [];
    } else if (depth === 1) {
      // VDev level (mirror-0, raidz1-0, etc.)
      const type = name.replace(/-\d+$/, '') as VDev['type'];
      currentVdev = {
        name,
        type,
        size: fields[1] !== '-' ? Number(fields[1]) : undefined,
        allocated: fields[2] !== '-' ? Number(fields[2]) : undefined,
        free: fields[3] !== '-' ? Number(fields[3]) : undefined,
        health: fields[9] || 'ONLINE',
        children: [],
      };
      pools[currentPool].push(currentVdev);
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
  return pools;
}
```

### 1.3 `zpool status` — Detailed Pool Status

This is the **hardest to parse** — it's free-form text with no `-H` mode. The output includes a config tree with scan status, error counts, and special messages.

**Example output:**
```
  pool: zfs
 state: ONLINE
  scan: scrub repaired 0B in 12:34:56 with 0 errors on Sun Mar  8 00:24:01 2026
config:

        NAME                                      STATE     READ WRITE CKSUM
        zfs                                       ONLINE       0     0     0
          mirror-0                                ONLINE       0     0     0
            ata-WDC_WD80EFZZ-68BTXN0_WD-CA0xxxxx  ONLINE       0     0     0
            ata-WDC_WD80EFZZ-68BTXN0_WD-CA0yyyyy  ONLINE       0     0     0
          mirror-1                                ONLINE       0     0     0
            ata-ST8000DM004-2U9188_ZR1xxxxx        ONLINE       0     0     0
            ata-ST8000DM004-2U9188_ZR1yyyyy        ONLINE       0     0     0

errors: No known data errors
```

**Parsing strategy:** Use regex-based section parsing:

```typescript
interface PoolStatus {
  name: string;
  state: string;
  scan: string;
  config: StatusDevice[];
  errors: string;
}

interface StatusDevice {
  name: string;
  state: string;
  read: number;
  write: number;
  cksum: number;
  children: StatusDevice[];
}

function parseZpoolStatus(stdout: string): PoolStatus[] {
  const pools: PoolStatus[] = [];
  // Split by "pool:" lines to handle multiple pools
  const poolBlocks = stdout.split(/(?=\s*pool:)/g).filter(b => b.trim());

  for (const block of poolBlocks) {
    const nameMatch = block.match(/pool:\s+(\S+)/);
    const stateMatch = block.match(/state:\s+(\S+)/);
    const scanMatch = block.match(/scan:\s+(.+?)(?=\nconfig:|$)/s);
    const errorsMatch = block.match(/errors:\s+(.+?)$/m);

    // Parse config section — use indentation (2-space units) for hierarchy
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
          children: [],
        };

        // Find parent by indentation
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
      state: stateMatch?.[1] ?? '',
      scan: scanMatch?.[1]?.trim() ?? '',
      config: devices,
      errors: errorsMatch?.[1] ?? '',
    });
  }
  return pools;
}
```

**Note:** `zpool status` is primarily for display — use `zpool list -Hp` for structured data and `zpool status` for the device tree and scan/error details only.

### 1.4 `zpool iostat` — I/O Statistics

**Human-readable:**
```
              capacity     operations     bandwidth
pool        alloc   free   read  write   read  write
----------  -----  -----  -----  -----  -----  -----
zfs         7.23T  7.30T     45     12  1.23M   456K
```

**Scripting mode (`-Hp`):**
```
zfs\t7950516674560\t7995939733504\t45\t12\t1289748\t466944
```

**Continuous mode (`-Hp 5`):** Outputs every 5 seconds — useful for live dashboard updates.

```typescript
interface PoolIOStat {
  name: string;
  alloc: number;
  free: number;
  readOps: number;
  writeOps: number;
  readBw: number;   // bytes/sec
  writeBw: number;  // bytes/sec
}

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

// Command: zpool iostat -Hp
// For continuous: spawn child process with `zpool iostat -Hp 5` and stream lines
```

### 1.5 `zfs list` — Dataset Listing

**Scripting mode (`-Hpo name,used,avail,refer,mountpoint`):**
```
zfs\t7950516674560\t7995939733504\t425984\t/zfs
zfs/backups\t2199023255552\t7995939733504\t2199023255552\t/zfs/backups
zfs/claude\t536870912000\t7995939733504\t536870912000\t/zfs/claude
```

```typescript
interface Dataset {
  name: string;
  used: number;
  available: number;
  refer: number;
  mountpoint: string;
}

function parseZfsList(stdout: string): Dataset[] {
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [name, used, avail, refer, mountpoint] = line.split('\t');
    return {
      name,
      used: Number(used),
      available: Number(avail),
      refer: Number(refer),
      mountpoint,
    };
  });
}

// Command: zfs list -Hpo name,used,avail,refer,mountpoint
```

### 1.6 `zfs list -t snapshot` — Snapshot Listing

**Scripting mode (`-Hpt snapshot -o name,used,refer,creation`):**
```
zfs/data@autosnap_2026-03-12\t1048576\t536870912000\t1710201600
zfs/data@manual-backup\t0\t536870912000\t1710288000
```

```typescript
interface Snapshot {
  dataset: string;
  name: string;
  used: number;
  refer: number;
  creation: Date;
}

function parseZfsSnapshots(stdout: string): Snapshot[] {
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [fullName, used, refer, creation] = line.split('\t');
    const [dataset, snapName] = fullName.split('@');
    return {
      dataset,
      name: snapName,
      used: Number(used),
      refer: Number(refer),
      creation: new Date(Number(creation) * 1000),
    };
  });
}

// Command: zfs list -Hpt snapshot -o name,used,refer,creation
```

### 1.7 `zfs get` — Properties

**Scripting mode (`-Hp all <dataset>`):**
```
zfs/data\ttype\tfilesystem\t-
zfs/data\tcreation\t1710201600\t-
zfs/data\tused\t536870912000\t-
zfs/data\tavailable\t7995939733504\t-
zfs/data\tcompression\tlz4\tlocal
zfs/data\tquota\t0\tdefault
```

Format: `dataset\tproperty\tvalue\tsource`

```typescript
interface ZfsProperty {
  name: string;
  value: string;
  source: string; // 'local' | 'default' | 'inherited' | '-'
}

function parseZfsProperties(stdout: string): Record<string, ZfsProperty> {
  const props: Record<string, ZfsProperty> = {};
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const [_dataset, name, value, source] = line.split('\t');
    props[name] = { name, value, source };
  }
  return props;
}

// Command: zfs get -Hp all <dataset>
```

### 1.8 `smartctl` — Disk Health

**`smartctl --scan` output:**
```
/dev/sda -d sat # /dev/sda [SAT], ATA device
/dev/sdb -d sat # /dev/sdb [SAT], ATA device
/dev/sdc -d sat # /dev/sdc [SAT], ATA device
```

**Key insight: smartctl supports `-j` (JSON output)!** This is far superior to parsing text.

**`smartctl -j --scan`:**
```json
{
  "devices": [
    { "name": "/dev/sda", "info_name": "/dev/sda [SAT]", "type": "sat", "protocol": "ATA" },
    { "name": "/dev/sdb", "info_name": "/dev/sdb [SAT]", "type": "sat", "protocol": "ATA" }
  ]
}
```

**`smartctl -j -a /dev/sda`:**
```json
{
  "model_name": "WDC WD80EFZZ-68BTXN0",
  "serial_number": "WD-CA0xxxxx",
  "firmware_version": "83.H0A83",
  "user_capacity": { "bytes": 8001563222016 },
  "rotation_rate": 5400,
  "smart_status": { "passed": true },
  "temperature": { "current": 35 },
  "power_on_time": { "hours": 24567 },
  "power_cycle_count": 42,
  "ata_smart_attributes": {
    "table": [
      {
        "id": 5,
        "name": "Reallocated_Sector_Ct",
        "value": 100,
        "worst": 100,
        "thresh": 10,
        "raw": { "value": 0 }
      },
      {
        "id": 197,
        "name": "Current_Pending_Sector",
        "value": 100,
        "worst": 100,
        "thresh": 0,
        "raw": { "value": 0 }
      }
    ]
  },
  "ata_smart_error_log": { "count": 0 }
}
```

**TypeScript parser — trivial with JSON mode:**
```typescript
interface DiskHealth {
  device: string;
  model: string;
  serial: string;
  capacity: number;
  temperature: number;
  powerOnHours: number;
  smartPassed: boolean;
  reallocatedSectors: number;
  pendingSectors: number;
}

async function getDiskHealth(device: string): Promise<DiskHealth> {
  const { stdout } = await exec(`smartctl -j -a ${device}`);
  const data = JSON.parse(stdout);

  const findAttr = (id: number) =>
    data.ata_smart_attributes?.table?.find((a: any) => a.id === id)?.raw?.value ?? 0;

  return {
    device,
    model: data.model_name ?? 'Unknown',
    serial: data.serial_number ?? '',
    capacity: data.user_capacity?.bytes ?? 0,
    temperature: data.temperature?.current ?? 0,
    powerOnHours: data.power_on_time?.hours ?? 0,
    smartPassed: data.smart_status?.passed ?? false,
    reallocatedSectors: findAttr(5),
    pendingSectors: findAttr(197),
  };
}

// Command: smartctl -j -a /dev/sdX  (requires root/sudo)
```

### 1.9 Parsing Summary

| Command | Best flags | Format | Difficulty |
|---------|-----------|--------|------------|
| `zpool list` | `-Hpo <cols>` | Tab-separated | Easy |
| `zpool list -v` | `-vHp` | Tab-separated with depth | Medium |
| `zpool status` | (none available) | Free-form text | Hard |
| `zpool iostat` | `-Hp [interval]` | Tab-separated | Easy |
| `zfs list` | `-Hpo <cols>` | Tab-separated | Easy |
| `zfs list -t snapshot` | `-Hpt snapshot -o <cols>` | Tab-separated | Easy |
| `zfs get` | `-Hp all <dataset>` | Tab-separated (4 fields) | Easy |
| `smartctl --scan` | `-j` | JSON | Trivial |
| `smartctl -a` | `-j` | JSON | Trivial |

---

## 2. xterm.js + node-pty Integration

### Architecture

```
Browser (xterm.js) ←→ WebSocket ←→ Node.js Server ←→ node-pty (PTY process)
```

### Server-Side Implementation

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { IncomingMessage } from 'http';

interface TerminalSession {
  pty: pty.IPty;
  ws: WebSocket;
}

const sessions = new Map<string, TerminalSession>();

function createTerminalServer(server: http.Server, authMiddleware: (req: IncomingMessage) => boolean) {
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Auth check
    if (!authMiddleware(req)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const sessionId = crypto.randomUUID();
    const shell = process.env.SHELL || '/bin/bash';

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || '/root',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    // PTY → WebSocket
    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      ws.close(1000, `Shell exited with code ${exitCode}`);
      sessions.delete(sessionId);
    });

    // WebSocket → PTY
    ws.on('message', (msg: Buffer) => {
      const message = msg.toString();

      // Handle resize messages (JSON with type: 'resize')
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          ptyProcess.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON — regular terminal input
      }

      ptyProcess.write(message);
    });

    ws.on('close', () => {
      ptyProcess.kill();
      sessions.delete(sessionId);
    });

    sessions.set(sessionId, { pty: ptyProcess, ws });
  });

  return wss;
}
```

### Client-Side Implementation

```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

function createTerminal(containerId: string, wsUrl: string) {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'JetBrains Mono, Menlo, monospace',
    theme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  const container = document.getElementById(containerId)!;
  term.open(container);

  // Try WebGL for performance, fall back to canvas
  try {
    term.loadAddon(new WebglAddon());
  } catch {
    console.warn('WebGL not available, using canvas renderer');
  }

  fitAddon.fit();

  // WebSocket connection
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    // Send initial size
    ws.send(JSON.stringify({
      type: 'resize',
      cols: term.cols,
      rows: term.rows,
    }));
  };

  ws.onmessage = (event) => {
    term.write(event.data);
  };

  ws.onclose = (event) => {
    term.write(`\r\n\x1b[31mConnection closed: ${event.reason || 'unknown'}\x1b[0m\r\n`);
  };

  // Terminal → WebSocket
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
  });
  resizeObserver.observe(container);

  term.onResize(({ cols, rows }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  return { term, ws, fitAddon };
}
```

### Required Packages

```json
{
  "dependencies": {
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/addon-web-links": "^0.11.0",
    "node-pty": "^1.0.0",
    "ws": "^8.16.0"
  }
}
```

### Key Considerations

1. **Resize handling is critical** — without it, full-screen apps (vim, htop) break
2. **WebGL addon** dramatically improves rendering performance for busy terminals
3. **node-pty requires native compilation** — needs `node-gyp`, Python, and a C++ compiler at install time
4. **Security:** The terminal WebSocket MUST be authenticated — an open terminal is a root shell
5. **Flow control:** For high-throughput output, consider backpressure between PTY and WebSocket
6. **Message protocol:** Use a simple convention — plain strings are terminal I/O, JSON objects are control messages (resize, etc.)

---

## 3. Authentication Approaches

### Option A: Simple Session-Based Auth (Recommended for v1)

```typescript
import session from 'express-session';
import bcrypt from 'bcrypt';

// Single admin user, password stored hashed in config
interface AuthConfig {
  username: string;
  passwordHash: string;  // bcrypt hash
}

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (username === config.username && await bcrypt.compare(password, config.passwordHash)) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// WebSocket auth: validate session cookie on upgrade
server.on('upgrade', (req, socket, head) => {
  sessionParser(req, {} as any, () => {
    if (!req.session?.authenticated) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
});
```

**Pros:** Simple, no external dependencies, works everywhere
**Cons:** Single user, manual password setup

### Option B: PAM Authentication (Like Cockpit/WebZFS)

Uses the system's existing user accounts via Linux PAM.

```typescript
// Using node-linux-pam or authenticate-pam
import { authenticate } from 'authenticate-pam';

function pamLogin(username: string, password: string): Promise<boolean> {
  return new Promise((resolve) => {
    authenticate(username, password, (err) => {
      resolve(!err);
    });
  });
}
```

**Pros:** Uses existing system accounts, no separate user management
**Cons:** Requires running on Linux, needs PAM dev libraries, more complex setup

### Option C: Proxmox API Token (Future Enhancement)

Proxmox VE uses ticket-based auth with API tokens. Could integrate for users already running Proxmox:

```typescript
// Proxmox API auth
const ticket = await fetch('https://proxmox:8006/api2/json/access/ticket', {
  method: 'POST',
  body: new URLSearchParams({ username: 'user@pam', password: 'pass' }),
});
const { data: { ticket: token, CSRFPreventionToken } } = await ticket.json();
```

### Recommendation

**Start with Option A** (simple session auth with bcrypt). It's the simplest, has no native dependencies beyond node-pty, and covers the single-admin use case. Add PAM support later if multi-user is needed.

### What Competitors Do

| Tool | Auth Method |
|------|-------------|
| Cockpit | PAM (full Linux session, setuid helper) |
| WebZFS | PAM (Unix accounts) |
| ZfDash | Flask-Login with PBKDF2 hashing |
| Portainer | Built-in user database, LDAP, OAuth |

---

## 4. Competitive Analysis

### 4.1 WebZFS (Python/FastAPI/HTMX)

**GitHub:** webzfs/webzfs

**Architecture:**
- Backend: Python 3.11 + FastAPI + Uvicorn
- Frontend: HTMX + Tailwind CSS + Jinja2 templates
- Auth: PAM-based
- No database — reads ZFS state directly each time

**What works well:**
- HTMX approach keeps JavaScript minimal — server renders HTML fragments
- Read-mostly design is safe — can't accidentally destroy pools from UI
- PAM auth means no separate user management
- Clean separation: `services/` for ZFS command wrappers, `views/` for routes, `templates/` for UI
- Clever port choice: 26619 (Z=26, F=6, S=19)

**What to avoid:**
- No persistent state means no historical metrics/trends
- "You cannot delete pools or datasets with the UI" is too restrictive — users expect basic management
- CSS was initially poor quality (dev admitted using AI to rewrite to Tailwind)
- FreeBSD requires root execution — bad security model
- No embedded terminal

**Lessons for LiteZFS:**
- The HTMX pattern is elegant but may limit interactivity for real-time dashboards
- Read-only by default is wise — make destructive ops require confirmation
- Consider caching ZFS state briefly rather than re-running commands on every request

### 4.2 ZfDash (Python/Qt/Flask)

**GitHub:** ad4mts/zfdash

**Architecture:**
- Desktop: PySide6 (Qt) GUI
- Web: Flask + Bootstrap + Waitress
- Daemon: Privileged backend with polkit/pkexec authorization
- Client-daemon communication via Unix sockets/named pipes
- Agent mode for multi-host management

**What works well:**
- Proper privilege separation — daemon runs as root, clients are unprivileged
- Agent mode with mDNS discovery for multi-host management
- Comprehensive feature set: replication, encryption management, send/receive
- Challenge-Response auth for agent connections
- Cross-platform (Linux, macOS, FreeBSD)

**What to avoid:**
- Dual GUI (Qt + Web) means maintaining two UIs — pick one
- Complex daemon architecture is overkill for a lightweight tool
- PySide6/Qt dependency is heavy and hard to package
- Over-engineered for the "lite" use case

**Lessons for LiteZFS:**
- Privilege separation is important — run the server with minimal sudo permissions
- Send/receive replication is a killer feature users want
- Agent mode is scope creep for v1 — avoid it

### 4.3 45Drives cockpit-zfs (Vue.js/Python/Cockpit)

**GitHub:** 45Drives/cockpit-zfs

**Architecture:**
- Frontend: Vue.js + TypeScript
- Backend: Python scripts executing ZFS commands
- Platform: Cockpit plugin (requires Cockpit framework)
- Build: Yarn + Makefile
- Shared components from `houston-common` submodule

**What works well:**
- Vue.js provides rich, reactive UI
- Cockpit integration gives free auth, terminal, system overview
- Well-structured as a Cockpit plugin — focused on ZFS management only
- 45Drives is a real storage company — battle-tested patterns

**What to avoid:**
- Cockpit dependency — requires users to install and run Cockpit
- `houston-common` submodule ties it to 45Drives ecosystem
- Complex build system (Makefile + Yarn + Vue CLI)
- Heavy dependency chain

**Lessons for LiteZFS:**
- Vue.js/TypeScript is a good frontend choice but may be heavy for "lite"
- Cockpit's approach of being a platform with plugins is powerful but not "lite"
- The ZFS command wrapping patterns in Python are worth studying

### 4.4 Competitive Landscape Summary

| Feature | WebZFS | ZfDash | cockpit-zfs | **LiteZFS (target)** |
|---------|--------|--------|-------------|---------------------|
| Language | Python | Python | Vue+Python | **TypeScript (full stack)** |
| Frontend | HTMX | Flask/Qt | Vue.js | **Lightweight (see rec below)** |
| Terminal | No | No | Via Cockpit | **Built-in (xterm.js)** |
| AI Assistant | No | No | No | **Yes** |
| Auth | PAM | Custom | Cockpit/PAM | **Session (v1), PAM (v2)** |
| Destructive ops | Blocked | Full | Full | **With confirmation** |
| Dependencies | Python+FastAPI | Python+Qt+Flask | Cockpit+Vue | **Node.js only** |
| Install complexity | Medium | High | High (needs Cockpit) | **Low (single binary/npm)** |

**LiteZFS differentiators:**
1. Built-in terminal (no separate SSH needed)
2. AI assistant for ZFS operations
3. Single-language stack (TypeScript everywhere)
4. Minimal dependencies
5. Modern, responsive UI without a heavy framework

---

## 5. Technology Stack Recommendations

### Recommended Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Runtime** | Node.js 20+ (LTS) | Stable, native node-pty support, TypeScript-first |
| **Language** | TypeScript | Type safety for CLI parsing, shared types client/server |
| **Server** | Express.js or Fastify | Lightweight, WebSocket-compatible, huge ecosystem |
| **WebSocket** | `ws` library | De facto standard, lightweight, no Socket.io overhead |
| **Terminal** | xterm.js + node-pty | Industry standard, used by VS Code's terminal |
| **Frontend** | **htmx + vanilla JS** (see discussion) | Minimal JS, server-rendered, fast to build |
| **CSS** | **Tailwind CSS** (via CDN or CLI) | Utility-first, no custom CSS needed, great for dashboards |
| **Build** | esbuild or tsup | Fast TypeScript compilation, minimal config |
| **Auth** | express-session + bcrypt | Simple, no external deps for v1 |
| **Process** | child_process (exec/spawn) | Direct ZFS command execution |

### Frontend Approach: htmx vs Svelte vs Vanilla JS

**htmx (Recommended for v1):**
- Server renders HTML fragments — parsing logic stays server-side
- No build step for frontend
- Dashboard updates via `hx-trigger="every 5s"` for polling
- Terminal panel uses xterm.js directly (the one place where JS is needed)
- Fast development, small bundle

**Svelte (Alternative if more interactivity needed):**
- Compiled to vanilla JS — small bundle
- Reactive UI is great for real-time dashboards
- Better than React/Vue for a lightweight tool
- More complex build setup

**Vanilla JS (Not recommended):**
- Maximum control but more boilerplate
- No reactivity patterns — manual DOM updates
- Harder to maintain as features grow

### Project Structure

```
litezfs/
├── CLAUDE.md                  # Project docs and team structure
├── package.json
├── tsconfig.json
├── src/
│   ├── server/
│   │   ├── index.ts           # Entry point — Express + WebSocket setup
│   │   ├── auth.ts            # Session auth middleware
│   │   ├── terminal.ts        # node-pty + WebSocket bridge
│   │   ├── routes/
│   │   │   ├── api.ts         # JSON API endpoints
│   │   │   └── pages.ts       # HTML page routes (htmx)
│   │   └── services/
│   │       ├── zfs.ts         # ZFS command execution + parsing
│   │       ├── zpool.ts       # zpool command execution + parsing
│   │       ├── smart.ts       # smartctl integration
│   │       └── exec.ts        # Safe command execution wrapper
│   ├── shared/
│   │   └── types.ts           # Shared TypeScript interfaces
│   └── client/
│       ├── terminal.ts        # xterm.js setup
│       └── dashboard.ts       # Minimal JS for htmx enhancements
├── templates/                 # Jinja2-style or Handlebars templates
│   ├── layout.html
│   ├── dashboard.html
│   ├── pools.html
│   ├── datasets.html
│   ├── snapshots.html
│   ├── disks.html
│   └── terminal.html
├── public/
│   └── css/                   # Tailwind output
└── research/                  # This document
```

### Command Execution Safety

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// NEVER use exec() with string interpolation — command injection risk!
// Always use execFile() with argument arrays.

async function zfsCommand(cmd: 'zfs' | 'zpool' | 'smartctl', args: string[]): Promise<string> {
  // Whitelist allowed commands
  const allowedCommands = ['/sbin/zfs', '/sbin/zpool', '/usr/sbin/smartctl'];
  const fullPath = allowedCommands.find(p => p.endsWith(cmd));
  if (!fullPath) throw new Error(`Unknown command: ${cmd}`);

  const { stdout } = await execFileAsync('sudo', [fullPath, ...args], {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024, // 10MB for large property lists
  });
  return stdout;
}
```

---

## 6. Key Design Decisions

### 6.1 Polling vs WebSocket for Dashboard Updates

**Recommendation: htmx polling for dashboard, WebSocket only for terminal.**

- Dashboard data (pool status, disk health) changes infrequently — polling every 5-10 seconds is fine
- htmx makes polling trivial: `hx-get="/api/pools" hx-trigger="every 5s"`
- WebSocket adds complexity for marginal benefit on read-only dashboards
- Reserve WebSocket for the terminal (which genuinely needs bidirectional streaming)
- `zpool iostat -Hp 5` can be streamed over WebSocket for live I/O graphs if needed later

### 6.2 sudo Strategy

LiteZFS needs root access for ZFS and smartctl commands. Options:

1. **Run server as root** — simplest but worst security
2. **sudo with NOPASSWD for specific commands** — recommended

```sudoers
# /etc/sudoers.d/litezfs
litezfs ALL=(ALL) NOPASSWD: /sbin/zfs list *, /sbin/zfs get *, /sbin/zfs snapshot *, /sbin/zfs rollback *, /sbin/zpool list *, /sbin/zpool status *, /sbin/zpool iostat *, /usr/sbin/smartctl *
```

Run the server as a dedicated `litezfs` user with these specific sudo permissions.

### 6.3 Caching

ZFS commands are fast but not free. Cache strategy:
- Pool/dataset listings: cache for 5 seconds
- Properties: cache for 30 seconds
- SMART data: cache for 5 minutes (SMART reads are slow)
- Invalidate cache on write operations (snapshot create, property set)

### 6.4 Error Handling for CLI Commands

```typescript
async function safeExec(cmd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('sudo', [cmd, ...args], { timeout: 30000 });
    if (stderr && !stdout) return { ok: false, error: stderr };
    return { ok: true, stdout };
  } catch (err: any) {
    return { ok: false, error: err.stderr || err.message };
  }
}
```

---

## 7. References

- [xterm.js documentation](https://xtermjs.org/)
- [node-pty GitHub](https://github.com/microsoft/node-pty)
- [WebZFS GitHub](https://github.com/webzfs/webzfs) — Python/FastAPI/HTMX ZFS management
- [ZfDash GitHub](https://github.com/ad4mts/zfdash) — Python/Qt ZFS management with agent mode
- [45Drives cockpit-zfs](https://github.com/45Drives/cockpit-zfs) — Vue.js Cockpit plugin
- [Cockpit authentication docs](https://cockpit-project.org/guide/latest/authentication)
- [node-zfs (Joyent)](https://github.com/TritonDataCenter/node-zfs) — Node.js ZFS wrapper
- [Web terminal tutorial (xterm.js + node-pty)](https://ashishpoudel.substack.com/p/web-terminal-with-xtermjs-node-pty)
- [Browser remote terminal gist](https://gist.github.com/GitSquared/2049d7e85eaddeeeaa44e8404fe0b0e1)
- [Poolsman — Cockpit ZFS plugin](https://www.poolsman.com/)
- [OpenZFS documentation](https://openzfs.github.io/openzfs-docs/)
