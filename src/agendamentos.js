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

// Chave de comparação tolerante ao 9º dígito: 55 + DDD + últimos 8 dígitos.
// O wa_id do WhatsApp pode vir sem o 9 (553488353700) enquanto o MedX guarda com
// o 9 (5534988353700) — os dois viram a mesma chave (553488353700). Use apenas para
// COMPARAR números; para exibir/enviar, use normalizarTelefone.
export function chaveTelefone(sms) {
  const num = normalizarTelefone(sms);
  if (!num) return null;
  return num.slice(0, 4) + num.slice(-8);
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
