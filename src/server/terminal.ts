import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';

interface TerminalSession {
  id: string;
  ptyProcess: pty.IPty;
  ws: WebSocket;
}

const sessions = new Map<string, TerminalSession>();

/**
 * Create the terminal WebSocket server.
 * Authenticates via session cookie parsed by the session middleware
 * that ran on the HTTP upgrade request.
 */
export function createTerminalServer(
  server: Server,
  isAuthenticated: (req: IncomingMessage) => boolean,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP upgrade — authenticate before upgrading
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    // Only handle /ws/terminal path
    if (req.url !== '/ws/terminal') {
      socket.destroy();
      return;
    }

    if (!isAuthenticated(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const sessionId = randomUUID();
    const shell = process.env.SHELL || '/bin/bash';

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || '/root',
      env: {
        ...process.env as Record<string, string>,
        TERM: 'xterm-256color',
      },
    });

    const session: TerminalSession = { id: sessionId, ptyProcess, ws };
    sessions.set(sessionId, session);

    // PTY output → WebSocket
    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, `Shell exited with code ${exitCode}`);
      }
      sessions.delete(sessionId);
    });

    // WebSocket input → PTY
    ws.on('message', (msg: Buffer) => {
      const message = msg.toString();

      // Check for JSON control messages (resize)
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          ptyProcess.resize(
            Math.max(1, Math.min(500, parsed.cols)),
            Math.max(1, Math.min(200, parsed.rows)),
          );
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

    ws.on('error', (err) => {
      console.error(`[terminal] WebSocket error for session ${sessionId}:`, err.message);
      ptyProcess.kill();
      sessions.delete(sessionId);
    });
  });

  return wss;
}

/** Get count of active terminal sessions */
export function getActiveSessionCount(): number {
  return sessions.size;
}
