// Suite TD · configurazione da variabili d'ambiente (stesso schema delle app TD esistenti)
const env = process.env;
const list = (v, lower = false) => (v || '').split(',').map((s) => (lower ? s.trim().toLowerCase() : s.trim())).filter(Boolean);
const bool = (v, d = false) => (v == null || v === '' ? d : String(v).toLowerCase() === 'true');

export const LEGACY_KEYS = ['cash', 'orders', 'shipments', 'room', 'nc', 'retail', 'business', 'finance', 'integration', 'contracts', 'circolari', 'ticket', 'cartella', 'referti', 'audit'];
// Moduli ripartiti da zero sull'anagrafica unica: niente travaso né sincronizzazione delle anagrafiche; la sorgente legacy serve
// solo a importare i contenuti dall'app originale (Travaso moduli > Importa i contenuti)
export const FRESH_MODULES = ['cash', 'room', 'nc', 'orders', 'retail', 'contracts', 'business', 'integration', 'circolari', 'ticket', 'cartella', 'referti', 'audit'];
// Moduli con l'importazione dei contenuti dall'app originale
export const CONTENT_IMPORT_MODULES = ['room', 'integration'];

export const config = {
  port: Number(env.PORT || 3000),
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5432/suite',
  sessionSecret: env.SESSION_SECRET || 'dev-only-change-me',
  secureCookies: env.NODE_ENV === 'production',
  sessionHours: Number(env.SESSION_HOURS || 10),
  appName: 'Suite TD',
  appTagline: 'Intranet e Operating Suite di Toscana Diagnostica',
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 40),
  personalQuotaMb: Number(env.PERSONAL_QUOTA_MB || 500),
  requireTotpForAdmins: bool(env.REQUIRE_TOTP_FOR_ADMINS, true),
  autoInternalDomains: list(env.AUTO_INTERNAL_DOMAINS || 'toscanadiagnostica.it', true),

  entra: {
    // Single tenant di default (ENTRA_TENANT_ID); "organizations" per multi tenant
    authority: env.ENTRA_AUTHORITY || env.ENTRA_TENANT_ID || 'organizations',
    tenantId: env.ENTRA_TENANT_ID || '',
    clientId: env.ENTRA_CLIENT_ID || '',
    clientSecret: env.ENTRA_CLIENT_SECRET || '',
    allowedTenants: list(env.ENTRA_ALLOWED_TENANTS),
    get enabled() { return Boolean(this.clientId && this.clientSecret); },
  },

  seed: {
    ownerEmail: (env.SEED_OWNER_EMAIL || 'francesco.epifani@toscanadiagnostica.it').toLowerCase(),
    ownerName: env.SEED_OWNER_NAME || 'Francesco Epifani',
    ownerPassword: env.SEED_OWNER_PASSWORD || '',
  },

  // Posta in uscita via Microsoft Graph (casella suite@) oppure solo registro
  mail: {
    provider: env.MAIL_PROVIDER || (env.GRAPH_SENDER && env.ENTRA_CLIENT_SECRET ? 'graph' : 'log'),  // graph | log
    sender: env.GRAPH_SENDER || 'suite@toscanadiagnostica.it',
    senderName: env.MAIL_FROM_NAME || 'Suite TD · Toscana Diagnostica',
    graph: {
      tenantId: env.GRAPH_TENANT_ID || env.ENTRA_TENANT_ID || '',
      clientId: env.GRAPH_CLIENT_ID || env.ENTRA_CLIENT_ID || '',
      clientSecret: env.GRAPH_CLIENT_SECRET || env.ENTRA_CLIENT_SECRET || '',
    },
  },

  // Azure Blob Storage: tutti i file (cartelle personali, allegati, foto). Nessun file nel database
  blob: {
    connectionString: env.AZURE_STORAGE_CONNECTION_STRING || '',
    container: env.AZURE_STORAGE_CONTAINER || 'suite',
    get enabled() { return Boolean(this.connectionString); },
  },

  // Anthropic (ricerca in linguaggio naturale, frase del giorno, riassunti). Mai dati sensibili
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    get enabled() { return Boolean(this.apiKey); },
  },

  // Database delle app esistenti, sola lettura: LEGACY_CASH_DATABASE_URL, LEGACY_ORDERS_DATABASE_URL, ...
  legacy: Object.fromEntries(LEGACY_KEYS.map((k) => [k, env[`LEGACY_${k.toUpperCase()}_DATABASE_URL`] || ''])),
  legacySyncMinutes: Number(env.LEGACY_SYNC_MINUTES || 30),

  // SSO verso le app esistenti: segreti per modulo (SSO_SECRET_CASH, ...) oppure uno comune (SSO_SECRET)
  sso: {
    defaultSecret: env.SSO_SECRET || '',
    perModule: Object.fromEntries(LEGACY_KEYS.map((k) => [k, env[`SSO_SECRET_${k.toUpperCase()}`] || ''])),
    tokenSeconds: Number(env.SSO_TOKEN_SECONDS || 90),
  },

  schedulerMinutes: Number(env.SCHEDULER_MINUTES || 5),
  disableScheduler: bool(env.DISABLE_SCHEDULER, false),
};

if (env.NODE_ENV === 'production' && config.sessionSecret === 'dev-only-change-me') {
  throw new Error('SESSION_SECRET obbligatorio in produzione');
}
