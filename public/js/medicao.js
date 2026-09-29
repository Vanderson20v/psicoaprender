'use strict';
// Tela de medição móvel — acesso por link de delegação (sem login).
const QS = new URLSearchParams(location.search);
const TOKEN = QS.get('token') || '';
// gestor usando a própria tela: ?ref=AAAA-MM&med=1 ; delegado: ?token=...
const MODO_GESTOR = QS.get('med') === '1';
const REF_GESTOR = QS.get('ref') || '';

const state = {
  ref: null,
  condoNome: '',
  logo: null,
  linhas: [],      // unidades visíveis (respeita o escopo do link), na ordem de navegação
  idx: 0,
  ordem: 'desc',
  salvando: false,
  timer: null,
};

function getToken() {
  if (TOKEN) return TOKEN;
  try { return localStorage.getItem('agua_token') || ''; } catch { return ''; }
}

function api(path, opts) {
  // gestor: envia também o cabeçalho do condomínio selecionado
  let condoHeader = {};
  try { const c = localStorage.getItem('agua_condo'); if (c) condoHeader['X-Condo-Id'] = c; } catch { /* sem storage */ }
  const t = getToken();
  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { 'Authorization': `Bearer ${t}`, 'X-Auth-Token': t } : {}),
      ...condoHeader,
      ...(opts && opts.headers),
    },
    credentials: 'same-origin',
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Erro de conexão.');
    return data;
  });
}

