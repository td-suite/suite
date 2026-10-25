/* Room Planning · motore di pianificazione (puro, senza DOM): usato dal frontend e dal server (avvisi, simulazioni). */
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const DAYS_S = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const EQUIP = ['Ecografo', 'RX', 'RM 1.5T', 'RM 0.4T', 'TC', 'EMG', 'OPT', 'MOC', 'ECG', 'Holter', 'Spirometro', 'Mammografo'];
const DISC = ['Cardiologia', 'Radiologia', 'Ortopedia', 'Neurologia', 'Dermatologia', 'Ginecologia', 'Oculistica', 'Fisiatria', 'Endocrinologia', 'Urologia', 'Otorinolaringoiatria', 'Chirurgia vascolare', 'Medicina dello sport', 'Pneumologia', 'Gastroenterologia', 'Medicina del Lavoro', 'Punto Prelievi'];
const uid = () => Math.random().toString(36).slice(2, 10);
const t2m = s => {
  if (!s) return 0;
  const p = s.split(':');
  return +p[0] * 60 + (+p[1] || 0);
};
const m2t = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const clone = o => JSON.parse(JSON.stringify(o));
const durTxt = m => {
  const h = Math.floor(m / 60),
    mm = m % 60;
  return (h ? h + 'h' : '') + (mm ? mm + "'" : '') || '0';
};
const hexRgb = h => {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
};
function defaultHours() {
  const h = {};
  for (let d = 0; d < 7; d++) h[d] = d < 5 ? {
    closed: false,
    open: '08:00',
    close: '19:00'
  } : d === 5 ? {
    closed: false,
    open: '08:00',
    close: '13:00'
  } : {
    closed: true,
    open: '08:00',
    close: '13:00'
  };
  return h;
}
function dispFromHours(hours) {
  const o = {};
  for (let d = 0; d < 7; d++) o[d] = hours[d].closed ? [] : [{
    from: hours[d].open,
    to: hours[d].close
  }];
  return o;
}
const emptyDisp = () => ({
  0: [],
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
  6: []
});
function newStruttura() {
  const hours = defaultHours();
  return {
    id: uid(),
    denominazione: '',
    logo: null,
    indirizzo: '',
    telefono: '',
    email: '',
    siteManager: '',
    deskCapacity: 2,
    deskCapAM: 2,
    deskCapPM: 2,
    deskSplit: '14:00',
    hours,
    ambulatori: [],
    personale: [],
    plan: {
      dataUrl: null,
      markers: {}
    },
    note: ''
  };
}
const SHARED_EQUIP = ['Ecografo', 'EMG'];
const PRELIEVI = 'Punto Prelievi';
const PROFILI_SAN = ['Infermiere', 'Ostetrica', 'Tecnico Sanitario di Radiologia Medica'];
function sanRanges(p, d, openDay) {
  if (p.tipo !== 'sanitario' || p.contratto !== 'dipendente') return rangesM((p.disp || {})[d]);
  if (!openDay) return [];
  const days = Math.max(1, Math.min(7, +p.giorniSett || 7));
  const daily = Math.round(contractMin(p) / days / 30) * 30;
  if (daily < 30) return [];
  const pres = daily + (hasLunch(p) && daily >= LUNCH_MIN_SHIFT ? LUNCH : 0);
  const [o, c] = openDay;
  const pr = p.turnoPref || 'indifferente';
  if (pr === 'mattina') return [[o, Math.min(c, o + pres)]];
  if (pr === 'pomeriggio') return [[Math.max(o, c - pres), c]];
  return [[o, c]];
}
const isPrelievi = r => (r.discipline || []).includes(PRELIEVI);
const prelieviRanges = (r, d) => isPrelievi(r) ? rangesM((r.prelievi || {})[d]) : [];
function roomExclusive(r) {
  if (isPrelievi(r)) return false;
  if (r.esclusivo === true || r.esclusivo === false) return r.esclusivo;
  if (!r.discipline || r.discipline.length === 0) return false;
  const eq = r.attrezzature || [];
  return !(eq.length > 0 && eq.every(e => SHARED_EQUIP.includes(e)));
}
const roomNum = r => {
  const m = (r.nome || '').match(/\d+/);
  if (m) return m[0];
  const w = (r.nome || '?').trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
};
function newRoom(str) {
  return {
    id: uid(),
    nome: 'Ambulatorio ' + (str.ambulatori.length + 1),
    mq: '',
    wc: false,
    discipline: [],
    attrezzature: [],
    disp: dispFromHours(str.hours),
    note: ''
  };
}
function contractMin(p) {
  if (p.oreContratto != null && p.oreContratto !== '') return Math.max(0, Math.round(+p.oreContratto * 60));
  let t = 0;
  for (let d = 0; d < 7; d++) t += sumM(rangesM((p.disp || {})[d]));
  return t;
}
const maxDayMin = p => Math.max(60, Math.round((+p.maxOreGiorno || 8) * 60));
const medDisc = p => Array.isArray(p.discipline) && p.discipline.length ? p.discipline : p.disciplina ? [p.disciplina] : [];
const medDiscTxt = p => medDisc(p).join(', ');
const isMedP = p => p.tipo === 'medico';
const slotsOf = (m, s, e) => {
  const d = +m.durataPrestazione;
  return d > 0 ? Math.floor((e - s) / d) : null;
};
function newPerson(tipo) {
  return {
    id: uid(),
    nome: '',
    tipo,
    disciplina: '',
    attrezzature: [],
    richiedeSanitario: false,
    dispositivi: [],
    supporto: '',
    disp: emptyDisp()
  };
}
const rangesM = r => (r || []).map(x => [t2m(x.from), t2m(x.to)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
const coverM = (list, s, e) => list.some(([a, b]) => a <= s && b >= e);
function intersectM(list, seg) {
  const out = [];
  for (const [a, b] of list) {
    const x = Math.max(a, seg[0]),
      y = Math.min(b, seg[1]);
    if (y > x) out.push([x, y]);
  }
  return out;
}
function subtractM(base, busy) {
  let out = base.map(x => [...x]);
  for (const [bs, be] of busy) {
    const nx = [];
    for (const [a, b] of out) {
      if (be <= a || bs >= b) {
        nx.push([a, b]);
        continue;
      }
      if (a < bs) nx.push([a, bs]);
      if (be < b) nx.push([be, b]);
    }
    out = nx;
  }
  return out;
}
const sumM = list => list.reduce((t, [a, b]) => t + (b - a), 0);
function deskReq(str) {
  const base = Math.max(1, +str.deskCapacity || 1);
  const am = str.deskCapAM != null && str.deskCapAM !== '' ? Math.max(0, +str.deskCapAM) : base;
  const pm = str.deskCapPM != null && str.deskCapPM !== '' ? Math.max(0, +str.deskCapPM) : base;
  const ratio = Math.max(1, +str.deskRatio || 4);
  const max = Math.max(am, pm, +str.deskMax || Math.max(am, pm) + 1);
  const overlap = Math.max(0, Math.round((+str.deskOverlap || 30) / 30) * 30);
  return {
    am,
    pm,
    split: t2m(str.deskSplit || '14:00'),
    splitT: str.deskSplit || '14:00',
    ratio,
    max,
    overlap
  };
}
const hasLunch = p => p.contratto === 'dipendente' && contractMin(p) > 30 * 60;
const LUNCH = 30,
  LUNCH_MIN_SHIFT = 360;
const deskLabel = d => 'minimo ' + d.am + ' mattina · ' + d.pm + ' pomeriggio/sera (cambio ore ' + d.splitT + ') · +1 addetto ogni ' + d.ratio + ' ambulatori attivi, max ' + d.max;
function computePlan(str) {
  const open = {};
  for (let d = 0; d < 7; d++) open[d] = str.hours[d].closed ? null : [t2m(str.hours[d].open), t2m(str.hours[d].close)];
  const staff = t => str.personale.filter(p => p.tipo === t && p.nome.trim());
  const acc = staff('accettazione'),
    san = staff('sanitario'),
    med = staff('medico');
  const byId = {};
  str.personale.forEach(p => byId[p.id] = p);
  str.ambulatori.forEach(r => byId[r.id] = r);
  const roomAvail = {};
  for (const r of str.ambulatori) {
    roomAvail[r.id] = {};
    for (let d = 0; d < 7; d++) roomAvail[r.id][d] = open[d] ? subtractM(intersectM(rangesM(r.disp[d]), open[d]), prelieviRanges(r, d)) : [];
  }
  const busyRoom = {},
    busySan = {};
  const bR = (rid, d) => (busyRoom[rid] = busyRoom[rid] || {})[d] = busyRoom[rid][d] || [];
  const bS = (pid, d) => (busySan[pid] = busySan[pid] || {})[d] = busySan[pid][d] || [];
  const eqOK = (m, r) => m.attrezzature.every(e => r.attrezzature.includes(e));
  const dOK = (m, r) => {
    const md = medDisc(m);
    return !md.length || r.discipline.length === 0 || isPrelievi(r) || md.some(x => r.discipline.includes(x));
  };
  const reqRoom = m => m.roomMode === 'req' && m.roomId ? str.ambulatori.find(r => r.id === m.roomId) : null;
  const prefRoom = m => m.roomMode !== 'req' && m.roomId ? m.roomId : null;
  const compat = m => {
    const rq = reqRoom(m);
    if (rq) return [rq];
    return str.ambulatori.filter(r => !r.soloVincolati && eqOK(m, r) && (dOK(m, r) || !roomExclusive(r)));
  };
  const pri = m => reqRoom(m) ? 0 : m.stessaStanza ? 1 : prefRoom(m) ? 2 : 3;
  /* medico "sempre nello stesso ambulatorio": sceglie l'unica stanza che ospita il maggior numero di sessioni (poi minuti coperti, preferenza, disciplina) */
  const pickSingleRoom = (m, rooms) => {
    if (!rooms.length) return null;
    let best = null;
    for (const r of rooms) {
      let full = 0, cov = 0, tot = 0;
      for (let d = 0; d < 7; d++) {
        if (!open[d]) continue;
        const free = subtractM(roomAvail[r.id][d], bR(r.id, d));
        for (const [s, e] of intersectM(rangesM(m.disp[d]), open[d])) {
          if (e - s < 30) continue;
          tot++;
          if (free.some(([a, b]) => a <= s && b >= e)) full++;
          cov += sumM(intersectM(free, [s, e]));
        }
      }
      const sc = [full, cov, prefRoom(m) === r.id ? 1 : 0, dOK(m, r) ? 1 : 0, -r.attrezzature.length, -(+r.mq || 0)];
      if (!best || cmp(sc, best.sc) > 0) best = { room: r, sc, full, tot };
    }
    return best;
  };
  const meds = [...med].sort((a, b) => pri(a) - pri(b) || compat(a).length - compat(b).length || b.attrezzature.length - a.attrezzature.length);
  const assigns = [],
    unassigned = [];
  const singleRoomOf = {};
  for (const m of meds) {
    let rooms = compat(m);
    let single = null;
    if (m.stessaStanza && !reqRoom(m)) {
      single = pickSingleRoom(m, rooms);
      if (single) { rooms = [single.room]; singleRoomOf[m.id] = single.room.id; }
    }
    for (let d = 0; d < 7; d++) {
      if (!open[d]) continue;
      for (const [s, e] of intersectM(rangesM(m.disp[d]), open[d])) {
        if (e - s < 30) continue;
        let best = null;
        for (const r of rooms) {
          const free = subtractM(roomAvail[r.id][d], bR(r.id, d));
          const full = free.some(([a, b]) => a <= s && b >= e);
          if (full) {
            const sc = [1, prefRoom(m) === r.id ? 1 : 0, dOK(m, r) ? 1 : 0, -r.attrezzature.length, -(+r.mq || 0)];
            if (!best || cmp(sc, best.sc) > 0) best = {
              room: r,
              s2: s,
              e2: e,
              full: true,
              sc
            };
          } else {
            const ov = intersectM(free, [s, e]).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
            if (ov && ov[1] - ov[0] >= 60) {
              const sc = [0, prefRoom(m) === r.id ? 1 : 0, dOK(m, r) ? 1 : 0, ov[1] - ov[0], -r.attrezzature.length];
              if (!best || cmp(sc, best.sc) > 0) best = {
                room: r,
                s2: ov[0],
                e2: ov[1],
                full: false,
                sc
              };
            }
          }
        }
        if (!best) {
          let reason;
          if (reqRoom(m) || single) {
            const rq = reqRoom(m) || single.room;
            const lab = reqRoom(m) ? ' (obbligatorio)' : ' (ambulatorio unico per tutta la programmazione)';
            reason = intersectM(roomAvail[rq.id][d], [s, e]).length === 0 ? rq.nome + lab + ' non disponibile ' + DAYS[d] + ' ' + m2t(s) + '-' + m2t(e) : rq.nome + lab + ' già occupato ' + DAYS[d] + ' ' + m2t(s) + '-' + m2t(e);
          } else if (rooms.length === 0) {
            const missing = new Set();
            str.ambulatori.forEach(r => {
              if (dOK(m, r)) m.attrezzature.forEach(e => {
                if (!r.attrezzature.includes(e)) missing.add(e);
              });
            });
            const onlyBound = str.ambulatori.length > 0 && str.ambulatori.every(r => r.soloVincolati || !eqOK(m, r) || !(dOK(m, r) || !roomExclusive(r))) && str.ambulatori.some(r => r.soloVincolati && eqOK(m, r) && (dOK(m, r) || !roomExclusive(r)));
            reason = str.ambulatori.length === 0 ? 'nessun ambulatorio configurato' : onlyBound ? 'gli ambulatori compatibili sono riservati ai medici vincolati (impostare l\'assegnazione obbligatoria o togliere la riserva)' : missing.size ? 'nessun ambulatorio con: ' + [...missing].join(', ') : 'nessun ambulatorio compatibile con la disciplina';
          } else if (rooms.every(r => intersectM(roomAvail[r.id][d], [s, e]).length === 0)) {
            reason = 'ambulatori compatibili non disponibili ' + DAYS[d] + ' ' + m2t(s) + '-' + m2t(e);
          } else reason = 'ambulatori compatibili già occupati ' + DAYS[d] + ' ' + m2t(s) + '-' + m2t(e);
          unassigned.push({
            medId: m.id,
            d,
            s,
            e,
            reason
          });
          continue;
        }
        let sanId = null;
        if (m.richiedeSanitario) {
          const pref = (m.supportoIds || []).map(id => byId[id]).filter(p => p && p.nome && p.nome.trim() && (p.tipo === 'sanitario' || p.tipo === 'accettazione'));
          const pool = pref.length ? pref : san;
          const skillOK = p => p.tipo !== 'sanitario' || m.attrezzature.every(e => (p.attrezzature || []).includes(e));
          const cands = pool.filter(p => {
            if (!skillOK(p)) return false;
            const free = subtractM(open[d] ? intersectM(sanRanges(p, d, open[d]), open[d]) : [], bS(p.id, d));
            return free.some(([a, b]) => a <= best.s2 && b >= best.e2);
          }).sort((a, b) => sumM(bS(a.id, d)) - sumM(bS(b.id, d)));
          if (!cands.length && pool.some(p => !skillOK(p)) && pool.every(p => p.tipo !== 'sanitario' || !skillOK(p))) {
            unassigned.push({
              medId: m.id,
              d,
              s,
              e,
              reason: 'nessun sanitario con le competenze richieste (' + m.attrezzature.join(', ') + ') ' + DAYS[d] + ' ' + m2t(best.s2) + '-' + m2t(best.e2)
            });
            continue;
          }
          if (!cands.length) {
            unassigned.push({
              medId: m.id,
              d,
              s,
              e,
              reason: 'personale sanitario di supporto non disponibile ' + DAYS[d] + ' ' + m2t(best.s2) + '-' + m2t(best.e2)
            });
            continue;
          }
          sanId = cands[0].id;
          bS(sanId, d).push([best.s2, best.e2]);
        }
        bR(best.room.id, d).push([best.s2, best.e2]);
        assigns.push({
          medId: m.id,
          roomId: best.room.id,
          d,
          s: best.s2,
          e: best.e2,
          sanId,
          partial: !best.full,
          orig: [s, e],
          slots: slotsOf(m, best.s2, best.e2)
        });
      }
    }
  }
  assigns.sort((a, b) => a.d - b.d || a.s - b.s || byId[a.roomId].nome.localeCompare(byId[b.roomId].nome));
  const prelievi = [];
  for (const r of str.ambulatori) for (let d = 0; d < 7; d++) if (open[d]) for (const [a, b] of intersectM(prelieviRanges(r, d), open[d])) prelievi.push({
    roomId: r.id,
    d,
    s: a,
    e: b
  });
  const free = [],
    roomStats = {};
  for (const r of str.ambulatori) {
    let avail = 0,
      busy = 0;
    for (let d = 0; d < 7; d++) {
      const base = roomAvail[r.id][d];
      avail += sumM(base);
      const bz = busyRoom[r.id] && busyRoom[r.id][d] ? busyRoom[r.id][d] : [];
      busy += sumM(mergeM(bz));
      for (const [a, b] of subtractM(base, bz)) if (b - a >= 30) free.push({
        roomId: r.id,
        d,
        s: a,
        e: b
      });
    }
    const slots = assigns.filter(a => a.roomId === r.id).reduce((t, a) => t + (a.slots || 0), 0);
    roomStats[r.id] = {
      avail,
      busy,
      util: avail ? Math.round(100 * busy / avail) : 0,
      slots
    };
  }
  free.sort((a, b) => a.d - b.d || a.s - b.s);
  const desk = deskReq(str);
  const req = desk.am;
  const minAt = m => m < desk.split ? desk.am : desk.pm;
  const activity = (d, m) => assigns.filter(a => a.d === d && a.s <= m && a.e > m).length + prelievi.filter(x => x.d === d && x.s <= m && x.e > m).length;
  const needAtD = (d, m) => Math.max(minAt(m), Math.min(desk.max, Math.ceil(activity(d, m) / desk.ratio)));
  const openDays = [];
  for (let d = 0; d < 7; d++) if (open[d]) openDays.push(d);
  const reqAt = m => minAt(m);
  const needOfDay = d => {
    let t = 0;
    const [o, c] = open[d];
    for (let m = o; m < c; m += 30) t += needAtD(d, m) * 30;
    return t;
  };
  const totalNeed = openDays.reduce((t, d) => t + needOfDay(d), 0);
  const totalSupply = acc.reduce((t, p) => t + contractMin(p), 0);
  const seatsOf = d => {
    const [o, c] = open[d];
    const out = [];
    let maxK = 0;
    for (let m = o; m < c; m += 30) maxK = Math.max(maxK, needAtD(d, m));
    for (let k = 1; k <= maxK; k++) {
      let cur = null;
      for (let m = o; m < c; m += 30) {
        if (needAtD(d, m) >= k) {
          if (cur && cur[1] === m) cur[1] = m + 30;else {
            if (cur) out.push(cur);
            cur = [m, m + 30];
          }
        }
      }
      if (cur) out.push(cur);
    }
    return out.filter(([x, y]) => y > x).sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
  };
  const autoBase = {};
  acc.filter(p => p.turnazione && (p.turnoPref || 'indifferente') === 'indifferente').forEach((p, i) => autoBase[p.id] = i % 2 === 0 ? 'mattina' : 'pomeriggio');
  const prefOf = (p, w) => {
    const pr = p.turnoPref || 'indifferente';
    if (!p.turnazione) return pr;
    const base = pr === 'indifferente' ? autoBase[p.id] : pr;
    return w === 1 ? base === 'mattina' ? 'pomeriggio' : 'mattina' : base;
  };
  const nOpen = openDays.length;
  const workDaysOf = p => Math.max(1, Math.min(nOpen, +p.giorniSett || nOpen));
  const dailyWork = p => Math.round(contractMin(p) / workDaysOf(p) / 30) * 30;
  const satDay = nOpen >= 6 ? Math.max(...openDays) : -1;
  const dailyWorkOn = (p, d) => {
    const days = workDaysOf(p);
    if (days >= 6 && satDay >= 0) {
      const wd = Math.min(maxDayMin(p), Math.round(contractMin(p) * 7 / 40 / 30) * 30);
      const satLen = open[satDay][1] - open[satDay][0];
      const sat = Math.min(satLen, Math.max(0, contractMin(p) - 5 * wd));
      return d === satDay ? sat : wd;
    }
    return Math.round(contractMin(p) / days / 30) * 30;
  };
  const lunchFor = (p, work) => hasLunch(p) && work >= LUNCH_MIN_SHIFT ? LUNCH : 0;
  const planDeskWeek = w => {
    const deskGrid = {},
      shortages = [],
      minutesBy = {};
    acc.forEach(p => minutesBy[p.id] = 0);
    const sidesFor = ww => {
      const sd = {};
      let mTot = 0,
        pTot = 0;
      const fixed = acc.filter(p => prefOf(p, ww) !== 'indifferente'),
        flex = acc.filter(p => prefOf(p, ww) === 'indifferente');
      fixed.forEach(p => {
        sd[p.id] = prefOf(p, ww);
        if (sd[p.id] === 'mattina') mTot += dailyWork(p);else pTot += dailyWork(p);
      });
      [...flex].sort((a, b) => dailyWork(b) - dailyWork(a)).forEach(p => {
        if (mTot <= pTot) {
          sd[p.id] = 'mattina';
          mTot += dailyWork(p);
        } else {
          sd[p.id] = 'pomeriggio';
          pTot += dailyWork(p);
        }
      });
      return sd;
    };
    const side = sidesFor(w),
      sideA = sidesFor(0);
    const off = {};
    acc.forEach(p => off[p.id] = new Set());
    const supplySide = (d, S) => acc.filter(p => !off[p.id].has(d) && side[p.id] === S).reduce((t, p) => t + dailyWork(p), 0);
    const needSide = (d, S) => {
      let t = 0;
      const [o, c] = open[d];
      for (let m = o; m < c; m += 30) if (m < desk.split === (S === 'mattina')) t += needAtD(d, m) * 30;
      return t;
    };
    [...acc].sort((a, b) => dailyWork(b) - dailyWork(a)).forEach(p => {
      let k = nOpen - workDaysOf(p);
      while (k-- > 0) {
        const supplyDay = d => acc.filter(q => !off[q.id].has(d)).reduce((t, q) => t + dailyWork(q), 0);
        const cand = openDays.filter(d => !off[p.id].has(d)).map(d => {
          const S = side[p.id],
            sup = supplySide(d, S),
            nd = needSide(d, S),
            supD = supplyDay(d),
            ndD = needOfDay(d);
          const cost = Math.max(0, nd - (sup - dailyWork(p))) - Math.max(0, nd - sup) + (Math.max(0, ndD - (supD - dailyWork(p))) - Math.max(0, ndD - supD));
          const already = acc.filter(q => off[q.id].has(d)).length;
          return {
            d,
            cost,
            already,
            surplus: supD - dailyWork(p) - ndD
          };
        }).sort((x, y) => x.cost - y.cost || x.already - y.already || y.surplus - x.surplus || y.d - x.d);
        if (cand.length) off[p.id].add(cand[0].d);
      }
    });
    const shifts = [];
    for (const d of openDays) {
      const [o, c] = open[d];
      const byS = {
        mattina: [],
        pomeriggio: []
      };
      const shortDay = c - o <= 480;
      const present = acc.filter(p => !off[p.id].has(d));
      present.forEach(p => byS[(shortDay ? sideA : side)[p.id]].push(p));
      byS.mattina.sort((a, b) => dailyWork(b) - dailyWork(a));
      byS.pomeriggio.sort((a, b) => dailyWork(b) - dailyWork(a));
      const delayFor = (i, edgeM, dir) => {
        if (i === 0) return 0;
        let dl = 0;
        for (let m = edgeM; dir > 0 ? m < c : m > o; m += dir * 30) {
          if (needAtD(d, dir > 0 ? m : m - 30) >= i + 1) break;
          dl += 30;
          if (dl >= 90) break;
        }
        return dl;
      };
      byS.mattina.forEach((p, i) => {
        const work = dailyWorkOn(p, d),
          pres = work + (shortDay ? 0 : lunchFor(p, work));
        if (work < 30) return;
        const dl = shortDay ? 0 : delayFor(i, o, +1);
        const s0 = Math.min(o + dl, c - 30),
          e0 = Math.min(c, s0 + pres);
        shifts.push({
          d,
          personId: p.id,
          s: s0,
          e: e0,
          work: Math.min(work, e0 - s0 - (!shortDay && lunchFor(p, work) && e0 - s0 > lunchFor(p, work) ? LUNCH : 0)),
          lunch: shortDay ? 0 : lunchFor(p, work)
        });
      });
      byS.pomeriggio.forEach((p, i) => {
        const work = dailyWorkOn(p, d),
          pres = work + (shortDay ? 0 : lunchFor(p, work));
        if (work < 30) return;
        const dl = shortDay ? 0 : delayFor(i, c, -1);
        const e0 = Math.max(c - dl, o + 30),
          s0 = Math.max(o, e0 - pres);
        shifts.push({
          d,
          personId: p.id,
          s: s0,
          e: e0,
          work: Math.min(work, e0 - s0 - (!shortDay && lunchFor(p, work) && e0 - s0 > lunchFor(p, work) ? LUNCH : 0)),
          lunch: shortDay ? 0 : lunchFor(p, work)
        });
      });
    }
    acc.forEach(p => {
      const mine = shifts.filter(x => x.personId === p.id);
      let deficit = contractMin(p) - mine.reduce((t, x) => t + x.work, 0);
      let guard = 0;
      while (deficit >= 30 && guard++ < 200) {
        const cand = mine.filter(x => {
          const [o, c] = open[x.d];
          return x.work + 30 <= maxDayMin(p) && (side[p.id] === 'mattina' ? x.e + 30 <= c : x.s - 30 >= o);
        }).sort((a, b) => a.work - b.work)[0];
        if (!cand) break;
        if (side[p.id] === 'mattina') cand.e += 30;else cand.s -= 30;
        cand.work += 30;
        deficit -= 30;
        if (cand.lunch === 0 && hasLunch(p) && cand.work >= LUNCH_MIN_SHIFT) {
          cand.lunch = LUNCH;
          const [o, c] = open[cand.d];
          if (side[p.id] === 'mattina' && cand.e + LUNCH <= c) cand.e += LUNCH;else if (side[p.id] !== 'mattina' && cand.s - LUNCH >= o) cand.s -= LUNCH;else {
            cand.lunch = 0;
          }
        }
      }
    });
    shifts.forEach(x => {
      minutesBy[x.personId] += x.work;
    });
    for (const d of openDays) {
      const [o, c] = open[d];
      const onDesk = (m, skip) => shifts.filter(x => x.d === d && x !== skip && x.s <= m && x.e > m && !(x.pausa && x.pausa[0] <= m && x.pausa[1] > m)).length;
      const daily = shifts.filter(x => x.d === d).sort((a, b) => (side[a.personId] === 'mattina' ? 1 : 0) - (side[b.personId] === 'mattina' ? 1 : 0));
      for (const sh of daily) {
        if (!sh.lunch) continue;
        let best = null;
        for (let m = sh.s + 60; m + LUNCH <= sh.e - 60; m += 30) {
          const od = onDesk(m, sh);
          const samePause = shifts.filter(x => x.d === d && x.pausa && x.pausa[0] === m).length;
          const pos = side[sh.personId] === 'pomeriggio' ? m - (sh.s + 60) : sh.e - 60 - LUNCH - m;
          const sc = [od >= minAt(m) ? 0 : 1, od >= needAtD(d, m) ? 0 : 1, samePause, pos];
          if (!best || cmp(best.sc, sc) > 0) best = {
            m,
            sc
          };
        }
        if (best) {
          sh.pausa = [best.m, best.m + LUNCH];
          sh.presenza = true;
        }
      }
    }
    for (const d of openDays) {
      const [o, c] = open[d];
      deskGrid[d] = [];
      for (let m = o; m < c; m += 30) {
        const ids = shifts.filter(x => x.d === d && x.s <= m && x.e > m && !(x.pausa && x.pausa[0] <= m && x.pausa[1] > m)).map(x => x.personId);
        const need = needAtD(d, m);
        deskGrid[d].push({
          m,
          ids,
          missing: Math.max(0, need - ids.length),
          missingMin: Math.max(0, minAt(m) - ids.length),
          need,
          activity: activity(d, m),
          min: minAt(m)
        });
      }
    }
    const sh = [];
    for (const d of openDays) {
      let cur = null;
      for (const cell of deskGrid[d]) {
        if (cell.missing > 0) {
          if (cur && cur.e === cell.m && cur.missing === cell.missing && cur.missingMin === cell.missingMin) cur.e = cell.m + 30;else {
            if (cur) sh.push(cur);
            cur = {
              d,
              s: cell.m,
              e: cell.m + 30,
              missing: cell.missing,
              missingMin: cell.missingMin
            };
          }
        } else {
          if (cur) {
            sh.push(cur);
            cur = null;
          }
        }
      }
      if (cur) sh.push(cur);
    }
    const deskShifts = [...shifts].sort((a, b) => a.d - b.d || a.s - b.s || byId[a.personId].nome.localeCompare(byId[b.personId].nome));
    const reducible = {};
    acc.forEach(p => reducible[p.id] = 0);
    for (const d of openDays) for (const cell of deskGrid[d]) {
      const extra = cell.ids.length - cell.min;
      if (extra > 0) cell.ids.forEach(id => reducible[id] += 30);
    }
    const deskHours = acc.map(p => ({
      id: p.id,
      nome: p.nome,
      contratto: contractMin(p),
      assegnate: minutesBy[p.id] || 0,
      residue: contractMin(p) - (minutesBy[p.id] || 0),
      pref: prefOf(p, w),
      side: side[p.id],
      off: [...off[p.id]],
      workDays: workDaysOf(p),
      daily: dailyWorkOn(p, openDays[0]),
      dailySat: satDay >= 0 && workDaysOf(p) >= 6 ? dailyWorkOn(p, satDay) : null,
      reducible: reducible[p.id]
    }));
    return {
      deskGrid,
      deskShifts,
      shortages: sh,
      minutesBy,
      deskHours,
      side,
      off
    };
  };
  const turnazione = acc.some(p => p.turnazione);
  const deskWeeks = [{
    label: 'Settimana A',
    ...planDeskWeek(0)
  }];
  if (turnazione) deskWeeks.push({
    label: 'Settimana B',
    ...planDeskWeek(1)
  });
  const {
    deskGrid,
    deskShifts,
    shortages,
    minutesBy,
    deskHours
  } = deskWeeks[0];
  const deskBalance = {
    need: totalNeed,
    supply: totalSupply
  };
  const crit = [];
  if (deskBalance.supply < deskBalance.need) crit.push({
    lv: 'alta',
    t: 'Ore a contratto del personale di accettazione insufficienti: fabbisogno desk ' + durTxt(deskBalance.need) + '/settimana contro ' + durTxt(deskBalance.supply) + ' disponibili (mancano ' + durTxt(deskBalance.need - deskBalance.supply) + ').'
  });
  deskWeeks.forEach(wk => wk.shortages.forEach(sh => crit.push(sh.missingMin > 0 ? {
    lv: 'alta',
    t: 'Desk accettazione SOTTO IL MINIMO ' + (deskWeeks.length > 1 ? wk.label + ' ' : '') + DAYS[sh.d] + ' ' + m2t(sh.s) + '-' + m2t(sh.e) + ': mancano ' + sh.missingMin + ' operatori rispetto al minimo del turno. Aumentare le ore a contratto o rivedere il minimo.'
  } : {
    lv: 'media',
    t: 'Desk accettazione sotto il fabbisogno da carico ambulatori ' + (deskWeeks.length > 1 ? wk.label + ' ' : '') + DAYS[sh.d] + ' ' + m2t(sh.s) + '-' + m2t(sh.e) + ': presenti ' + (sh.missing > 0 ? 'meno di ' + sh.missing : '') + ' del previsto (minimo comunque rispettato).'
  })));
  for (const h of deskHours) if (h.residue >= 30) crit.push({
    lv: 'alta',
    t: h.nome + ': ' + durTxt(h.residue) + ' a contratto NON collocabili nell\'orario (assegnate ' + durTxt(h.assegnate) + ' su ' + durTxt(h.contratto) + '): aumentare il massimo ore/giorno, i giorni lavorativi o l\'orario di apertura. Il contratto va rispettato per intero.'
  });
  deskWeeks.forEach(wk => {
    if (wk.shortages.some(x => x.missingMin > 0)) return;
    const cand = [...wk.deskHours].filter(h => h.reducible >= 120).sort((a, b) => b.reducible - a.reducible)[0];
    if (cand) {
      const target = Math.max(0, cand.contratto - cand.reducible);
      crit.push({
        lv: 'media',
        t: (deskWeeks.length > 1 ? wk.label + ': ' : '') + 'copertura minima sempre assicurata con margine. ' + cand.nome + ' ha ' + durTxt(cand.reducible) + '/settimana in fasce sopra il minimo: una figura da circa ' + Math.floor(target / 60) + 'h invece di ' + durTxt(cand.contratto) + ' razionalizzerebbe i costi senza scoprire il desk (verificare il carico ambulatori nelle fasce di punta).'
      });
    }
  });
  for (const u of unassigned) crit.push({
    lv: 'alta',
    t: 'Dott. ' + byId[u.medId].nome + ' non allocabile (' + DAYS[u.d] + ' ' + m2t(u.s) + '-' + m2t(u.e) + '): ' + u.reason + '.'
  });
  for (const a of assigns) if (a.partial) crit.push({
    lv: 'media',
    t: 'Dott. ' + byId[a.medId].nome + ': disponibilità ' + DAYS[a.d] + ' ' + m2t(a.orig[0]) + '-' + m2t(a.orig[1]) + ' allocata solo parzialmente (' + m2t(a.s) + '-' + m2t(a.e) + ') in ' + byId[a.roomId].nome + '.'
  });
  for (const r of str.ambulatori) {
    const st = roomStats[r.id];
    if (st.avail > 0 && st.util < 25) crit.push({
      lv: 'media',
      t: byId[r.id].nome + ' utilizzato al ' + st.util + '%: valutare la proposta delle fasce libere a nuovi specialisti o l\'accorpamento delle attività.'
    });
  }
  const eqMiss = new Set();
  unassigned.forEach(u => {
    const mm = u.reason.match(/nessun ambulatorio con: (.+)/);
    if (mm) mm[1].split(', ').forEach(e => eqMiss.add(e));
  });
  eqMiss.forEach(e => crit.push({
    lv: 'media',
    t: 'Attrezzatura mancante nel parco ambulatori: ' + e + '. L\'installazione in un ambulatorio con fasce libere sbloccherebbe i medici oggi non allocabili.'
  }));
  const totFree = free.reduce((t, f) => t + (f.e - f.s), 0);
  if (totFree > 0) crit.push({
    lv: 'info',
    t: 'Capacità residua settimanale: ' + durTxt(totFree) + ' distribuite su ' + free.length + ' fasce. Base commerciale per l\'ingresso di nuovi medici.'
  });
  if (acc.length) {
    const vals = acc.map(p => minutesBy[p.id] || 0);
    const gap = Math.max(...vals) - Math.min(...vals);
    if (gap >= 240) crit.push({
      lv: 'info',
      t: 'Carico desk sbilanciato tra gli operatori (differenza ' + durTxt(gap) + '/settimana): coerente con i diversi monte ore a contratto.'
    });
  }
  if (!crit.length) crit.push({
    lv: 'info',
    t: 'Nessuna criticità rilevata: copertura desk completa e tutti i medici allocati.'
  });
  return {
    open,
    deskGrid,
    deskShifts,
    shortages,
    req,
    desk,
    deskHours,
    deskBalance,
    deskWeeks,
    turnazione,
    prelievi,
    assigns,
    unassigned,
    singleRoomOf,
    free,
    roomStats,
    crit,
    minutesBy,
    byId,
    generated: new Date().toLocaleString('it-IT')
  };
}
function mergeM(list) {
  const s = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const x of s) {
    if (out.length && x[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], x[1]);else out.push([...x]);
  }
  return out;
}
function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export { DAYS, DAYS_S, DISC, EQUIP, LUNCH, LUNCH_MIN_SHIFT, PRELIEVI, PROFILI_SAN, SHARED_EQUIP, clone, cmp, computePlan, contractMin, coverM, defaultHours, deskLabel, deskReq, dispFromHours, durTxt, emptyDisp, hasLunch, hexRgb, intersectM, isMedP, isPrelievi, m2t, maxDayMin, medDisc, medDiscTxt, mergeM, newPerson, newRoom, newStruttura, prelieviRanges, rangesM, roomExclusive, roomNum, sanRanges, slotsOf, subtractM, sumM, t2m, uid };
