import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

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

export function montarDashboard({ store, config }) {
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
  router.get('/api/dados', exigirSessao, (req, res) => {
    const data = req.query.data || new Date().toISOString().slice(0, 10);
    res.json({
      data,
      resumo: store.resumoPorData(data),
      porMedico: store.porMedico(data),
      detalhado: store.detalhado(data),
    });
  });
  return router;
}
