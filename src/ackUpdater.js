import { agoraISO } from './datas.js';

// Consulta o Mais Chat e atualiza o ACK das mensagens enviadas ainda não-lidas
// de uma data. Não depende de "lote" (serve para o job e para o refresh sob demanda).
export async function atualizarAcks({ maischat, store, dataLote }) {
  const pendentes = store.mensagensNaoLidas(dataLote);
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
  return { atualizados, erros, pendentes: pendentes.length };
}

export async function executarPasse({ maischat, store, dataLote, numero }) {
  console.log(`[ack] passe ${numero} lote ${dataLote}`);
  const r = await atualizarAcks({ maischat, store, dataLote });
  store.marcarPasseFeito(dataLote, numero);
  console.log(`[ack] passe ${numero} concluído: ${r.atualizados} atualizados, ${r.erros} erros (${r.pendentes} consultadas)`);
  return { atualizados: r.atualizados, erros: r.erros };
}
