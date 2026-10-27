// Set dimostrativo: coerente con le sedi reali, il listino GIPO e le linee di prodotto di Toscana Diagnostica.
// Generato in modo deterministico (seed fisso): utile per vedere la dashboard prima degli import reali.
import { q, one, many, tx } from '../db.js';
import { refreshCustomerStats } from './customers.js';
import { holidays } from './calendar.js';

// PRNG deterministico (mulberry32)
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const DEMO_PRODUCTS = [
  // Laboratorio (prezzi dal tracciato GIPO)
  ['0014', 'Emocromocitometrico completo', 'LAB', 'Patologia clinica', 7, 1, 1, 12],
  ['003', 'Formula leucocitaria', 'LAB', 'Patologia clinica', 7, 1, 1, null],
  ['010', 'V.E.S.', 'LAB', 'Patologia clinica', 5, 1, 1, null],
  ['016', 'Tempo di protrombina (PT)', 'LAB', 'Patologia clinica', 6, 1, 1, null],
  ['020', 'Glicemia', 'LAB', 'Chimica clinica', 4, 1, 1, 12],
  ['021', 'Emoglobina glicata (HbA1c)', 'LAB', 'Chimica clinica', 14, 2, 1, 6],
  ['025', 'Colesterolo totale', 'LAB', 'Chimica clinica', 4, 1, 1, 12],
  ['026', 'Colesterolo HDL', 'LAB', 'Chimica clinica', 5, 1, 1, 12],
  ['027', 'Trigliceridi', 'LAB', 'Chimica clinica', 4, 1, 1, 12],
  ['030', 'Creatinina', 'LAB', 'Chimica clinica', 4, 1, 1, 12],
  ['031', 'Azotemia', 'LAB', 'Chimica clinica', 4, 1, 1, null],
  ['035', 'Transaminasi GOT/GPT', 'LAB', 'Chimica clinica', 7, 1, 1, null],
  ['040', 'Esame urine completo', 'LAB', 'Patologia clinica', 5, 1, 1, 12],
  ['050', 'TSH', 'LAB', 'Endocrinologia', 12, 2, 1, 12],
  ['051', 'FT4', 'LAB', 'Endocrinologia', 12, 2, 1, null],
  ['055', 'Vitamina D (25-OH)', 'LAB', 'Chimica clinica', 22, 4, 1, 12],
  ['060', 'PSA totale', 'LAB', 'Marcatori', 16, 3, 1, 12],
  ['061', 'Ferritina', 'LAB', 'Chimica clinica', 10, 2, 1, null],
  ['070', 'Tampone faringeo', 'LAB', 'Microbiologia', 15, 3, 1, null],
  ['071', 'Urinocoltura', 'LAB', 'Microbiologia', 12, 2, 1, null],
  ['080', 'Test intolleranze alimentari', 'LAB', 'Allergologia', 120, 35, 1, null],
  ['081', 'Pannello allergeni inalanti', 'LAB', 'Allergologia', 65, 18, 1, null],
  ['090', 'Esame citologico (Pap test)', 'LAB', 'Anatomia patologica', 35, 8, 5, 36],
  ['091', 'HPV DNA test', 'LAB', 'Biologia molecolare', 60, 15, 5, 36],
  ['095', 'Test genetico celiachia', 'LAB', 'Biologia molecolare', 110, 30, 5, null],
  // Imaging
  ['RM001', 'RM ginocchio', 'IMG', 'Risonanza magnetica', 160, 40, 30, null],
  ['RM002', 'RM colonna lombo-sacrale', 'IMG', 'Risonanza magnetica', 170, 42, 30, null],
  ['RM003', 'RM encefalo', 'IMG', 'Risonanza magnetica', 190, 45, 30, null],
  ['RM004', 'RM spalla', 'IMG', 'Risonanza magnetica', 160, 40, 30, null],
  ['TC001', 'TC torace', 'IMG', 'Tomografia computerizzata', 150, 38, 20, null],
  ['TC002', 'TC addome completo con mdc', 'IMG', 'Tomografia computerizzata', 260, 70, 30, null],
  ['TC003', 'TC colonna', 'IMG', 'Tomografia computerizzata', 140, 35, 20, null],
  ['MAM003', 'Mammografia bilaterale con tomosintesi', 'IMG', 'Senologia', 110, 25, 20, 12],
  ['ECO009', 'Ecografia mammaria bilaterale', 'IMG', 'Senologia', 70, 15, 20, 12],
  ['ECO001', 'Ecografia addome completo', 'IMG', 'Ecografia', 80, 15, 20, null],
  ['ECO003', 'Ecografia tiroidea', 'IMG', 'Ecografia', 60, 12, 15, 12],
  ['ECO012', 'Ecografia pelvica transvaginale', 'IMG', 'Ecografia', 70, 14, 20, 12],
  ['ECO020', 'Ecografia muscolo-tendinea', 'IMG', 'Ecografia', 65, 12, 20, null],
  ['DOP011', 'Ecocolordoppler tronchi sovraortici', 'IMG', 'Doppler', 90, 18, 20, 12],
  ['DOP002', 'Ecocolordoppler arti inferiori venoso', 'IMG', 'Doppler', 90, 18, 20, null],
  ['CAR006', 'Ecocolordoppler cardiaco', 'IMG', 'Cardiologia', 110, 20, 30, 12],
  ['MOC001', 'MOC DEXA colonna e femore', 'IMG', 'Densitometria', 60, 12, 15, 24],
  ['RX001', 'RX torace', 'IMG', 'Radiologia', 45, 10, 10, null],
  ['RX010', 'RX colonna lombo-sacrale', 'IMG', 'Radiologia', 50, 10, 10, null],
  ['RX020', 'Ortopanoramica', 'IMG', 'Radiologia', 40, 8, 10, null],
  ['EMG003', 'Elettromiografia arti superiori', 'IMG', 'Neurofisiologia', 232, 50, 20, null],
  ['EMG004', 'Elettromiografia arti inferiori', 'IMG', 'Neurofisiologia', 196, 45, 20, null],
  // Specialistica
  ['MSPE007', 'Visita cardiologica con ECG', 'SPEC', 'Cardiologia', 120, 60, 30, 12],
  ['MSPE003', 'Visita ginecologica', 'SPEC', 'Ginecologia', 110, 55, 30, 12],
  ['MSPE029', 'Visita senologica', 'SPEC', 'Senologia', 170, 80, 20, 12],
  ['MSPE041', 'Visita chirurgia vascolare', 'SPEC', 'Chirurgia vascolare', 140, 70, 20, null],
  ['MSPE010', 'Visita dermatologica con mappatura nei', 'SPEC', 'Dermatologia', 130, 65, 30, 12],
  ['MSPE012', 'Visita ortopedica', 'SPEC', 'Ortopedia', 120, 60, 20, null],
  ['MSPE015', 'Visita endocrinologica', 'SPEC', 'Endocrinologia', 120, 60, 30, null],
  ['MSPE018', 'Visita urologica', 'SPEC', 'Urologia', 120, 60, 20, 12],
  ['MSPE020', 'Visita oculistica', 'SPEC', 'Oculistica', 100, 50, 30, 12],
  ['MSPE022', 'Visita neurologica', 'SPEC', 'Neurologia', 130, 65, 30, null],
  ['MSPE025', 'Visita gastroenterologica', 'SPEC', 'Gastroenterologia', 120, 60, 30, null],
  ['MSPE030', 'Visita nutrizionale', 'SPEC', 'Nutrizione', 90, 45, 40, null],
  ['MSPE033', 'Visita fisiatrica', 'SPEC', 'Fisiatria', 100, 50, 30, null],
  ['END002', 'Colonscopia in sedazione', 'SPEC', 'Endoscopia digestiva', 350, 140, 40, null],
  ['END001', 'Gastroscopia in sedazione', 'SPEC', 'Endoscopia digestiva', 280, 110, 30, null],
  // Medicina del lavoro (B2B)
  ['MDL001', 'Visita medica periodica medicina del lavoro', 'MDL', 'Medicina del lavoro', 55, 25, 20, 12],
  ['MDL002', 'Visita preassuntiva', 'MDL', 'Medicina del lavoro', 60, 25, 20, null],
  ['MDL003', 'Audiometria', 'MDL', 'Medicina del lavoro', 25, 6, 15, 12],
  ['MDL004', 'Spirometria', 'MDL', 'Medicina del lavoro', 25, 6, 15, 12],
  ['MDL005', 'Esami ematochimici protocollo sorveglianza', 'MDL', 'Medicina del lavoro', 35, 8, 5, 12],
  ['MDL006', 'Test tossicologico urine', 'MDL', 'Medicina del lavoro', 45, 12, 5, 12],
  ['MDL007', 'Visita oculistica (videoterminalisti)', 'MDL', 'Medicina del lavoro', 40, 15, 15, 24],
  // Pacchetti
  ['PAC010', 'Pacchetto ginecologico (visita + eco TV)', 'PAC', 'Prevenzione donna', 150, 65, 45, 12],
  ['PAC011', 'Pacchetto senologico (visita + eco + mammografia)', 'PAC', 'Prevenzione donna', 290, 110, 60, 12],
  ['PAC012', 'Pacchetto vascolare (visita + TSA)', 'PAC', 'Prevenzione cardiovascolare', 200, 85, 40, 12],
  ['PAC001', 'Check-up cardiologico (visita + ecocardio)', 'PAC', 'Prevenzione cardiovascolare', 200, 75, 50, 12],
  ['PAC020', 'Check-up laboratorio base', 'PAC', 'Prevenzione', 39, 9, 5, 12],
  ['PAC021', 'Check-up laboratorio donna', 'PAC', 'Prevenzione donna', 59, 14, 5, 12],
  ['PAC022', 'Check-up laboratorio uomo over 50', 'PAC', 'Prevenzione uomo', 69, 16, 5, 12],
  ['PAC023', 'Check-up tiroide (TSH, FT4, eco)', 'PAC', 'Prevenzione', 79, 22, 20, 12],
  ['PAC030', 'Profilo sportivo (esami + ECG)', 'PAC', 'Sport', 89, 25, 20, 12],
];