function mesLabel(ref) {
  const [y, m] = ref.split('-').map(Number);
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${nomes[m - 1]}/${y}`;
}

function fotoUrl(nome) {
  const t = getToken();
  return nome ? `/api/uploads/${encodeURIComponent(nome)}?token=${encodeURIComponent(t)}` : null;
}

function ordenarLinhas(linhas) {
  const base = linhas.slice().sort((a, b) =>
    a.torre.localeCompare(b.torre) || Number(a.numero) - Number(b.numero));
  state.linhas = state.ordem === 'desc' ? base.reverse() : base;
}

function linhaAtual() { return state.linhas[state.idx]; }

function jaMedida(l) { return l.leitura_atual != null && l.leitura_atual !== ''; }

function atualizarContagem() {
  const feitas = state.linhas.filter(jaMedida).length;
  document.getElementById('contagem').textContent = `${feitas} / ${state.linhas.length} medições`;
}

function setSalvamento(cls, txt) {
  const el = document.getElementById('salvamento');
  el.className = 'salvo ' + cls;
  el.textContent = txt;
}

function renderCartao() {
  const l = linhaAtual();
  const main = document.getElementById('cartao');
  main.innerHTML = '';
  if (!l) {
    main.innerHTML = '<div class="cartao"><p style="text-align:center;color:#64748b">Nenhuma unidade encontrada.</p></div>';
    return;
  }
  const feito = jaMedida(l);
  main.innerHTML = `
    <div class="cartao ${feito ? 'feito' : ''}">
      <div class="etiqueta-grande">${l.etiqueta}</div>
      <div class="torre">Torre ${l.torre} · Apartamento ${l.numero}</div>
      <div class="hidro"><small>Hidrômetro</small>${l.hidrometro || '—'}</div>

      <div class="campo">
        <label for="leitura">📋 Leitura do hidrômetro (m³)</label>
        <input id="leitura" type="number" inputmode="decimal" step="0.001" min="0"
               placeholder="0" autocomplete="off" value="${feito ? l.leitura_atual : ''}">
        <div id="msg-alerta" class="msg-alerta">⚠️ Atenção: este número é menor que a leitura do mês passado. Confira o hidrômetro antes de salvar.</div>
      </div>

      <div class="foto-area">
        <label>📷 Foto do hidrômetro</label>
        <div class="foto-preview" id="foto-preview"><img id="foto-img" alt="Foto do hidrômetro"></div>
        <div class="selo-foto" id="selo-foto">✅ Foto registrada</div>
        <div class="botoes-foto" style="margin-top:10px">
          <button type="button" class="btn-foto" id="btn-tirar">📷 Tirar foto</button>
          <button type="button" class="btn-foto secundario" id="btn-escolher">🖼️ Galeria</button>
        </div>
        <button type="button" class="btn-foto" id="btn-excluir-foto"
          style="width:100%;margin-top:8px;border-color:#dc2626;color:#b91c1c;background:#fef2f2;display:none;">🗑️ Excluir foto</button>
        <input type="file" id="arquivo-foto" accept="image/*" capture="environment" style="display:none">
        <input type="file" id="arquivo-galeria" accept="image/*" style="display:none">
      </div>
    </div>`;

  const inp = document.getElementById('leitura');
  inp.addEventListener('input', () => validarAlerta(inp, l));
  inp.addEventListener('change', () => { validarAlerta(inp, l); salvarAtual(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); proxima(); } });

  const arqFoto = document.getElementById('arquivo-foto');
  const arqGal = document.getElementById('arquivo-galeria');
  document.getElementById('btn-tirar').addEventListener('click', () => arqFoto.click());
  document.getElementById('btn-escolher').addEventListener('click', () => arqGal.click());
  arqFoto.addEventListener('change', () => processarFoto(arqFoto.files[0]));
  arqGal.addEventListener('change', () => processarFoto(arqGal.files[0]));
  document.getElementById('btn-excluir-foto').addEventListener('click', excluirFotoAtual);

  if (l.foto) {
    const img = document.getElementById('foto-img');
    img.src = fotoUrl(l.foto) + '&_=' + Date.now();
    document.getElementById('foto-preview').style.display = 'block';
    document.getElementById('selo-foto').classList.add('visivel');
    document.getElementById('btn-excluir-foto').style.display = 'block';
  }

  validarAlerta(inp, l);
  setTimeout(() => { document.getElementById('q').value = ''; inp.focus(); }, 50);
}

function validarAlerta(inp, l) {
  const msg = document.getElementById('msg-alerta');
  const v = inp.value === '' ? null : Number(inp.value);
  // Compara com a leitura do mês passado SEM exibi-la na tela.
  const anterior = l.leitura_anterior;
  if (v != null && Number.isFinite(v) && anterior != null && v < Number(anterior)) {
    inp.classList.add('alerta');
    msg.classList.add('visivel');
  } else {
    inp.classList.remove('alerta');
    msg.classList.remove('visivel');
  }
}

function salvarAtual() {
  const l = linhaAtual();
  if (!l) return;
  const inp = document.getElementById('leitura');
  const valor = inp.value === '' ? null : Number(inp.value);
  if (valor != null && (!Number.isFinite(valor) || valor < 0)) return;

  setSalvamento('salvando', '💾 Salvando…');
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    try {
      const resp = await api(`/api/meses/${state.ref}`, {
        method: 'PUT',
        body: JSON.stringify({
          leituras: [{
            apartment_id: l.apartment_id,
            leitura_atual: valor == null ? '' : valor,
            data_leitura: new Date().toISOString().slice(0, 10),
          }],
        }),
      });
      // atualiza estado local
      const nl = resp.linhas.find((x) => x.apartment_id === l.apartment_id);
      if (nl) state.linhas[state.idx] = nl;
      setSalvamento('ok', '✅ Salvo');
      atualizarContagem();
      document.querySelector('.cartao')?.classList.toggle('feito', jaMedida(nl || l));
    } catch (e) {
      setSalvamento('erro', '❌ ' + e.message);
    }
  }, 350);
}

async function excluirFotoAtual() {
  const l = linhaAtual();
  if (!l || !l.foto) return;
  if (!confirm('Excluir a foto deste hidrômetro?')) return;
  try {
    await api(`/api/meses/${state.ref}/unidades/${l.apartment_id}/foto`, { method: 'DELETE' });
    l.foto = null;
    document.getElementById('foto-preview').style.display = 'none';
    document.getElementById('selo-foto').classList.remove('visivel');
    document.getElementById('btn-excluir-foto').style.display = 'none';
    setSalvamento('ok', '🗑️ Foto excluída');
  } catch (e) {
    setSalvamento('erro', '❌ ' + e.message);
  }
}

function processarFoto(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { alert('A foto é muito grande (máx. 8 MB).'); return; }
  setSalvamento('salvando', '📷 Enviando foto…');
  const reader = new FileReader();
  reader.onload = async () => {
    // redimensiona para economizar dados no celular
    const dataUrl = await redimensionar(reader.result, 1280, 0.75);
    const l = linhaAtual();
    try {
      const resp = await api(`/api/meses/${state.ref}/unidades/${l.apartment_id}/foto`, {
        method: 'POST',
        body: JSON.stringify({ foto: dataUrl }),
      });
      l.foto = resp.foto;
      const img = document.getElementById('foto-img');
      img.src = fotoUrl(resp.foto) + '&_=' + Date.now();
      document.getElementById('foto-preview').style.display = 'block';
      document.getElementById('selo-foto').classList.add('visivel');
      document.getElementById('btn-excluir-foto').style.display = 'block';
      setSalvamento('ok', '✅ Foto salva');
    } catch (e) {
      setSalvamento('erro', '❌ ' + e.message);
    }
  };
  reader.readAsDataURL(file);
}

function dataHoraTexto() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

function redimensionar(dataUrl, maxDim, qualidade) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) {
        const r = maxDim / Math.max(width, height);
        width = Math.round(width * r); height = Math.round(height * r);
      }
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // carimbo de data/hora no canto superior direito
      const texto = dataHoraTexto();
      ctx.font = `bold ${Math.max(14, Math.round(width / 28))}px -apple-system, Arial, sans-serif`;
      const pad = Math.max(8, Math.round(width / 60));
      const tw = ctx.measureText(texto).width;
      const th = Math.max(16, Math.round(width / 22));
      const bx = width - tw - pad * 2.4;
      const by = pad;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - pad, by, tw + pad * 2, th + pad);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'top';
      ctx.fillText(texto, bx, by + pad / 2);
      resolve(cv.toDataURL('image/jpeg', qualidade));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function irPara(idx) {
  if (idx < 0) idx = 0;
  if (idx >= state.linhas.length) idx = state.linhas.length - 1;
  state.idx = idx;
  renderCartao();
  window.scrollTo({ top: 0 });
}
function proxima() { if (state.idx < state.linhas.length - 1) irPara(state.idx + 1); }
function anterior() { if (state.idx > 0) irPara(state.idx - 1); }

function mostrarErro(msg) {
  const el = document.getElementById('erro');
  el.style.display = 'block';
  el.innerHTML = msg;
}

async function init() {
  if (!TOKEN && !MODO_GESTOR) {
    return mostrarErro('Link inválido: faltando o código de acesso. Peça um novo link ao responsável pelo condomínio.');
  }
  try {
    const me = MODO_GESTOR
      ? await api(`/api/me?med=1&ref=${encodeURIComponent(REF_GESTOR)}`)
      : await api('/api/me');
    if (!me.med) throw new Error('Este link não é válido para medição.');
    state.ref = me.med.ref_month;

    const detail = await api(`/api/meses/${state.ref}`);
    state.condoNome = (detail.condo && detail.condo.nome) || me.med.condo_nome || 'Condomínio';
    state.logo = detail.condo && detail.condo.logo;
    ordenarLinhas(detail.linhas || []);
    // começa na primeira unidade não medida (respeitando a ordem escolhida)
    const primeiraPendente = state.linhas.findIndex((l) => !jaMedida(l));
    state.idx = primeiraPendente === -1 ? 0 : primeiraPendente;

    document.getElementById('condo-nome').textContent = state.condoNome;
    document.getElementById('mes-info').textContent = `Medição de ${mesLabel(state.ref)} · ${me.user.nome}`;
    if (state.logo) {
      const logo = document.getElementById('logo');
      logo.src = fotoUrl(state.logo);
      logo.style.display = 'block';
    }
    document.getElementById('app').style.display = 'block';
    atualizarContagem();
    renderCartao();
  } catch (e) {
    mostrarErro('Não foi possível abrir a medição: ' + e.message +
      '<br><br>Este link pode ter sido cancelado. Peça um novo link ao responsável.');
  }
}

// busca por unidade/hidrômetro
document.getElementById('q').addEventListener('input', (e) => {
  const termo = e.target.value.trim().toLowerCase();
  const main = document.getElementById('cartao');
  if (!termo) { renderCartao(); return; }
  const hits = state.linhas.filter((l) =>
    l.etiqueta.toLowerCase().includes(termo) ||
    l.numero.toLowerCase().includes(termo) ||
    (l.hidrometro || '').toLowerCase().includes(termo)).slice(0, 8);
  main.innerHTML = `<div class="lista-busca">${hits.map((l, i) => `
    <div class="item-busca" data-i="${state.linhas.indexOf(l)}">
      <div><span class="etq">${l.etiqueta}</span> <span class="hid">· ${l.hidrometro || ''}</span></div>
      <span class="${jaMedida(l) ? 'ok' : 'pend'}">${jaMedida(l) ? '✅ medido' : '⏳ pendente'}</span>
    </div>`).join('') || '<div class="item-busca">Nenhuma unidade encontrada</div>'}</div>`;
  main.querySelectorAll('.item-busca[data-i]').forEach((el) => {
    el.addEventListener('click', () => irPara(Number(el.dataset.i)));
  });
});

document.getElementById('btn-prox').addEventListener('click', proxima);
document.getElementById('btn-ant').addEventListener('click', anterior);

init();

// marca do produto (nome pode vir trocado via APP_NAME no servidor)
fetch('/api/config').then((r) => (r.ok ? r.json() : null)).then((c) => {
  const el = document.getElementById('app-marca');
  if (el && c && c.app && c.app.nome) el.textContent = 'via ' + c.app.nome;
}).catch(() => {});
