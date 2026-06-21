import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS = join(__dirname, '..', 'views');

function exigirSessao(req, res, next) {
  if (req.session?.logado) return next();
  return res.redirect('/login');
}

export function montarDashboard({ store, config }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(cookieSession({
    name: 'sess', secret: config.sessionSecret, maxAge: 8 * 3600 * 1000, httpOnly: true,
  }));

  router.get('/login', (req, res) => res.sendFile(join(VIEWS, 'login.html')));
  router.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    if (usuario === config.dashboardUser && senha === config.dashboardPassword) {
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
