import { amanhaISO, agoraISO } from './datas.js';
import { ehElegivel, montarEnvio } from './agendamentos.js';
import { mapaMedicos, gravarSnapshot } from './agendaSnapshot.js';

function montarVariaveis(envio, ordem) {
  const valores = {
    nome: envio.nome_paciente, medico: envio.nome_medico,
    data: envio.data_br, hora: envio.hora_br,
  };
  return ordem.map((chave) => valores[chave] ?? '');
}

export async function executarJobEnvio({ medx, maischat, store, config, agora = new Date() }) {
  const dataLote = amanhaISO(agora);
  console.log(`[job] iniciando envio para o lote ${dataLote}`);
  const [agenda, usuarios] = await Promise.all([
    medx.getAgenda(dataLote, dataLote), medx.getUsuarios(),
  ]);
  const mapa = mapaMedicos(usuarios, config.medicoCampoNome);

  try {
    gravarSnapshot({ store, agenda, mapa, dataLote, agora });
  } catch (e) {
    console.error('[job] falha ao gravar snapshot da agenda:', e.message);
  }

  let enviados = 0, pulados = 0, erros = 0, simulados = 0;
  let primeiroEnvioIso = null, ultimoEnvioIso = null;

  for (const item of agenda) {
    if (!ehElegivel(item)) { pulados++; continue; }
    if (store.jaEnviado(item.Id_Agendamento)) { pulados++; continue; }
    if (config.dryRun) { simulados++; continue; }
    const envio = montarEnvio(item, mapa);
    const variaveis = montarVariaveis(envio, config.templateVariaveis);
    const ts = agoraISO();
    try {
      const { idMensagem } = await maischat.sendTemplate({ telefone: envio.telefone, variaveis });
      store.registrarEnvio({
        id_agendamento: envio.id_agendamento,
        id_paciente: envio.id_paciente,
        nome_paciente: envio.nome_paciente,
        telefone: envio.telefone,
        id_usuario: envio.id_usuario,
        nome_medico: envio.nome_medico,
        inicio: envio.inicio,
        id_mensagem: idMensagem,
        status_envio: 'enviado',
        ack: 'enviado',
        data_envio: ts,
        data_lote: dataLote,
        erro: null,
      });
      enviados++;
      primeiroEnvioIso ??= ts;
      ultimoEnvioIso = ts;
    } catch (e) {
      store.registrarEnvio({
        id_agendamento: envio.id_agendamento,
        id_paciente: envio.id_paciente,
        nome_paciente: envio.nome_paciente,
        telefone: envio.telefone,
        id_usuario: envio.id_usuario,
        nome_medico: envio.nome_medico,
        inicio: envio.inicio,
        id_mensagem: null,
        status_envio: 'erro',
        ack: 'falha',
        data_envio: ts,
        data_lote: dataLote,
        erro: String(e.message ?? e),
      });
      erros++;
      console.error(`[job] erro ao enviar agendamento ${item.Id_Agendamento}:`, e.message);
    }
  }

  if (enviados > 0) {
    const p1 = new Date(new Date(ultimoEnvioIso).getTime() + config.ackPasse1Min * 60000).toISOString();
    const p2 = new Date(new Date(primeiroEnvioIso).getTime() + config.ackPasse2Min * 60000).toISOString();
    store.criarLote({ data_lote: dataLote, fim_campanha: ultimoEnvioIso, passe1_em: p1, passe2_em: p2 });
  }

  if (config.dryRun) {
    console.log(`[job] DRY_RUN ativo: ${simulados} envios simulados, ${pulados} pulados (0 enviados, nenhuma mensagem enviada)`);
  } else {
    console.log(`[job] concluído: ${enviados} enviados, ${pulados} pulados, ${erros} erros`);
  }
  return { enviados, pulados, erros, simulados, dataLote, dryRun: config.dryRun };
}
