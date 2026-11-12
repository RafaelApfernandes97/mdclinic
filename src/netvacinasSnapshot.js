import { normalizarTelefone } from './agendamentos.js';

function dataISO(valor) {
  const data = String(valor ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
}

function horaISO(valor) {
  const texto = String(valor ?? '');
  const horario = texto.includes('T') ? texto.split('T')[1] : texto;
  const match = horario.match(/^(\d{2}:\d{2})(?::(\d{2}))?/);
  return match ? `${match[1]}:${match[2] ?? '00'}` : null;
}

function montarInicio(data, horario) {
  return `${data}T${horario ?? '00:00:00'}`;
}

function pacienteDe(item) {
  const paciente = item ?? {};
  return {
    id_paciente: paciente.internalId == null ? null : String(paciente.internalId),
    nome_paciente: String(paciente.name ?? '').trim() || null,
    telefone: normalizarTelefone(paciente.whatsappPhoneNumber),
  };
}

export function classificarItemNetVacinas(item) {
  if (!item.nome_paciente) return { elegivel: 0, motivo: 'sem_paciente' };
  if (!item.telefone) return { elegivel: 0, motivo: 'sem_telefone' };
  return { elegivel: 1, motivo: null };
}

function itemDeAppointment(appointment, shot, paciente, indice) {
  const data_lote = dataISO(appointment.date);
  if (!data_lote) return null;
  const idAppointment = String(appointment.internalId ?? 'sem-id');
  const idDetalhe = String(shot?.internalId ?? paciente?.internalId ?? indice);
  const dadosPaciente = pacienteDe(paciente);
  const { elegivel, motivo } = classificarItemNetVacinas(dadosPaciente);
  const horario = horaISO(appointment.startTime);

  return {
    chave: `appointment:${idAppointment}:${idDetalhe}`,
    id_externo: idAppointment,
    tipo: 'appointment',
    data_lote,
    inicio: montarInicio(data_lote, horario),
    fim: horaISO(appointment.endTime) ? montarInicio(data_lote, horaISO(appointment.endTime)) : null,
    tem_horario: horario ? 1 : 0,
    ...dadosPaciente,
    vacina: String(shot?.vaccine?.name ?? '').trim() || null,
    elegivel,
    motivo,
  };
}

function itemDeScheduledShot(registro) {
  const data_lote = dataISO(registro.date);
  if (!data_lote) return null;
  const id = String(registro.internalId ?? 'sem-id');
  const dadosPaciente = pacienteDe(registro.patient);
  const { elegivel, motivo } = classificarItemNetVacinas(dadosPaciente);

  return {
    chave: `scheduled-shot:${id}`,
    id_externo: id,
    tipo: 'scheduled-shot',
    data_lote,
    inicio: montarInicio(data_lote, null),
    fim: null,
    tem_horario: 0,
    ...dadosPaciente,
    vacina: String(registro.vaccine?.name ?? '').trim() || null,
    elegivel,
    motivo,
  };
}

export function normalizarAgendaNetVacinas({ appointments = [], scheduledShots = [] }) {
  const itens = [];
  for (const appointment of appointments) {
    const shots = Array.isArray(appointment.shots) ? appointment.shots : [];
    const pacientes = Array.isArray(appointment.patients) ? appointment.patients : [];
    if (shots.length) {
      shots.forEach((shot, indice) => itens.push(itemDeAppointment(
        appointment, shot, shot.patient ?? pacientes[0] ?? null, indice,
      )));
    } else {
      pacientes.forEach((paciente, indice) => itens.push(itemDeAppointment(appointment, null, paciente, indice)));
    }
  }
  // scheduledShots repetem os shots dos appointments (sem horário): só entram os avulsos.
  const shotsDeAppointment = new Set(appointments.flatMap((a) => (a.shots ?? []).map((s) => String(s.internalId))));
  for (const registro of scheduledShots) {
    if (!shotsDeAppointment.has(String(registro.internalId))) itens.push(itemDeScheduledShot(registro));
  }

  const porChave = new Map();
  for (const item of itens) if (item) porChave.set(item.chave, item);
  return [...porChave.values()];
}

// statusPorId (opcional, da API REST): marca confirmado=1/0 nos appointments.
// Sem ele, confirmado fica como estava no banco.
export function gravarSnapshotNetVacinas({ store, agenda, statusPorId = null, agora = new Date() }) {
  const capturadoEm = agora.toISOString();
  const itens = normalizarAgendaNetVacinas(agenda).map((item) => (
    statusPorId && item.tipo === 'appointment'
      ? { ...item, confirmado: statusPorId.get(item.id_externo) === 'confirmed' ? 1 : 0 }
      : item));
  let elegiveis = 0;
  for (const item of itens) {
    store.upsertAgendaNetVacinasItem({ ...item, capturado_em: capturadoEm });
    if (item.elegivel) elegiveis++;
  }
  return { total: itens.length, elegiveis };
}

export async function snapshotAgendaNetVacinas({ netvacinas, netvacinasRest = null, store, inicio, fim, agora = new Date() }) {
  const agenda = await netvacinas.getAgenda(inicio, fim);
  let statusPorId = null;
  if (netvacinasRest) {
    try {
      statusPorId = await netvacinasRest.statusAgendamentos(inicio, fim);
    } catch (e) {
      console.error('[netvacinas] falha ao ler status de confirmação:', e.message);
    }
  }
  return gravarSnapshotNetVacinas({ store, agenda, statusPorId, agora });
}
