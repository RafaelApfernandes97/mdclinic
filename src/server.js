import express from 'express';
import { montarDashboard } from './dashboard.js';

export function criarServidor({ store, config, executarEnvio }) {
  const app = express();

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

  app.use('/', montarDashboard({ store, config }));
  return app;
}
