import { Router, type Request, type Response } from 'express';
import * as zpoolService from '../services/zpool.js';
import * as zfsService from '../services/zfs.js';
import * as smartService from '../services/smart.js';
import * as alertService from '../services/alert.js';
import * as systemService from '../services/system.js';

const router = Router();

function apiResponse<T>(data: T, cached = false) {
  return { data, timestamp: new Date().toISOString(), cached };
}

// ============================================================================
// Pools
// ============================================================================

router.get('/pools', async (_req: Request, res: Response) => {
  const pools = await zpoolService.listPools();
  res.json(apiResponse(pools));
});

router.get('/pools/:name', async (req: Request, res: Response) => {
  const pool = await zpoolService.getPool(req.params.name);
  if (!pool) {
    res.status(404).json({ error: 'Pool not found', detail: `No pool named '${req.params.name}'` });
    return;
  }
  const vdevs = await zpoolService.getPoolVDevs(req.params.name);
  res.json(apiResponse({ pool, vdevs }));
});

router.get('/pools/:name/status', async (req: Request, res: Response) => {
  const status = await zpoolService.getPoolStatus(req.params.name);
  if (!status) {
    res.status(404).json({ error: 'Pool not found' });
    return;
  }
  res.json(apiResponse(status));
});

router.get('/pools/:name/iostat', async (req: Request, res: Response) => {
  const iostat = await zpoolService.getPoolIOStat(req.params.name);
  if (!iostat) {
    res.status(404).json({ error: 'Pool not found' });
    return;
  }
  res.json(apiResponse(iostat));
});

router.post('/pools/:name/scrub', async (req: Request, res: Response) => {
  const result = await zpoolService.startScrub(req.params.name);
  if (!result.ok) {
    const status = result.message.includes('already') ? 409 : 404;
    res.status(status).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ message: result.message }));
});

router.delete('/pools/:name/scrub', async (req: Request, res: Response) => {
  const result = await zpoolService.cancelScrub(req.params.name);
  if (!result.ok) {
    res.status(404).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ message: result.message }));
});

router.post('/pools/import', async (req: Request, res: Response) => {
  const { name, force } = req.body as { name?: string; force?: boolean };
  if (!name) {
    res.status(400).json({ error: 'Pool name required' });
    return;
  }
  const result = await zpoolService.importPool(name, force);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ message: result.message }));
});

router.post('/pools/:name/export', async (req: Request, res: Response) => {
  const { force } = req.body as { force?: boolean };
  const result = await zpoolService.exportPool(req.params.name, force);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ message: result.message }));
});

// ============================================================================
// Datasets
// ============================================================================

router.get('/datasets', async (req: Request, res: Response) => {
  const pool = req.query.pool as string | undefined;
  const datasets = await zfsService.listDatasets(pool);
  res.json(apiResponse(datasets));
});

// Note: dataset names contain slashes, so we use wildcard routing
router.get('/datasets/:name(*)', async (req: Request, res: Response) => {
  const name = req.params.name;
  const dataset = await zfsService.getDataset(name);
  if (!dataset) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }
  res.json(apiResponse(dataset));
});

router.post('/datasets', async (req: Request, res: Response) => {
  const { name, properties } = req.body as { name?: string; properties?: Record<string, string> };
  if (!name) {
    res.status(400).json({ error: 'Dataset name required' });
    return;
  }

  const result = await zfsService.createDataset(name, properties);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.status(201).json(apiResponse(result.dataset));
});

router.delete('/datasets/:name(*)', async (req: Request, res: Response) => {
  const name = req.params.name;
  const recursive = req.query.recursive === 'true';

  const result = await zfsService.destroyDataset(name, recursive);
  if (!result.ok) {
    const status = result.message.includes('has children') ? 409 : 400;
    res.status(status).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ message: result.message }));
});

