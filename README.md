# LiteZFS

Lightweight web-based ZFS management UI with an embedded terminal and AI assistant.

LiteZFS sits **on top of your existing Linux system** — no dedicated OS required. Unlike TrueNAS, it doesn't take over your machine. Install it on any Linux box running ZFS and get a modern dashboard for managing pools, datasets, snapshots, and disk health.

## Features

- **ZFS Dashboard** — pool overview with capacity bars, health status, alerts
- **Pool Management** — vdev tree visualization, scrub control, I/O stats, import/export
- **Dataset Management** — hierarchical view, create/destroy, set properties (compression, quota, etc.)
- **Snapshot Management** — create, rollback, destroy, batch operations, filter by dataset
- **Disk Health** — SMART monitoring with temperature, power-on hours, error tracking
- **Web Terminal** — full xterm.js terminal in your browser (no SSH client needed)
- **Alerts** — degraded pools, SMART warnings, low space, overdue scrubs
- **Scheduled Tasks** — auto-snapshots with retention, scrub scheduling
- **Dark Theme** — modern dashboard UI built with Tailwind CSS and htmx

## Screenshots

*Coming soon*

## Quick Start

```bash
git clone https://github.com/wlatic/litezfs.git
cd litezfs
npm install
npm run build
npm run dev
```

Open http://localhost:26619 — login with `admin` / `litezfs`

On systems without ZFS, the dashboard runs with realistic mock data for development.

## Production Deployment

1. Create a dedicated system user:
```bash
sudo useradd -r -s /bin/false litezfs
```

2. Install sudoers rules (read-only ZFS + smartctl access):
```bash
sudo cp install/litezfs-sudoers /etc/sudoers.d/litezfs
```

3. Configure:
```bash
sudo mkdir -p /etc/litezfs
sudo cp config/litezfs.example.yaml /etc/litezfs/config.yaml
# Edit config — set a real password hash, bind address, etc.
```

4. Install systemd service:
```bash
sudo cp install/litezfs.service /etc/systemd/system/
sudo systemctl enable --now litezfs
```

## Stack

| Component | Technology |
|-----------|-----------|
| Server | Node.js + Express |
| Frontend | EJS templates + htmx + Tailwind CSS (CDN) |
| Terminal | xterm.js + node-pty |
| WebSocket | ws |
| Auth | express-session + bcrypt |
| ZFS interaction | CLI wrapping via `execFile` (never `exec`) |

## Architecture

LiteZFS wraps ZFS CLI tools (`zfs`, `zpool`, `smartctl`) — it reads live system state directly with no middleware database. This means:

- No state desync (unlike TrueNAS middleware)
- No database to corrupt or migrate
- What you see is what's actually on disk

All commands use `execFile` with argument arrays (never shell interpolation) and a dedicated sudoers file with minimal permissions.

## Requirements

- Node.js 20+
- Linux with ZFS (OpenZFS)
- `smartctl` (smartmontools) for disk health monitoring

## Configuration

See `config/litezfs.example.yaml` for all options including:

- Server port and bind address
- Auth credentials
- Scheduled snapshot and scrub jobs
- Alert thresholds (space, temperature, scrub age)
- Cache TTLs

## License

MIT
