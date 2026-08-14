import {
  formatarDataBR, formatarHoraBR, formatarDiaTemplate, formatarHoraTemplate,
  formatarDataCurta, formatarHoraH, saudacaoBR,
} from './datas.js';
import { nomeSemTitulo } from './nomes.js';

// Cada agenda tem seu template aprovado na Meta, com ordem própria de variáveis
// posicionais (conforme os exemplos cadastrados no Gerenciador de Templates).
// Agendas fora deste mapa (ex.: MD Infusion) usam o template padrão do .env.
const TEMPLATES_MEDICOS = new Map([
  ['draliviaaraujo', { nome: 'confirmar_dralivia', variaveis: ['saudacao', 'data_curta', 'hora'] }],
  ['drvitorganem', { nome: 'confimar_drvitor', variaveis: ['nome', 'dia', 'hora'] }],
  ['dramarinadedeus', { nome: 'confirmar_dramarina', variaveis: ['saudacao', 'nome', 'data_curta', 'hora_h'] }],
]);

// "Dra Livia Araujo" -> "draliviaaraujo" (mesmo formato do login MedX),
// tolerante a acentos, pontuação e espaços.
export function slugMedico(nome) {
  return String(nome ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

// Decide template e ordem de variáveis para a agenda do médico.
export function resolverTemplate(nomeMedico, config) {
  const proprio = TEMPLATES_MEDICOS.get(slugMedico(nomeMedico));
  if (proprio) return { templateNome: proprio.nome, ordem: proprio.variaveis };
  return { templateNome: config.templateNome, ordem: config.templateVariaveis };
}

export function montarVariaveisTemplate({ nomePaciente, nomeMedico, inicio, ordem, agora = new Date(), semHorario = false }) {
  const valores = {
    nome: nomePaciente,
    medico: nomeSemTitulo(nomeMedico),
    data: formatarDataBR(inicio),
    hora: semHorario ? '' : formatarHoraBR(inicio),
    dia: formatarDiaTemplate(inicio),
    hora_curta: semHorario ? '' : formatarHoraTemplate(inicio),
    data_curta: formatarDataCurta(inicio),
    hora_h: semHorario ? '' : formatarHoraH(inicio),
    saudacao: saudacaoBR(agora),
  };
  return ordem.map((chave) => valores[chave] ?? '');
}
