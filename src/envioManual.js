import { formatarDataBR, formatarHoraBR, agoraISO } from './datas.js';

// Envia manualmente a confirmação de UM agendamento (acionado pelo botão no dashboard).
// Respeita DRY_RUN: com dryRun=true apenas simula (não chama o Mais Chat, não registra).
export async function enviarManual({ maischat, store, config, idAgendamento, agora = new Date() }) {
  const item = store.agendaItem(idAgendamento);
  if (!item) return { ok: false, status: 404, erro: 'Agendamento não encontrado' };
  if (!item.elegivel) return { ok: false, status: 400, erro: 'Agendamento não elegível para envio' };

  const valores = {
    nome: item.nome_paciente, medico: item.nome_medico,
    data: formatarDataBR(item.inicio), hora: formatarHoraBR(item.inicio),
  };
  const variaveis = config.templateVariaveis.map((chave) => valores[chave] ?? '');

  if (config.dryRun) {
    return { ok: true, dryRun: true, enviado: false };
  }

  const ts = agoraISO();
  const base = {
    id_agendamento: item.id_agendamento, id_paciente: item.id_paciente,
    nome_paciente: item.nome_paciente, telefone: item.telefone,
    id_usuario: item.id_usuario, nome_medico: item.nome_medico, inicio: item.inicio,
    data_envio: ts, data_lote: item.data_lote,
  };
  try {
    const { idMensagem } = await maischat.sendTemplate({ telefone: item.telefone, variaveis });
    store.registrarEnvio({ ...base, id_mensagem: idMensagem, status_envio: 'enviado', ack: 'enviado', erro: null });
    return { ok: true, enviado: true, ack: 'enviado' };
  } catch (e) {
    store.registrarEnvio({ ...base, id_mensagem: null, status_envio: 'erro', ack: 'falha', erro: String(e.message ?? e) });
    return { ok: false, status: 502, erro: 'Falha ao enviar pelo Mais Chat', ack: 'falha' };
  }
}
