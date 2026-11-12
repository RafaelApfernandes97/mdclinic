const PAGE_SIZE = 100;
const DAY_START_IN_SAO_PAULO = 'T03:00:00.000Z';

const APPOINTMENTS_QUERY = `
  query($startDate: Date!, $endDate: Date!, $page: ID, $perPage: Int!) {
    myClinic {
      appointments(startDate: $startDate, endDate: $endDate, take: $perPage, after: $page) {
        pagination { hasNextPage nextPage }
        records {
          internalId
          date
          startTime
          endTime
          patients { internalId name whatsappPhoneNumber }
          shots {
            internalId
            vaccine { internalId name }
            patient { internalId name whatsappPhoneNumber }
          }
        }
      }
    }
  }
`;

const SCHEDULED_SHOTS_QUERY = `
  query($startDate: Date!, $endDate: Date!, $page: ID, $perPage: Int!) {
    myClinic {
      scheduledShots(startDate: $startDate, endDate: $endDate, take: $perPage, after: $page) {
        pagination { hasNextPage nextPage }
        records {
          internalId
          date
          patient { internalId name whatsappPhoneNumber }
          vaccine { internalId name }
        }
      }
    }
  }
`;

function dataParaApi(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) {
    throw new Error('A data NetVacinas deve estar no formato AAAA-MM-DD.');
  }
  return `${data}${DAY_START_IN_SAO_PAULO}`;
}

export function criarNetVacinas({ url, token, fetch = globalThis.fetch }) {
  if (!url) throw new Error('URL da API NetVacinas ausente');
  if (!token) throw new Error('Token da API NetVacinas ausente');

  async function consultar(query, variables) {
    const resposta = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    let corpo;
    try {
      corpo = await resposta.json();
    } catch {
      throw new Error(`NetVacinas retornou HTTP ${resposta.status} sem JSON válido.`);
    }
    if (!resposta.ok) throw new Error(`NetVacinas retornou HTTP ${resposta.status}.`);
    if (corpo.errors?.length) {
      throw new Error(`NetVacinas GraphQL: ${corpo.errors.map((e) => e.message).join('; ')}`);
    }
    return corpo.data;
  }

  async function listarTodas(query, campo, inicio, fim) {
    const records = [];
    let page = null;

    do {
      const data = await consultar(query, {
        startDate: dataParaApi(inicio),
        endDate: dataParaApi(fim),
        page,
        perPage: PAGE_SIZE,
      });
      const conexao = data?.myClinic?.[campo];
      if (!conexao?.pagination || !Array.isArray(conexao.records)) {
        throw new Error(`Resposta inválida da NetVacinas em ${campo}.`);
      }
      records.push(...conexao.records);
      if (!conexao.pagination.hasNextPage) break;
      page = conexao.pagination.nextPage;
      if (page == null) throw new Error(`Cursor ausente na paginação de ${campo}.`);
    } while (page != null);

    return records;
  }

  return {
    async getAgenda(inicio, fim) {
      const [appointments, scheduledShots] = await Promise.all([
        listarTodas(APPOINTMENTS_QUERY, 'appointments', inicio, fim),
        listarTodas(SCHEDULED_SHOTS_QUERY, 'scheduledShots', inicio, fim),
      ]);
      return { appointments, scheduledShots };
    },
  };
}

// API REST (leitura e escrita), separada do GraphQL e com token próprio.
// O id do agendamento é o mesmo internalId do GraphQL.
export function criarNetVacinasRest({ baseUrl, token, fetch = globalThis.fetch }) {
  if (!baseUrl) throw new Error('URL da API REST NetVacinas ausente');
  if (!token) throw new Error('Token da API REST NetVacinas ausente');
  async function get(caminho) {
    const resposta = await fetch(`${baseUrl}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok) throw new Error(`NetVacinas REST HTTP ${resposta.status}${corpo?.error ? `: ${corpo.error}` : ''}`);
    return corpo;
  }

  return {
    // Map id do agendamento -> status (ex.: "confirmed"; null = não confirmado).
    async statusAgendamentos(inicio, fim) {
      const status = new Map();
      for (let page = 1; ; page++) {
        const corpo = await get(`/appointments?filters[start_date]=${inicio}&filters[end_date]=${fim}&per_page=50&page=${page}`);
        if (!Array.isArray(corpo?.data)) throw new Error('Resposta inválida da NetVacinas em /appointments.');
        for (const a of corpo.data) status.set(String(a.id), a.status ?? null);
        if (!corpo.page_info?.has_next_page) return status;
      }
    },
    async confirmarAgendamento(id) {
      const resposta = await fetch(`${baseUrl}/appointments/${encodeURIComponent(id)}/confirm`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        throw new Error(`NetVacinas confirm HTTP ${resposta.status}${corpo?.error ? `: ${corpo.error}` : ''}`);
      }
      return corpo;
    },
  };
}
