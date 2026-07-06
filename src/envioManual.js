import { agoraISO } from './datas.js';
import { resolverTemplate, montarVariaveisTemplate } from './templates.js';

// Envia manualmente a confirmação de UM agendamento (acionado pelo botão no dashboard).
// Respeita DRY_RUN: com dryRun=true apenas simula (não chama o Mais Chat, não registra).
export async function enviarManual({ maischat, store, config, idAgendamento, agora = new Date() }) {
  console.log(`[envio-manual] acionado: agendamento=${idAgendamento} dryRun=${config.dryRun ? 'true' : 'false'}`);
  const item = store.agendaItem(idAgendamento);
  if (!item) {
    console.warn(`[envio-manual] ignorado: agendamento ${idAgendamento} não encontrado`);
    return { ok: false, status: 404, erro: 'Agendamento não encontrado' };
  }
  if (!item.elegivel) {
    console.warn(`[envio-manual] ignorado: agendamento ${idAgendamento} não elegível (${item.motivo})`);
    return { ok: false, status: 400, erro: 'Agendamento não elegível para envio' };
  }

  const { templateNome, ordem } = resolverTemplate(item.nome_medico, config);
  const variaveis = montarVariaveisTemplate({
    nomePaciente: item.nome_paciente, nomeMedico: item.nome_medico,
    inicio: item.inicio, ordem, agora,
  });

  if (config.dryRun) {
    console.log(`[envio-manual] DRY_RUN: simulado (não enviado) — agendamento=${idAgendamento} paciente="${item.nome_paciente}" telefone=${item.telefone}`);
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
    const { idMensagem } = await maischat.sendTemplate({
      telefone: item.telefone, variaveis, template: templateNome,
    });
    store.registrarEnvio({ ...base, id_mensagem: idMensagem, status_envio: 'enviado', ack: 'enviado', erro: null });
    console.log(`[envio-manual] ENVIADO: agendamento=${idAgendamento} paciente="${item.nome_paciente}" telefone=${item.telefone} wamid=${idMensagem}`);
    return { ok: true, enviado: true, ack: 'enviado' };
  } catch (e) {
    store.registrarEnvio({ ...base, id_mensagem: null, status_envio: 'erro', ack: 'falha', erro: String(e.message ?? e) });
    console.error(`[envio-manual] FALHA: agendamento=${idAgendamento} telefone=${item.telefone} erro=${e.message ?? e}`);
    return { ok: false, status: 502, erro: 'Falha ao enviar pelo Mais Chat', ack: 'falha' };
  }
}
