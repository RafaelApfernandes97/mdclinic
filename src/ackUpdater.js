import { agoraISO } from './datas.js';

// Consulta o Mais Chat e atualiza o ACK das mensagens enviadas ainda não-lidas
// de uma data. Não depende de "lote" (serve para o job e para o refresh sob demanda).
export async function atualizarAcks({ maischat, store, dataLote, dataFim = dataLote }) {
  const pendentes = [
    ...store.mensagensNaoLidas(dataLote, dataFim).map((item) => ({ ...item, origem: 'medx' })),
    ...store.mensagensNetVacinasNaoLidas(dataLote, dataFim)
      .map((item) => ({ ...item, origem: 'netvacinas' })),
  ];
  let atualizados = 0, erros = 0;
  for (const { id_agendamento, chave, id_mensagem, telefone, origem } of pendentes) {
    try {
      const { ack } = await maischat.getStatusMensagem(id_mensagem, telefone);
      if (ack) {
        if (origem === 'netvacinas') store.atualizarAckNetVacinas(chave, ack, agoraISO());
        else store.atualizarAck(id_agendamento, ack, agoraISO());
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
