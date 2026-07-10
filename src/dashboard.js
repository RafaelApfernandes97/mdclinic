import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { snapshotAgenda, mapaMedicos } from './agendaSnapshot.js';
import { enviarManual } from './envioManual.js';
import { atualizarAcks } from './ackUpdater.js';

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

export function montarDashboard({ store, config, medx, maischat, executarEnvio }) {
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

  // ativa/desativa o envio de 15 dias para uma agenda (médico).
  router.post('/api/medico-15dias', exigirSessao, (req, res) => {
    const idUsuario = Number(req.body?.idUsuario);
    if (!Number.isInteger(idUsuario)) return res.status(400).json({ erro: 'idUsuario inválido' });
    const ativo = req.body?.ativo === true || req.body?.ativo === 'true';
    const ok = store.definirEnvio15Dias(idUsuario, ativo);
    if (!ok) return res.status(404).json({ erro: 'Agenda não encontrada' });
    res.json({ ok: true, idUsuario, ativo, medicos: store.listarMedicos() });
  });

  // disparo manual do envio (mesma régua do cron: base + janela 15d das agendas ativas).
  router.post('/api/disparar-envio', exigirSessao, async (req, res) => {
    if (!executarEnvio) return res.status(503).json({ erro: 'Envio indisponível' });
    try {
      const resultado = await executarEnvio();
      res.json({ ok: true, resultado });
    } catch (e) {
      console.error('[dashboard] falha no disparo manual:', e.message);
      res.status(500).json({ erro: 'Falha ao disparar o envio' });
    }
  });

  router.post('/api/enviar', exigirSessao, async (req, res) => {
    const id = Number(req.query.id);
    if (!Number.isFinite(id)) return res.status(400).json({ erro: 'id inválido' });
    const r = await enviarManual({ maischat, store, config, idAgendamento: id });
    if (!r.ok) return res.status(r.status ?? 500).json({ erro: r.erro });
    res.json(r);
  });

  router.post('/api/atualizar-ack', exigirSessao, async (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    let ackAtualizados = 0;
    try {
      const r = await atualizarAcks({ maischat, store, dataLote: data });
      ackAtualizados = r.atualizados;
      if (config.debug) console.log(`[ack] refresh sob demanda data=${data}: ${r.atualizados}/${r.pendentes} atualizados`);
    } catch (e) {
      console.error('[ack] falha no refresh sob demanda:', e.message);
    }
    res.json({
      data,
      resumo: store.resumoAgenda(data),
      porMedico: store.porMedicoAgenda(data),
      agenda: store.agendaCompleta(data),
      medicos: store.listarMedicos(),
      ackAtualizados,
    });
  });

  // relógio do servidor — o front formata este epoch no fuso de Brasília para
  // conferir se o relógio do servidor está correto.
  router.get('/api/hora', exigirSessao, (req, res) => {
    res.json({ epoch: Date.now(), tz: 'America/Sao_Paulo' });
  });

  router.get('/api/dados', exigirSessao, (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    res.json({
      data,
      resumo: store.resumoAgenda(data),
      porMedico: store.porMedicoAgenda(data),
      agenda: store.agendaCompleta(data),
      medicos: store.listarMedicos(),
    });
  });

  router.post('/api/atualizar-agenda', exigirSessao, async (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    try {
      await snapshotAgenda({ medx, store, config, dataLote: data });
    } catch (e) {
      console.error('[dashboard] falha ao atualizar agenda:', e.message);
      return res.status(502).json({ erro: 'Não foi possível atualizar a agenda no MedX.' });
    }
    res.json({
      data,
      resumo: store.resumoAgenda(data),
      porMedico: store.porMedicoAgenda(data),
      agenda: store.agendaCompleta(data),
      medicos: store.listarMedicos(),
    });
  });
  return router;
}
