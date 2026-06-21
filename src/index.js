import 'dotenv/config';
import cron from 'node-cron';
import { carregarConfig } from './config.js';
import { criarStore } from './store.js';
import { criarMedx } from './medx.js';
import { criarMaisChat } from './maischat.js';
import { executarJobEnvio } from './job.js';
import { iniciarScheduler, verificarPassesPendentes } from './scheduler.js';
import { criarServidor } from './server.js';

const config = carregarConfig();
const store = criarStore(config.sqlitePath);
const medx = criarMedx({ baseUrl: config.medxBaseUrl, token: config.medxToken });
const maischat = criarMaisChat({
  baseUrl: config.maischatBaseUrl, token: config.maischatToken,
  templateNome: config.templateNome, templateIdioma: config.templateIdioma,
});

const executarEnvio = () => executarJobEnvio({ medx, maischat, store, config });
const verificarPasses = () => verificarPassesPendentes({ store, maischat });

iniciarScheduler({ cron, config, executarEnvio, verificarPasses });

const app = criarServidor({ store, config, executarEnvio });
app.listen(config.port, () => {
  console.log(`[server] ouvindo na porta ${config.port}`);
  verificarPasses().catch((e) => console.error('[init] erro ao verificar passes pendentes:', e));
});
