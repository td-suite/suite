// Eventi in tempo reale (Server-Sent Events) verso tutti i client collegati.
// Un'unica istanza applicativa: basta un bus in memoria.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(500);
const clients = new Set();

export function publish(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

export function sseHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`retry: 3000\n`);
  res.write(`data: ${JSON.stringify({ type: 'hello', at: new Date().toISOString() })}\n\n`);
  clients.add(res);
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* chiuso */ } }, 25000);
  req.on('close', () => { clearInterval(hb); clients.delete(res); });
}

export const clientCount = () => clients.size;
export { bus };
