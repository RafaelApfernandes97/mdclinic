// Tabela de status da agenda (índice = valor do campo Status no agendamento).
// Origem: GET /api/integration/GetStatusNomeAgenda. Manter em sincronia com a conta.
export const STATUS_AGENDA = Object.freeze([
  'DESMARCADO',            // 0
  'PRIMEIRA CONSULTA',     // 1
  'COMPARECEU',            // 2
  'FALTOU',                // 3
  'PARTICULAR',            // 4
  'REPRESENTANTE',         // 5
  'TELEMEDICINA',          // 6
  'RETORNO',               // 7
  'CONFIRMADO',            // 8
  'FERIADO',               // 9
  'INICIADO ATENDIMENTO',  // 10
  'AGENDA FECHADA',        // 11
  'MD INFUSION',           // 12
]);

// Confirmação exige exatamente esta string para marcar o agendamento como confirmado.
export const CONFIRMACAO_OK = 'Mensagem Salva com Sucesso';

// Remapeia um item retornado por GetAgenda/GetAgendabyUsuario para o corpo esperado
// por UpdateAgendamento. Os nomes de campo divergem entre GET e PUT.
export function mapearAgendamentoParaUpdate(agendamento, alteracoes = {}) {
  if (!agendamento || typeof agendamento !== 'object') {
    throw new Error('mapearAgendamentoParaUpdate: agendamento inválido');
  }
  if (agendamento.Id_Agendamento == null) {
    throw new Error('mapearAgendamentoParaUpdate: Id_Agendamento ausente no item de origem');
  }
  const base = {
    Id_do_Agendamento: agendamento.Id_Agendamento,
    Id_do_Usuario: agendamento.Id_Usuario,
    Inicio: agendamento.Inicio,
    Final: agendamento.Fim,
    Descricao: agendamento.Descricao,
    Status: agendamento.Status,
    Vinculado_a: agendamento.Id_Paciente,
    Confirmacao: agendamento.Confirmacao,
    Id_do_TipoConsulta: agendamento.Id_do_TipoConsulta ?? agendamento.TipoAgendamento ?? null,
  };
  return { ...base, ...alteracoes };
}

export function criarMedx({ baseUrl, token, fetch = globalThis.fetch }) {
  let authToken = null;

  async function autenticar() {
    const url = `${baseUrl}/api/integration/GetAuthorizedToken?token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) throw new Error(`Falha ao autenticar no MedX: ${r.status}`);
    const txt = (await r.text()).trim();
    authToken = txt.replace(/^"|"$/g, ''); // remove aspas se vier como JSON string
    return authToken;
  }

  async function getAuthToken() {
    if (!authToken) await autenticar();
    return authToken;
  }

  async function comAuth(fazerReq, parse = 'json') {
    await getAuthToken();
    let r = await fazerReq(authToken);
    if (r.status === 401) { await autenticar(); r = await fazerReq(authToken); }
    if (!r.ok) throw new Error(`Erro MedX: ${r.status} ${await r.text()}`);
    if (parse === 'text') return r.text();
    return r.json();
  }

  function getAgenda(inicio, fim) {
    const url = `${baseUrl}/api/integration/GetAgenda?inicio=${inicio}&fim=${fim}`;
    return comAuth((tk) => fetch(url, { headers: { Authorization: `Bearer ${tk}` } }));
  }

  function getUsuarios() {
    const url = `${baseUrl}/api/integration/GetUsuariosAgenda`;
    return comAuth((tk) => fetch(url, { headers: { Authorization: `Bearer ${tk}` } }));
  }

  function getAgendaPorUsuario(inicio, fim, idUsuario) {
    const qs = new URLSearchParams({ inicio, fim, idUsuario: String(idUsuario) });
    const url = `${baseUrl}/api/integration/GetAgendabyUsuario?${qs}`;
    return comAuth((tk) => fetch(url, { headers: { Authorization: `Bearer ${tk}` } }));
  }

  // Lista os status cadastrados na conta (índice → nome). Ver STATUS_AGENDA.
  function getStatusNomeAgenda() {
    const url = `${baseUrl}/api/integration/GetStatusNomeAgenda`;
    return comAuth((tk) => fetch(url, { headers: { Authorization: `Bearer ${tk}` } }));
  }

  // Lista os tipos de consulta ({ Id_do_TipoConsulta, TipoConsulta }). Usado para
  // resolver o nome vindo em TipoAgendamento (GET) para o id numérico exigido no PUT.
  function getTiposAgendamento() {
    const url = `${baseUrl}/api/integration/gettiposagendamento`;
    return comAuth((tk) => fetch(url, { headers: { Authorization: `Bearer ${tk}` } }));
  }

  // Envia um objeto já no formato do UpdateAgendamento (PUT). Use mapearAgendamentoParaUpdate
  // para converter um item vindo de GetAgenda/GetAgendabyUsuario.
  function atualizarAgendamento(corpo) {
    if (!corpo || corpo.Id_do_Agendamento == null) {
      throw new Error('atualizarAgendamento: corpo inválido (Id_do_Agendamento obrigatório)');
    }
    const url = `${baseUrl}/api/integration/UpdateAgendamento`;
    return comAuth((tk) => fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }), 'text');
  }

  // Atualiza somente o Status de um agendamento existente, preservando os demais campos.
  // Recebe o item completo (como retornado por GetAgendabyUsuario) para evitar sobrescrever
  // dados com um PUT parcial. novoStatus é o índice da tabela STATUS_AGENDA.
  // Passe { confirmar: true } para marcar Confirmacao = CONFIRMACAO_OK (ex.: status CONFIRMADO).
  // Passe { idTipoConsulta } para enviar o id numérico do tipo (GET traz só o nome em
  // TipoAgendamento; o PUT exige Id_do_TipoConsulta). Quando omitido, usa o fallback do mapper.
  function atualizarStatus(agendamento, novoStatus, { confirmar = false, idTipoConsulta } = {}) {
    if (!Number.isInteger(novoStatus) || novoStatus < 0 || novoStatus >= STATUS_AGENDA.length) {
      throw new Error(`atualizarStatus: novoStatus inválido (${novoStatus}); esperado 0..${STATUS_AGENDA.length - 1}`);
    }
    const alteracoes = { Status: novoStatus };
    if (confirmar) alteracoes.Confirmacao = CONFIRMACAO_OK;
    if (idTipoConsulta !== undefined) alteracoes.Id_do_TipoConsulta = idTipoConsulta;
    const corpo = mapearAgendamentoParaUpdate(agendamento, alteracoes);
    return atualizarAgendamento(corpo);
  }

  return {
    getAuthToken,
    getAgenda,
    getUsuarios,
    getAgendaPorUsuario,
    getStatusNomeAgenda,
    getTiposAgendamento,
    atualizarAgendamento,
    atualizarStatus,
  };
}
