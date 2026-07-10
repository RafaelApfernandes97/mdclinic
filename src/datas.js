const TZ = 'America/Sao_Paulo';

// Retorna 'YYYY-MM-DD' do dia (no fuso BR) correspondente a `data`.
function dataLocalISO(data) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(data); // en-CA => YYYY-MM-DD
}

// 'YYYY-MM-DD' de hoje no fuso BR.
export function hojeISO(agora = new Date()) {
  return dataLocalISO(agora);
}

// 'YYYY-MM-DDTHH:MM:SS' do instante atual no fuso BR — mesmo formato do campo Inicio
// dos agendamentos (hora de parede, sem timezone), permitindo comparação por string.
export function agoraLocalISO(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora);
  const p = (t) => partes.find((x) => x.type === t).value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}

export function amanhaISO(agora = new Date()) {
  const hojeBR = dataLocalISO(agora);
  // soma 1 dia de forma segura usando UTC a partir da data BR
  const [y, m, d] = hojeBR.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

// Soma `dias` a uma data 'YYYY-MM-DD' e devolve 'YYYY-MM-DD' (aritmética em UTC).
export function somaDiasISO(dataISO, dias) {
  const [y, m, d] = String(dataISO).split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

// true se hoje (fuso BR) é sábado ou domingo.
export function ehFimDeSemanaBR(agora = new Date()) {
  const [y, m, d] = hojeISO(agora).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo, 6=sábado
  return dow === 0 || dow === 6;
}

// Próximo dia útil (segunda a sexta) estritamente após hoje, no fuso BR. 'YYYY-MM-DD'.
// Ex.: sexta → segunda; sábado/domingo → segunda; demais dias úteis → dia seguinte.
export function proximoDiaUtilISO(agora = new Date()) {
  const [y, m, d] = hojeISO(agora).split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  do {
    base.setUTCDate(base.getUTCDate() + 1);
  } while (base.getUTCDay() === 0 || base.getUTCDay() === 6);
  return base.toISOString().slice(0, 10);
}

export function formatarDataBR(iso) {
  const [data] = iso.split('T');
  const [y, m, d] = data.split('-');
  return `${d}/${m}/${y}`;
}

export function formatarHoraBR(iso) {
  const hora = iso.split('T')[1] ?? '00:00:00';
  return hora.slice(0, 5);
}

// "Terça-feira 14/07" — formato do template de confirmação (ex.: "na {{2}} às ...").
export function formatarDiaTemplate(iso) {
  const [data] = iso.split('T');
  const [y, m, d] = data.split('-').map(Number);
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
  const capitalizada = semana.charAt(0).toUpperCase() + semana.slice(1);
  return `${capitalizada} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

// "14" ou "14:30" — o template já traz a palavra "horas" após a variável.
export function formatarHoraTemplate(iso) {
  const [h, min] = formatarHoraBR(iso).split(':');
  return min === '00' ? String(Number(h)) : `${Number(h)}:${min}`;
}

// "14/07" — dd/mm sem o ano.
export function formatarDataCurta(iso) {
  const [d, m] = formatarDataBR(iso).split('/');
  return `${d}/${m}`;
}

// "14h" ou "14h30".
export function formatarHoraH(iso) {
  const [h, min] = formatarHoraBR(iso).split(':');
  return min === '00' ? `${Number(h)}h` : `${Number(h)}h${min}`;
}

// Saudação pela hora do envio no fuso BR.
export function saudacaoBR(agora = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', hourCycle: 'h23',
  }).format(agora));
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function agoraISO() {
  return new Date().toISOString();
}
