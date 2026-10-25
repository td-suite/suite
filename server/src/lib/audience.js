// Perimetro di visibilità dei contenuti di Community e dell'indice di ricerca.
// audience: {"type":"ALL"} | {"type":"INTERNAL"} | {"type":"SITES","ids":[..]} | {"type":"ORGS","ids":[..]} | {"type":"MODULE","key":"cash"} | {"type":"USERS","ids":[..]}
// Un utente interno è chi appartiene a Toscana Diagnostica (organizzazione GRUPPO/SOCIETA) o ha email del dominio aziendale.

export function isInternal(u) {
  if (!u) return false;
  if (u.level === 'OWNER' || u.level === 'ADMIN') return true;
  if (u.organization_kind === 'GRUPPO' || u.organization_kind === 'SOCIETA') return true;
  return (u.internal_domains || []).some((d) => u.email.toLowerCase().endsWith('@' + d));
}

// Restituisce frammento SQL (con parametri) che filtra una colonna JSONB "audience" per l'utente
export function audienceSql(u, col = 'audience', params = []) {
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const sites = u.site_ids || [];
  const orgs = u.org_ids || [];
  const mods = Object.keys(u.grants || {});
  const parts = [`${col}->>'type' = 'ALL'`];
  if (isInternal(u)) parts.push(`${col}->>'type' = 'INTERNAL'`);
  // gli id dentro "ids" possono essere numeri o stringhe: confronto come testo
  const hasAny = (type, arr) => `(${col}->>'type' = '${type}' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${col}->'ids') e WHERE e = ANY(${p(arr.map(String))}::text[])))`;
  parts.push(hasAny('USERS', [u.id]));
  if (sites.length) parts.push(hasAny('SITES', sites));
  if (orgs.length) parts.push(hasAny('ORGS', orgs));
  if (mods.length) parts.push(`(${col}->>'type' = 'MODULE' AND ${col}->>'key' = ANY(${p(mods)}::text[]))`);
  if (u.level === 'OWNER' || u.level === 'ADMIN') parts.push('TRUE');
  return { sql: `(${parts.join(' OR ')})`, params };
}

export function canSee(u, audience) {
  if (!audience || audience.type === 'ALL') return true;
  if (u.level === 'OWNER' || u.level === 'ADMIN') return true;
  switch (audience.type) {
    case 'INTERNAL': return isInternal(u);
    case 'USERS': return (audience.ids || []).map(Number).includes(u.id);
    case 'SITES': return (audience.ids || []).some((id) => (u.site_ids || []).includes(Number(id)));
    case 'ORGS': return (audience.ids || []).some((id) => (u.org_ids || []).includes(Number(id)));
    case 'MODULE': return Boolean(u.grants?.[audience.key]);
    default: return false;
  }
}
