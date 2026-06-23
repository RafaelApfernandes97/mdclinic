const OBRIGATORIAS = [
  'MEDX_BASE_URL', 'MEDX_TOKEN_INTEGRACAO', 'MAISCHAT_BASE_URL',
  'MAISCHAT_APP_ID', 'MAISCHAT_SOURCE', 'MAISCHAT_META_TOKEN',
  'MAISCHAT_TEMPLATE_NOME', 'DASHBOARD_PASSWORD', 'SESSION_SECRET', 'RUN_TOKEN',
];

export function carregarConfig(env = process.env) {
  for (const chave of OBRIGATORIAS) {
    if (!env[chave]) throw new Error(`Variável de ambiente obrigatória ausente: ${chave}`);
  }
  return {
    medxBaseUrl: env.MEDX_BASE_URL,
    medxToken: env.MEDX_TOKEN_INTEGRACAO,
    maischatBaseUrl: env.MAISCHAT_BASE_URL,
    maischatBroker: env.MAISCHAT_BROKER ?? 'wppCloudAPI',
    maischatAppId: env.MAISCHAT_APP_ID,
    maischatSource: env.MAISCHAT_SOURCE,
    maischatMetaToken: env.MAISCHAT_META_TOKEN,
    maischatApiKey: env.MAISCHAT_API_KEY ?? null,
    templateNome: env.MAISCHAT_TEMPLATE_NOME,
    templateVariaveis: (env.MAISCHAT_TEMPLATE_VARIAVEIS ?? 'nome,medico,data,hora')
      .split(',').map((v) => v.trim()).filter(Boolean),
    templateIdioma: env.MAISCHAT_TEMPLATE_IDIOMA ?? 'pt_BR',
    medicoCampoNome: env.MEDX_MEDICO_CAMPO ?? 'Nome',
    cronHorario: env.CRON_HORARIO ?? '0 8 * * *',
    ackPasse1Min: Number(env.ACK_PASSE1_MIN ?? 5),
    ackPasse2Min: Number(env.ACK_PASSE2_MIN ?? 60),
    runToken: env.RUN_TOKEN,
    dashboardUser: env.DASHBOARD_USER ?? 'admin',
    dashboardPassword: env.DASHBOARD_PASSWORD,
    sessionSecret: env.SESSION_SECRET,
    port: Number(env.PORT ?? 3000),
    sqlitePath: env.SQLITE_PATH ?? './data/envios.db',
    dryRun: env.DRY_RUN === 'true',
  };
}
