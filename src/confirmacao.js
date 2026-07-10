// Confirmação de consulta acionada pelo bot (clique do paciente no botão "Confirmar"
// do template do WhatsApp). O bot só conhece o TELEFONE do paciente — não o ID do
// agendamento. Aqui localizamos o agendamento no MedX pelo telefone, na janela
// hoje..hoje+janelaDias, escolhemos o mais próximo no tempo e aplicamos CONFIRMADO.
// A janela cobre o envio D+1 (inclusive sexta -> segunda, pulando o fim de semana)
// e o envio antecipado de 15 dias (JANELA_CONFIRMACAO_DIAS).

import { normalizarTelefone, chaveTelefone, ehDesmarcado } from './agendamentos.js';
import { hojeISO, somaDiasISO, agoraLocalISO } from './datas.js';

// Índice CONFIRMADO na tabela do MedX (GetStatusNomeAgenda).
export const STATUS_CONFIRMADO = 8;

// Resolve o nome do tipo de consulta (ex.: "Consulta", vindo em TipoAgendamento no GET)
// para o Id_do_TipoConsulta numérico exigido pelo UpdateAgendamento. Retorna null quando
// não há tipo ou o nome não é reconhecido (preserva o comportamento de "sem tipo").
export function resolverIdTipoConsulta(tipos, nomeTipo) {
  if (nomeTipo == null || String(nomeTipo).trim() === '') return null;
  const lista = Array.isArray(tipos) ? tipos : [];
  const alvo = String(nomeTipo).trim().toLowerCase();
  const achado = lista.find((t) => String(t?.TipoConsulta ?? '').trim().toLowerCase() === alvo);
  return achado ? achado.Id_do_TipoConsulta : null;
}

// Aplica CONFIRMADO a um item (idempotente). Reusa o mesmo caminho para busca por id
// ou por telefone. Retorna { idAgendamento, jaConfirmado }.
async function aplicarConfirmacao(medx, item) {
  if (Number(item.Status) === STATUS_CONFIRMADO) {
    return { idAgendamento: item.Id_Agendamento, jaConfirmado: true };
  }
  const tipos = await medx.getTiposAgendamento();
  const idTipoConsulta = resolverIdTipoConsulta(tipos, item.TipoAgendamento);
  await medx.atualizarStatus(item, STATUS_CONFIRMADO, { confirmar: true, idTipoConsulta });
  return { idAgendamento: item.Id_Agendamento, jaConfirmado: false };
}

// Dentre os agendamentos, escolhe o do telefone informado mais próximo no tempo
// (menor Inicio que ainda não passou em relação a `agoraLocal`). Retorna o item ou null.
// Compara por chaveTelefone (tolerante ao 9º dígito: o wa_id do WhatsApp pode vir sem
// o 9 enquanto o MedX guarda com o 9). Ignora agendamentos DESMARCADOS — confirmar um
// desmarcado o ressuscitaria como CONFIRMADO no MedX.
export function selecionarMaisProximo(agenda, telefone, agoraLocal) {
  const alvo = chaveTelefone(telefone);
  if (!alvo) return null;
  const candidatos = (Array.isArray(agenda) ? agenda : [])
    .filter((x) => chaveTelefone(x.SMS) === alvo)
    .filter((x) => !ehDesmarcado(x))
    .filter((x) => String(x.Inicio ?? '') >= agoraLocal)
    .sort((a, b) => String(a.Inicio).localeCompare(String(b.Inicio)));
  return candidatos[0] ?? null;
}

// Confirma o agendamento do paciente a partir do telefone.
// Janela de busca: hoje até hoje+janelaDias (fuso BR). Escolhe o mais próximo no tempo.
// janelaDias vem de JANELA_CONFIRMACAO_DIAS (default 15) — mesma janela do envio 15 dias.
export async function confirmarPorTelefone({ medx, telefone, agora = new Date(), janelaDias = 15 }) {
  const alvo = normalizarTelefone(telefone);
  if (!alvo) return { success: false, status: 400, erro: 'telefone inválido' };

  const hoje = hojeISO(agora);
  const agenda = await medx.getAgenda(hoje, somaDiasISO(hoje, janelaDias));
  const item = selecionarMaisProximo(agenda, telefone, agoraLocalISO(agora));
  if (!item) {
    return { success: false, status: 404, erro: `Nenhum agendamento futuro para este telefone (próximos ${janelaDias} dias)` };
  }

  const r = await aplicarConfirmacao(medx, item);
  return {
    success: true,
    idAgendamento: r.idAgendamento,
    statusAplicado: 'CONFIRMADO',
    jaConfirmado: r.jaConfirmado,
    inicio: item.Inicio,
    telefone: alvo,
  };
}

// Confirma um agendamento específico pelo Id_Agendamento (utilitário — usado quando o
// id é conhecido). Localiza na agenda do dia informado. Idempotente.
export async function confirmarAgendamento({ medx, idAgendamento, data }) {
  const agenda = await medx.getAgenda(data, data);
  const item = (Array.isArray(agenda) ? agenda : []).find((x) => x.Id_Agendamento === idAgendamento);
  if (!item) {
    return { success: false, status: 404, erro: 'Agendamento não encontrado na data informada' };
  }
  const r = await aplicarConfirmacao(medx, item);
  return { success: true, idAgendamento, statusAplicado: 'CONFIRMADO', jaConfirmado: r.jaConfirmado };
}
