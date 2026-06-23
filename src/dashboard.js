import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { snapshotAgenda, mapaMedicos } from './agendaSnapshot.js';

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

export function montarDashboard({ store, config, medx }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(cookieSession({
    name: 'sess', secret: config.sessionSecret, maxAge: 8 * 3600 * 1000, httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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
