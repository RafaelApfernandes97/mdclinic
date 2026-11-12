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
  // Regra: só agendamentos pendentes recebem mensagem — reenvio de um já enviado
  // duplicaria a confirmação no WhatsApp do paciente. Falhas podem ser reenviadas.
  if (store.jaEnviado(idAgendamento)) {
    console.warn(`[envio-manual] ignorado: agendamento ${idAgendamento} já enviado (só pendentes recebem mensagem)`);
    return { ok: false, status: 409, erro: 'Mensagem já enviada — apenas agendamentos pendentes recebem envio' };
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

// Envia manualmente uma dose ou agendamento da NetVacinas. Os envios ficam em uma
// tabela própria porque os IDs GraphQL podem ser textos e não devem colidir com a MedX.
export async function enviarManualNetVacinas({ maischat, store, config, chave, agora = new Date() }) {
  console.log(`[envio-manual] acionado: netvacinas=${chave} dryRun=${config.dryRun ? 'true' : 'false'}`);
  const item = store.agendaNetVacinasItem(chave);
  if (!item) return { ok: false, status: 404, erro: 'Agendamento NetVacinas não encontrado' };
  if (!item.elegivel) return { ok: false, status: 400, erro: 'Agendamento não elegível para envio' };
  // O template de vacinas exige horário ({{3}}); a Meta recusa parâmetro vazio.
  if (!item.tem_horario) return { ok: false, status: 400, erro: 'Item sem horário — envie pela linha do agendamento' };
  if (store.jaEnviadoNetVacinas(chave)) {
    console.warn(`[envio-manual] ignorado: netvacinas=${chave} já enviado (só pendentes recebem mensagem)`);
    return { ok: false, status: 409, erro: 'Mensagem já enviada — apenas agendamentos pendentes recebem envio' };
  }

  const { templateNome, ordem } = resolverTemplate(config.netvacinasNomeAgenda, config);
  const variaveis = montarVariaveisTemplate({
    nomePaciente: item.nome_paciente,
    nomeMedico: config.netvacinasNomeAgenda,
    inicio: item.inicio,
    ordem,
    agora,
    semHorario: !item.tem_horario,
    vacina: item.vacina ?? '',
  });

  if (config.dryRun) {
    console.log(`[envio-manual] DRY_RUN: NetVacinas simulada — chave=${chave} paciente="${item.nome_paciente}"`);
    return { ok: true, dryRun: true, enviado: false };
  }

  const base = {
    chave: item.chave,
    id_externo: item.id_externo,
    id_paciente: item.id_paciente,
    nome_paciente: item.nome_paciente,
    telefone: item.telefone,
    vacina: item.vacina,
    inicio: item.inicio,
    data_envio: agoraISO(),
    data_lote: item.data_lote,
  };
  try {
    const { idMensagem } = await maischat.sendTemplate({
      telefone: item.telefone, variaveis, template: templateNome,
    });
    store.registrarEnvioNetVacinas({
      ...base, id_mensagem: idMensagem, status_envio: 'enviado', ack: 'enviado', erro: null,
    });
    console.log(`[envio-manual] ENVIADO: netvacinas=${chave} paciente="${item.nome_paciente}" wamid=${idMensagem}`);
    return { ok: true, enviado: true, ack: 'enviado' };
  } catch (e) {
    store.registrarEnvioNetVacinas({
      ...base, id_mensagem: null, status_envio: 'erro', ack: 'falha', erro: String(e.message ?? e),
    });
    console.error(`[envio-manual] FALHA: netvacinas=${chave} erro=${e.message ?? e}`);
    return { ok: false, status: 502, erro: 'Falha ao enviar pelo Mais Chat', ack: 'falha' };
  }
}