const FIRST_F = ['Maria', 'Francesca', 'Giulia', 'Laura', 'Elena', 'Sara', 'Chiara', 'Anna', 'Paola', 'Silvia', 'Martina', 'Alessandra', 'Lucia', 'Valentina', 'Federica', 'Roberta', 'Simona', 'Daniela', 'Cristina', 'Elisa', 'Giovanna', 'Rita', 'Marta', 'Serena', 'Irene', 'Beatrice', 'Alice', 'Sofia', 'Giorgia', 'Monica'];
const FIRST_M = ['Marco', 'Andrea', 'Francesco', 'Luca', 'Alessandro', 'Giuseppe', 'Matteo', 'Lorenzo', 'Stefano', 'Paolo', 'Roberto', 'Giovanni', 'Simone', 'Davide', 'Fabio', 'Massimo', 'Antonio', 'Riccardo', 'Leonardo', 'Tommaso', 'Niccolò', 'Filippo', 'Gabriele', 'Enrico', 'Maurizio', 'Claudio', 'Franco', 'Sergio', 'Pietro', 'Duccio'];
const LAST = ['Rossi', 'Bianchi', 'Innocenti', 'Conti', 'Fabbri', 'Giusti', 'Martini', 'Nannini', 'Pieri', 'Bartolini', 'Benvenuti', 'Cecchi', 'Chiti', 'Del Lungo', 'Falcini', 'Gori', 'Landi', 'Lenzi', 'Lombardi', 'Mancini', 'Mazzoni', 'Mugnaini', 'Nencini', 'Paoli', 'Pratesi', 'Querci', 'Ricci', 'Sani', 'Tempesti', 'Vannucci', 'Baldi', 'Biagini', 'Casini', 'Donati', 'Ferri', 'Galli', 'Masi', 'Nesi', 'Orlandi', 'Pucci', 'Santini', 'Ulivi', 'Venturi', 'Zini', 'Bellini', 'Corsi', 'Fantini', 'Marchi', 'Pagni', 'Toccafondi'];

