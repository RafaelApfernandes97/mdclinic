import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { montarDashboard } from './dashboard.js';
import { confirmarPorTelefone, agendamentoNetVacinasParaConfirmar } from './confirmacao.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

export function criarServidor({ store, config, executarEnvio, medx, netvacinas = null, netvacinasRest = null, maischat }) {
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

  // Webhook público chamado pelo bot quando o paciente clica em "Confirmar".
  // Sem autenticação (por decisão de produto). O bot só conhece o telefone do paciente:
  // localizamos o agendamento na janela hoje..hoje+JANELA_CONFIRMACAO_DIAS (cobre o
  // lembrete D+1 — inclusive sexta -> segunda) e gravamos CONFIRMADO.
  app.post('/api/confirmacao', express.json(), async (req, res) => {
    const corpo = req.body ?? {};
    const telefone = typeof corpo.telefone === 'string' ? corpo.telefone.trim() : '';
    if (!telefone) {
      console.warn('[confirmacao] falha 400: telefone obrigatório (corpo sem telefone)');
      return res.status(400).json({ success: false, erro: 'telefone obrigatório' });
    }
    const nv = netvacinasRest
      ? agendamentoNetVacinasParaConfirmar({ store, telefone, janelaDias: config.janelaConfirmacaoDias })
      : null;
    if (nv) {
      try {
        await netvacinasRest.confirmarAgendamento(nv.id);
        console.log(`[confirmacao] telefone=${telefone} netvacinas=${nv.id} -> CONFIRMADO`);
        return res.json({ success: true, origem: 'netvacinas', idAgendamento: nv.id, statusAplicado: 'CONFIRMADO', inicio: nv.inicio });
      } catch (e) {
        console.error(`[confirmacao] falha netvacinas=${nv.id} telefone=${telefone}:`, e.message);
        return res.status(502).json({ success: false, erro: 'Falha ao confirmar na NetVacinas' });
      }
    }
    try {
      const r = await confirmarPorTelefone({ medx, telefone, janelaDias: config.janelaConfirmacaoDias });
      if (!r.success) {
        console.warn(`[confirmacao] falha ${r.status ?? 500}: ${r.erro} — telefone=${telefone}`);
        return res.status(r.status ?? 500).json({ success: false, erro: r.erro });
      }
      console.log(`[confirmacao] telefone=${r.telefone} agendamento=${r.idAgendamento} -> CONFIRMADO${r.jaConfirmado ? ' (idempotente)' : ''}`);
      return res.json(r);
    } catch (e) {
      console.error(`[confirmacao] falha telefone=${telefone}:`, e.message);
      return res.status(502).json({ success: false, erro: 'Falha ao confirmar no MedX' });
    }
  });

  app.use(express.static(PUBLIC));
  app.use('/', montarDashboard({ store, config, medx, netvacinas, maischat, executarEnvio }));
  return app;
}
