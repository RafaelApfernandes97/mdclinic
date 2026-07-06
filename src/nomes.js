// O MedX devolve o login do médico no campo Usuario (ex.: "draliviaaraujo").
// Sem separadores não dá para segmentar sobrenomes compostos automaticamente,
// então nomes conhecidos ficam no mapa explícito; o restante cai na heurística
// de prefixo Dr/Dra + capitalização do que sobrar.
const NOMES_CONHECIDOS = new Map([
  ['draliviaaraujo', 'Dra Livia Araujo'],
  ['dramarinadedeus', 'Dra Marina de Deus'],
  ['drvitorganem', 'Dr Vitor Ganem'],
]);

const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

function capitalizar(palavra) {
  if (!palavra) return '';
  return palavra.charAt(0).toUpperCase() + palavra.slice(1);
}

function montarNome(palavras) {
  return palavras
    .map((p, i) => (i > 0 && CONECTIVOS.has(p) ? p : capitalizar(p)))
    .join(' ');
}

// Nome sem o título Dr/Dra — para a variável do template, cujo texto
// aprovado na Meta já contém "Dr(a)." antes do placeholder.
export function nomeSemTitulo(nome) {
  return String(nome ?? '').replace(/^dra?\.?\s+/i, '').trim();
}

export function normalizarNomeMedico(usuario) {
  const login = String(usuario ?? '').trim();
  if (!login) return 'Desconhecido';

  const conhecido = NOMES_CONHECIDOS.get(login.toLowerCase());
  if (conhecido) return conhecido;

  // Logins com separadores (espaço, ponto, hífen, underscore) viram palavras.
  const partes = login.toLowerCase().split(/[\s._-]+/).filter(Boolean);
  const primeira = partes[0];
  if (primeira === 'dra' || primeira === 'dr') {
    const resto = montarNome(partes.slice(1));
    return resto ? `${capitalizar(primeira)} ${resto}` : capitalizar(primeira);
  }
  if (partes.length > 1) return montarNome(partes);

  // Login colado sem mapeamento: separa só o título e capitaliza o resto.
  const m = login.toLowerCase().match(/^(dra|dr)(.+)$/);
  if (m) return `${capitalizar(m[1])} ${capitalizar(m[2])}`;
  return capitalizar(login.toLowerCase());
}
