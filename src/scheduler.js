import { executarPasse } from './ackUpdater.js';
import { agoraISO } from './datas.js';

export async function verificarPassesPendentes({ store, maischat, agoraIso = agoraISO() }) {
  const pendentes = store.passesPendentes(agoraIso);
  for (const { data_lote, numero } of pendentes) {
    await executarPasse({ maischat, store, dataLote: data_lote, numero });
  }
  return pendentes.length;
}

export function iniciarScheduler({ cron, config, executarEnvio, verificarPasses }) {
  const tz = 'America/Sao_Paulo';
  cron.schedule(config.cronHorario, () => {
    executarEnvio().catch((e) => console.error('[scheduler] erro no job de envio:', e));
  }, { timezone: tz });
  cron.schedule('* * * * *', () => {
    verificarPasses().catch((e) => console.error('[scheduler] erro nos passes de ACK:', e));
  }, { timezone: tz });
  console.log(`[scheduler] cron de envio em "${config.cronHorario}" (${tz}) e verificação de ACK por minuto`);
}
