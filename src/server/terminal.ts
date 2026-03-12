import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';

/**
 * Create the terminal WebSocket server.
 * Currently disabled — terminal feature needs a secure sandboxed shell design.
 * Sends a message to the client explaining the feature is coming soon.
 */
export function createTerminalServer(
  server: Server,
  _isAuthenticated: (req: IncomingMessage) => boolean,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url !== '/ws/terminal') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.send('\r\n  Terminal feature coming soon.\r\n\r\n  This will provide a secure, restricted shell for ZFS management commands.\r\n\r\n');
    ws.close(1000, 'Terminal not yet available');
  });

  return wss;
}

/** Get count of active terminal sessions */
export function getActiveSessionCount(): number {
  return 0;
}
