'use strict';
// Página de conferência do condômino — acesso somente-leitura à própria unidade.
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function mesLabel(ref) {
  const [y, m] = ref.split('-').map(Number);
  return `${MESES[m - 1]}/${y}`;
}
function brl(v) {
  return v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function num(v) {
  return v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fotoUrl(nome) {
  return nome ? `/api/uploads/${encodeURIComponent(nome)}?token=${encodeURIComponent(TOKEN)}` : null;
}
async function api(path) {
  const r = await fetch(path, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erro ao carregar.');
  return d;
}
function mostrarErro(msg) {
  const el = document.getElementById('erro');
  el.style.display = 'block';
  el.innerHTML = msg;
}

async function init() {
  if (!TOKEN) return mostrarErro('Link inválido: faltando o código de acesso. Peça um novo link à administração.');
  let dados;
  try {
    dados = await api('/api/conferencia');
  } catch (e) {
    return mostrarErro('Não foi possível abrir a conferência: ' + e.message +
      '<br><br>Este link pode ter sido cancelado. Procure a administração do condomínio.');
  }
  const { apartamento: apt, condominio, registros } = dados;

  document.getElementById('condo-nome').textContent = condominio.nome || 'Condomínio';
  document.getElementById('sub').textContent = `Conferência de medição · Unidade ${apt.etiqueta}`;
  if (condominio.logo) {
    const logo = document.getElementById('logo');
    logo.src = fotoUrl(condominio.logo);
    logo.style.display = 'block';
  }
  document.getElementById('uni-etq').textContent = apt.etiqueta;
  document.getElementById('uni-hid').textContent = `Torre ${apt.torre} · Hidrômetro ${apt.hidrometro || '—'}`;

  const regs = registros.slice().reverse(); // mais recente primeiro
  document.getElementById('app').style.display = 'block';

  const sel = document.getElementById('f-mes');
  sel.innerHTML = regs.map((r, i) => `<option value="${i}">${mesLabel(r.ref_month)}</option>`).join('');

  function mostrarMes(idx) {
    const r = regs[idx];
    const el = document.getElementById('detalhe');
    el.innerHTML = `
      <div class="cartao-mes">
        <h2>${mesLabel(r.ref_month)}
          <span class="badge ${r.status_mes === 'finalizado' ? 'final' : 'rasc'}">
            ${r.status_mes === 'finalizado' ? 'Faturamento fechado' : 'Em lançamento'}</span></h2>
        <div class="linhas">
          <div class="item"><div class="t">Leitura anterior</div><div class="v">${num(r.leitura_anterior)} m³</div></div>
          <div class="item"><div class="t">Leitura atual</div><div class="v">${num(r.leitura_atual)} m³</div></div>
          <div class="item"><div class="t">Consumo</div><div class="v">${num(r.consumo)} m³</div></div>
          <div class="item"><div class="t">Data da leitura</div><div class="v" style="font-size:15px;">${r.data_leitura || '—'}</div></div>
          <div class="item"><div class="t">Água</div><div class="v">${brl(r.valor_agua)}</div></div>
          <div class="item"><div class="t">Esgoto</div><div class="v">${brl(r.valor_esgoto)}</div></div>
          <div class="item total"><div class="t">Valor total (água + esgoto)</div><div class="v">${brl(r.valor_total)}</div></div>
        </div>
        ${r.foto ? `<div class="foto"><a href="${fotoUrl(r.foto)}" target="_blank" rel="noopener">
          <img src="${fotoUrl(r.foto)}" alt="Foto do hidrômetro ${apt.etiqueta}"><br>📷 Ver foto do hidrômetro</a></div>`
          : '<p class="rodape" style="margin-top:10px;">Nenhuma foto registrada neste mês.</p>'}
        ${r.medido_por ? `<p class="rodape" style="margin:8px 0 0;">Medição feita por: <strong>${r.medido_por}</strong></p>` : ''}
      </div>`;
  }
  sel.addEventListener('change', () => mostrarMes(Number(sel.value)));
  mostrarMes(0);

  document.getElementById('historico').innerHTML = `
    <table>
      <thead><tr><th>Mês</th><th class="n">Anterior</th><th class="n">Atual</th><th class="n">Consumo</th><th class="n">Total</th></tr></thead>
      <tbody>${regs.map((r) => `<tr>
        <td>${mesLabel(r.ref_month)}</td>
        <td class="n">${num(r.leitura_anterior)}</td>
        <td class="n">${num(r.leitura_atual)}</td>
        <td class="n">${num(r.consumo)}</td>
        <td class="n">${brl(r.valor_total)}</td>
      </tr>`).join('')}</tbody>
    </table>`;

  desenharGrafico(registros.filter((r) => r.consumo != null));
}

// Gráfico de barras do consumo mensal (SVG, sem dependências)
function desenharGrafico(regs) {
  const wrap = document.getElementById('grafico');
  if (!regs.length) { wrap.innerHTML = '<p class="rodape">Sem dados de consumo ainda.</p>'; return; }
  const W = 640, H = 240, padL = 40, padR = 12, padT = 24, padB = 40;
  const w = W - padL - padR, h = H - padT - padB;
  const vals = regs.map((r) => r.consumo || 0);
  const maxV = Math.max(...vals, 1);
  const niceMax = Math.ceil(maxV * 1.15);
  const y = (v) => padT + h - (v / niceMax) * h;
  const bw = Math.min(46, (w / regs.length) * 0.6);
  const passo = w / regs.length;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const val = (niceMax / 4) * i;
    const yy = y(val);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#e2e8f0"/>`;
    grid += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${Math.round(val)}</text>`;
  }
  const bars = regs.map((r, i) => {
    const cx = padL + passo * i + passo / 2;
    const bh = h - (y(r.consumo || 0) - padT);
    const by = y(r.consumo || 0);
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="3" fill="#0891b2">
      <title>${mesLabel(r.ref_month)}: ${num(r.consumo)} m³</title></rect>
      <text x="${cx}" y="${(by - 6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0e7490">${(r.consumo || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</text>
      <text x="${cx}" y="${H - 14}" text-anchor="middle" font-size="9.5" fill="#64748b">${mesCurto(r.ref_month)}</text>`;
  }).join('');
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;" role="img" aria-label="Consumo mensal em metros cúbicos">
    ${grid}${bars}
    <text x="${padL}" y="14" font-size="11" font-weight="700" fill="#334155">Consumo de água (m³)</text>
  </svg>
  <p class="rodape" style="margin-top:6px;">Cada barra mostra o consumo do mês (leitura atual − anterior).</p>`;
}
function mesCurto(ref) {
  const [y, m] = ref.split('-').map(Number);
  return MESES[m - 1].slice(0, 3) + '/' + String(y).slice(2);
}
init();

// marca do produto (nome pode vir trocado via APP_NAME no servidor)
fetch('/api/config').then((r) => (r.ok ? r.json() : null)).then((c) => {
  const el = document.getElementById('app-marca');
  if (el && c && c.app && c.app.nome) el.textContent = 'via ' + c.app.nome;
}).catch(() => {});