router.patch('/datasets/:name(*)', async (req: Request, res: Response) => {
  const name = req.params.name;
  const { properties } = req.body as { properties?: Record<string, string> };
  if (!properties || Object.keys(properties).length === 0) {
    res.status(400).json({ error: 'No properties provided' });
    return;
  }

  const result = await zfsService.setDatasetProperties(name, properties);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(apiResponse(result.dataset));
});

router.get('/datasets/:name(*)/properties', async (req: Request, res: Response) => {
  const name = req.params.name;
  const props = await zfsService.getDatasetProperties(name);
  if (!props) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }
  res.json(apiResponse(props));
});

// ============================================================================
// Snapshots
// ============================================================================

router.get('/snapshots', async (req: Request, res: Response) => {
  const dataset = req.query.dataset as string | undefined;
  const snapshots = await zfsService.listSnapshots(dataset);
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const page = snapshots.slice(offset, offset + limit);
  res.json({
    data: page,
    total: snapshots.length,
    offset,
    limit,
  });
});

router.post('/snapshots', async (req: Request, res: Response) => {
  const { dataset, name, recursive } = req.body as { dataset?: string; name?: string; recursive?: boolean };
  if (!dataset || !name) {
    res.status(400).json({ error: 'Dataset and snapshot name required' });
    return;
  }

  const result = await zfsService.createSnapshot(dataset, name, recursive);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.status(201).json(apiResponse(result.snapshot));
});

// Snapshot routes use wildcard because names contain / and @
router.delete('/snapshots/:name(*)', async (req: Request, res: Response) => {
  const name = req.params.name;
  const result = await zfsService.destroySnapshot(name);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ message: result.message }));
});

router.post('/snapshots/:name(*)/rollback', async (req: Request, res: Response) => {
  const name = req.params.name;
  const { force } = req.body as { force?: boolean };

  const result = await zfsService.rollbackSnapshot(name, force);
  if (!result.ok) {
    const status = result.message.includes('more recent') ? 409 : 400;
    res.status(status).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ message: result.message }));
});

router.get('/snapshots/:name(*)/diff', async (req: Request, res: Response) => {
  const name = req.params.name;
  const result = await zfsService.diffSnapshot(name);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(apiResponse(result.diff));
});

router.get('/snapshots/:name(*)/send-size', async (req: Request, res: Response) => {
  const name = req.params.name;
  const result = await zfsService.sendSize(name);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(apiResponse({ estimatedSize: result.estimatedSize }));
});

// ============================================================================
// Disks
// ============================================================================

router.get('/disks', async (_req: Request, res: Response) => {
  const disks = await smartService.listDisks();
  res.json(apiResponse(disks));
});

router.get('/disks/:device', async (req: Request, res: Response) => {
  const disk = await smartService.getDisk(req.params.device);
  if (!disk) {
    res.status(404).json({ error: 'Disk not found' });
    return;
  }
  res.json(apiResponse(disk));
});

// ============================================================================
// System
// ============================================================================

router.get('/system/stats', async (_req: Request, res: Response) => {
  const stats = await systemService.getSystemStats();
  res.json(apiResponse(stats));
});

// ============================================================================
// Alerts
// ============================================================================

router.get('/alerts', async (req: Request, res: Response) => {
  let alerts = await alertService.getAlerts();
  const severity = req.query.severity as string | undefined;
  const category = req.query.category as string | undefined;
  const acknowledged = req.query.acknowledged as string | undefined;

  if (severity) alerts = alerts.filter(a => a.severity === severity);
  if (category) alerts = alerts.filter(a => a.category === category);
  if (acknowledged !== undefined) alerts = alerts.filter(a => a.acknowledged === (acknowledged === 'true'));

  res.json(apiResponse(alerts));
});

router.post('/alerts/:id/acknowledge', (req: Request, res: Response) => {
  alertService.acknowledgeAlert(req.params.id);
  res.json(apiResponse({ message: 'Alert acknowledged' }));
});

export default router;
