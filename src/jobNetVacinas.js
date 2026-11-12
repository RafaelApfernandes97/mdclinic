import { proximoDiaUtilISO, agoraISO } from './datas.js';
import { snapshotAgendaNetVacinas } from './netvacinasSnapshot.js';
import { resolverTemplate, montarVariaveisTemplate } from './templates.js';

// Itens pendentes do dia agrupados por agendamento + paciente: um agendamento com
// várias vacinas vira UMA mensagem. Só "appointment" (tem horário); os
// "scheduled-shot" são os mesmos shots dos appointments, sem horário.
export function agruparPendentes(itens, jaEnviado) {
  const grupos = new Map();
  for (const item of itens) {
    if (item.tipo !== 'appointment' || !item.elegivel || !item.tem_horario) continue;
    if (jaEnviado(item.chave)) continue;
    const chaveGrupo = `${item.id_externo}|${item.telefone}`;
    const grupo = grupos.get(chaveGrupo);
    if (grupo) grupo.push(item); else grupos.set(chaveGrupo, [item]);
  }
  return [...grupos.values()];
}

export async function executarJobNetVacinas({ netvacinas, maischat, store, config, agora = new Date() }) {
  // Mesma base das agendas MedX: próximo dia útil (sexta => segunda).
  const base = proximoDiaUtilISO(agora);
  console.log(`[job-netvacinas] envio base=${base}`);
  await snapshotAgendaNetVacinas({ netvacinas, store, inicio: base, fim: base, agora });

  const itens = store.agendaNetVacinasCompleta(base, base)
    .map((i) => ({ ...i, ...store.agendaNetVacinasItem(i.chave) }));
  const grupos = agruparPendentes(itens, (chave) => store.jaEnviadoNetVacinas(chave));
  const { templateNome, ordem } = resolverTemplate(config.netvacinasNomeAgenda, config);

  let enviados = 0, erros = 0, primeiro = null, ultimo = null;
  if (config.dryRun) {
    console.log(`[job-netvacinas] DRY_RUN: ${grupos.length} envios simulados (nenhuma mensagem enviada)`);
    return { enviados: 0, erros: 0, simulados: grupos.length, dataLote: base, dryRun: true };
  }

  for (const grupo of grupos) {
    const [p] = grupo;
    const vacina = [...new Set(grupo.map((i) => i.vacina).filter(Boolean))].join(', ');
    const variaveis = montarVariaveisTemplate({
      nomePaciente: p.nome_paciente, nomeMedico: config.netvacinasNomeAgenda,
      inicio: p.inicio, ordem, agora, vacina,
    });
    const ts = agoraISO();
    let resultado;
    try {
      const { idMensagem } = await maischat.sendTemplate({ telefone: p.telefone, variaveis, template: templateNome });
      resultado = { id_mensagem: idMensagem, status_envio: 'enviado', ack: 'enviado', erro: null };
      enviados++;
      primeiro ??= ts; ultimo = ts;
    } catch (e) {
      resultado = { id_mensagem: null, status_envio: 'erro', ack: 'falha', erro: String(e.message ?? e) };
      erros++;
      console.error(`[job-netvacinas] erro ao enviar agendamento ${p.id_externo}:`, e.message);
    }
    // Todos os shots do grupo compartilham a mensagem (e o ACK) enviada.
    for (const item of grupo) {
      store.registrarEnvioNetVacinas({
        chave: item.chave, id_externo: item.id_externo, id_paciente: item.id_paciente,
        nome_paciente: item.nome_paciente, telefone: item.telefone, vacina: item.vacina,
        inicio: item.inicio, data_envio: ts, data_lote: base, ...resultado,
      });
    }
  }

  if (primeiro) {
    store.criarLote({
      data_lote: base, fim_campanha: ultimo,
      passe1_em: new Date(new Date(ultimo).getTime() + config.ackPasse1Min * 60000).toISOString(),
      passe2_em: new Date(new Date(primeiro).getTime() + config.ackPasse2Min * 60000).toISOString(),
    });
  }
  console.log(`[job-netvacinas] concluído: ${enviados} enviados, ${erros} erros`);
  return { enviados, erros, simulados: 0, dataLote: base, dryRun: false };
}
