export function mapearAck(codigo) {
  const n = Number(codigo);
  if (n < 0) return 'falha';
  if (n >= 3) return 'lido';
  if (n === 2) return 'entregue';
  return 'enviado'; // 0 ou 1
}

export function criarMaisChat({ baseUrl, token, templateNome, templateIdioma, fetch = globalThis.fetch }) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  async function sendTemplate({ telefone, variaveis }) {
    const url = `${baseUrl}/api/messages/template`;
    const body = JSON.stringify({
      to: telefone, template: templateNome, language: templateIdioma, params: variaveis,
    });
    const r = await fetch(url, { method: 'POST', headers, body });
    if (!r.ok) throw new Error(`Falha sendTemplate: ${r.status} ${await r.text()}`);
    const data = await r.json();
    return { idMensagem: data.messageId ?? data.id ?? null };
  }

  async function getStatusMensagem(idMensagem) {
    const url = `${baseUrl}/api/messages/${encodeURIComponent(idMensagem)}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Falha getStatusMensagem: ${r.status}`);
    const data = await r.json();
    const codigo = data.ack ?? data.status;
    return { ack: mapearAck(codigo) };
  }

  return { sendTemplate, getStatusMensagem, mapearAck };
}
