import { Router, type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import type { LiteZFSConfig } from '../shared/types.js';

// Extend express-session types
declare module 'express-session' {
  interface SessionData {
    authenticated: boolean;
    username: string;
  }
}

const DEFAULT_PASSWORD = 'litezfs';
const SALT_ROUNDS = 12;

/** Create session middleware */
export function createSessionMiddleware(config: LiteZFSConfig) {
  return session({
    name: 'litezfs.sid',
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  });
}

/** Ensure the auth config has a password hash, generating a default if needed */
export async function ensurePasswordHash(config: LiteZFSConfig): Promise<void> {
  if (!config.auth.passwordHash) {
    console.warn('[auth] No password hash configured — using default password "litezfs"');
    console.warn('[auth] Change this in /etc/litezfs/config.yaml or config/litezfs.yaml');
    config.auth.passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
  }
}

/** Auth check middleware — redirects to login for page requests, returns 401 for API */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.authenticated) {
    next();
    return;
  }

  if (req.path.startsWith('/api/') || req.path.startsWith('/partials/')) {
    res.status(401).json({ error: 'Authentication required' });
  } else {
    res.redirect('/login');
  }
}

/** Create auth routes */
export function createAuthRouter(config: LiteZFSConfig): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }

    const validUser = username === config.auth.username;
    const validPass = await bcrypt.compare(password, config.auth.passwordHash);

    if (validUser && validPass) {
      req.session.authenticated = true;
      req.session.username = username;
      res.json({
        data: { authenticated: true, username },
        timestamp: new Date().toISOString(),
        cached: false,
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  router.post('/logout', (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: 'Failed to logout' });
        return;
      }
      res.json({
        data: { authenticated: false },
        timestamp: new Date().toISOString(),
        cached: false,
      });
    });
  });

  router.get('/status', (req: Request, res: Response) => {
    res.json({
      data: {
        authenticated: !!req.session.authenticated,
        username: req.session.username,
      },
      timestamp: new Date().toISOString(),
      cached: false,
    });
  });

  return router;
}
