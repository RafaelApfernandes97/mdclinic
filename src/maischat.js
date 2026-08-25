// Cliente da API REST do Mais Chat (broker Meta Cloud API / wppCloudAPI).
// Envio v3 (principal): POST {baseUrl}/template/send/{broker}
// Envio v2 (fallback):  POST {v2BaseUrl}/msg/template/{broker}  (Authorization: Bearer <token do tenant>)
//   Quando o envio pela v3 falha e a v2 está configurada, tenta-se a v2 com o mesmo corpo.
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
  v2BaseUrl = null, v2Token = null,
  templateNome, templateIdioma = 'pt_BR', fetch = globalThis.fetch, debug = false,
}) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  // Fallback v2: exige URL base e token do tenant (JWT) — só é tentado se ambos existirem.
  const v2Habilitado = Boolean(v2BaseUrl && v2Token);
  const v2Headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${v2Token}` };
  // log de debug (DEBUG=true) — nunca inclui token/credenciais
  const dbg = (...args) => { if (debug) console.log('[maischat]', ...args); };

  // Faz o POST do template numa das versões da API e devolve { idMensagem }.
  // Lança em falha de rede, HTTP não-ok ou status:false do Mais Chat.
  async function postarTemplate(url, cabecalhos, body, telefone) {
    const r = await fetch(url, { method: 'POST', headers: cabecalhos, body });
    if (!r.ok) throw new Error(`Falha sendTemplate: ${r.status} ${await r.text()}`);
    const data = await r.json();
    if (data?.status === false) {
      throw new Error(`Falha sendTemplate: ${data.message ?? 'erro'} ${JSON.stringify(data.error ?? {})}`);
    }
    // A API do Mais Chat embrulha a resposta da Meta em { status, data: {...} }.
    const payload = data?.data ?? data;
    const idMensagem = payload?.messages?.[0]?.id ?? null;
    if (!idMensagem) console.warn('[maischat] envio sem wamid retornado — ACK não poderá ser consultado para', telefone);
    return { idMensagem };
  }

  // `template` (opcional) sobrepõe o nome padrão — usado pelos templates por agenda.
  async function sendTemplate({ telefone, variaveis, template }) {
    const nome = template ?? templateNome;
    // Mesmo corpo para v3 e v2; só mudam URL e cabeçalhos de autenticação.
    const body = JSON.stringify({
      type: 'apiTemplate',
      broker,
      appId,
      source,
      destination: telefone,
      token: metaToken,
      template: {
        name: nome,
        language: templateIdioma,
        components: montarComponents(variaveis),
      },
    });
    dbg(`sendTemplate -> destino=${telefone} template=${nome} vars=${variaveis?.length ?? 0}`);
    try {
      const r = await postarTemplate(`${baseUrl}/template/send/${broker}`, headers, body, telefone);
      dbg(`sendTemplate OK (v3) destino=${telefone} wamid=${r.idMensagem}`);
      return r;
    } catch (erroV3) {
      if (!v2Habilitado) throw erroV3;
      console.warn(`[maischat] envio v3 falhou para ${telefone}, tentando fallback v2:`, erroV3.message);
      const r = await postarTemplate(`${v2BaseUrl}/msg/template/${broker}`, v2Headers, body, telefone);
      dbg(`sendTemplate OK (v2) destino=${telefone} wamid=${r.idMensagem}`);
      return r;
    }
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
