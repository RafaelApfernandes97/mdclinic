import { ehBloqueio, ehDesmarcado, normalizarTelefone, extrairNomePaciente } from './agendamentos.js';
import { normalizarNomeMedico } from './nomes.js';

// GetUsuariosAgenda real devolve { IddoUsuario, Usuario }; GetAgenda usa Id_Usuario
// nos agendamentos. Aceitamos ambos os formatos (e o campo de nome configurável).
export function mapaMedicos(usuarios, campoNome = 'Usuario') {
  const m = new Map();
  for (const u of usuarios) {
    const id = u.IddoUsuario ?? u.Id_Usuario;
    const nome = u[campoNome] ?? u.Usuario ?? u.Nome ?? 'Desconhecido';
    m.set(id, normalizarNomeMedico(nome));
  }
  return m;
}

export function classificarItem(item) {
  if (ehBloqueio(item.Descricao)) return { elegivel: 0, motivo: 'bloqueio' };
  if (ehDesmarcado(item)) return { elegivel: 0, motivo: 'desmarcado' };
  if (!item.Id_Paciente) return { elegivel: 0, motivo: 'sem_paciente' };
  if (!normalizarTelefone(item.SMS)) return { elegivel: 0, motivo: 'sem_telefone' };
  return { elegivel: 1, motivo: null };
}

export function gravarSnapshot({ store, agenda, mapa, dataLote, agora = new Date() }) {
  const capturadoEm = agora.toISOString();
  // persiste TODOS os médicos do mapa (mesmo sem agenda no dia) p/ o seletor
  for (const [id, nome] of mapa) {
    if (id != null) store.upsertMedico({ id_usuario: id, nome });
  }
  let total = 0, elegiveis = 0;
  for (const item of agenda) {
    const { elegivel, motivo } = classificarItem(item);
    // cada item é agrupado pelo seu próprio dia (Inicio é hora-parede BR), o que
    // permite janelas de vários dias sem misturar os agendamentos no painel.
    const diaItem = String(item.Inicio ?? '').split('T')[0] || dataLote;
    store.upsertAgendaItem({
      id_agendamento: item.Id_Agendamento,
      data_lote: diaItem,
      id_usuario: item.Id_Usuario,
      nome_medico: mapa.get(item.Id_Usuario) ?? 'Desconhecido',
      id_paciente: item.Id_Paciente ?? null,
      nome_paciente: extrairNomePaciente(item.Descricao),
      telefone: normalizarTelefone(item.SMS),
      inicio: item.Inicio,
      elegivel,
      motivo,
      descricao: item.Descricao ?? '',
      capturado_em: capturadoEm,
    });
    total++;
    if (elegivel) elegiveis++;
  }
  return { dataLote, total, elegiveis };
}

export async function snapshotAgenda({ medx, store, config, dataLote, agora = new Date() }) {
  const [agenda, usuarios] = await Promise.all([
    medx.getAgenda(dataLote, dataLote), medx.getUsuarios(),
  ]);
  const mapa = mapaMedicos(usuarios, config.medicoCampoNome);
  return gravarSnapshot({ store, agenda, mapa, dataLote, agora });
}
