import { proximoDiaUtilISO, somaDiasISO, agoraISO } from './datas.js';
import { ehElegivel, montarEnvio } from './agendamentos.js';
import { mapaMedicos, gravarSnapshot } from './agendaSnapshot.js';
import { resolverTemplate, montarVariaveisTemplate } from './templates.js';

const JANELA_15_DIAS_PADRAO = 15;

export async function executarJobEnvio({ medx, maischat, store, config, agora = new Date() }) {
  // Base: próximo dia útil (seg-qui => D+1; sexta => segunda). Todas as agendas recebem
  // o envio da base. Agendas com "envio 15 dias" ativo recebem também os dias seguintes,
  // até `base + (janela-1)`. Os demais dias caem no envio diário quando forem a base.
  const base = proximoDiaUtilISO(agora);
  const janelaDias = config.janelaConfirmacaoDias ?? JANELA_15_DIAS_PADRAO;
  const habilitados = new Set(store.medicosEnvio15Dias());
  const usaJanela = habilitados.size > 0;
  const fim = usaJanela ? somaDiasISO(base, janelaDias - 1) : base;
  console.log(`[job] envio base=${base}` + (usaJanela ? ` + janela ${janelaDias}d até ${fim} (${habilitados.size} agenda(s))` : ''));

  const [agenda, usuarios] = await Promise.all([
    medx.getAgenda(base, fim), medx.getUsuarios(),
  ]);
  const mapa = mapaMedicos(usuarios, config.medicoCampoNome);

  try {
    gravarSnapshot({ store, agenda, mapa, dataLote: base, agora });
  } catch (e) {
    console.error('[job] falha ao gravar snapshot da agenda:', e.message);
  }

  let enviados = 0, pulados = 0, erros = 0, simulados = 0;
  const porDia = new Map(); // dia -> { primeiro, ultimo } dos envios, para o lote/ACK

  for (const item of agenda) {
    const dia = String(item.Inicio ?? '').split('T')[0];
    // dias além da base só entram para agendas com envio de 15 dias ativado.
    const noEscopo = dia === base || habilitados.has(item.Id_Usuario);
    if (!noEscopo) continue;
    if (!ehElegivel(item)) { pulados++; continue; }
    if (store.jaEnviado(item.Id_Agendamento)) { pulados++; continue; }
    if (config.dryRun) { simulados++; continue; }
    const envio = montarEnvio(item, mapa);
    const { templateNome, ordem } = resolverTemplate(envio.nome_medico, config);
    const variaveis = montarVariaveisTemplate({
      nomePaciente: envio.nome_paciente, nomeMedico: envio.nome_medico,
      inicio: envio.inicio, ordem, agora,
    });
    const ts = agoraISO();
    try {
      const { idMensagem } = await maischat.sendTemplate({
        telefone: envio.telefone, variaveis, template: templateNome,
      });
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
        data_lote: dia,
        erro: null,
      });
      enviados++;
      const reg = porDia.get(dia);
      if (reg) reg.ultimo = ts; else porDia.set(dia, { primeiro: ts, ultimo: ts });
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
        data_lote: dia,
        erro: String(e.message ?? e),
      });
      erros++;
      console.error(`[job] erro ao enviar agendamento ${item.Id_Agendamento}:`, e.message);
    }
  }

  // um lote (e seus passes de ACK) por dia que teve envio.
  for (const [dia, { primeiro, ultimo }] of porDia) {
    const p1 = new Date(new Date(ultimo).getTime() + config.ackPasse1Min * 60000).toISOString();
    const p2 = new Date(new Date(primeiro).getTime() + config.ackPasse2Min * 60000).toISOString();
    store.criarLote({ data_lote: dia, fim_campanha: ultimo, passe1_em: p1, passe2_em: p2 });
  }

  if (config.dryRun) {
    console.log(`[job] DRY_RUN ativo: ${simulados} envios simulados, ${pulados} pulados (0 enviados, nenhuma mensagem enviada)`);
  } else {
    console.log(`[job] concluído: ${enviados} enviados, ${pulados} pulados, ${erros} erros`);
  }
  return { enviados, pulados, erros, simulados, dataLote: base, dryRun: config.dryRun };
}
