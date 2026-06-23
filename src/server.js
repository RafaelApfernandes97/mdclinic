import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { montarDashboard } from './dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

export function criarServidor({ store, config, executarEnvio, medx, maischat }) {
  const app = express();
  app.set('trust proxy', 1); // EasyPanel termina TLS num proxy reverso

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.post('/run-now', express.json(), async (req, res) => {
    if (req.get('x-run-token') !== config.runToken) return res.status(401).json({ erro: 'token inválido' });
    try {
      const r = executarEnvio ? await executarEnvio() : { ok: true };
      res.json({ ok: true, resultado: r });
    } catch (e) {
      res.status(500).json({ erro: String(e.message ?? e) });
    }
  });

  app.use(express.static(PUBLIC));
  app.use('/', montarDashboard({ store, config, medx, maischat }));
  return app;
}
