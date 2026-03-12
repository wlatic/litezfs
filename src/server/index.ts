import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { loadConfig, PROJECT_ROOT } from './config.js';
import { createSessionMiddleware, ensurePasswordHash, requireAuth, createAuthRouter } from './auth.js';
import { createTerminalServer } from './terminal.js';
import apiRouter from './routes/api.js';
import pageRouter from './routes/pages.js';
import { init as initZpool } from './services/zpool.js';
import { init as initZfs } from './services/zfs.js';
import { init as initSmart } from './services/smart.js';
import { init as initAlerts } from './services/alert.js';
import type { IncomingMessage } from 'node:http';

async function main() {
  const config = loadConfig();
  await ensurePasswordHash(config);

  // Detect ZFS/SMART availability (falls back to mock data if not found)
  await Promise.all([initZpool(), initZfs(), initSmart()]);
  initAlerts(config.alerts);

  const app = express();
  const server = createServer(app);

  // ---- Security middleware ----
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:"],
        upgradeInsecureRequests: null, // disable — we serve plain HTTP
      },
    },
    hsts: false, // disable — we serve plain HTTP, not behind a TLS proxy
  }));

  // ---- Body parsing ----
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // ---- Session ----
  const sessionMiddleware = createSessionMiddleware(config);
  app.use(sessionMiddleware);

  // Parse session for WebSocket upgrade requests too
  const isAuthenticated = (req: IncomingMessage): boolean => {
    // The session is parsed by the middleware on HTTP requests.
    // For WebSocket upgrades, we need to manually parse it.
    const session = (req as unknown as { session?: { authenticated?: boolean } }).session;
    return session?.authenticated === true;
  };

  // Apply session middleware to upgrade requests
  server.on('upgrade', (req, socket, head) => {
    sessionMiddleware(req as unknown as express.Request, {} as express.Response, () => {
      // Session parsed — the terminal server will handle the rest
    });
  });

  // ---- Rate limiting ----
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts, try again later' },
  });

  // ---- View engine ----
  app.set('view engine', 'ejs');
  app.set('views', resolve(PROJECT_ROOT, 'templates'));

  // ---- Static files ----
  app.use(express.static(resolve(PROJECT_ROOT, 'public')));

  // ---- Auth routes (no auth required) ----
  app.use('/api/auth', loginLimiter, createAuthRouter(config));

  // ---- Login page (no auth required) ----
  app.get('/login', (req, res) => {
    if (req.session.authenticated) {
      res.redirect('/');
      return;
    }
    res.render('pages/login');
  });

  // ---- Protected routes ----
  app.use('/api', requireAuth, apiRouter);
  app.use('/', requireAuth, pageRouter);

  // ---- Terminal WebSocket ----
  createTerminalServer(server, isAuthenticated);

  // ---- Error pages ----
  app.use((_req, res) => {
    res.status(404).render('errors/404');
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] Error:', err);
    res.status(500).render('errors/500');
  });

  // ---- Start ----
  const port = config.server.port;
  const host = config.server.host;

  server.listen(port, host, () => {
    console.log(`[litezfs] Server running at http://${host}:${port}`);
    console.log(`[litezfs] Default login: ${config.auth.username} / litezfs`);
  });
}

main().catch((err) => {
  console.error('[litezfs] Fatal error:', err);
  process.exit(1);
});
