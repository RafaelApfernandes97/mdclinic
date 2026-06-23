// Cliente da API REST do Mais Chat (broker Meta Cloud API / wppCloudAPI).
// Envio:  POST {baseUrl}/template/send/{broker}
// ACK:    GET  {baseUrl}/messages/destination/{destino}  -> casa pelo wppMsgId
// Códigos de ack da Meta: -1=falha, 1=enviado, 2=entregue, 3=lido.

export function mapearAck(codigo) {
  const n = Number(codigo);
  if (Number.isNaN(n)) return 'enviado';
  if (n < 0) return 'falha';
  if (n >= 3) return 'lido';
  if (n === 2) return 'entregue';
  return 'enviado'; // 0 ou 1
}

// Monta os componentes do template (Meta) a partir das variáveis posicionais.
// Sem variáveis => sem componentes (template estático).
export function montarComponents(variaveis) {
  if (!variaveis || variaveis.length === 0) return [];
  return [{ type: 'body', parameters: variaveis.map((v) => ({ type: 'text', text: String(v) })) }];
}

export function criarMaisChat({
  baseUrl, broker = 'wppCloudAPI', appId, source, metaToken, apiKey = null,
  templateNome, templateIdioma = 'pt_BR', fetch = globalThis.fetch, debug = false,
}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // log de debug (DEBUG=true) — nunca inclui token/credenciais
  const dbg = (...args) => { if (debug) console.log('[maischat]', ...args); };

  async function sendTemplate({ telefone, variaveis }) {
    const url = `${baseUrl}/template/send/${broker}`;
    const body = JSON.stringify({
      type: 'apiTemplate',
      broker,
      appId,
      source,
      destination: telefone,
      token: metaToken,
      template: {
        name: templateNome,
        language: templateIdioma,
        components: montarComponents(variaveis),
      },
    });
    dbg(`sendTemplate -> destino=${telefone} template=${templateNome} vars=${variaveis?.length ?? 0}`);
    const r = await fetch(url, { method: 'POST', headers, body });
    if (!r.ok) throw new Error(`Falha sendTemplate: ${r.status} ${await r.text()}`);
    const data = await r.json();
    if (data?.status === false) {
      throw new Error(`Falha sendTemplate: ${data.message ?? 'erro'} ${JSON.stringify(data.error ?? {})}`);
    }
    // A API do Mais Chat embrulha a resposta da Meta em { status, data: {...} }.
    const payload = data?.data ?? data;
    const idMensagem = payload?.messages?.[0]?.id ?? null;
    if (!idMensagem) console.warn('[maischat] envio sem wamid retornado — ACK não poderá ser consultado para', telefone);
    dbg(`sendTemplate OK destino=${telefone} wamid=${idMensagem}`);
    return { idMensagem };
  }

  // Consulta o status pela lista de mensagens do destino e casa pelo wppMsgId (wamid).
  // Retorna { ack: null } quando a mensagem ainda não aparece na listagem.
  async function getStatusMensagem(idMensagem, destination) {
    const url = `${baseUrl}/messages/destination/${encodeURIComponent(destination)}?limit=50`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Falha getStatusMensagem: ${r.status}`);
    const data = await r.json();
    const lista = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    const msg = lista.find((m) => m.wppMsgId === idMensagem);
    if (!msg) { dbg(`ack destino=${destination} wamid=${idMensagem} -> pendente`); return { ack: null }; }
    const ack = mapearAck(msg.ack);
    dbg(`ack destino=${destination} wamid=${idMensagem} -> ${ack}`);
    return { ack };
  }

  return { sendTemplate, getStatusMensagem, mapearAck };
}