// Bacino geografico: comune, provincia, CAP, peso, sedi "naturali"
const AREAS = [
  ['Firenze', 'FI', '50100', 30, ['FI-CEC', 'FI-CIFS', 'FI-COR', 'FI-PAO']],
  ['Sesto Fiorentino', 'FI', '50019', 10, ['SF-RAG', 'SF-COL']],
  ['Campi Bisenzio', 'FI', '50013', 6, ['CB-POL', 'SF-COL']],
  ['Calenzano', 'FI', '50041', 4, ['CA-PP', 'SF-RAG']],
  ['Scandicci', 'FI', '50018', 5, ['FI-CEC']],
  ['Borgo San Lorenzo', 'FI', '50032', 5, ['BSL-BIO']],
  ['Scarperia e San Piero', 'FI', '50038', 2, ['BSL-BIO']],
  ['Vicchio', 'FI', '50039', 1, ['BSL-BIO']],
  ['Prato', 'PO', '59100', 6, ['PC-MOR', 'MM-PP']],
  ['Poggio a Caiano', 'PO', '59016', 3, ['PC-MOR']],
  ['Montemurlo', 'PO', '59013', 3, ['MM-PP']],
  ['Quarrata', 'PT', '51039', 3, ['QU-PP']],
  ['Pistoia', 'PT', '51100', 2, ['QU-PP']],
  ['Livorno', 'LI', '57100', 14, ['LI-LAM', 'LI-FOL', 'LI-MAR', 'LI-ROM', 'LI-MON', 'LI-MTL']],
  ['Rosignano Marittimo', 'LI', '57016', 3, ['RS-POL']],
  ['Collesalvetti', 'LI', '57014', 1, ['LI-MON', 'LI-FOL']],
  ['Cecina', 'LI', '57023', 1, ['RS-POL']],
  ['Pisa', 'PI', '56100', 1, ['LI-LAM']],
];

const B2B = [
  ['Manifatture Tessili Pratesi S.p.A.', 'Manifatturiero', 'AZIENDA', 'Prato', 'PO', 320],
  ['Logistica Toscana S.r.l.', 'Logistica', 'AZIENDA', 'Calenzano', 'FI', 140],
  ['Cantieri Navali Labronici', 'Cantieristica', 'AZIENDA', 'Livorno', 'LI', 210],
  ['Chimica Solvay Rosignano (appalto)', 'Chimico', 'AZIENDA', 'Rosignano Marittimo', 'LI', 95],
  ['Supermercati Coop Nord Toscana', 'GDO', 'AZIENDA', 'Sesto Fiorentino', 'FI', 480],
  ['Hotel Florentia Group', 'Turismo', 'AZIENDA', 'Firenze', 'FI', 160],
  ['Pelletteria Fiorentina S.r.l.', 'Moda', 'AZIENDA', 'Scandicci', 'FI', 85],
  ['Costruzioni Mugello S.r.l.', 'Edilizia', 'AZIENDA', 'Borgo San Lorenzo', 'FI', 60],
  ['Comune di Campi Bisenzio', 'Pubblica amministrazione', 'AZIENDA', 'Campi Bisenzio', 'FI', 240],
  ['Studio Dentistico Associato Belfiore', 'Sanità', 'STRUTTURA', 'Firenze', 'FI', 12],
  ['Poliambulatorio Val di Sieve', 'Sanità', 'STRUTTURA', 'Pontassieve', 'FI', 20],
  ['Laboratorio Analisi Versilia', 'Sanità', 'LABORATORIO', 'Viareggio', 'LU', 15],
  ['Casa di Cura Villa Serena', 'Sanità', 'STRUTTURA', 'Firenze', 'FI', 110],
  ['RSA Le Querce', 'Sanità', 'STRUTTURA', 'Quarrata', 'PT', 70],
  ['UniSalute (convenzione)', 'Assicurazione', 'ASSICURAZIONE', 'Bologna', 'BO', null],
  ['Fondo Est', 'Fondo sanitario', 'FONDO', 'Roma', 'RM', null],
  ['Previmedical (RBM)', 'Assicurazione', 'ASSICURAZIONE', 'Treviso', 'TV', null],
  ['Farmacie Comunali Fiorentine', 'Farmacia', 'AZIENDA', 'Firenze', 'FI', 130],
  ['Autolinee Toscane (deposito Livorno)', 'Trasporti', 'AZIENDA', 'Livorno', 'LI', 190],
  ['Vetreria Empolese', 'Manifatturiero', 'AZIENDA', 'Empoli', 'FI', 75],
];

