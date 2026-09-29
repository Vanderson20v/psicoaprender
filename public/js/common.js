'use strict';
/* Utilidades compartilhadas do front-end. */

// ---------- Sessão / token ----------
// Token mantido em memória (sempre funciona, mesmo com cookies e localStorage
// bloqueados pelo iframe do preview) e também persistido no localStorage como
// reforço para sobreviver a recarregamentos. Enviado por DOIS cabeçalhos
// diferentes + cookie, para o caso de algum proxy filtrar um deles.
let memoriaToken = '';
try { memoriaToken = localStorage.getItem('agua_token') || ''; } catch { /* sem storage */ }

function getToken() {
  if (memoriaToken) return memoriaToken;
  try { return localStorage.getItem('agua_token') || ''; } catch { return ''; }
}
function setToken(t) {
  memoriaToken = t || '';
  try {
    if (t) localStorage.setItem('agua_token', t);
    else localStorage.removeItem('agua_token');
  } catch { /* armazenamento indisponível */ }
}
function urlComToken(u) {
  const params = new URLSearchParams();
  const t = getToken();
  if (t) params.set('token', t);
  if (!params.toString()) return u;
  return `${u}${u.includes('?') ? '&' : '?'}${params.toString()}`;
}
// Imagens (<img>/nova aba) não enviam cabeçalhos: token vai na query.
function fotoUrl(fileName) {
  if (!fileName) return '';
  return urlComToken(`/api/uploads/${encodeURIComponent(fileName)}`);
}

// ---------- Condomínio selecionado ----------
let memoriaCondo = '';
try { memoriaCondo = localStorage.getItem('agua_condo') || ''; } catch { /* sem storage */ }
function getCondo() {
  if (memoriaCondo) return memoriaCondo;
  try { return localStorage.getItem('agua_condo') || ''; } catch { return ''; }
}
function setCondo(id) {
  memoriaCondo = id || '';
  try {
    if (id) localStorage.setItem('agua_condo', id);
    else localStorage.removeItem('agua_condo');
  } catch { /* ignore */ }
}

// ---------- API ----------
async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!headers['Content-Type'] && (options.method === 'POST' || options.method === 'PUT' || options.body)) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Auth-Token'] = token;
  }
  const condo = getCondo();
  if (condo) headers['X-Condo-Id'] = condo;
  const res = await fetch(url, {
    headers,
    credentials: 'same-origin',
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* vazio */ }
  if (res.status === 401) {
    setToken('');
    if (!window.__aguaLoginShown) {
      if (typeof window.logoutUI === 'function') window.logoutUI();
      else if (!location.pathname.endsWith('/index.html')) window.location.href = '/index.html';
    }
    throw new Error('Não autenticado');
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Erro ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
const apiGet = (u) => apiFetch(u);
const apiPost = (u, body) => apiFetch(u, { method: 'POST', body: JSON.stringify(body || {}) });
const apiPut = (u, body) => apiFetch(u, { method: 'PUT', body: JSON.stringify(body || {}) });

// ---------- Formatação BR ----------
const fmtBRL = (v) => (v == null || v === '' || Number.isNaN(Number(v)))
  ? '—'
  : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v, d = 2) => (v == null || v === '' || Number.isNaN(Number(v)))
  ? '—'
  : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
// data ISO (YYYY-MM-DD) -> dd/mm/aaaa
const brData = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '—');

const NOMES_MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function mesLabel(ref) {
  const [y, m] = ref.split('-').map(Number);
  return `${NOMES_MESES[m - 1]}/${y}`;
}
function mesCurto(ref) {
  const [y, m] = ref.split('-').map(Number);
  return `${NOMES_MESES[m - 1].slice(0, 3)}/${String(y).slice(2)}`;
}
function dataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Tarifa CAESB (espelho do servidor) ----------
const TARIFAS = [
  { faixa: 1, descricao: '0 a 8 m³',        de: 0,  ate: 8,        aliquota: 4.30 },
  { faixa: 2, descricao: '9 a 14 m³',       de: 8,  ate: 14,       aliquota: 5.15 },
  { faixa: 3, descricao: '15 a 21 m³',      de: 14, ate: 21,       aliquota: 10.21 },
  { faixa: 4, descricao: '22 a 31 m³',      de: 21, ate: 31,       aliquota: 14.81 },
  { faixa: 5, descricao: '32 a 46 m³',      de: 31, ate: 46,       aliquota: 22.22 },
  { faixa: 6, descricao: 'Acima de 46 m³',  de: 46, ate: Infinity, aliquota: 28.88 },
];

function calcularAgua(consumo) {
  const c = Number(consumo) || 0;
  let agua = 0;
  const faixas = TARIFAS.map((f) => {
    const tamanho = f.ate === Infinity ? Infinity : f.ate - f.de;
    const m3 = Math.max(0, Math.min(c - f.de, tamanho));
    const valor = Math.round(m3 * f.aliquota * 100) / 100;
    agua += valor;
    return { faixa: f.faixa, descricao: f.descricao, aliquota: f.aliquota, m3: Math.round(m3 * 1000) / 1000, valor };
  });
  agua = Math.round(agua * 100) / 100;
  return { valor_agua: agua, valor_esgoto: agua, valor_total: Math.round(agua * 200) / 100, faixas };
}

