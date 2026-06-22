import { agoraISO } from './datas.js';

export async function executarPasse({ maischat, store, dataLote, numero }) {
  const pendentes = store.mensagensNaoLidas(dataLote);
  console.log(`[ack] passe ${numero} lote ${dataLote}: ${pendentes.length} mensagens`);
  let atualizados = 0, erros = 0;
  for (const { id_agendamento, id_mensagem, telefone } of pendentes) {
    try {
      const { ack } = await maischat.getStatusMensagem(id_mensagem, telefone);
      if (ack) {
        store.atualizarAck(id_agendamento, ack, agoraISO());
        atualizados++;
      }
    } catch (e) {
      erros++;
      console.error(`[ack] erro na msg ${id_mensagem}:`, e.message);
    }
  }
  store.marcarPasseFeito(dataLote, numero);
  console.log(`[ack] passe ${numero} concluído: ${atualizados} atualizados, ${erros} erros`);
  return { atualizados, erros };
}
