import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { snapshotAgenda, mapaMedicos } from './agendaSnapshot.js';
import { snapshotAgendaNetVacinas } from './netvacinasSnapshot.js';
import { enviarManual, enviarManualNetVacinas } from './envioManual.js';
import { criarEnvioMassa } from './envioMassa.js';
import { atualizarAcks } from './ackUpdater.js';
import { slugMedico } from './templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS = join(__dirname, '..', 'views');

function igual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function exigirSessao(req, res, next) {
  if (req.session?.logado) return next();
  return res.redirect('/login');
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function periodoDaRequisicao(query) {
  const inicio = String(query.inicio ?? query.data ?? hojeISO());
  const fim = String(query.fim ?? inicio);
  const formatoValido = /^\d{4}-\d{2}-\d{2}$/;
  if (!formatoValido.test(inicio) || !formatoValido.test(fim) || inicio > fim) return null;
  return { inicio, fim };
}

// Nomes (como aparecem no seletor) das agendas com envio em massa habilitado.
function medicosComEnvioMassa(store, config) {
  const slugs = config.envioMassaMedicos ?? [];
  return store.listarMedicos()
    .filter((m) => slugs.includes(slugMedico(m.nome)))
    .map((m) => m.nome);
}

function dadosDoDashboard({ store, config, netvacinas, inicio, fim }) {
  return {
    // "data" continua no contrato para clientes antigos; inicio/fim são o novo intervalo.
    data: inicio,
    inicio,
    fim,
    resumo: store.resumoAgenda(inicio, fim),
    porMedico: store.porMedicoAgenda(inicio, fim),
    agenda: store.agendaCompleta(inicio, fim),
    medicos: store.listarMedicos(),
    envioMassaMedicos: medicosComEnvioMassa(store, config),
    netvacinas: {
      habilitado: Boolean(netvacinas),
      resumo: store.resumoAgendaNetVacinas(inicio, fim),
      agenda: store.agendaNetVacinasCompleta(inicio, fim),
    },
  };
}

export function montarDashboard({ store, config, medx, netvacinas = null, maischat }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(express.json());
  router.use(cookieSession({
    name: 'sess', secret: config.sessionSecret, maxAge: 8 * 3600 * 1000, httpOnly: true,
    secure: config.cookieSegura ?? false,
    sameSite: 'lax',
  }));

  router.get('/login', (req, res) => res.sendFile(join(VIEWS, 'login.html')));
  router.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    if (igual(usuario, config.dashboardUser) && igual(senha, config.dashboardPassword)) {
      req.session.logado = true;
      return res.redirect('/');
    }
    return res.redirect('/login?erro=1');
  });
  router.get('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

  router.get('/', exigirSessao, (req, res) => res.sendFile(join(VIEWS, 'dashboard.html')));
  // lista de médicos para o seletor — busca ao vivo no MedX e cacheia no banco;
  // se o MedX falhar, devolve o que estiver cacheado.
  router.get('/api/medicos', exigirSessao, async (req, res) => {
    try {
      const usuarios = await medx.getUsuarios();
      const mapa = mapaMedicos(usuarios, config.medicoCampoNome);
      for (const [id, nome] of mapa) if (id != null) store.upsertMedico({ id_usuario: id, nome });
    } catch (e) {
      console.error('[dashboard] falha ao buscar médicos do MedX, usando cache:', e.message);
    }
    res.json({ medicos: store.listarMedicos() });
  });

  router.post('/api/enviar', exigirSessao, async (req, res) => {
    if (req.query.origem === 'netvacinas') {
      const chave = String(req.query.id ?? '').trim();
      if (!chave) return res.status(400).json({ erro: 'id NetVacinas inválido' });
      const r = await enviarManualNetVacinas({ maischat, store, config, chave });
      if (!r.ok) return res.status(r.status ?? 500).json({ erro: r.erro });
      return res.json(r);
    }
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.status(400).json({ erro: 'id inválido' });
    const r = await enviarManual({ maischat, store, config, idAgendamento: id });
    if (!r.ok) return res.status(r.status ?? 500).json({ erro: r.erro });
    res.json(r);
  });

  router.post('/api/atualizar-ack', exigirSessao, async (req, res) => {
    const periodo = periodoDaRequisicao(req.query);
    if (!periodo) return res.status(400).json({ erro: 'Período inválido' });
    const { inicio, fim } = periodo;
    let ackAtualizados = 0;
    try {
      const r = await atualizarAcks({ maischat, store, dataLote: inicio, dataFim: fim });
      ackAtualizados = r.atualizados;
      if (config.debug) console.log(`[ack] refresh sob demanda ${inicio}..${fim}: ${r.atualizados}/${r.pendentes} atualizados`);
    } catch (e) {
      console.error('[ack] falha no refresh sob demanda:', e.message);
    }
    res.json({ ...dadosDoDashboard({ store, config, netvacinas, inicio, fim }), ackAtualizados });
  });

  // relógio do servidor — o front formata este epoch no fuso de Brasília para
  // conferir se o relógio do servidor está correto.
  router.get('/api/hora', exigirSessao, (req, res) => {
    res.json({ epoch: Date.now(), tz: 'America/Sao_Paulo' });
  });

  router.get('/api/dados', exigirSessao, (req, res) => {
    const periodo = periodoDaRequisicao(req.query);
    if (!periodo) return res.status(400).json({ erro: 'Período inválido' });
    res.json(dadosDoDashboard({ store, config, netvacinas, ...periodo }));
  });

  router.post('/api/atualizar-agenda', exigirSessao, async (req, res) => {
    const periodo = periodoDaRequisicao(req.query);
    if (!periodo) return res.status(400).json({ erro: 'Período inválido' });
    const { inicio, fim } = periodo;
    try {
      await snapshotAgenda({ medx, store, config, dataLote: inicio, dataFim: fim });
    } catch (e) {
      console.error('[dashboard] falha ao atualizar agenda:', e.message);
      return res.status(502).json({ erro: 'Não foi possível atualizar a agenda no MedX.' });
    }
    let netvacinasErro = null;
    if (netvacinas) {
      try {
        await snapshotAgendaNetVacinas({ netvacinas, store, inicio, fim });
      } catch (e) {
        console.error('[dashboard] falha ao atualizar agenda NetVacinas:', e.message);
        netvacinasErro = 'Não foi possível atualizar a agenda na NetVacinas.';
      }
    }
    res.json({ ...dadosDoDashboard({ store, config, netvacinas, inicio, fim }), netvacinasErro });
  });

  // Envio em massa: dispara a campanha de uma agenda no período e devolve o job
  // para a tela de acompanhamento. Só agendas habilitadas em ENVIO_MASSA_MEDICOS.
  const envioMassa = criarEnvioMassa({ medx, maischat, store, config });
  router.post('/api/envio-massa', exigirSessao, async (req, res) => {
    const periodo = periodoDaRequisicao(req.query);
    if (!periodo) return res.status(400).json({ erro: 'Período inválido' });
    const medico = String(req.query.medico ?? '').trim();
    if (!medico) return res.status(400).json({ erro: 'Médico obrigatório' });
    if (!(config.envioMassaMedicos ?? []).includes(slugMedico(medico))) {
      return res.status(403).json({ erro: 'Envio em massa não habilitado para esta agenda' });
    }
    try {
      const r = await envioMassa.iniciar({ nomeMedico: medico, ...periodo });
      if (!r.ok) return res.status(r.status ?? 500).json({ erro: r.erro });
      res.json({ job: r.job });
    } catch (e) {
      console.error('[envio-massa] falha ao iniciar:', e.message);
      res.status(502).json({ erro: 'Não foi possível atualizar a agenda no MedX para iniciar o envio.' });
    }
  });
  router.get('/api/envio-massa/:id', exigirSessao, (req, res) => {
    const job = envioMassa.obter(req.params.id);
    if (!job) return res.status(404).json({ erro: 'Envio em massa não encontrado' });
    res.json({ job });
  });
  return router;
}
