import { Router, type Request, type Response } from 'express';
import * as zpoolService from '../services/zpool.js';
import * as zfsService from '../services/zfs.js';
import * as smartService from '../services/smart.js';
import * as alertService from '../services/alert.js';
import * as systemService from '../services/system.js';
import * as helpers from '../views/helpers.js';

const router = Router();

// Inject helpers into all renders
function render(res: Response, page: string, data: Record<string, unknown> = {}) {
  res.render(page, { ...data, helpers, currentPath: (res.req as Request).path });
}

// ---- Page routes ----

router.get('/', async (_req: Request, res: Response) => {
  const pools = await zpoolService.listPools();
  const alerts = await alertService.getAlerts();
  render(res, 'pages/dashboard', { pools, alerts: alerts.filter(a => !a.acknowledged) });
});

router.get('/pools', async (_req: Request, res: Response) => {
  const pools = await zpoolService.listPools();
  render(res, 'pages/pools', { pools });
});

router.get('/pools/:name', async (req: Request, res: Response) => {
  const pool = await zpoolService.getPool(req.params.name);
  if (!pool) { res.redirect('/pools'); return; }
  const vdevs = await zpoolService.getPoolVDevs(req.params.name);
  const status = await zpoolService.getPoolStatus(req.params.name);
  const iostat = await zpoolService.getPoolIOStat(req.params.name);
  render(res, 'pages/pool-detail', { pool, vdevs, status, iostat });
});

router.get('/datasets', async (req: Request, res: Response) => {
  const pool = req.query.pool as string | undefined;
  const datasets = await zfsService.listDatasets(pool);
  const pools = await zpoolService.listPools();
  render(res, 'pages/datasets', { datasets, pools, selectedPool: pool });
});

router.get('/snapshots', async (req: Request, res: Response) => {
  const dataset = req.query.dataset as string | undefined;
  const snapshots = await zfsService.listSnapshots(dataset);
  const datasets = await zfsService.listDatasets();
  render(res, 'pages/snapshots', { snapshots, datasets, selectedDataset: dataset });
});

router.get('/disks', async (_req: Request, res: Response) => {
  const disks = await smartService.listDisks();
  render(res, 'pages/disks', { disks });
});

router.get('/terminal', (_req: Request, res: Response) => {
  render(res, 'pages/terminal');
});

router.get('/settings', async (_req: Request, res: Response) => {
  const stats = await systemService.getSystemStats();
  const config = {
    alerts: {
      spaceWarningPercent: 80,
      spaceCriticalPercent: 90,
      tempWarningCelsius: 50,
      tempCriticalCelsius: 60,
      scrubMaxAgeDays: 30,
    },
    scheduler: {
      snapshots: [
        { dataset: 'zfs/backups', schedule: '0 4 * * *', nameTemplate: 'autosnap_%Y-%m-%d', recursive: false, retain: 7 },
        { dataset: 'zfs/claude', schedule: '0 4 * * *', nameTemplate: 'autosnap_%Y-%m-%d', recursive: false, retain: 7 },
      ],
      scrubs: [
        { pool: 'zfs', schedule: '0 2 * * 0' },
        { pool: 'tank', schedule: '0 2 * * 0' },
      ],
    },
  };
  render(res, 'pages/settings', {
    config,
    systemInfo: { zfsVersion: stats.zfsVersion, kernelVersion: stats.kernelVersion },
  });
});

// ---- htmx partial routes ----

router.get('/partials/pool-cards', async (_req: Request, res: Response) => {
  const pools = await zpoolService.listPools();
  res.render('partials/pool-card', { pools, helpers });
});

router.get('/partials/alerts', async (_req: Request, res: Response) => {
  const alerts = (await alertService.getAlerts()).filter(a => !a.acknowledged);
  res.render('partials/alert-list', { alerts, helpers });
});

router.get('/partials/alert-count', async (_req: Request, res: Response) => {
  const alerts = (await alertService.getAlerts()).filter(a => !a.acknowledged);
  const count = alerts.length;
  if (count > 0) {
    res.send(`<span class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">${count}</span>`);
  } else {
    res.send('');
  }
});

router.get('/partials/system-stats', async (_req: Request, res: Response) => {
  const stats = await systemService.getSystemStats();
  res.render('partials/system-stats', { stats, helpers });
});

router.get('/partials/vdev-tree/:pool', async (req: Request, res: Response) => {
  const vdevs = await zpoolService.getPoolVDevs(req.params.pool);
  res.render('partials/vdev-tree', { vdevs: vdevs || [], helpers });
});

router.get('/partials/pool-iostat/:pool', async (req: Request, res: Response) => {
  const iostat = await zpoolService.getPoolIOStat(req.params.pool);
  res.render('partials/pool-iostat', { iostat, helpers });
});

router.get('/partials/dataset-table', async (req: Request, res: Response) => {
  const pool = req.query.pool as string | undefined;
  const datasets = await zfsService.listDatasets(pool);
  res.render('partials/dataset-table', { datasets, helpers });
});

router.get('/partials/snapshot-table', async (req: Request, res: Response) => {
  const dataset = req.query.dataset as string | undefined;
  const snapshots = await zfsService.listSnapshots(dataset);
  res.render('partials/snapshot-table', { snapshots, helpers });
});

router.get('/partials/disk-cards', async (_req: Request, res: Response) => {
  const disks = await smartService.listDisks();
  res.render('partials/disk-cards', { disks, helpers });
});

export default router;
