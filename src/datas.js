const TZ = 'America/Sao_Paulo';

// Retorna 'YYYY-MM-DD' do dia (no fuso BR) correspondente a `data`.
function dataLocalISO(data) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(data); // en-CA => YYYY-MM-DD
}

export function amanhaISO(agora = new Date()) {
  const hojeBR = dataLocalISO(agora);
  // soma 1 dia de forma segura usando UTC a partir da data BR
  const [y, m, d] = hojeBR.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + 1);
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

export function agoraISO() {
  return new Date().toISOString();
}
