import { formatarDataBR, formatarHoraBR } from './datas.js';

export function extrairNomePaciente(descricao = '') {
  return String(descricao).split(',')[0].trim();
}

export function normalizarTelefone(sms) {
  const digitos = String(sms ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  let num = digitos;
  if (!num.startsWith('55')) num = '55' + num;
  // 55 + DDD(2) + numero(8 ou 9) => 12 ou 13 dígitos
  if (num.length < 12 || num.length > 13) return null;
  return num;
}

const PALAVRAS_BLOQUEIO = ['FECHADA', 'BLOQUEADO', 'SEQUENCIAL'];

export function ehBloqueio(descricao = '') {
  const up = String(descricao).toUpperCase();
  return PALAVRAS_BLOQUEIO.some((p) => up.includes(p));
}

// Status DESMARCADO na tabela do MedX (GetStatusNomeAgenda, índice 0).
export const STATUS_DESMARCADO = 0;

// Agendamento desmarcado no MedX: não deve receber confirmação.
export function ehDesmarcado(item) {
  return Number(item?.Status) === STATUS_DESMARCADO;
}

export function ehElegivel(item) {
  if (ehBloqueio(item.Descricao)) return false;
  if (ehDesmarcado(item)) return false;
  if (!item.Id_Paciente) return false;
  if (!normalizarTelefone(item.SMS)) return false;
  return true;
}

export function montarEnvio(item, mapaMedicos) {
  return {
    id_agendamento: item.Id_Agendamento,
    id_paciente: item.Id_Paciente,
    nome_paciente: extrairNomePaciente(item.Descricao),
    telefone: normalizarTelefone(item.SMS),
    id_usuario: item.Id_Usuario,
    nome_medico: mapaMedicos.get(item.Id_Usuario) ?? 'Desconhecido',
    inicio: item.Inicio,
    data_br: formatarDataBR(item.Inicio),
    hora_br: formatarHoraBR(item.Inicio),
  };
}
