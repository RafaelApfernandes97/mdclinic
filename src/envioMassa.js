import { randomUUID } from 'node:crypto';
import { agoraISO } from './datas.js';
import { snapshotAgenda } from './agendaSnapshot.js';
import { resolverTemplateEnvioMassa, montarVariaveisTemplate } from './templates.js';

// Envio em massa de uma agenda por período (acionado pelo dashboard).
// Regra: apenas agendamentos PENDENTES recebem mensagem — elegíveis e sem envio
// registrado. Já enviados, falhas anteriores e inelegíveis são pulados e
// aparecem no resumo.
//
// IMPORTANTE — fire-and-forget: o envio em massa NÃO grava em `envios` nem cria
// lotes/ACK. Se gravasse com status "enviado", o job diário (lembrete de 1 dia
// antes) pularia o agendamento em `jaEnviado()` e a mensagem da véspera não
// seria enviada. Por isso o massa apenas dispara e acompanha o progresso em
// memória (o dashboard usa polling); entrega/leitura não são rastreadas e uma
// nova execução no mesmo período reenvia (sem idempotência persistida).
export function criarEnvioMassa({ medx, maischat, store, config }) {
  const jobs = new Map();
  const execucoes = new Map(); // id do job -> promise do loop de envio
  let ativo = null;

  async function executar(job, agora) {
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
      try {
        await maischat.sendTemplate({
          telefone: item.telefone, variaveis, template: templateNome,
        });
        item.status = 'enviado';
        job.enviados++;
      } catch (e) {
        const erro = String(e.message ?? e);
        item.status = 'erro';
        item.erro = erro;
        job.erros++;
        console.error(`[envio-massa] FALHA: agendamento=${item.id_agendamento} telefone=${item.telefone} erro=${erro}`);
      }
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
