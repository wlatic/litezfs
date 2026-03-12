import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';

function createTerminal(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`Terminal container #${containerId} not found`);
    return;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
    theme: {
      background: '#0f1117',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  term.open(container);

  // Try WebGL for performance
  try {
    term.loadAddon(new WebglAddon());
  } catch {
    console.warn('WebGL not available, using canvas renderer');
  }

  fitAddon.fit();

  // WebSocket connection
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws/terminal`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'resize',
      cols: term.cols,
      rows: term.rows,
    }));
    term.focus();
  };

  ws.onmessage = (event) => {
    term.write(event.data);
  };

  ws.onclose = (event) => {
    term.write(`\r\n\x1b[31mConnection closed: ${event.reason || 'unknown'}\x1b[0m\r\n`);
  };

  ws.onerror = () => {
    term.write('\r\n\x1b[31mWebSocket error — check connection\x1b[0m\r\n');
  };

  // Terminal input → WebSocket
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

// Auto-initialize terminal if container exists
document.addEventListener('DOMContentLoaded', () => {
  const fullTerminal = document.getElementById('terminal-full');
  if (fullTerminal) {
    createTerminal('terminal-full');
  }
});

// Export for drawer terminal initialization
(window as unknown as Record<string, unknown>).createTerminal = createTerminal;
