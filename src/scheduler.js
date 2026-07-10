import { executarPasse } from './ackUpdater.js';
import { agoraISO, ehFimDeSemanaBR } from './datas.js';

export async function verificarPassesPendentes({ store, maischat, agoraIso = agoraISO() }) {
  const pendentes = store.passesPendentes(agoraIso);
  for (const { data_lote, numero } of pendentes) {
    await executarPasse({ maischat, store, dataLote: data_lote, numero });
  }
  return pendentes.length;
}

// Executa o envio apenas em dia útil (não envia sábado/domingo, fuso BR).
export async function executarSeDiaUtil({ executarEnvio, agora = new Date() }) {
  if (ehFimDeSemanaBR(agora)) {
    console.log('[scheduler] fim de semana — envio automático ignorado');
    return { ignorado: 'fim_de_semana' };
  }
  return executarEnvio();
}

export function iniciarScheduler({ cron, config, executarEnvio, verificarPasses }) {
  const tz = 'America/Sao_Paulo';
  cron.schedule(config.cronHorario, () => {
    executarSeDiaUtil({ executarEnvio }).catch((e) => console.error('[scheduler] erro no job de envio:', e));
  }, { timezone: tz });
  cron.schedule('* * * * *', () => {
    verificarPasses().catch((e) => console.error('[scheduler] erro nos passes de ACK:', e));
  }, { timezone: tz });
  console.log(`[scheduler] cron de envio em "${config.cronHorario}" (${tz}) e verificação de ACK por minuto`);
}
