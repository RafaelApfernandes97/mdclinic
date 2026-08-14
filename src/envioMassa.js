import { randomUUID } from 'node:crypto';
import { agoraISO } from './datas.js';
import { snapshotAgenda } from './agendaSnapshot.js';
import { resolverTemplateEnvioMassa, montarVariaveisTemplate } from './templates.js';

// Envio em massa de uma agenda por período (acionado pelo dashboard).
// Regra: apenas agendamentos PENDENTES recebem mensagem — elegíveis e sem envio
// registrado. Já enviados, falhas anteriores e inelegíveis são pulados e
// aparecem no resumo. Cada envio registra o status do próprio dia no painel,
// então todos os dias enviados de cada paciente ficam atualizados.
// O job roda em memória: o dashboard acompanha o progresso via polling.
export function criarEnvioMassa({ medx, maischat, store, config }) {
  const jobs = new Map();
  const execucoes = new Map(); // id do job -> promise do loop de envio
  let ativo = null;

  async function executar(job, agora) {
    const porDia = new Map(); // dia -> { primeiro, ultimo } para os passes de ACK
    for (const item of job.itens) {
      item.status = 'enviando';
      if (config.dryRun) {
        item.status = 'simulado';
        job.simulados++;
        continue;
      }
      const { templateNome, ordem } = resolverTemplateEnvioMassa(item.nome_medico, config);
      const variaveis = montarVariaveisTemplate({
        nomePaciente: item.nome_paciente, nomeMedico: item.nome_medico,
        inicio: item.inicio, ordem, agora,
      });
      const ts = agoraISO();
      const base = {
        id_agendamento: item.id_agendamento, id_paciente: item.id_paciente,
        nome_paciente: item.nome_paciente, telefone: item.telefone,
        id_usuario: item.id_usuario, nome_medico: item.nome_medico, inicio: item.inicio,
        data_envio: ts, data_lote: item.data_lote,
      };
      try {
        const { idMensagem } = await maischat.sendTemplate({
          telefone: item.telefone, variaveis, template: templateNome,
        });
        store.registrarEnvio({ ...base, id_mensagem: idMensagem, status_envio: 'enviado', ack: 'enviado', erro: null });
        item.status = 'enviado';
        job.enviados++;
        const reg = porDia.get(item.data_lote);
        if (reg) reg.ultimo = ts; else porDia.set(item.data_lote, { primeiro: ts, ultimo: ts });
      } catch (e) {
        const erro = String(e.message ?? e);
        store.registrarEnvio({ ...base, id_mensagem: null, status_envio: 'erro', ack: 'falha', erro });
        item.status = 'erro';
        item.erro = erro;
        job.erros++;
        console.error(`[envio-massa] FALHA: agendamento=${item.id_agendamento} telefone=${item.telefone} erro=${erro}`);
      }
    }
    for (const [dia, { primeiro, ultimo }] of porDia) {
      const p1 = new Date(new Date(ultimo).getTime() + config.ackPasse1Min * 60000).toISOString();
      const p2 = new Date(new Date(primeiro).getTime() + config.ackPasse2Min * 60000).toISOString();
      store.criarLote({ data_lote: dia, fim_campanha: ultimo, passe1_em: p1, passe2_em: p2 });
    }
    job.estado = 'concluido';
    job.concluido_em = agoraISO();
    console.log(`[envio-massa] concluído: agenda="${job.medico}" ${job.inicio}..${job.fim} — ${job.enviados} enviados, ${job.erros} erros, ${job.simulados} simulados (${job.resumo.ja_enviados} já enviados, ${job.resumo.falhas_anteriores} falhas anteriores e ${job.resumo.inelegiveis} inelegíveis pulados)`);
  }

  return {
    // Atualiza o snapshot do período no MedX, seleciona os pendentes da agenda e
    // dispara o envio em segundo plano. Retorna o job para acompanhamento.
    async iniciar({ nomeMedico, inicio, fim, agora = new Date() }) {
      if (ativo && ativo.estado === 'executando') {
        return { ok: false, status: 409, erro: 'Já existe um envio em massa em andamento' };
      }
      await snapshotAgenda({ medx, store, config, dataLote: inicio, dataFim: fim, agora });
      const pendentes = store.agendaPendentes(inicio, fim, nomeMedico);
      const job = {
        id: randomUUID(),
        medico: nomeMedico,
        inicio,
        fim,
        dryRun: config.dryRun,
        estado: pendentes.length ? 'executando' : 'concluido',
        criado_em: agoraISO(),
        concluido_em: pendentes.length ? null : agoraISO(),
        resumo: store.resumoEnvioMassa(inicio, fim, nomeMedico),
        total: pendentes.length,
        enviados: 0,
        erros: 0,
        simulados: 0,
        itens: pendentes.map((p) => ({ ...p, status: 'aguardando', erro: null })),
      };
      jobs.set(job.id, job);
      ativo = job;
      console.log(`[envio-massa] iniciado: agenda="${nomeMedico}" ${inicio}..${fim} — ${job.total} pendentes de ${job.resumo.total} agendamentos dryRun=${config.dryRun ? 'true' : 'false'}`);
      if (job.estado === 'executando') {
        execucoes.set(job.id, executar(job, agora).catch((e) => {
          job.estado = 'concluido';
          job.concluido_em = agoraISO();
          console.error('[envio-massa] falha inesperada no loop de envio:', e.message);
        }));
      }
      return { ok: true, job };
    },
    obter(id) {
      return jobs.get(id) ?? null;
    },
    // Aguarda o loop de envio terminar (usado nos testes; o dashboard usa polling).
    aguardar(id) {
      return execucoes.get(id) ?? Promise.resolve();
    },
  };
}
