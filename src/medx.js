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

  async function comAuth(fazerReq) {
    await getAuthToken();
    let r = await fazerReq(authToken);
    if (r.status === 401) { await autenticar(); r = await fazerReq(authToken); }
    if (!r.ok) throw new Error(`Erro MedX: ${r.status} ${await r.text()}`);
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

  return { getAuthToken, getAgenda, getUsuarios };
}