const OPERATORS = ['Giulia M.', 'Sara P.', 'Elena R.', 'Francesca B.', 'Martina C.', 'Chiara L.', 'Alessia F.', 'Laura G.', 'Valentina N.', 'Silvia T.', 'Irene V.', 'Monica D.', 'Paola S.', 'Serena A.', 'Marta Z.'];
const CHANNELS_B2C = [['SPORTELLO', 34], ['TELEFONO', 22], ['TUOTEMPO', 24], ['WEB', 8], ['MMG', 7], ['APP', 5]];
const PAY_B2C = [['PRIVATO', 70], ['SSN', 14], ['ASSICURAZIONE', 9], ['FONDO', 5], ['CONVENZIONE', 2]];

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const weighted = (r, pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let x = r() * tot; for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; } return pairs[pairs.length - 1][0]; };
const iso = (d) => d.toISOString().slice(0, 10);
const fakeCf = (r, i) => { const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let s = ''; for (let k = 0; k < 6; k++) s += L[Math.floor(r() * 26)]; return `${s}${String(70 + (i % 30)).padStart(2, '0')}${L[Math.floor(r() * 12)]}${String(10 + Math.floor(r() * 60))}D${String(612 + (i % 300)).padStart(3, '0')}X`; };

export async function loadDemo() {
  const r = rng(20261014);
  const today = new Date();
  const lines = Object.fromEntries((await many('SELECT id, code FROM product_lines')).map((x) => [x.code, x.id]));
  const sites = await many('SELECT id, code, kind FROM sites_v WHERE active AND in_network');
  const siteByCode = Object.fromEntries(sites.map((s) => [s.code, s]));
  // operatori di accettazione per sede (2-3 a testa)
  const opsBySite = {}; let oi = 0; const usedOps = new Set(); for (const s of sites) { const n = s.kind === 'PUNTO_PRELIEVI' ? 2 : 3; opsBySite[s.id] = []; for (let k = 0; k < n; k++) { let nm; do { nm = `${OPERATORS[oi % OPERATORS.length].split(' ')[0]} ${LAST[(oi * 7 + k * 3) % LAST.length].slice(0, 2)}.`; oi++; } while (usedOps.has(nm)); usedOps.add(nm); opsBySite[s.id].push(nm); } }
  const opPick = (siteId) => { const l = opsBySite[siteId]; return l[Math.floor(Math.pow(r(), 1.5) * l.length)]; };

  // Prestazioni
  const prodIds = {};
  for (const p of DEMO_PRODUCTS) {
    const row = await one(`INSERT INTO products(code, description, line_id, specialty, price, cost, duration_min, periodicity_months, is_package, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DEMO') ON CONFLICT ((upper(code))) DO UPDATE SET description=EXCLUDED.description RETURNING id, code`,
      [p[0], p[1], lines[p[2]], p[3], p[4], p[5], p[6], p[7], p[2] === 'PAC']);
    prodIds[row.code] = { id: row.id, line: p[2], price: p[4], code: p[0] };
  }
  const byLine = (l) => Object.values(prodIds).filter((p) => p.line === l);

  // Campagne e promozioni 2026
  const year = today.getFullYear();
  const promoDefs = [
    [1, 'Gennaio della prevenzione', 'Riparti da te', 'Il check-up di inizio anno a 39 €: 12 esami, referto in 24 ore.', 'Check-up laboratorio base', ['PAC020', 'PAC021', 'PAC022'], 'PREZZO_FISSO', 39],
    [2, 'Cuore di febbraio', 'Ascolta il tuo cuore', 'Visita cardiologica con ECG ed ecocardio: il check-up cardiologico a 169 €.', 'Prevenzione cardiovascolare', ['PAC001', 'MSPE007', 'CAR006'], 'PREZZO_FISSO', 169],
    [3, 'Marzo donna', 'Prenditi cura di te', 'Pacchetto senologico e ginecologico con il 20% di sconto per tutto il mese.', 'Prevenzione donna', ['PAC011', 'PAC010', 'MAM003', 'ECO009'], 'PERCENTUALE', 20],
    [4, 'Aprile tiroide', 'Energia in equilibrio', 'Check-up tiroide: TSH, FT4 ed ecografia a 69 €.', 'Tiroide', ['PAC023', 'ECO003', '050'], 'PREZZO_FISSO', 69],
    [5, 'Maggio pelle', 'La tua pelle sotto controllo', 'Visita dermatologica con mappatura dei nei a 99 €.', 'Prevenzione dermatologica', ['MSPE010'], 'PREZZO_FISSO', 99],
    [6, 'Giugno in movimento', 'Pronti per l\'estate', 'Profilo sportivo e visita ortopedica: 15% di sconto, referti in 24 ore.', 'Sport e movimento', ['PAC030', 'MSPE012', 'ECO020'], 'PERCENTUALE', 15],
    [7, 'Luglio vascolare', 'Gambe leggere', 'Ecocolordoppler arti inferiori e visita vascolare: pacchetto a 179 €.', 'Circolazione', ['PAC012', 'DOP002', 'MSPE041'], 'PREZZO_FISSO', 179],
    [8, 'Agosto senza attese', 'Il tuo tempo vale', 'Risonanza e TC entro 48 ore dalla prenotazione, prezzo bloccato.', 'Imaging senza attese', ['RM001', 'RM002', 'TC001'], 'NESSUNO', null],
    [9, 'Settembre uomo', 'Un controllo in più', 'Check-up uomo over 50 con PSA e visita urologica a 129 €.', 'Prevenzione uomo', ['PAC022', '060', 'MSPE018'], 'PREZZO_FISSO', 129],
    [10, 'Ottobre rosa', 'Ottobre è rosa', 'Mammografia con tomosintesi ed ecografia mammaria: pacchetto a 149 €.', 'Prevenzione senologica', ['MAM003', 'ECO009', 'MSPE029', 'PAC011'], 'PREZZO_FISSO', 149],
    [11, 'Novembre ossa', 'Forti dentro', 'MOC DEXA e vitamina D a 69 €.', 'Salute delle ossa', ['MOC001', '055'], 'PREZZO_FISSO', 69],
    [12, 'Dicembre regalo salute', 'Regala tempo, regala salute', 'Gift card check-up: il regalo che vale tutto l\'anno.', 'Gift card', ['PAC020', 'PAC021', 'PAC022', 'PAC001'], 'PERCENTUALE', 10],
  ];
  const promoIds = {};
  for (const p of promoDefs) {
    const [m, name, claim, body, theme, codes, dtype, dval] = p;
    const start = new Date(Date.UTC(year, m - 1, 1)); const end = new Date(Date.UTC(year, m, 0));
    const status = end < today ? 'CONCLUSA' : start <= today ? 'ATTIVA' : m <= today.getMonth() + 3 ? 'APPROVATA' : 'BOZZA';
    const row = await one(`INSERT INTO promotions(year, month, name, theme, claim, claim_short, body, target, channel_scope, discount_type, discount_value, start_date, end_date, product_ids, push_plan, materials, kpi_target, status, promo_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'B2C',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [year, m, name, theme, claim, claim.split(' ').slice(0, 3).join(' '), body, m === 3 || m === 10 ? 'Donne 40-69' : m === 9 ? 'Uomini over 50' : 'Adulti 30-70', dtype, dval, iso(start), iso(end),
        JSON.stringify(codes.map((c) => prodIds[c]?.id).filter(Boolean)),
        JSON.stringify([
          { channel: 'INSTORE', action: 'Sostituzione locandine e cavalieri in tutte le sedi', when: `${year}-${String(m).padStart(2, '0')}-01`, owner: 'Site manager', done: end < today },
          { channel: 'SMS', action: 'SMS ai clienti del target con ultima visita > 10 mesi', when: `${year}-${String(m).padStart(2, '0')}-03`, owner: 'Retail & Communications', done: end < today },
          { channel: 'META', action: 'Campagna social geolocalizzata 15 km dalle sedi', when: `${year}-${String(m).padStart(2, '0')}-01`, owner: 'Agenzia', done: end < today },
          { channel: 'MMG', action: 'Mailing ai medici di base del bacino', when: `${year}-${String(m).padStart(2, '0')}-05`, owner: 'Retail & Communications', done: start < today },
          { channel: 'ACCETTAZIONE', action: 'Script di proposta allo sportello e in call center', when: `${year}-${String(m).padStart(2, '0')}-01`, owner: 'Responsabile accettazione', done: start < today },
        ]),
        JSON.stringify([{ type: 'Locandina 70x100', status: end < today ? 'CONSEGNATO' : start <= today ? 'CONSEGNATO' : 'IN_PRODUZIONE' }, { type: 'Cavaliere A5', status: start <= today ? 'CONSEGNATO' : 'DA_FARE' }, { type: 'Post social (3)', status: start <= today ? 'PUBBLICATO' : 'DA_FARE' }, { type: 'SMS', status: start <= today ? 'INVIATO' : 'DA_FARE' }, { type: 'Palinsesto monitor', status: start <= today ? 'ATTIVO' : 'DA_FARE' }]),
        JSON.stringify({ bookings: 120 + m * 10, revenue: 15000 + m * 800, new_customers: 40 }), status, `PROMO${String(m).padStart(2, '0')}`]);
    promoIds[m] = row.id;
  }
  const campDefs = [
    ['Lancio brand Toscana Diagnostica', 'AFFISSIONI', 'NOTORIETA', `${year}-04-15`, `${year}-06-15`, 18000, 17400, null, 4],
    ['Ottobre rosa · social geolocalizzato', 'META', 'ACQUISIZIONE', `${year}-09-25`, `${year}-10-31`, 3500, 2100, 'ROSA26', 10],
    ['Google Search prenotazione RM/TC', 'GOOGLE', 'ACQUISIZIONE', `${year}-05-01`, `${year}-12-31`, 9000, 5200, null, 8],
    ['SMS richiamo check-up annuale', 'SMS', 'RIATTIVAZIONE', `${year}-01-08`, `${year}-01-31`, 900, 860, 'CHECK39', 1],
    ['Newsletter prevenzione donna', 'EMAIL', 'UPSELL', `${year}-03-01`, `${year}-03-31`, 300, 300, 'DONNA26', 3],
    ['Mailing MMG bacino Mugello', 'MMG', 'ACQUISIZIONE', `${year}-02-10`, `${year}-04-30`, 1200, 1200, null, 2],
    ['Medicina del lavoro · outreach aziende Prato', 'PARTNER', 'B2B', `${year}-05-01`, `${year}-09-30`, 2500, 1900, null, null],
    ['Open day Borgo San Lorenzo', 'EVENTO', 'NOTORIETA', `${year}-06-14`, `${year}-06-14`, 2200, 2350, 'OPENBSL', 6],
    ['Radio locale · Livorno settembre', 'RADIO', 'NOTORIETA', `${year}-09-01`, `${year}-09-30`, 4000, 4000, null, 9],
  ];
  const campaigns = [];
  for (const c of campDefs) {
    const [name, channel, objective, s, e, budget, spent, code, pm] = c;
    const status = new Date(e) < today ? 'CONCLUSA' : new Date(s) <= today ? 'ATTIVA' : 'PIANIFICATA';
    const row = await one(`INSERT INTO campaigns(name, channel, objective, start_date, end_date, budget, spent, promo_code, status, impressions, clicks, leads, bookings, promotion_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, promo_code, start_date, end_date, channel`,
      [name, channel, objective, s, e, budget, spent, code, status, ['META', 'GOOGLE'].includes(channel) ? Math.round(80000 + r() * 400000) : null, ['META', 'GOOGLE', 'EMAIL'].includes(channel) ? Math.round(1500 + r() * 9000) : null, Math.round(30 + r() * 300), null, pm ? promoIds[pm] : null]);
    campaigns.push(row);
  }

  // Clienti B2C
  const N = 1800;
  const customers = [];
  for (let i = 0; i < N; i++) {
    const sex = r() < 0.56 ? 'F' : 'M';
    const area = weighted(r, AREAS.map((a) => [a, a[3]]));
    const age = Math.max(1, Math.min(94, Math.round(18 + Math.abs(r() + r() + r() - 1.5) * 50)));
    const birth = new Date(Date.UTC(today.getFullYear() - age, Math.floor(r() * 12), 1 + Math.floor(r() * 28)));
    const home = siteByCode[pick(r, area[4])] || pick(r, sites);
    const row = await one(`INSERT INTO customers(kind, source, external_id, last_name, first_name, sex, birth_date, tax_code, email, phone, city, province, zip, home_site_id, acquisition_channel, marketing_consent)
      VALUES ('B2C',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [r() < 0.3 ? 'TUOTEMPO' : 'GIPO', `D${100000 + i}`, pick(r, LAST), sex === 'F' ? pick(r, FIRST_F) : pick(r, FIRST_M), sex, iso(birth), fakeCf(r, i), r() < 0.7 ? `demo${i}@example.org` : null, r() < 0.85 ? `3${String(Math.floor(r() * 1e9)).padStart(9, '0')}` : null, area[0], area[1], area[2], home.id, weighted(r, CHANNELS_B2C), r() < 0.62]);
    customers.push({ id: row.id, sex, age, home, area });
  }
  // Clienti B2B
  const b2b = [];
  for (const [i, b] of B2B.entries()) {
    const row = await one(`INSERT INTO customers(kind, source, external_id, company_name, vat_number, sector, b2b_type, city, province, employees, contact_name, email, acquisition_channel)
      VALUES ('B2B','STUDIOLAB',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONVENZIONE') RETURNING id`,
      [`S${500 + i}`, b[0], `0${String(1000000000 + Math.floor(r() * 8999999999)).slice(0, 11)}`, b[1], b[2], b[3], b[4], b[5], `${pick(r, FIRST_F)} ${pick(r, LAST)}`, `hr${i}@example.org`]);
    b2b.push({ id: row.id, type: b[2], employees: b[5] });
  }

  // Vendite: ultimi 15 mesi, con stagionalità e spinta delle promozioni
  const start = new Date(Date.UTC(today.getFullYear(), today.getMonth() - 14, 1));
  const days = Math.floor((today - start) / 86400000);
  let n = 0; let ref = 400000;
  const LAB = byLine('LAB'); const IMG = byLine('IMG'); const SPEC = byLine('SPEC'); const PAC = byLine('PAC'); const MDL = byLine('MDL');
  const batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const cols = ['source', 'external_ref', 'line_no', 'sale_date', 'sale_time', 'customer_id', 'b2b_customer_id', 'site_id', 'product_id', 'product_code', 'quantity', 'gross_amount', 'discount', 'net_amount', 'payment_kind', 'booking_channel', 'promo_code', 'campaign_id', 'promotion_id', 'operator'];
    const vals = []; const ph = [];
    batch.forEach((row, i) => { ph.push(`(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`); vals.push(...cols.map((c) => row[c] ?? null)); });
    await q(`INSERT INTO sales(${cols.join(',')}) VALUES ${ph.join(',')} ON CONFLICT DO NOTHING`, vals);
    batch.length = 0;
  };
  for (let d = 0; d <= days; d++) {
    const date = new Date(start.getTime() + d * 86400000);
    const dow = date.getUTCDay(); if (dow === 0) continue;
    if (holidays(date.getUTCFullYear()).has(iso(date))) continue;
    const m = date.getUTCMonth() + 1;
    const season = [1.05, 1.0, 1.1, 0.95, 1.0, 0.95, 0.8, 0.6, 1.05, 1.2, 1.05, 0.85][m - 1];
    const growth = 1 + d / days * 0.35; // crescita del network nel periodo
    const promo = date.getUTCFullYear() === year ? promoDefs[m - 1] : null;
    const volume = Math.round((dow === 6 ? 14 : 32) * season * growth);
    for (let k = 0; k < volume; k++) {
      const c = customers[Math.floor(Math.pow(r(), 1.8) * customers.length)]; // alcuni pazienti tornano spesso, molti una volta sola
      const site = r() < 0.8 ? c.home : pick(r, sites);
      const t = `${String(7 + Math.floor(r() * 11)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}`;
      const extRef = `A${ref++}`;
      const channel = weighted(r, CHANNELS_B2C); const pay = weighted(r, PAY_B2C); const operator = opPick(site.id);
      const items = [];
      const kind = site.kind;
      const x = r();
      if (kind === 'PUNTO_PRELIEVI' || kind === 'LABORATORIO' || x < 0.5) { const nI = 2 + Math.floor(r() * 5); for (let i = 0; i < nI; i++) items.push(pick(r, LAB)); }
      else if (x < 0.78) items.push(pick(r, IMG));
      else if (x < 0.93) items.push(pick(r, SPEC));
      else items.push(pick(r, PAC));
      // spinta promozionale
      let promoHit = null; let campaign = null;
      if (promo && r() < 0.18) { const code = pick(r, promo[5]); if (prodIds[code]) { items.length = 0; items.push(prodIds[code]); promoHit = promoIds[m]; } }
      if (r() < 0.07) { const cc = campaigns.filter((cp) => cp.start_date <= iso(date) && (!cp.end_date || cp.end_date >= iso(date))); if (cc.length) campaign = pick(r, cc); }
      items.forEach((p, i) => {
        const gross = p.price; let disc = 0;
        if (promoHit) disc = promo[6] === 'PERCENTUALE' ? Math.round(gross * promo[7]) / 100 : promo[6] === 'PREZZO_FISSO' ? Math.max(0, gross - promo[7]) : 0;
        else if (pay === 'SSN') disc = Math.round(gross * 0.35 * 100) / 100;
        else if (pay === 'ASSICURAZIONE' || pay === 'FONDO') disc = Math.round(gross * 0.12 * 100) / 100;
        batch.push({ source: 'DEMO', external_ref: extRef, line_no: i + 1, sale_date: iso(date), sale_time: t, customer_id: c.id, site_id: site.id, product_id: p.id, product_code: p.code, quantity: 1, gross_amount: gross, discount: disc, net_amount: Math.round((gross - disc) * 100) / 100, payment_kind: pay, booking_channel: channel, promo_code: promoHit ? `PROMO${String(m).padStart(2, '0')}` : campaign?.promo_code || null, campaign_id: campaign?.id || null, promotion_id: promoHit, operator });
        n++;
      });
      if (batch.length >= 400) await flush();
    }
    // B2B: medicina del lavoro e service, lotti settimanali
    if (dow === 2 || dow === 4) {
      const nB = 2 + Math.floor(r() * 4);
      for (let k = 0; k < nB; k++) {
        const b = pick(r, b2b);
        const site = pick(r, sites.filter((s) => s.kind !== 'PUNTO_PRELIEVI'));
        const extRef = `B${ref++}`;
        const isMdl = b.type === 'AZIENDA';
        const list = isMdl ? MDL : LAB;
        const nI = isMdl ? 3 + Math.floor(r() * 6) : 10 + Math.floor(r() * 30);
        for (let i = 0; i < nI; i++) {
          const p = pick(r, list); const qty = isMdl ? 1 + Math.floor(r() * 8) : 1 + Math.floor(r() * 4);
          const unit = Math.round(p.price * (isMdl ? 0.85 : 0.55) * 100) / 100;
          batch.push({ source: 'DEMO', external_ref: extRef, line_no: i + 1, sale_date: iso(date), sale_time: '09:00', customer_id: null, b2b_customer_id: b.id, site_id: site.id, product_id: p.id, product_code: p.code, quantity: qty, gross_amount: Math.round(p.price * qty * 100) / 100, discount: Math.round((p.price - unit) * qty * 100) / 100, net_amount: Math.round(unit * qty * 100) / 100, payment_kind: 'AZIENDA', booking_channel: 'AZIENDA', promo_code: null, campaign_id: null, promotion_id: null, operator: opsBySite[site.id][0] });
          n++;
        }
        if (batch.length >= 400) await flush();
      }
    }
  }
  await flush();
  await refreshCustomerStats();
  // conteggi prenotazioni delle campagne dalle vendite collegate
  await q(`UPDATE campaigns c SET bookings = s.n FROM (SELECT campaign_id, count(DISTINCT external_ref)::int AS n FROM sales WHERE campaign_id IS NOT NULL GROUP BY campaign_id) s WHERE s.campaign_id = c.id`);

  // Esposizione: book compilato per alcune sedi
  const zones = Object.fromEntries((await many('SELECT id, code FROM exposure_zones')).map((z) => [z.code, z.id]));
  const standards = await many('SELECT * FROM exposure_standards');
  const curPromo = promoIds[today.getMonth() + 1];
  for (const s of sites) {
    const applicable = standards.filter((st) => st.site_kind === 'TUTTE' || st.site_kind === s.kind);
    const compliance = r();
    for (const st of applicable) {
      const x = r();
      const status = x < compliance ? 'INSTALLATO' : x < compliance + 0.15 ? 'DA_SOSTITUIRE' : x < compliance + 0.25 ? 'NON_CONFORME' : 'DA_INSTALLARE';
      const isPromo = /promo del mese/i.test(st.material);
      await q(`INSERT INTO exposure_items(site_id, zone_id, standard_id, material, format, quantity, promotion_id, content, valid_from, valid_to, status, checked_at, checked_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [s.id, st.zone_id, st.id, st.material, st.format, st.quantity, isPromo ? curPromo : null, isPromo ? promoDefs[today.getMonth()][2] : null, isPromo ? iso(new Date(Date.UTC(year, today.getMonth(), 1))) : null, isPromo ? iso(new Date(Date.UTC(year, today.getMonth() + 1, 0))) : null, status, status === 'DA_INSTALLARE' ? null : iso(new Date(today.getTime() - Math.floor(r() * 45) * 86400000)), status === 'DA_INSTALLARE' ? null : 'Site manager']);
    }
  }
  void zones;
  // Struttura: orari e dotazioni (le persone della sede vengono da public.people: si assegnano in Amministrazione > Persone)
  for (const s of sites) {
    // Le fasce di apertura sono dell'anagrafica unica (public.sites.opening_hours_json): qui solo la nota operativa per giorno
    for (let wd = 1; wd <= 6; wd++) {
      if (wd === 6 && s.kind === 'LABORATORIO') continue;
      await q('INSERT INTO site_hours(site_id, weekday, note) VALUES ($1,$2,$3) ON CONFLICT (site_id, weekday) DO UPDATE SET note=EXCLUDED.note', [s.id, wd, 'prelievi 7:30-10:30']);
    }
    const assets = s.kind === 'CENTRO_DIAGNOSTICO' ? [['RM', 'Risonanza magnetica 1,5 T', 1], ['TC', 'TC 64 strati', 1], ['MAMMOGRAFO', 'Mammografo con tomosintesi', 1], ['ECOGRAFO', 'Ecografo', 2], ['RX', 'Radiologia digitale', 1], ['MOC', 'Densitometro DEXA', 1], ['BOX_PRELIEVO', 'Box prelievo', 2], ['AMBULATORIO', 'Ambulatorio', 3], ['MONITOR', 'Monitor sala attesa', 1]]
      : s.kind === 'POLIAMBULATORIO' ? [['ECOGRAFO', 'Ecografo', 2], ['AMBULATORIO', 'Ambulatorio', 4 + Math.floor(r() * 4)], ['BOX_PRELIEVO', 'Box prelievo', 2], ['MONITOR', 'Monitor sala attesa', 1]]
      : s.kind === 'PUNTO_PRELIEVI' ? [['BOX_PRELIEVO', 'Box prelievo', 1 + Math.floor(r() * 2)], ['AMBULATORIO', 'Ambulatorio', 1]]
      : s.kind === 'LABORATORIO' ? [['ALTRO', 'Linea analitica chimica-immunometria', 1], ['ALTRO', 'Ematologia', 1], ['ALTRO', 'Microbiologia', 1], ['ALTRO', 'Biologia molecolare', 1]] : [];
    for (const [k, nm, qty] of assets) await q('INSERT INTO site_assets(site_id, kind, name, quantity) VALUES ($1,$2,$3,$4)', [s.id, k, nm, qty]);
    await q(`INSERT INTO site_ext (site_id, surface_sqm, rooms, boxes, parking, accessibility, catchment_cities) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (site_id) DO UPDATE SET surface_sqm=EXCLUDED.surface_sqm, rooms=EXCLUDED.rooms, boxes=EXCLUDED.boxes, parking=EXCLUDED.parking, accessibility=EXCLUDED.accessibility, catchment_cities=EXCLUDED.catchment_cities, updated_at=now()`, [s.id, s.kind === 'PUNTO_PRELIEVI' ? 60 + Math.floor(r() * 60) : 180 + Math.floor(r() * 400), assets.find((a) => a[0] === 'AMBULATORIO')?.[2] || 1, assets.find((a) => a[0] === 'BOX_PRELIEVO')?.[2] || 0, pick(r, ['Parcheggio privato 8 posti', 'Strisce blu in zona', 'Parcheggio pubblico a 100 m', 'Nessun parcheggio dedicato']), 'Accesso senza barriere, ascensore', (AREAS.find((a) => a[4].includes(s.code)) || AREAS[0])[0]]);
  }
  // Giorni lavorati pianificati e budget dell'anno in corso (dal dato reale del mese, con un obiettivo di crescita)
  const { plannedDays } = await import('./calendar.js');
  const lineRows = await many('SELECT id FROM product_lines');
  for (let m = 1; m <= 12; m++) {
    await q('INSERT INTO working_days(year, month, site_id, planned) VALUES ($1,$2,NULL,$3) ON CONFLICT DO NOTHING', [year, m, plannedDays(year, m, { saturday: true })]);
    for (const s of sites) await q('INSERT INTO working_days(year, month, site_id, planned) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [year, m, s.id, plannedDays(year, m, { saturday: s.kind !== 'LABORATORIO' })]);
    const actualLine = await many(`SELECT p.line_id, sum(s.net_amount) AS v, count(DISTINCT s.external_ref)::int AS t FROM sales s JOIN products p ON p.id=s.product_id WHERE date_part('year', s.sale_date)=$1 AND date_part('month', s.sale_date)=$2 GROUP BY p.line_id`, [year, m]);
    const refMonth = m >= today.getMonth() + 1 ? Math.max(1, today.getMonth()) : m; // mese corrente e futuri: dal mese pieno precedente
    const refLine = refMonth === m ? actualLine : await many(`SELECT p.line_id, sum(s.net_amount) AS v, count(DISTINCT s.external_ref)::int AS t FROM sales s JOIN products p ON p.id=s.product_id WHERE date_part('year', s.sale_date)=$1 AND date_part('month', s.sale_date)=$2 GROUP BY p.line_id`, [year, refMonth]);
    for (const l of lineRows) { const a = refLine.find((x) => x.line_id === l.id); const f = 0.92 + r() * 0.2; await q('INSERT INTO budgets(year, month, line_id, site_id, amount, tickets) VALUES ($1,$2,$3,NULL,$4,$5) ON CONFLICT DO NOTHING', [year, m, l.id, Math.round(Number(a?.v || 0) * f), Math.round(Number(a?.t || 0) * f)]); }
    const refSite = await many(`SELECT s.site_id, sum(s.net_amount) AS v, count(DISTINCT s.external_ref)::int AS t FROM sales s WHERE date_part('year', s.sale_date)=$1 AND date_part('month', s.sale_date)=$2 GROUP BY s.site_id`, [year, refMonth]);
    for (const s of sites) { const a = refSite.find((x) => x.site_id === s.id); const f = 0.92 + r() * 0.2; await q('INSERT INTO budgets(year, month, line_id, site_id, amount, tickets) VALUES ($1,$2,NULL,$3,$4,$5) ON CONFLICT DO NOTHING', [year, m, s.id, Math.round(Number(a?.v || 0) * f), Math.round(Number(a?.t || 0) * f)]); }
  }
  return { customers: customers.length + b2b.length, products: Object.keys(prodIds).length, sales: n };
}

export async function clearDemo() {
  await tx(async (c) => {
    await c.query("DELETE FROM sales WHERE source='DEMO'");
    await c.query("DELETE FROM exposure_items");
    await c.query("DELETE FROM customers WHERE source IN ('GIPO','TUOTEMPO','STUDIOLAB') AND external_id LIKE 'D%' OR external_id LIKE 'S%'");
    await c.query("DELETE FROM campaigns");
    await c.query("DELETE FROM promotions");
    await c.query("DELETE FROM products WHERE source='DEMO'");
    await c.query('DELETE FROM site_hours'); await c.query('DELETE FROM site_assets'); await c.query('DELETE FROM budgets'); await c.query('DELETE FROM working_days'); await c.query('DELETE FROM variance_notes');
  });
  await refreshCustomerStats();
}