const STATUS_LABELS = {
  lido: 'Lido', pendente: 'Pendente', anomalia: 'Leitura inválida',
  atencao: 'Consumo elevado', inicial: 'Leitura inicial', sem_anterior: 'Sem leitura anterior',
};
function statusBadge(status) {
  const cls = { lido: 'badge-lido', pendente: 'badge-pendente', anomalia: 'badge-anomalia',
    atencao: 'badge-atencao', inicial: 'badge-inicial', sem_anterior: 'badge-sem_anterior' }[status] || 'badge-pendente';
  return `<span class="badge ${cls}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

// ---------- Toast / Modal ----------
function toast(msg, tipo = 'ok') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${tipo === 'error' ? 'error' : tipo === 'success' ? 'success' : ''}`;
  const ic = document.createElement('span');
  ic.className = 't-ico';
  ic.textContent = tipo === 'error' ? '!' : '✓';
  el.appendChild(ic);
  el.appendChild(document.createTextNode(msg));
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

function openModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) closeModal();
  });
  document.body.appendChild(overlay);
  return overlay;
}
function closeModal() {
  document.getElementById('modal-overlay')?.remove();
}

// ---------- Gráficos SVG (sem dependências) ----------
function lineChartSVG(pontos, opts = {}) {
  // pontos: [{label, value}]
  const W = 640, H = 240, padL = 46, padR = 16, padT = 18, padB = 34;
  const w = W - padL - padR, h = H - padT - padB;
  const vals = pontos.map((p) => p.value);
  const maxV = Math.max(opts.min != null ? opts.min : 0, ...vals, 1);
  const niceMax = Math.ceil(maxV * 1.12);
  const x = (i) => padL + (pontos.length <= 1 ? w / 2 : (i / (pontos.length - 1)) * w);
  const y = (v) => padT + h - (v / niceMax) * h;

  let grid = '';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const val = (niceMax / steps) * i;
    const yy = y(val);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#e2e8f0" stroke-width="1"/>`;
    grid += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#94a3b8">${opts.fmtAxis ? opts.fmtAxis(val) : Math.round(val)}</text>`;
  }
  const path = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(pontos.length - 1).toFixed(1)},${(padT + h)} L${x(0).toFixed(1)},${(padT + h)} Z`;
  let dots = '', labels = '';
  pontos.forEach((p, i) => {
    dots += `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="#0891b2" stroke="#fff" stroke-width="2"/>`;
    dots += `<text x="${x(i)}" y="${y(p.value) - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="#0e7490">${opts.fmtVal ? opts.fmtVal(p.value) : p.value}</text>`;
    labels += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="10.5" fill="#64748b">${esc(p.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || 'gráfico')}">
    ${grid}
    <path d="${area}" fill="#0891b2" opacity="0.08"/>
    <path d="${path}" fill="none" stroke="#0891b2" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labels}
  </svg>`;
}

function barChartSVG(grupos, opts = {}) {
  // grupos: [{label, series:[{value,color,name}]}]
  const W = 640, H = 240, padL = 58, padR = 16, padT = 18, padB = 34;
  const w = W - padL - padR, h = H - padT - padB;
  const totais = grupos.map((g) => g.series.reduce((s, x) => s + x.value, 0));
  const maxV = Math.max(...totais, 1);
  const niceMax = Math.ceil(maxV * 1.15 / 1000) * 1000;
  const y = (v) => padT + h - (v / niceMax) * h;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const val = (niceMax / 4) * i;
    const yy = y(val);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#e2e8f0"/>`;
    grid += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="10.5" fill="#94a3b8">${(val / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k</text>`;
  }
  const gw = w / grupos.length;
  let bars = '', labels = '';
  grupos.forEach((g, i) => {
    const cx = padL + gw * i + gw / 2;
    const n = g.series.length;
    const bw = Math.min(34, (gw * 0.62) / n);
    let acc = 0;
    g.series.forEach((s, j) => {
      const bx = cx - (bw * n) / 2 + j * bw;
      const by = y(acc + s.value);
      const bh = y(acc) - by;
      bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="3" fill="${s.color}"><title>${esc(g.label)} — ${esc(s.name)}: ${fmtBRL(s.value)}</title></rect>`;
      acc += s.value;
    });
    labels += `<text x="${cx}" y="${H - 12}" text-anchor="middle" font-size="10.5" fill="#64748b">${esc(g.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || 'gráfico')}">${grid}${bars}${labels}</svg>`;
}

function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c == null ? '' : c).replace(/\./g, (m, o) => m); // números já vêm formatados
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
