import 'dotenv/config';
import cron from 'node-cron';
import { carregarConfig } from './config.js';
import { criarStore } from './store.js';
import { criarMedx } from './medx.js';
import { criarNetVacinas, criarNetVacinasRest } from './netvacinas.js';
import { criarMaisChat } from './maischat.js';
import { executarJobEnvio } from './job.js';
import { executarJobNetVacinas } from './jobNetVacinas.js';
import { iniciarScheduler, verificarPassesPendentes } from './scheduler.js';
import { criarServidor } from './server.js';

const config = carregarConfig();
const store = criarStore(config.sqlitePath);
const medx = criarMedx({ baseUrl: config.medxBaseUrl, token: config.medxToken });
const netvacinas = config.netvacinasToken
  ? criarNetVacinas({ url: config.netvacinasGraphqlUrl, token: config.netvacinasToken })
  : null;
const netvacinasRest = config.netvacinasApiToken
  ? criarNetVacinasRest({ baseUrl: config.netvacinasApiUrl, token: config.netvacinasApiToken })
  : null;
const maischat = criarMaisChat({
  baseUrl: config.maischatBaseUrl, broker: config.maischatBroker,
  appId: config.maischatAppId, source: config.maischatSource,
  metaToken: config.maischatMetaToken, apiKey: config.maischatApiKey,
  v2BaseUrl: config.maischatV2BaseUrl, v2Token: config.maischatV2Token,
  templateNome: config.templateNome, templateIdioma: config.templateIdioma,
  debug: config.debug,
});

// NetVacinas roda em paralelo e isolado: falha de uma origem não bloqueia a outra.
const executarEnvio = async () => {
  const netvac = netvacinas
    ? executarJobNetVacinas({ netvacinas, maischat, store, config })
      .catch((e) => { console.error('[job-netvacinas] falha:', e.message); return { erro: e.message }; })
    : null;
  try {
    return { ...(await executarJobEnvio({ medx, maischat, store, config })), netvacinas: await netvac };
  } catch (e) {
    await netvac;
    throw e;
  }
};
const verificarPasses = () => verificarPassesPendentes({ store, maischat });

iniciarScheduler({ cron, config, executarEnvio, verificarPasses });

const app = criarServidor({ store, config, executarEnvio, medx, netvacinas, netvacinasRest, maischat });
const server = app.listen(config.port, () => {
  console.log(`[server] ouvindo na porta ${config.port}`);
  verificarPasses().catch((e) => console.error('[init] erro ao verificar passes pendentes:', e));
});

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    console.log(`[server] recebido ${sinal}, encerrando...`);
    server.close(() => { store.fechar(); process.exit(0); });
  });
}
