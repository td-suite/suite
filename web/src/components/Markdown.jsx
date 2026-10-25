import React from 'react';

/* Piccolo renderer Markdown senza librerie: titoli, paragrafi, liste (anche numerate), grassetto, corsivo, link,
   immagini (anche "file:ID" → /api/files/ID), citazioni, codice, separatori, tabelle semplici. Output React (nessun HTML grezzo). */

const safeUrl = (u = '') => {
  const s = u.trim();
  if (/^file:(\d+)$/i.test(s)) return `/api/files/${s.slice(5)}`;
  if (/^(https?:|mailto:|tel:|\/)/i.test(s)) return s;
  return '#';
};

function inline(text, keyBase = 'i') {
  const out = [];
  let rest = text;
  let k = 0;
  const re = /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\n]+)\*)|(_([^_\n]+)_)|(`([^`]+)`)/;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(<img key={key} src={safeUrl(m[3])} alt={m[2] || ''} loading="lazy" />);
    else if (m[4]) { const href = safeUrl(m[6]); const ext = /^https?:/i.test(href); out.push(<a key={key} href={href} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined}>{inline(m[5], key)}</a>); }
    else if (m[7]) out.push(<strong key={key}>{inline(m[8], key)}</strong>);
    else if (m[9]) out.push(<strong key={key}>{inline(m[10], key)}</strong>);
    else if (m[11]) out.push(<em key={key}>{inline(m[12], key)}</em>);
    else if (m[13]) out.push(<em key={key}>{inline(m[14], key)}</em>);
    else if (m[15]) out.push(<code key={key}>{m[16]}</code>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function renderMarkdown(src = '') {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0, k = 0;
  const key = () => `b${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // blocco di codice
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={key()}><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const Tag = `h${Math.min(3, h[1].length)}`; blocks.push(<Tag key={key()}>{inline(h[2], key())}</Tag>); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr key={key()} />); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={key()}>{renderMarkdown(buf.join('\n'))}</blockquote>);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''));
      blocks.push(<ul key={key()}>{items.map((t, j) => <li key={j}>{inline(t, `l${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push(<ol key={key()}>{items.map((t, j) => <li key={j}>{inline(t, `o${j}`)}</li>)}</ol>);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = line.split('|').slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++].split('|').slice(1, -1).map((c) => c.trim()));
      blocks.push(<table key={key()}><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `th${j}`)}</th>)}</tr></thead><tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `td${ri}-${j}`)}</td>)}</tr>)}</tbody></table>);
      continue;
    }
    // paragrafo: righe consecutive non vuote
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+|\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    const text = buf.join('\n');
    const parts = text.split('\n');
    blocks.push(<p key={key()}>{parts.map((t, j) => <React.Fragment key={j}>{inline(t, `p${j}`)}{j < parts.length - 1 && <br />}</React.Fragment>)}</p>);
  }
  return blocks;
}

export default function Markdown({ source, className = '' }) {
  return <div className={`md ${className}`}>{renderMarkdown(source)}</div>;
}
