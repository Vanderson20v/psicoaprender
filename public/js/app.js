'use strict';

const state = {
  user: null,
  isAdmin: false,
  condominios: [],
  condo: null,
  mes: null, month: null, linhas: new Map(),
  torre: '', q: '', soPendentes: false,
  dirty: new Set(), globalDirty: false, valorGlobal: '',
  saveTimer: null, salvando: false,
  histTab: 'apt',
};

const ACOES_LABELS = {
  login: 'Login no sistema', logout: 'Logout',
  criar_mes: 'Lançamento criado', alterar_valor_global: 'Valor global alterado',
  leitura_inicial: 'Leitura inicial registrada',
  finalizar_mes: 'Mês finalizado', reabrir_mes: 'Mês reaberto',
  inicializacao: 'Inicialização do sistema',
  criar_condominio: 'Condomínio cadastrado', upload_foto: 'Foto do hidrômetro enviada',
  criar_medidor_diario: 'Medidor macro diário cadastrado',
  excluir_medidor_diario: 'Medidor macro diário excluído',
  trocar_logo: 'Logo do condomínio atualizada', ativar_usuario: 'Usuário ativado',
  desativar_usuario: 'Usuário desativado', criar_usuario: 'Usuário criado',
  trocar_senha: 'Senha alterada', redefinir_senha_usuario: 'Senha de usuário redefinida',
  editar_condominio: 'Condomínio editado', editar_hidrometro: 'Hidrômetro de unidade atualizado',
  criar_hidrometro_comum: 'Hidrômetro de área comum cadastrado',
  editar_hidrometro_comum: 'Hidrômetro de área comum editado',
  excluir_hidrometro_comum: 'Hidrômetro de área comum excluído',
  criar_link_medicao: 'Link de medição gerado', revogar_link_medicao: 'Link de medição revogado',
  excluir_foto: 'Foto do hidrômetro excluída',
  alerta_consumo: 'Alerta de consumo enviado ao condômino',
};

// ---------------- init / roteamento ----------------

function showLoginOverlay() {
  window.__aguaLoginShown = true;
  const el = document.getElementById('view');
  el.innerHTML = `
    <div style="max-width:400px;margin:40px auto;">
      <div class="card" style="padding:30px 26px;">
        <h2 style="justify-content:center;">Entrar no sistema</h2>
        <form id="overlay-login">
          <div class="field" style="margin-bottom:12px;">
            <label for="ol-user">Usuário</label>
            <input type="text" id="ol-user" value="admin" required autofocus>
          </div>
          <div class="field" style="margin-bottom:14px;">
            <label for="ol-pass">Senha</label>
            <div class="senha-wrap"><input type="password" id="ol-pass" required placeholder="••••••••">
            <button type="button" class="olho" data-alvo="ol-pass">👁️</button></div>
          </div>
          <div id="ol-error" class="login-error" style="margin:0 0 12px;" hidden></div>
          <button class="btn btn-primary btn-block" style="margin-top:0;" type="submit">Entrar</button>
        </form>
        <p class="small mt-16" style="text-align:center;color:var(--muted);">Use as credenciais fornecidas pela administração.</p>
      </div>
    </div>`;
  ativarOlhosModal();
  document.getElementById('overlay-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('ol-error');
    errBox.hidden = true;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Entrando...';
    try {
      const res = await apiPost('/api/login', {
        username: document.getElementById('ol-user').value.trim(),
        password: document.getElementById('ol-pass').value,
      });
      setToken(res.token);
      window.__aguaLoginShown = false;
      aplicarSessao(res);
      document.getElementById('user-name').textContent = res.user.nome || res.user.username;
      montarShell();
      window.addEventListener('hashchange', route);
      if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
      route();
    } catch (err) {
      errBox.textContent = err.message || 'Falha no login.';
      errBox.hidden = false;
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}
window.logoutUI = showLoginOverlay;

async function init() {
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.view;
      location.hash = v === 'dashboard' ? '#/dashboard' : `#/${v}`;
    });
  });
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('logout-btn-m').addEventListener('click', logout);

  try {
    const me = await apiGet('/api/me');
    aplicarSessao(me);
    document.getElementById('user-name').textContent = me.user.nome || me.user.username;
    montarShell();
    window.addEventListener('hashchange', route);
    route();
  } catch {
    showLoginOverlay();
  }
}

// Liga o botão "olhinho" dos campos de senha dentro de modais.
function ativarOlhosModal() {
  document.querySelectorAll('#modal-overlay .olho').forEach((b) => {
    if (b.dataset.ligado) return;
    b.dataset.ligado = '1';
    b.addEventListener('click', () => {
      const inp = document.getElementById(b.dataset.alvo);
      if (!inp) return;
      const mostrar = inp.type === 'password';
      inp.type = mostrar ? 'text' : 'password';
      b.textContent = mostrar ? '🙈' : '👁️';
    });
  });
}

function aplicarSessao(data) {
  state.user = data.user;
  state.isAdmin = !!data.is_admin;
  state.condominios = data.condos || [];
  setCondo(data.default_condo || getCondo() || (state.condominios[0] && state.condominios[0].id) || '');
  state.condo = state.condominios.find((c) => c.id === getCondo()) || state.condominios[0] || null;
  if (data.user && data.user.must_change_password) modalTrocarSenhaObrigatoria();
}

// Primeiro acesso / senha temporária: o usuário É OBRIGADO a trocar a senha.
function modalTrocarSenhaObrigatoria() {
  openModal(`
    <h3>🔐 Defina uma nova senha</h3>
    <p class="m-sub">Este é o seu primeiro acesso (ou sua senha foi redefinida). Por segurança,
      crie uma senha nova antes de continuar. A senha deve ter no mínimo 6 caracteres.</p>
    <div class="field" style="margin-bottom:10px;"><label>Senha atual</label>
      <div class="senha-wrap"><input type="password" id="pw-atual" autocomplete="current-password">
      <button type="button" class="olho" data-alvo="pw-atual">👁️</button></div></div>
    <div class="field" style="margin-bottom:10px;"><label>Nova senha</label>
      <div class="senha-wrap"><input type="password" id="pw-nova" autocomplete="new-password">
      <button type="button" class="olho" data-alvo="pw-nova">👁️</button></div></div>
    <div class="field" style="margin-bottom:10px;"><label>Repetir a nova senha</label>
      <div class="senha-wrap"><input type="password" id="pw-conf" autocomplete="new-password">
      <button type="button" class="olho" data-alvo="pw-conf">👁️</button></div></div>
    <div id="pw-erro" class="login-error" hidden style="margin:8px 0;"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="pw-salvar">Salvar nova senha e entrar</button>
    </div>`);
  ativarOlhosModal();
  // impede fechar clicando fora
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.querySelector('.modal').addEventListener('click', (e) => e.stopPropagation());
  setTimeout(() => document.getElementById('pw-atual').focus(), 80);
  const salvar = async () => {
    const atual = document.getElementById('pw-atual').value;
    const nova = document.getElementById('pw-nova').value;
    const conf = document.getElementById('pw-conf').value;
    const er = document.getElementById('pw-erro');
    er.hidden = true;
    if (!atual) { er.textContent = 'Informe a senha atual.'; er.hidden = false; return; }
    if (nova.length < 6) { er.textContent = 'A nova senha deve ter ao menos 6 caracteres.'; er.hidden = false; return; }
    if (nova !== conf) { er.textContent = 'A confirmação não confere com a nova senha.'; er.hidden = false; return; }
    try {
      await apiPost('/api/me/senha', { senha_atual: atual, nova_senha: nova });
      state.user.must_change_password = false;
      closeModal();
      toast('Senha alterada com sucesso!', 'success');
    } catch (e) {
      er.textContent = e.message; er.hidden = false;
    }
  };
  document.getElementById('pw-salvar').addEventListener('click', salvar);
}

// Modal de troca de senha acessível pelas Configurações (sem obrigatoriedade).
function modalTrocarSenha() {
  openModal(`
    <h3>🔐 Alterar minha senha</h3>
    <div class="field" style="margin-bottom:10px;"><label>Senha atual</label>
      <div class="senha-wrap"><input type="password" id="pw2-atual" autocomplete="current-password">
      <button type="button" class="olho" data-alvo="pw2-atual">👁️</button></div></div>
    <div class="field" style="margin-bottom:10px;"><label>Nova senha</label>
      <div class="senha-wrap"><input type="password" id="pw2-nova" autocomplete="new-password">
      <button type="button" class="olho" data-alvo="pw2-nova">👁️</button></div></div>
    <div class="field" style="margin-bottom:10px;"><label>Repetir a nova senha</label>
      <div class="senha-wrap"><input type="password" id="pw2-conf" autocomplete="new-password">
      <button type="button" class="olho" data-alvo="pw2-conf">👁️</button></div></div>
    <div id="pw2-erro" class="login-error" hidden style="margin:8px 0;"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" id="pw2-salvar">Salvar nova senha</button>
    </div>`);
  ativarOlhosModal();
  setTimeout(() => document.getElementById('pw2-atual').focus(), 80);
  document.getElementById('pw2-salvar').addEventListener('click', async () => {
    const atual = document.getElementById('pw2-atual').value;
    const nova = document.getElementById('pw2-nova').value;
    const conf = document.getElementById('pw2-conf').value;
    const er = document.getElementById('pw2-erro');
    er.hidden = true;
    if (nova.length < 6) { er.textContent = 'A nova senha deve ter ao menos 6 caracteres.'; er.hidden = false; return; }
    if (nova !== conf) { er.textContent = 'A confirmação não confere.'; er.hidden = false; return; }
    try {
      await apiPost('/api/me/senha', { senha_atual: atual, nova_senha: nova });
      closeModal();
      toast('Senha alterada com sucesso!', 'success');
    } catch (e) {
      er.textContent = e.message; er.hidden = false;
    }
  });
}

async function logout() {
  try { await apiPost('/api/logout'); } catch { /* ignore */ }
  setToken(''); setCondo('');
  window.location.href = '/index.html';
}

function montarShell() {
  // permissões: abas só de administrador
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.style.display = state.isAdmin ? '' : 'none';
  });
  aplicarAbasCondominio();
  // seletor de condomínio: gestor tem 1 só → oculta
  const wrapSel = document.getElementById('condo-select');
  if (wrapSel) wrapSel.style.display = state.condominios.length > 1 ? '' : 'none';

  const sel = document.getElementById('condo-select');
  if (!sel) return;
  sel.innerHTML = state.condominios.map((c) =>
    `<option value="${c.id}" ${state.condo && c.id === state.condo.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  sel.onchange = () => {
    setCondo(sel.value);
    state.condo = state.condominios.find((c) => c.id === sel.value);
    aplicarAbasCondominio();
    if (!condoMedeMensal() && condoMedeDiaria() && !location.hash.startsWith('#/diaria')) { location.hash = '#/diaria'; return; }
    if (!condoMedeDiaria() && location.hash.startsWith('#/diaria')) { location.hash = '#/dashboard'; return; }
    if (location.hash.startsWith('#/lancamento') || location.hash.startsWith('#/historico') || location.hash === '') {
      location.hash = '#/dashboard';
    } else { route(); }
  };
  const label = document.getElementById('condo-label');
  if (label && state.condo) label.textContent = state.condo.nome;
  const srcLogo = state.condo && state.condo.logo
    ? fotoUrl(state.condo.logo)
    : null;
  const logo = document.getElementById('condo-logo');
  if (logo) {
    logo.src = srcLogo || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%230891b2' d='M12 2C12 2 5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13z'/%3E%3C/svg%3E";
  }
  const logoM = document.getElementById('condo-logo-m');
  if (logoM) {
    logoM.src = srcLogo || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%2322d3ee' d='M12 2C12 2 5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13z'/%3E%3C/svg%3E";
  }
}

// o condomínio atual cobra mensalmente? (cadastro define; antigo = mensal por padrão)
function condoMedeMensal() {
  const m = state.condo && state.condo.medicoes;
  return !m || m.mensal !== false;
}
function condoMedeDiaria() {
  const m = state.condo && state.condo.medicoes;
  return !m || m.diaria_macro !== false;
}
function aplicarAbasCondominio() {
  const mensal = condoMedeMensal();
  document.querySelectorAll('button[data-view="lancamento"], button[data-view="historico"], button[data-view="iniciais"]').forEach((b) => {
    b.style.display = mensal ? '' : 'none';
  });
  document.querySelectorAll('button[data-view="diaria"]').forEach((b) => {
    b.style.display = condoMedeDiaria() ? '' : 'none';
  });
}

function route() {
  const parts = (location.hash || '#/dashboard').replace(/^#\//, '').split('/');
  const view = parts[0] || 'dashboard';
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  const el = document.getElementById('view');
  el.innerHTML = '';
  if ((view === 'condominios' || view === 'usuarios') && !state.isAdmin) { location.hash = '#/dashboard'; return; }
  // admin sem NENHUM condomínio cadastrado (banco de fábrica): a tela de Condomínios
  // é justamente o cadastro, então não pode ser bloqueada nem redirecionada para si mesma
  if (!state.condo && !(state.isAdmin && view === 'condominios')) {
    location.hash = state.isAdmin ? '#/condominios' : '#/dashboard'; return;
  }
  if (!condoMedeMensal() && ['lancamento', 'historico'].includes(view)) { location.hash = '#/diaria'; return; }
  if (!condoMedeDiaria() && view === 'diaria') { location.hash = '#/dashboard'; return; }
  if (view === 'lancamento') renderLancamento(el, parts[1] || null);
  else if (view === 'historico') renderHistorico(el, parts);
  else if (view === 'diaria') renderDiaria(el);
  else if (view === 'configuracoes') renderConfiguracoes(el);
  else if (view === 'iniciais') renderIniciais(el);
  else if (view === 'condominios') renderCondominios(el);
  else if (view === 'usuarios') renderUsuarios(el);
  else renderDashboard(el);
}

function mesPadrao() {
  const d = new Date();
  const ref = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
}

// ================================================================
// DASHBOARD
// ================================================================

async function renderDashboard(el) {
  el.innerHTML = `<div class="empty-state"><p>Carregando...</p></div>`;
  const [resumo, mesesResp] = await Promise.all([apiGet('/api/resumo'), apiGet('/api/meses')]);
  // trilha de auditoria é restrita ao administrador
  let aud = { eventos: [] };
  if (state.isAdmin) {
    try { aud = await apiGet('/api/auditoria'); } catch { aud = { eventos: [] }; }
  }
  const ult = resumo.ultimo_mes;
  el.innerHTML = `
    <div class="dash-head">
      <div class="dash-ident">
        ${state.condo && state.condo.logo
          ? `<img class="dash-logo" src="${fotoUrl(state.condo.logo)}" alt="logo do condomínio">`
          : '<div class="dash-logo dash-logo-photo">🏢</div>'}
        <div>
          <div class="dash-condo">${esc(resumo.condominio)}</div>
          <h1>Dashboard</h1>
          <p>Visão geral do faturamento de água</p>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-novo">+ Novo lançamento</button>
    </div>

    <div class="grid grid-4 mb-24">
      <div class="card stat-card">
        <span class="s-label">Unidades</span>
        <span class="s-value">${fmtInt(resumo.total_apartamentos)}</span>
        <span class="s-sub">Hidrômetros individualizados</span>
      </div>
      <div class="card stat-card accent-green">
        <span class="s-label">Meses finalizados</span>
        <span class="s-value">${fmtInt(resumo.meses_finalizados)}</span>
        <span class="s-sub">${resumo.total_meses} lançamento(s) no total</span>
      </div>
      <div class="card stat-card accent-cyan">
        <span class="s-label">Soma das unidades${ult ? ` (${mesLabel(ult.ref_month)})` : ''}</span>
        <span class="s-value">${ult ? fmtBRL(ult.total_individual) : '—'}</span>
        <span class="s-sub">Água + esgoto rateado</span>
      </div>
      <div class="card stat-card accent-amber">
        <span class="s-label">Fatura global${ult ? ` (${mesLabel(ult.ref_month)})` : ''}</span>
        <span class="s-value">${ult && ult.valor_global != null ? fmtBRL(ult.valor_global) : '—'}</span>
        <span class="s-sub">${ult && ult.valor_area_comum != null ? `Área comum: ${fmtBRL(ult.valor_area_comum)}` : 'Ainda não lançada'}</span>
      </div>
    </div>

    ${resumo.maiores_consumos && resumo.maiores_consumos.length ? `
    <div class="card mb-24" style="border-left:4px solid #f59e0b;">
      <h2>📊 Unidades com consumo acima da média
        ${resumo.mes_referencia_consumo ? `<span class="spacer"></span><span class="small">Média: <strong>${fmtNum(resumo.media_consumo, 1)} m³</strong> · ${mesLabel(resumo.mes_referencia_consumo)}</span>` : ''}
      </h2>
      <p class="small mb-16">Unidades que consumiram mais que a média do condomínio no mês de referência. Úteis para identificar vazamentos ou usos elevados.</p>
      <div class="table-wrap" style="box-shadow:none;border:none;max-height:340px;overflow-y:auto;">
        <table class="data">
          <thead><tr><th>#</th><th>Unidade</th><th>Torre</th><th class="num">Consumo (m³)</th><th class="num">Valor total</th><th></th></tr></thead>
          <tbody>
            ${resumo.maiores_consumos.map((l, i) => `
              <tr${l.consumo > 100 ? ' style="background:#fffbeb;"' : ''}>
                <td class="small">${i + 1}º</td>
                <td class="apt-tag">${l.etiqueta}</td>
                <td>${l.torre}</td>
                <td class="num"><strong>${fmtNum(l.consumo, 1)}</strong>${l.consumo > 100 ? ' <span class="badge badge-atencao">elevado</span>' : ''}</td>
                <td class="num">${fmtBRL(l.valor_total)}</td>
                <td class="center"><button type="button" class="btn btn-ghost btn-sm" data-hist-id="${l.apartment_id}" data-hist-etq="${l.etiqueta}">Ver histórico</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <div class="card mb-24">
      <h2>Lançamentos mensais</h2>
      <div class="table-wrap" style="box-shadow:none;border:none;">
        <table class="data">
          <thead><tr>
            <th>Mês de referência</th><th>Situação</th><th class="num">Leituras</th>
            <th class="num">Fatura global</th><th class="num">Unidades</th><th class="num">Área comum</th><th></th>
          </tr></thead>
          <tbody>
            ${mesesResp.meses.length ? mesesResp.meses.map((m) => `
              <tr>
                <td class="apt-tag">${mesLabel(m.ref_month)}</td>
                <td>${m.status === 'finalizado'
                  ? '<span class="badge badge-finalizado">Finalizado</span>'
                  : '<span class="badge badge-rascunho">Rascunho</span>'}</td>
                <td class="num">${m.status === 'finalizado' ? `${m.total_apartamentos}/${m.total_apartamentos}` : `${m.lidos}/${m.total_apartamentos}`}</td>
                <td class="num">${fmtBRL(m.valor_global)}</td>
                <td class="num">${m.status === 'finalizado' ? fmtBRL(m.total_individual) : '—'}</td>
                <td class="num">${m.valor_area_comum != null ? fmtBRL(m.valor_area_comum) : '—'}</td>
                <td class="center" style="white-space:nowrap;">
                  <a class="btn btn-ghost btn-sm" href="#/lancamento/${m.ref_month}">Lançamento</a>
                  <a class="btn btn-ghost btn-sm" href="#/historico/mes/${m.ref_month}">Relatório</a>
                </td>
              </tr>`).join('') : '<tr><td colspan="7" class="empty-state">Nenhum lançamento ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    ${state.isAdmin ? `
    <div class="card">
      <h2>Trilha de auditoria</h2>
      <div class="table-wrap" style="box-shadow:none;border:none;max-height:320px;overflow-y:auto;">
        <table class="data audit-table">
          <thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr></thead>
          <tbody>
            ${aud.eventos.filter((e) => !e.condo || (state.condo && e.condo === state.condo.nome)).slice(0, 25).map((e) => {
              let det = '';
              try { det = JSON.parse(e.details).msg || e.details.replace(/[{}"]/g, '').slice(0, 120); } catch { det = ''; }
              return `<tr>
                <td class="ts">${dataHora(e.ts)}</td>
                <td>${esc(e.username)}</td>
                <td><strong>${esc(ACOES_LABELS[e.action] || e.action)}</strong></td>
                <td class="small">${esc(det)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}`;
  document.getElementById('btn-novo').addEventListener('click', () => { location.hash = '#/lancamento'; });
  document.querySelectorAll('[data-hist-id]').forEach((b) =>
    b.addEventListener('click', () => modalHistoricoUnidade(b.dataset.histId, b.dataset.histEtq)));
}

// Modal com o histórico de uma unidade direto (sem trocar de aba).
async function modalHistoricoUnidade(aptId, etq) {
  openModal(`<h3>Histórico — ${esc(etq || '')}</h3><p class="m-sub" id="mh-loading">Carregando histórico…</p>`);
  try {
    const hist = await apiGet(`/api/apartamentos/${aptId}/historico`);
    const reg = hist.registros.filter((r) => r.consumo != null);
    const todos = hist.registros;
    openModal(`
      <h3>Histórico — ${esc(hist.apartamento.etiqueta)}
        <span class="spacer"></span><span class="small">Hidrômetro ${esc(hist.apartamento.hidrometro || '—')}</span></h3>
      ${reg.length ? `
        <div class="chart-box">${lineChartSVG(reg.map((r) => ({ label: mesCurto(r.ref_month), value: r.consumo })), {
          aria: `Consumo da unidade ${hist.apartamento.etiqueta}`,
          fmtVal: (v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³`,
        })}</div>
        <div class="chart-legend"><span class="lg"><span class="dot" style="background:#0891b2"></span> Consumo em m³ (leitura atual − anterior)</span></div>`
        : '<p class="small">Sem leituras lançadas ainda.</p>'}
      <div class="table-wrap" style="box-shadow:none;border:none;max-height:40vh;overflow-y:auto;margin-top:12px;">
        <table class="data">
          <thead><tr>
            <th>Mês</th><th class="num">Anterior</th><th class="num">Atual</th><th class="num">Consumo (m³)</th>
            <th class="num">Total (R$)</th><th class="center">Foto</th><th>Medição por</th>
          </tr></thead>
          <tbody>
            ${todos.slice().reverse().map((r) => `
              <tr>
                <td class="apt-tag">${mesLabel(r.ref_month)}</td>
                <td class="num">${r.leitura_anterior != null ? fmtNum(r.leitura_anterior, 2) : '—'}</td>
                <td class="num">${r.leitura_atual != null ? fmtNum(r.leitura_atual, 2) : '—'}</td>
                <td class="num">${r.consumo != null ? fmtNum(r.consumo, 2) : '—'}</td>
                <td class="num"><strong>${fmtBRL(r.valor_total)}</strong></td>
                <td class="center">${r.foto ? `<a href="${fotoUrl(r.foto)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><img src="${fotoUrl(r.foto)}" class="foto-thumb" alt="foto"></a>` : '<span class="small">—</span>'}</td>
                <td class="small">${esc(r.medido_por || (r.updated_by || '—'))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-actions">
        ${reg.length ? '<button class="btn btn-warn" id="mh-btn-alerta">⚠️ Enviar alerta ao condômino</button>' : ''}
        <button class="btn btn-primary" data-close>Fechar</button>
      </div>`);
    const btnAlerta = document.getElementById('mh-btn-alerta');
    if (btnAlerta) btnAlerta.addEventListener('click', () => modalAlertaConsumo(hist));
  } catch (e) {
    document.getElementById('mh-loading').textContent = 'Erro ao carregar: ' + e.message;
  }
}

// ================================================================
// ALERTA DE CONSUMO ACIMA DA MÉDIA — mensagem orientativa ao condômino
// ================================================================

function dataDiaMes(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function modalAlertaConsumo(hist) {
  const apt = hist.apartamento;
  const registros = hist.registros.filter((r) => r.consumo != null);
  if (!registros.length) { toast('Não há medições lançadas para esta unidade.', 'error'); return; }
  const ultimo = registros[registros.length - 1];

  // média do condomínio no mês de referência (se o gestor veio do card do dashboard)
  let media = null;
  try {
    const resumo = await apiGet('/api/resumo');
    if (resumo.mes_referencia_consumo === ultimo.ref_month) media = resumo.media_consumo;
  } catch { /* resumo é opcional */ }

  // link de conferência do condômino (gera ou reaproveita o link ativo da unidade)
  let urlConferencia = null;
  try {
    const r = await apiPost(`/api/apartamentos/${apt.id}/link-conferencia`, {});
    urlConferencia = `${location.origin}/conferencia.html?token=${encodeURIComponent(r.link.token)}`;
  } catch { /* link é opcional; a mensagem segue sem ele */ }

  const nomeCondo = (state.condo && state.condo.nome) || 'o condomínio';
  const unidade = apt.torre ? `${apt.etiqueta} (Torre ${apt.torre})` : apt.etiqueta;
  const diaMedicao = dataDiaMes(ultimo.data_leitura)
    || `na medição referente a ${mesLabel(ultimo.ref_month)}`;
  const cons = ultimo.consumo.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const linhas = [
    `Prezado(a) condômino(a) da unidade ${unidade},`,
    '',
    `No dia ${diaMedicao}, ao realizarmos a leitura do hidrômetro do seu apartamento, constatamos um consumo de ${cons.replace('.', ',')} m³`
      + (media != null
        ? `, valor acima da média das unidades do condomínio (${media.toLocaleString('pt-BR', { maximumFractionDigits: 2 }).replace('.', ',')} m³ no período).`
        : ', valor acima do consumo habitual da unidade.'),
    '',
    'Um consumo elevado como esse pode indicar vazamento interno na unidade. Para evitar surpresas na próxima fatura, recomendamos verificar:',
    '',
    '• Vaso sanitário: adicione corante na caixa acoplada e aguarde 30 minutos sem dar descarga; se a água do vaso mudar de cor, há vazamento na borracha de vedação.',
    '• Torneiras, registros e chuveiros pingando ou com vedação ressecada.',
    '• Ducha higiênica e torneira da área de serviço.',
    '• Teste rápido: feche todas as torneiras e não use água por 1 hora; se o número do hidrômetro continuar andando, existe um vazamento oculto.',
    '',
    'Caso não consiga identificar o ponto de vazamento, recomendamos acionar um encanador de sua confiança o quanto antes.',
    '',
    urlConferencia
      ? `Você pode conferir o histórico de consumo, as leituras e as fotos do hidrômetro da sua unidade a qualquer momento, sem precisar de senha, pelo link:\n${urlConferencia}`
      : 'Estamos à disposição caso queira conferir a leitura ou a foto do hidrômetro.',
    '',
    `Atenciosamente,`,
    `Administração — ${nomeCondo}`,
  ];
  const mensagem = linhas.join('\n');

  const telKey = `agua_tel_${apt.id}`;
  openModal(`
    <h3>⚠️ Alerta de consumo — ${esc(apt.etiqueta)}</h3>
    <p class="m-sub">Uma mensagem orientativa <strong>já está pronta</strong> para o condômino desta unidade,
      informando o consumo acima da média e orientando a verificar possíveis vazamentos.
      Você pode abrir o WhatsApp com o texto preenchido ou copiar a mensagem e enviar pelo canal que preferir.</p>
    <div class="field" style="margin-bottom:12px;">
      <label for="al-tel">Telefone do condômino (opcional, para abrir o WhatsApp)</label>
      <input type="text" id="al-tel" placeholder="Ex.: (61) 99999-9999"
        value="${esc(localStorage.getItem(telKey) || localStorage.getItem('agua_tel_ultimo') || '')}">
    </div>
    ${urlConferencia ? `
    <div class="field" style="margin-bottom:12px;">
      <label>🔗 Link de conferência do condômino (já incluído na mensagem)</label>
      <div style="display:flex;gap:8px;align-items:stretch;">
        <div class="formula-box" style="flex:1;word-break:break-all;margin:0;font-size:12.5px;">${esc(urlConferencia)}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="al-copiar-link" style="white-space:nowrap;">📋 Copiar link</button>
      </div>
    </div>` : ''}
    <div class="field" style="margin-bottom:8px;">
      <label for="al-msg">Mensagem (editável)</label>
      <textarea id="al-msg" rows="18" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:9px;font-size:13.5px;font-family:inherit;line-height:1.5;resize:vertical;">${esc(mensagem)}</textarea>
    </div>
    <p class="small" style="color:var(--muted);">💡 O link permite que o condômino veja o histórico, as leituras e as fotos do hidrômetro da própria unidade, sem login e sem acesso ao restante do sistema.</p>
    <div class="modal-actions">
      <button class="btn btn-success" id="al-wpp">💬 Abrir no WhatsApp</button>
      <button class="btn btn-primary" id="al-copiar">📋 Copiar mensagem</button>
      <button class="btn btn-ghost" data-close>Fechar</button>
    </div>`);

  const btnCopiarLink = document.getElementById('al-copiar-link');
  if (btnCopiarLink) btnCopiarLink.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(urlConferencia); toast('Link copiado!', 'success'); }
    catch { window.prompt('Copie o link:', urlConferencia); }
  });

  const registrar = (canal) => {
    apiPost(`/api/apartamentos/${apt.id}/alerta-consumo`, {
      ref_month: ultimo.ref_month, consumo: ultimo.consumo, media, canal,
    }).catch(() => { /* registro de auditoria é best-effort */ });
  };

  document.getElementById('al-wpp').addEventListener('click', () => {
    let tel = document.getElementById('al-tel').value.replace(/\D/g, '');
    if (!tel) { toast('Informe o telefone do condômino ou use "Copiar mensagem".', 'error'); return; }
    if (tel.startsWith('0')) tel = tel.slice(1);
    if (tel.length === 10 || tel.length === 11) tel = '55' + tel;
    if (tel.length < 12 || tel.length > 13 || !tel.startsWith('55')) {
      toast('Telefone inválido. Use DDD + número, ex.: (61) 99999-9999.', 'error');
      return;
    }
    localStorage.setItem(telKey, tel);
    localStorage.setItem('agua_tel_ultimo', tel);
    const texto = encodeURIComponent(document.getElementById('al-msg').value);
    registrar('whatsapp');
    window.open(`https://wa.me/${tel}?text=${texto}`, '_blank', 'noopener');
    toast('Abrindo o WhatsApp com a mensagem pronta…', 'success');
  });

  document.getElementById('al-copiar').addEventListener('click', async () => {
    const texto = document.getElementById('al-msg').value;
    let copiou = false;
    try { await navigator.clipboard.writeText(texto); copiou = true; }
    catch {
      try {
        const ta = document.getElementById('al-msg');
        ta.select();
        copiou = document.execCommand('copy');
      } catch { /* cai no prompt */ }
    }
    if (copiou) {
      registrar('copia');
      toast('Mensagem copiada! Cole no WhatsApp, SMS ou e-mail do condômino.', 'success');
    } else {
      window.prompt('Copie a mensagem:', texto);
    }
  });
}

// ================================================================
// LANÇAMENTO MENSAL
// ================================================================

async function renderLancamento(el, ref) {
  el.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Lançamento Mensal</h1>
        <p>Informe o mês de referência, a fatura global e as leituras dos hidrômetros</p>
      </div>
    </div>
    <div id="lac-area"><div class="empty-state"><p>Carregando...</p></div></div>`;
  const area = document.getElementById('lac-area');

  if (!ref) {
    area.innerHTML = starterHTML();
    ligarBotaoIniciar();
    // lista os lançamentos já abertos
    try {
      const resp = await apiGet('/api/meses');
      const lista = document.getElementById('meses-existentes');
      if (lista && resp.meses.length) {
        lista.innerHTML = `
          <h2>Lançamentos já abertos</h2>
          <p class="small mb-16">Clique em um mês para abrir o lançamento e continuar a medição.</p>
          <div class="table-wrap" style="box-shadow:none;border:none;">
            <table class="data">
              <thead><tr><th>Mês</th><th>Situação</th><th class="num">Leituras</th><th></th></tr></thead>
              <tbody>
                ${resp.meses.map((m) => `
                  <tr>
                    <td class="apt-tag">${mesLabel(m.ref_month)}</td>
                    <td>${m.status === 'finalizado'
                      ? '<span class="badge badge-finalizado">Finalizado</span>'
                      : '<span class="badge badge-rascunho">Rascunho</span>'}</td>
                    <td class="num">${m.status === 'finalizado' ? `${m.total_apartamentos}/${m.total_apartamentos}` : `${m.lidos}/${m.total_apartamentos}`}</td>
                    <td class="center"><a class="btn btn-primary btn-sm" href="#/lancamento/${m.ref_month}">Abrir lançamento</a></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }
    } catch { /* se falhar, fica só o form de iniciar */ }
    return;
  }

  try {
    const detail = await apiGet(`/api/meses/${ref}`);
    carregarDetail(detail);
    montarWorkspace(area);
  } catch (e) {
    if (e.status === 404) {
      area.innerHTML = starterHTML(ref);
      ligarBotaoIniciar();
    } else toast(e.message, 'error');
  }
}

function starterHTML(ref) {
  return `
  <div class="card" style="max-width:560px;">
    <h2>Iniciar lançamento</h2>
    <div class="grid" style="gap:14px;">
      <div class="field">
        <label for="in-ref">Mês de referência</label>
        <input type="month" id="in-ref" value="${ref || mesPadrao()}">
      </div>
      <div class="field">
        <label for="in-global">Valor total da fatura global (R$)</label>
        <input type="number" id="in-global" step="0.01" min="0" placeholder="Opcional — pode ser lançado depois">
      </div>
      <p class="small">A leitura anterior é buscada automaticamente do mês anterior (ex.: medição de
      <strong>agosto</strong> já está cadastrada e será a referência para <strong>setembro</strong>).
      O saldo da fatura global após o rateio das unidades é lançado como <strong>área comum</strong>.</p>
      <button class="btn btn-primary" id="btn-iniciar">Iniciar lançamento</button>
    </div>
  </div>
  <div id="meses-existentes"></div>`;
}

function ligarBotaoIniciar() {
  const btn = document.getElementById('btn-iniciar');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const novoRef = document.getElementById('in-ref').value;
    const vg = document.getElementById('in-global').value;
    if (!novoRef) return toast('Selecione o mês de referência.', 'error');
    try {
      await apiPost('/api/meses', { ref_month: novoRef, valor_global: vg === '' ? null : Number(vg) });
      toast(`Lançamento de ${mesLabel(novoRef)} criado.`, 'success');
    } catch (e) {
      if (e.status === 409) toast('Este mês já existe — carregando...', 'ok');
      else return toast(e.message, 'error');
    }
    location.hash = `#/lancamento/${novoRef}`;
  });
}

function carregarDetail(detail) {
  state.mes = detail.month.ref_month;
  state.month = detail.month;
  state.valorGlobal = detail.month.valor_global != null ? String(detail.month.valor_global) : '';
  state.globalDirty = false;
  state.dirty.clear();
  state.linhas = new Map();
  for (const l of detail.linhas) {
    state.linhas.set(l.apartment_id, {
      ...l,
      atual: l.leitura_atual != null ? String(l.leitura_atual) : '',
      anteriorEditavel: !l.tem_baseline,
    });
  }
}

function montarWorkspace(area) {
  const bloqueado = state.month.status === 'finalizado';
  const torres = [...new Set([...state.linhas.values()].map((l) => l.torre))].sort();
  area.innerHTML = `
    <div class="card mb-16">
      <div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div class="flex" style="align-items:center;gap:12px;flex-wrap:wrap;">
          <h2 style="margin:0;">
            ${mesLabel(state.mes)}
            ${bloqueado ? '<span class="badge badge-finalizado">Finalizado</span>' : '<span class="badge badge-rascunho">Rascunho</span>'}
            ${state.month.finalizado_forcado ? '<span class="badge badge-atencao" title="Fechado com área comum negativa (reservatório)">⚠️ Fechado c/ ressalva</span>' : ''}
          </h2>
          <select id="sel-mes" style="padding:8px 10px;border-radius:8px;border:1px solid var(--border,#cbd5e1);font-weight:600;"></select>
        </div>
        <div class="flex" style="flex-wrap:wrap;gap:8px;justify-content:flex-end;">
          <button class="btn btn-primary btn-sm" id="btn-medir">📱 Iniciar medição</button>
          <button class="btn btn-ghost btn-sm" id="btn-delegar">🔗 Delegar (link)</button>
          <button class="btn btn-ghost btn-sm" id="btn-memoria">Memória de cálculo</button>
          ${state.isAdmin ? '<button class="btn btn-danger btn-sm" id="btn-excluir-mes">🗑️ Excluir mês</button>' : ''}
          ${bloqueado
            ? '<button class="btn btn-danger btn-sm" id="btn-reabrir">Reabrir lançamento</button>'
            : '<button class="btn btn-success" id="btn-finalizar">Finalizar faturamento</button>'}
        </div>
      </div>
      ${bloqueado && state.month.finalized_at ? `<p class="small mt-16">Medição conferida e fechada${state.month.finalizado_forcado ? ' <strong>com ressalva</strong> (a soma das unidades superou a fatura global — uso de reservatório).' : '.'} Para corrigir ou lançar o valor da fatura global, reabra o lançamento — a ação fica registrada na auditoria.</p>` : ''}
    </div>

    <div class="grid grid-4 mb-24">
      <div class="card stat-card">
        <span class="s-label">Fatura global (CAESB)</span>
        ${bloqueado
          ? `<span class="s-value">${fmtBRL(state.month.valor_global)}</span>`
          : `<input type="number" id="inp-global" step="0.01" min="0" value="${esc(state.valorGlobal)}" placeholder="0,00" style="font-size:18px;font-weight:700;">`}
        <span class="s-sub">Valor total cobrado do condomínio</span>
      </div>
      <div class="card stat-card accent-cyan">
        <span class="s-label">Soma das unidades</span>
        <span class="s-value" id="sum-unidades">${fmtBRL(0)}</span>
        <span class="s-sub">Água + esgoto das unidades</span>
      </div>
      <div class="card stat-card accent-amber">
        <span class="s-label">Área comum (saldo)</span>
        <span class="s-value" id="sum-comum">—</span>
        <span class="s-sub">Fatura global − unidades</span>
      </div>
      <div class="card stat-card">
        <span class="s-label">Leituras lançadas</span>
        <span class="s-value" id="sum-lidos">0/0</span>
        <div class="progress mt-16"><div id="prog-bar" style="width:0%"></div></div>
      </div>
    </div>

    <div class="card">
      <div class="filter-bar">
        <div class="field">
          <label>Torre</label>
          <select id="f-bloco">
            <option value="">Todas</option>${torres.map((t) => `<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:1;">
          <input type="search" id="f-q" placeholder="Buscar unidade (ex.: 201A) ou hidrômetro (S7025041)...">
        </div>
        <label class="check-pill"><input type="checkbox" id="f-pendentes"> Somente pendentes</label>
      </div>
      <div class="table-wrap" style="max-height:62vh;overflow-y:auto;box-shadow:none;border:none;">
        <table class="data" id="tab-leituras">
          <thead><tr>
            <th>Unidade</th>
            <th>Hidrômetro</th>
            <th class="num">Leitura anterior (m³)</th>
            <th class="num">Leitura atual (m³)</th>
            <th class="num">Consumo (m³)</th>
            <th class="num">Valor total (R$)</th>
            <th class="center">Foto</th>
            <th>Medição por</th>
            <th>Situação</th>
          </tr></thead>
          <tbody id="tbody-leituras"></tbody>
        </table>
      </div>
      <p class="small mt-16">💧 Salvamento automático. Use o botão de câmera/foto para registrar a imagem do
      hidrômetro — ela serve de comprovante junto ao condômino. Leitura menor que a anterior é sinalizada
      em vermelho e bloqueia o fechamento.</p>
    </div>`;

  renderLinhas();
  atualizarResumo();

  const tbody = document.getElementById('tbody-leituras');
  tbody.addEventListener('input', onInputLinha);
  tbody.addEventListener('click', onClickLinha);
  tbody.addEventListener('change', onChangeLinha);
  document.getElementById('f-bloco').addEventListener('change', (e) => { state.torre = e.target.value; aplicarFiltros(); });
  document.getElementById('f-q').addEventListener('input', (e) => { state.q = e.target.value.trim().toUpperCase(); aplicarFiltros(); });
  document.getElementById('f-pendentes').addEventListener('change', (e) => { state.soPendentes = e.target.checked; aplicarFiltros(); });
  document.getElementById('btn-memoria').addEventListener('click', mostrarMemoria);
  document.getElementById('btn-medir').addEventListener('click', iniciarMedicao);
  document.getElementById('btn-delegar').addEventListener('click', modalDelegar);

  // seletor de mês dentro da própria tela de lançamento
  const selMes = document.getElementById('sel-mes');
  apiGet('/api/meses').then((r) => {
    const meses = r.meses;
    selMes.innerHTML = meses.map((m) =>
      `<option value="${m.ref_month}" ${m.ref_month === state.mes ? 'selected' : ''}>${mesLabel(m.ref_month)} — ${m.status === 'finalizado' ? 'finalizado' : 'rascunho'}</option>`).join('')
      + '<option value="__novo">+ Novo lançamento…</option>';
  }).catch(() => {});
  selMes.addEventListener('change', () => {
    if (selMes.value === '__novo') location.hash = '#/lancamento';
    else location.hash = `#/lancamento/${selMes.value}`;
  });
  const btnExcluir = document.getElementById('btn-excluir-mes');
  if (btnExcluir) btnExcluir.addEventListener('click', confirmarExcluirMes);

  if (!bloqueado) {
    document.getElementById('inp-global').addEventListener('input', (e) => {
      state.valorGlobal = e.target.value;
      state.globalDirty = true;
      atualizarResumo();
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(salvarRascunho, 700);
    });
    document.getElementById('btn-finalizar').addEventListener('click', confirmarFinalizacao);
  } else {
    document.getElementById('btn-reabrir').addEventListener('click', confirmarReabertura);
  }
}

function fotoCellHTML(l, bloqueado) {
  if (l.foto) {
    return `<div style="display:inline-flex;align-items:center;gap:4px;">
      <a href="${fotoUrl(l.foto)}" target="_blank" rel="noopener" title="Ver foto do hidrômetro" class="foto-link">
        <img src="${fotoUrl(l.foto)}" class="foto-thumb" alt="Foto do hidrômetro ${esc(l.etiqueta)}"></a>
      ${bloqueado ? '' : `<button type="button" class="foto-del" data-foto-del="${l.apartment_id}" title="Excluir esta foto"
        style="border:none;background:none;cursor:pointer;font-size:15px;padding:2px;line-height:1;">🗑️</button>`}
    </div>`;
  }
  if (bloqueado) return '<span class="small">—</span>';
  return `<label class="foto-btn" title="Enviar foto do hidrômetro">
      📷<input type="file" accept="image/*" capture="environment" data-foto="${l.apartment_id}" hidden>
    </label>`;
}

function renderLinhas() {
  const bloqueado = state.month.status === 'finalizado';
  const tbody = document.getElementById('tbody-leituras');
  tbody.innerHTML = [...state.linhas.values()].map((l) => {
    const anteriorDisp = l.leitura_anterior != null;
    const celAnterior = anteriorDisp
      ? `<span class="num">${fmtNum(l.leitura_anterior, 2)}</span>`
      : (bloqueado
          ? '<span class="num">—</span>'
          : `<input type="number" class="reading-input input-sm" data-campo="anterior" data-id="${l.apartment_id}" step="any" min="0" placeholder="leitura inicial">`);
    return `
    <tr id="row-${l.apartment_id}" data-torre="${l.torre}" data-busca="${l.etiqueta} ${l.hidrometro || ''}" data-status="${l.status}">
      <td class="apt-tag">${l.etiqueta}</td>
      <td class="small" style="font-family:ui-monospace,monospace;">${esc(l.hidrometro || '—')}</td>
      <td class="num" data-cell="anterior">${celAnterior}</td>
      <td class="num">
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;">
          <input type="text" readonly inputmode="decimal" class="reading-input reading-ro"
            data-campo="atual" data-id="${l.apartment_id}"
            value="${l.atual !== '' ? String(l.atual).replace('.', ',') : ''}" ${bloqueado ? 'disabled' : ''}
            placeholder="—" title="Clique em ✏️ para lançar ou corrigir">
          ${bloqueado ? '' : `<button type="button" class="edit-btn" data-editar="${l.apartment_id}" title="Lançar / corrigir a leitura desta unidade"
            style="border:none;background:none;cursor:pointer;font-size:16px;padding:2px 4px;line-height:1;">✏️</button>`}
        </div>
      </td>
      <td class="num" data-cell="consumo">${l.consumo != null ? fmtNum(l.consumo, 2) : '—'}</td>
      <td class="num" data-cell="valor">${l.valor_total != null ? fmtBRL(l.valor_total) : '—'}</td>
      <td class="center" data-cell="foto">${fotoCellHTML(l, bloqueado)}</td>
      <td class="small" data-cell="medidopor">${esc(l.medido_por || '—')}</td>
      <td data-cell="status">${statusBadge(l.status)}</td>
    </tr>`;
  }).join('');
  aplicarFiltros();
}

function onInputLinha(e) {
  const input = e.target.closest('[data-campo]');
  if (!input) return;
  const id = Number(input.dataset.id);
  const l = state.linhas.get(id);
  if (!l) return;
  if (input.dataset.campo === 'atual') l.atual = input.value;
  else if (input.dataset.campo === 'anterior') {
    const v = input.value === '' ? null : Number(input.value);
    l.leitura_anterior = v != null && !Number.isNaN(v) ? v : null;
  }
  recalcular(l);
  atualizarCelula(l);
  atualizarResumo();
  state.dirty.add(id);
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(salvarRascunho, 900);
}

async function onChangeLinha(e) {
  const fileInput = e.target.closest('[data-foto]');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  const id = Number(fileInput.dataset.foto);
  const l = state.linhas.get(id);
  if (!l) return;
  const file = fileInput.files[0];
  if (file.size > 9 * 1024 * 1024) return toast('Imagem muito grande (máx. ~8 MB).', 'error');
  try {
    const respFoto = await processImage(file).then((dataUrl) =>
      apiPost(`/api/meses/${state.mes}/unidades/${id}/foto`, { foto: dataUrl }));
    const det = await apiGet(`/api/meses/${state.mes}`);
    const atualizada = det.linhas.find((x) => x.apartment_id === id);
    if (atualizada) {
      l.foto = atualizada.foto;
      const cell = document.querySelector(`#row-${id} [data-cell="foto"]`);
      if (cell) cell.innerHTML = fotoCellHTML(l, false);
    }
    toast(`Foto de ${l.etiqueta} enviada! O sistema confere o número da foto automaticamente.`, 'success');
  } catch (err) {
    toast(err.message || 'Erro ao enviar foto.', 'error');
  }
}

function onClickLinha(e) {
  const btnDel = e.target.closest('[data-foto-del]');
  if (btnDel) return excluirFoto(Number(btnDel.dataset.fotoDel));
  const btn = e.target.closest('[data-editar]');
  if (btn) return editarLeitura(Number(btn.dataset.editar));
  // clicar na própria célula (somente leitura) também abre a edição
  const ro = e.target.closest('.reading-ro');
  if (ro) return editarLeitura(Number(ro.dataset.id));
  // clique na miniatura já abre pelo <a target=_blank>; nada extra aqui
}

async function excluirFoto(id) {
  const l = state.linhas.get(id);
  if (!l || !l.foto) return;
  if (!confirm(`Excluir a foto do hidrômetro da unidade ${l.etiqueta}?`)) return;
  try {
    await apiFetch(`/api/meses/${state.mes}/unidades/${id}/foto`, { method: 'DELETE' });
    l.foto = null;
    const cell = document.querySelector(`#row-${id} [data-cell="foto"]`);
    if (cell) cell.innerHTML = fotoCellHTML(l, false);
    toast(`Foto de ${l.etiqueta} excluída.`, 'success');
  } catch (err) {
    toast(err.message || 'Erro ao excluir foto.', 'error');
  }
}

function editarLeitura(id) {
  const l = state.linhas.get(id);
  if (!l) return;
  const bloqueado = state.month.status === 'finalizado';
  openModal(`
    <h3>Corrigir leitura — ${l.etiqueta}</h3>
    <p class="m-sub">Torre ${l.torre} · hidrômetro ${esc(l.hidrometro || '—')}.
    As medições feitas no celular chegam aqui automaticamente; use esta correção para ajustar erros.</p>
    <div class="grid grid-2" style="gap:12px;">
      <div class="field"><label>Leitura de ${mesLabel(state.mes)} (m³)</label>
        <input type="number" id="ed-atual" step="any" min="0" inputmode="decimal" value="${esc(l.atual)}" style="font-size:20px;font-weight:700;"></div>
      <div class="field"><label>Data da leitura</label>
        <input type="date" id="ed-data" value="${l.data_leitura || new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <p class="small">💡 A leitura do mês passado é usada automaticamente no cálculo e não precisa ser informada.</p>
    <div id="ed-erro" class="login-error" hidden style="margin:8px 0;"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" id="ed-salvar">Salvar correção</button>
    </div>`);
  const inp = document.getElementById('ed-atual');
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
  document.getElementById('ed-salvar').addEventListener('click', async () => {
    const valor = inp.value === '' ? '' : Number(inp.value);
    if (valor !== '' && (!Number.isFinite(valor) || valor < 0)) {
      const er = document.getElementById('ed-erro');
      er.textContent = 'Informe um número válido.'; er.hidden = false; return;
    }
    if (valor !== '' && l.leitura_anterior != null && valor < Number(l.leitura_anterior)) {
      const er = document.getElementById('ed-erro');
      er.textContent = 'Atenção: este valor é menor que a leitura do mês passado. Confira antes de salvar.';
      er.hidden = false;
      // ainda permite salvar (anomalia sinalizada)
    }
    try {
      if (bloqueado) {
        // mês fechado: reabrir exige confirmação; aqui mantemos simples — orienta a reabrir
        closeModal();
        toast('O mês está finalizado — reabra o lançamento para corrigir.', 'error');
        return;
      }
      const resp = await apiPut(`/api/meses/${state.mes}`, {
        leituras: [{
          apartment_id: id,
          leitura_atual: valor === '' ? null : valor,
          data_leitura: document.getElementById('ed-data').value || null,
        }],
      });
      const sv = resp.linhas.find((x) => x.apartment_id === id);
      if (sv) {
        l.atual = sv.leitura_atual != null ? String(sv.leitura_atual) : '';
        l.leitura_anterior = sv.leitura_anterior; l.data_leitura = sv.data_leitura;
        l.consumo = sv.consumo; l.valor_agua = sv.valor_agua; l.valor_esgoto = sv.valor_esgoto;
        l.valor_total = sv.valor_total; l.faixas = sv.faixas; l.status = sv.status; l.tem_baseline = sv.tem_baseline;
      }
      closeModal();
      renderLinhas();
      atualizarResumo();
      toast(`Leitura de ${l.etiqueta} atualizada.`, 'success');
    } catch (err) {
      const er = document.getElementById('ed-erro');
      er.textContent = err.message; er.hidden = false;
    }
  });
}

// Abre a tela de medição (formato celular) usando a própria sessão do gestor.
function iniciarMedicao() {
  const url = urlComToken(`/medicao.html?ref=${encodeURIComponent(state.mes)}&med=1`);
  window.open(url, '_blank');
}

// Cria/lista links de delegação para o zelador medir sem login.
async function modalDelegar() {
  const torres = [...new Set([...state.linhas.values()].map((l) => l.torre))].sort();
  openModal(`
    <h3>Delegar a medição — ${mesLabel(state.mes)}</h3>
    <p class="m-sub">Gere um link e envie ao zelador/responsável. Quem abrir o link acessa
      <strong>apenas a tela de medição</strong> deste mês (unidade, hidrômetro, leitura e foto) —
      não vê valores, faturas, relatórios nem outros condomínios, e nem precisa fazer login.</p>
    <div class="field">
      <label>Nome do responsável</label>
      <input type="text" id="dl-nome" placeholder="Ex.: Zelador João" maxlength="80">
    </div>
    <div class="field">
      <label>Quais torres esse colaborador vai medir?</label>
      <div id="dl-torres" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;">
        ${torres.map((t) => `<label class="check-pill" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" class="dl-torre" value="${t}" checked> Torre ${t}</label>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Unidades específicas (opcional — se preencher, o link libera só estas unidades, além das torres marcadas)</label>
      <input type="text" id="dl-unidades" placeholder="Ex.: 201A, 202A, 305C (separadas por vírgula)">
      <p class="small">Deixe em branco para liberar todas as unidades das torres marcadas.</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="dl-criar">Gerar link de medição</button>
      <button class="btn btn-ghost" data-close>Fechar</button>
    </div>
    <div id="dl-lista" style="margin-top:14px;"></div>`);

  async function listar() {
    const box = document.getElementById('dl-lista');
    const resp = await apiGet(`/api/med-links/${state.mes}`);
    if (!resp.links.length) {
      box.innerHTML = '<p class="small">Nenhum link gerado para este mês ainda.</p>';
      return;
    }
    box.innerHTML = `<h4 style="margin:6px 0;">Links deste mês</h4>` + resp.links.map((lk) => {
      const url = `${location.origin}/medicao.html?token=${encodeURIComponent(lk.token)}`;
      return `<div class="formula-box" style="margin-bottom:10px;word-break:break-all;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <strong>${esc(lk.responsavel)}</strong>
          ${lk.ativo
            ? '<span class="badge badge-lido">Ativo</span>'
            : '<span class="badge badge-pendente">Revogado</span>'}
        </div>
        <div class="small" style="margin:4px 0;color:#64748b;">Criado em ${dataHora(lk.criado_em)}${lk.criado_por ? ` por ${esc(lk.criado_por)}` : ''}</div>
        ${lk.ativo ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-primary btn-sm" data-copiar="${esc(url)}">📋 Copiar link</button>
            <a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Abrir</a>
            <button class="btn btn-danger btn-sm" data-revogar="${lk.id}">Revogar</button>
          </div>` : ''}
      </div>`;
    }).join('');
    box.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copiar);
        toast('Link copiado! Envie ao responsável.', 'success');
      } catch {
        window.prompt('Copie o link:', b.dataset.copiar);
      }
    }));
    box.querySelectorAll('[data-revogar]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Revogar este link? A pessoa perderá o acesso à medição.')) return;
      await apiPost(`/api/med-links/id/${b.dataset.revogar}/revogar`);
      toast('Link revogado.', 'success');
      listar();
    }));
  }
  document.getElementById('dl-criar').addEventListener('click', async () => {
    const nome = document.getElementById('dl-nome').value.trim();
    if (!nome) { toast('Informe o nome do responsável.', 'error'); return; }
    const torresSel = [...document.querySelectorAll('.dl-torre:checked')].map((c) => c.value);
    const txtUnids = document.getElementById('dl-unidades').value.trim();
    const unidadesIds = [];
    if (txtUnids) {
      const etiquetas = txtUnids.split(/[;,]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
      for (const etq of etiquetas) {
        const l = [...state.linhas.values()].find((x) => x.etiqueta.toUpperCase() === etq);
        if (l) unidadesIds.push(l.apartment_id);
        else toast(`Unidade ${etq} não encontrada (ignorada).`, 'error');
      }
    }
    if (!torresSel.length && !unidadesIds.length) { toast('Selecione ao menos uma torre ou informe unidades.', 'error'); return; }
    const btn = document.getElementById('dl-criar');
    btn.disabled = true; btn.textContent = 'Gerando...';
    try {
      const resp = await apiPost('/api/med-links', {
        ref_month: state.mes, responsavel: nome,
        torres: torresSel, unidades: unidadesIds,
      });
      document.getElementById('dl-nome').value = '';
      document.getElementById('dl-unidades').value = '';
      const url = `${location.origin}/medicao.html?token=${encodeURIComponent(resp.link.token)}`;
      try { await navigator.clipboard.writeText(url); toast('Link gerado e copiado!', 'success'); }
      catch { toast('Link gerado.', 'success'); }
      listar();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Gerar link de medição';
    }
  });
  listar();
}

function carimboDataHora(ctx, width) {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const texto = `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
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
}
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // redimensiona para no máximo 1280px (JPEG 0.82) para economizar espaço
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width >= height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        carimboDataHora(ctx, width);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function recalcular(l) {
  const atual = l.atual === '' ? null : Number(l.atual);
  const ant = l.leitura_anterior;
  if (atual == null || Number.isNaN(atual)) {
    l.consumo = null; l.valor_total = null; l.faixas = null;
    l.status = ant == null ? 'sem_anterior' : 'pendente';
    return;
  }
  if (ant == null) { l.consumo = null; l.valor_total = null; l.faixas = null; l.status = 'sem_anterior'; return; }
  if (atual < ant) {
    l.consumo = Math.round((atual - ant) * 1000) / 1000;
    l.valor_agua = null; l.valor_esgoto = null; l.valor_total = null; l.faixas = null;
    l.status = 'anomalia';
    return;
  }
  const consumo = Math.round((atual - ant) * 1000) / 1000;
  const calc = calcularAgua(consumo);
  l.consumo = consumo;
  l.valor_agua = calc.valor_agua; l.valor_esgoto = calc.valor_esgoto;
  l.valor_total = calc.valor_total; l.faixas = calc.faixas;
  l.status = consumo > 100 ? 'atencao' : 'lido';
}

function atualizarCelula(l) {
  const row = document.getElementById(`row-${l.apartment_id}`);
  if (!row) return;
  row.dataset.status = l.status;
  row.classList.toggle('row-anomalia', l.status === 'anomalia');
  row.classList.toggle('row-atencao', l.status === 'atencao');
  row.querySelector('[data-cell="consumo"]').textContent = l.consumo != null ? fmtNum(l.consumo, 2) : '—';
  row.querySelector('[data-cell="valor"]').textContent = l.valor_total != null ? fmtBRL(l.valor_total) : '—';
  row.querySelector('[data-cell="status"]').innerHTML = statusBadge(l.status);
  const inp = row.querySelector('[data-campo="atual"]');
  if (inp) inp.classList.toggle('invalid', l.status === 'anomalia' || l.status === 'sem_anterior');
  aplicarFiltros();
}

function aplicarFiltros() {
  const q = state.q;
  document.querySelectorAll('#tbody-leituras tr').forEach((tr) => {
    const okTorre = !state.torre || tr.dataset.torre === state.torre;
    const okQ = !q || tr.dataset.busca.toUpperCase().includes(q);
    const st = tr.dataset.status;
    const okPend = !state.soPendentes || st === 'pendente' || st === 'sem_anterior' || st === 'anomalia';
    tr.style.display = okTorre && okQ && okPend ? '' : 'none';
  });
}

function atualizarResumo() {
  let soma = 0, lidos = 0, total = 0;
  for (const l of state.linhas.values()) {
    total++;
    if (l.status === 'lido' || l.status === 'atencao') { soma += l.valor_total || 0; lidos++; }
  }
  soma = Math.round(soma * 100) / 100;
  document.getElementById('sum-unidades').textContent = fmtBRL(soma);
  document.getElementById('sum-lidos').textContent = `${lidos}/${total}`;
  document.getElementById('prog-bar').style.width = `${(lidos / total) * 100}%`;
  const elComum = document.getElementById('sum-comum');
  const vg = state.valorGlobal === '' ? null : Number(state.valorGlobal);
  if (vg == null || Number.isNaN(vg)) { elComum.textContent = '—'; elComum.style.color = ''; }
  else {
    const comum = Math.round((vg - soma) * 100) / 100;
    elComum.textContent = fmtBRL(comum);
    elComum.style.color = comum < 0 ? 'var(--red)' : '';
  }
}

async function salvarRascunho() {
  if (state.salvando) { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(salvarRascunho, 600); return; }
  if (!state.dirty.size && !state.globalDirty) return;
  state.salvando = true;
  const ids = [...state.dirty];
  const payload = {
    leituras: ids.map((id) => {
      const l = state.linhas.get(id);
      return {
        apartment_id: id,
        leitura_atual: l.atual === '' ? null : l.atual,
        leitura_anterior: l.anteriorEditavel ? l.leitura_anterior : null,
      };
    }),
  };
  if (state.globalDirty) payload.valor_global = state.valorGlobal === '' ? null : Number(state.valorGlobal);
  try {
    const resp = await apiPut(`/api/meses/${state.mes}`, payload);
    let baselineMudou = false;
    for (const sv of resp.linhas) {
      const l = state.linhas.get(sv.apartment_id);
      if (!l) continue;
      if (!l.tem_baseline && sv.tem_baseline) baselineMudou = true;
      l.leitura_anterior = sv.leitura_anterior;
      l.consumo = sv.consumo; l.valor_agua = sv.valor_agua; l.valor_esgoto = sv.valor_esgoto;
      l.valor_total = sv.valor_total; l.faixas = sv.faixas; l.status = sv.status; l.tem_baseline = sv.tem_baseline;
      if (sv.tem_baseline) l.anteriorEditavel = false;
    }
    state.month = resp.month;
    state.dirty.clear(); state.globalDirty = false;
    if (baselineMudou) montarWorkspace(document.getElementById('lac-area'));
    else { ids.forEach((id) => atualizarCelula(state.linhas.get(id))); atualizarResumo(); }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    state.salvando = false;
  }
}

function mostrarMemoria() {
  openModal(`
    <h3>Memória de cálculo — padrão CAESB</h3>
    <p class="m-sub">O consumo de cada unidade é fatiado em faixas progressivas; cada m³ paga a alíquota da faixa.</p>
    <table class="tariff-table">
      <thead><tr><th>Faixa</th><th>Intervalo de consumo</th><th class="num">Alíquota (R$/m³)</th></tr></thead>
      <tbody>
        ${TARIFAS.map((t) => `<tr><td><strong>${t.faixa}</strong></td><td>${t.descricao}</td>
          <td class="num">${fmtBRL(t.aliquota).replace('R$', 'R$ ')}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="formula-box"><strong>Esgoto de 100%:</strong> a cobrança final da unidade é
      <code>(soma das faixas de água) × 2</code>.</div>
    <div class="formula-box" style="background:#f8fafc;border-color:var(--border);color:var(--text);">
      <strong>Área comum:</strong> <code>fatura global − soma das unidades</code>.</div>
    <div class="modal-actions"><button class="btn btn-primary" data-close>Entendido</button></div>`);
}

async function confirmarFinalizacao() {
  if (state.dirty.size || state.globalDirty) {
    clearTimeout(state.saveTimer);
    await salvarRascunho();
  }
  let soma = 0, lidos = 0, pendentes = 0, anomalias = 0;
  for (const l of state.linhas.values()) {
    if (l.status === 'lido' || l.status === 'atencao') { soma += l.valor_total || 0; lidos++; }
    else if (l.status === 'anomalia') anomalias++;
    else pendentes++;
  }
  const total = state.linhas.size;
  const vg = state.valorGlobal === '' ? null : Number(state.valorGlobal);
  const comum = vg == null ? null : Math.round((vg - soma) * 100) / 100;

  openModal(`
    <h3>Finalizar faturamento de ${mesLabel(state.mes)}?</h3>
    <p class="m-sub">Após a finalização o mês fica bloqueado e compõe o histórico/relatórios.</p>
    <table class="tariff-table">
      <tr><td>Leituras lançadas</td><td class="num"><strong>${lidos} de ${total}</strong></td></tr>
      <tr><td>Soma das unidades (água + esgoto)</td><td class="num">${fmtBRL(soma)}</td></tr>
      <tr><td>Fatura global</td><td class="num">${vg != null ? fmtBRL(vg) : '<em>não informada (pode ser lançada depois)</em>'}</td></tr>
      <tr><td><strong>Área comum (saldo)</strong></td><td class="num"><strong>${comum != null ? fmtBRL(comum) : '—'}</strong></td></tr>
    </table>
    ${pendentes || anomalias || (comum != null && comum < 0) ? `
      <div class="error-list"><h4>${(pendentes || anomalias) ? 'Não é possível finalizar ainda:' : 'Atenção:'}</h4><ul>
        ${pendentes ? `<li>${pendentes} unidade(s) sem leitura válida</li>` : ''}
        ${anomalias ? `<li>${anomalias} unidade(s) com leitura atual inferior à anterior</li>` : ''}
        ${comum != null && comum < 0 ? `<li>⚠️ A soma das unidades (${fmtBRL(soma)}) é <strong>maior</strong> que a fatura global (${fmtBRL(vg)}).
          Área comum ficará <strong>${fmtBRL(comum)}</strong>. Isso é normal em meses em que se usou a água do reservatório
          (entrou menos água da rua, mas os condôminos consumiram a reserva).</li>` : ''}
      </ul></div>`
      : `<p class="small">✅ Todas as ${total} leituras estão válidas. A fatura global pode ser informada agora ou depois (reabrindo o mês).</p>`}
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancelar</button>
      ${(!pendentes && !anomalias && comum != null && comum < 0)
        ? `<button class="btn btn-success" id="btn-confirma-forca">Fechar mesmo assim</button>`
        : ''}
      <button class="btn btn-success" id="btn-confirma-final" ${pendentes || anomalias || (comum != null && comum < 0) ? 'disabled' : ''}>Confirmar fechamento</button>
    </div>`);

  const acaoFinalizar = async (forcar) => {
    const btn = document.getElementById(forcar ? 'btn-confirma-forca' : 'btn-confirma-final');
    if (btn) { btn.disabled = true; btn.textContent = 'Fechando...'; }
    try {
      const resp = await apiPost(`/api/meses/${state.mes}/finalizar`, forcar ? { forcar: true } : {});
      closeModal();
      carregarDetail(resp);
      montarWorkspace(document.getElementById('lac-area'));
      toast(`Faturamento de ${mesLabel(state.mes)} finalizado!`, 'success');
    } catch (e) {
      closeModal();
      if (e.status === 422 && e.data && e.data.erros) {
        const podeForcar = e.data.permite_forcar && e.data.erros.some((x) => x.tipo === 'global_negativo');
        openModal(`
          <h3>${podeForcar ? 'Atenção ao fechar' : 'Pendências impedem o fechamento'}</h3>
          <div class="error-list">
            ${e.data.erros.map((er) => `<h4>${esc(er.msg)}</h4>
              <ul>${(er.lista || []).slice(0, 60).map((x) => `<li>${esc(x)}</li>`).join('')}
              ${er.lista && er.lista.length > 60 ? `<li>…e mais ${er.lista.length - 60}</li>` : ''}</ul>`).join('')}
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-close>Voltar e corrigir</button>
            ${podeForcar ? '<button class="btn btn-success" id="btn-confirma-forca2">Fechar mesmo assim</button>' : ''}
          </div>`);
        const bf = document.getElementById('btn-confirma-forca2');
        if (bf) bf.addEventListener('click', () => acaoFinalizar(true));
      } else toast(e.message, 'error');
    }
  };
  const btn = document.getElementById('btn-confirma-final');
  if (btn) btn.addEventListener('click', () => acaoFinalizar(false));
  const btnF = document.getElementById('btn-confirma-forca');
  if (btnF) btnF.addEventListener('click', () => acaoFinalizar(true));
}

function confirmarExcluirMes() {
  openModal(`
    <h3>🗑️ Excluir lançamento de ${mesLabel(state.mes)}?</h3>
    <p class="m-sub">Esta ação apaga <strong>todas as leituras e fotos</strong> deste mês e não pode ser desfeita.
      A exclusão fica registrada na auditoria. A medição dos meses seguintes não é alterada.</p>
    <div id="ex-erro" class="login-error" hidden style="margin:8px 0;"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-danger" id="btn-confirma-excluir">Excluir mês</button>
    </div>`);
  document.getElementById('btn-confirma-excluir').addEventListener('click', async () => {
    try {
      await apiFetch(`/api/meses/${state.mes}`, { method: 'DELETE' });
      closeModal();
      toast(`Lançamento de ${mesLabel(state.mes)} excluído.`, 'success');
      location.hash = '#/lancamento';
      setTimeout(() => route(), 50);
    } catch (e) {
      const er = document.getElementById('ex-erro');
      if (er) { er.textContent = e.message; er.hidden = false; }
    }
  });
}

function confirmarReabertura() {
  openModal(`
    <h3>Reabrir lançamento de ${mesLabel(state.mes)}?</h3>
    <p class="m-sub">O mês voltará a ser rascunho e poderá ser editado (inclusive para lançar a fatura global).
    A reabertura fica registrada na auditoria.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-danger" id="btn-confirma-reabrir">Reabrir</button>
    </div>`);
  document.getElementById('btn-confirma-reabrir').addEventListener('click', async () => {
    try {
      await apiPost(`/api/meses/${state.mes}/reabrir`);
      closeModal();
      const detail = await apiGet(`/api/meses/${state.mes}`);
      carregarDetail(detail);
      montarWorkspace(document.getElementById('lac-area'));
      toast('Lançamento reaberto.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ================================================================
// HISTÓRICO E RELATÓRIOS
// ================================================================

async function renderHistorico(el, parts) {
  const abrirMes = parts[1] === 'mes' ? parts[2] : null;
  if (abrirMes) state.histTab = 'mes';

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Histórico e Relatórios</h1>
      <p>Consumo por unidade e fechamentos mensais para auditoria</p></div>
    </div>
    <div class="tabs">
      <button class="tab-btn" data-tab="apt">Por unidade</button>
      <button class="tab-btn" data-tab="mes">Relatório do mês</button>
    </div>
    <div id="hist-area"></div>`;

  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.addEventListener('click', () => { state.histTab = b.dataset.tab; renderTab(); }));

  async function renderTab() {
    document.querySelectorAll('.tab-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === state.histTab));
    const area = document.getElementById('hist-area');
    if (state.histTab === 'apt') await renderTabApt(area);
    else await renderTabMes(area, abrirMes);
  }
  await renderTab();
}

async function renderTabApt(area) {
  area.innerHTML = `<div class="empty-state"><p>Carregando...</p></div>`;
  const aps = (await apiGet('/api/apartamentos')).apartamentos;
  const torres = [...new Set(aps.map((a) => a.torre))].sort();

  area.innerHTML = `
    <div class="card mb-16">
      <div class="controls-row">
        <div class="field"><label>Torre</label>
          <select id="h-torre"><option value="">Selecione...</option>${torres.map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div class="field"><label>Unidade</label>
          <select id="h-apt" disabled><option value="">Selecione a torre...</option></select></div>
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="h-export" disabled>Baixar CSV</button>
      </div>
    </div>
    <div id="h-apt-body"><div class="card empty-state">Selecione uma unidade para ver o histórico de consumo e as fotos dos hidrômetros.</div></div>`;

  const selTorre = document.getElementById('h-torre');
  const selApt = document.getElementById('h-apt');
  selTorre.addEventListener('change', () => {
    const lista = aps.filter((a) => a.torre === selTorre.value)
      .sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
    selApt.innerHTML = '<option value="">Selecione...</option>' +
      lista.map((a) => `<option value="${a.id}">${a.etiqueta} — ${esc(a.hidrometro || '')}</option>`).join('');
    selApt.disabled = false;
  });
  selApt.addEventListener('change', () => carregar(Number(selApt.value)));

  async function carregar(id) {
    const body = document.getElementById('h-apt-body');
    if (!id) return;
    body.innerHTML = '<div class="card empty-state"><p>Carregando...</p></div>';
    const hist = await apiGet(`/api/apartamentos/${id}/historico`);
    const reg = hist.registros.filter((r) => r.consumo != null);

    body.innerHTML = `
      <div class="card mb-16">
        <h2>Consumo mensal — ${hist.apartamento.etiqueta}
          <span class="spacer"></span><span class="small">Hidrômetro ${esc(hist.apartamento.hidrometro || '—')}</span>
          <button class="btn btn-ghost btn-sm" id="btn-link-cond" data-apt="${hist.apartamento.id}" data-etq="${hist.apartamento.etiqueta}"
            style="margin-left:10px;">🔗 Link de conferência p/ condômino</button></h2>
        ${reg.length ? `
        <div class="chart-box">${lineChartSVG(reg.map((r) => ({ label: mesCurto(r.ref_month), value: r.consumo })), {
          aria: `Consumo da unidade ${hist.apartamento.etiqueta}`,
          fmtVal: (v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³`,
        })}</div>
        <div class="chart-legend"><span class="lg"><span class="dot" style="background:#0891b2"></span> Consumo em m³ (leitura atual − anterior)</span></div>`
        : '<p class="small">Sem leituras lançadas ainda.</p>'}
      </div>
      <div class="card">
        <h2>Detalhamento por mês</h2>
        <div class="table-wrap" style="box-shadow:none;border:none;">
          <table class="data">
            <thead><tr>
              <th>Mês</th><th class="num">Leitura anterior</th><th class="num">Leitura atual</th>
              <th class="num">Consumo (m³)</th><th class="num">Água (R$)</th>
              <th class="num">Esgoto (R$)</th><th class="num">Total (R$)</th><th class="center">Foto</th><th>Situação</th>
            </tr></thead>
            <tbody>
              ${hist.registros.slice().reverse().map((r) => `
                <tr>
                  <td class="apt-tag">${mesLabel(r.ref_month)}</td>
                  <td class="num">${r.leitura_anterior != null ? fmtNum(r.leitura_anterior, 2) : '—'}</td>
                  <td class="num">${r.leitura_atual != null ? fmtNum(r.leitura_atual, 2) : '—'}</td>
                  <td class="num">${r.consumo != null ? fmtNum(r.consumo, 2) : '—'}</td>
                  <td class="num">${fmtBRL(r.valor_agua)}</td>
                  <td class="num">${fmtBRL(r.valor_esgoto)}</td>
                  <td class="num"><strong>${fmtBRL(r.valor_total)}</strong></td>
                  <td class="center">${r.foto ? `<a href="${fotoUrl(r.foto)}" target="_blank" rel="noopener"><img src="${fotoUrl(r.foto)}" class="foto-thumb" alt="foto"></a>` : '<span class="small">—</span>'}</td>
                  <td>${statusBadge(r.status_mes === 'rascunho' ? 'pendente' : (r.status === 'inicial' ? 'inicial' : 'lido'))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('h-export').disabled = false;

    const btnLink = document.getElementById('btn-link-cond');
    if (btnLink) btnLink.addEventListener('click', async () => {
      const aptId = btnLink.dataset.apt;
      const etq = btnLink.dataset.etq;
      try {
        const r = await apiPost(`/api/apartamentos/${aptId}/link-conferencia`, {});
        const url = `${location.origin}/conferencia.html?token=${encodeURIComponent(r.link.token)}`;
        openModal(`
          <h3>🔗 Link de conferência — ${esc(etq)}</h3>
          <p class="m-sub">Envie este link ao condômino da unidade <strong>${esc(etq)}</strong>.
            Ele verá <strong>somente</strong> o histórico, leituras, valores e fotos da própria unidade dele
            (sem login), e não acessa nada mais do sistema.</p>
          <div class="formula-box" style="word-break:break-all;">${esc(url)}</div>
          <div class="modal-actions">
            <button class="btn btn-primary" id="lc-copiar">📋 Copiar link</button>
            <button class="btn btn-ghost" data-close>Fechar</button>
          </div>`);
        document.getElementById('lc-copiar').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(url); toast('Link copiado!', 'success'); }
          catch { window.prompt('Copie o link:', url); }
        });
      } catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('h-export').onclick = () => {
      const rows = [
        ['Condomínio', state.condo ? state.condo.nome : ''],
        ['Unidade', hist.apartamento.etiqueta], ['Hidrômetro', hist.apartamento.hidrometro || ''], [],
        ['Mês', 'Leitura Anterior (m³)', 'Leitura Atual (m³)', 'Consumo (m³)', 'Valor Água (R$)', 'Valor Esgoto (R$)', 'Valor Total (R$)', 'Situação'],
        ...hist.registros.map((r) => [
          mesLabel(r.ref_month),
          r.leitura_anterior != null ? String(r.leitura_anterior).replace('.', ',') : '',
          r.leitura_atual != null ? String(r.leitura_atual).replace('.', ',') : '',
          r.consumo != null ? String(r.consumo).replace('.', ',') : '',
          r.valor_agua != null ? String(r.valor_agua).replace('.', ',') : '',
          r.valor_esgoto != null ? String(r.valor_esgoto).replace('.', ',') : '',
          r.valor_total != null ? String(r.valor_total).replace('.', ',') : '',
          STATUS_LABELS[r.status] || r.status,
        ]),
      ];
      downloadCSV(`historico-${hist.apartamento.etiqueta}.csv`, rows);
    };
  }
}

async function renderTabMes(area, refSel) {
  area.innerHTML = '<div class="empty-state"><p>Carregando...</p></div>';
  const { meses } = await apiGet('/api/meses');
  if (!meses.length) {
    area.innerHTML = '<div class="card empty-state">Nenhum lançamento cadastrado. Crie um na aba Lançamento Mensal.</div>';
    return;
  }
  const ref = refSel && meses.some((m) => m.ref_month === refSel) ? refSel : meses[0].ref_month;

  area.innerHTML = `
    <div class="card mb-16">
      <div class="controls-row">
        <div class="field"><label>Mês de referência</label>
          <select id="rm-mes">${meses.map((m) =>
            `<option value="${m.ref_month}" ${m.ref_month === ref ? 'selected' : ''}>${mesLabel(m.ref_month)} — ${m.status === 'finalizado' ? 'finalizado' : 'rascunho'}</option>`).join('')}
          </select></div>
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="rm-csv">Baixar CSV</button>
        <button class="btn btn-primary" id="rm-pdf">🖨️ Relatório / PDF</button>
      </div>
    </div>
    <div id="rm-body"></div>`;

  document.getElementById('rm-mes').addEventListener('change', (e) => carregar(e.target.value));
  document.getElementById('rm-csv').addEventListener('click', () => {
    window.open(urlComToken(`/api/meses/${document.getElementById('rm-mes').value}/csv?condo=${getCondo() || ''}`), '_blank');
  });
  document.getElementById('rm-pdf').addEventListener('click', () => {
    window.open(urlComToken(`/api/meses/${document.getElementById('rm-mes').value}/relatorio?condo=${getCondo() || ''}`), '_blank');
  });
  await carregar(ref);

  async function carregar(r) {
    const body = document.getElementById('rm-body');
    body.innerHTML = '<div class="card empty-state"><p>Carregando...</p></div>';
    const detail = await apiGet(`/api/meses/${r}`);
    const m = detail.month;
    const bloq = m.status === 'finalizado';
    const somaTela = detail.linhas.reduce((s, l) => s + (l.valor_total || 0), 0);

    body.innerHTML = `
      <div class="grid grid-3 mb-16">
        <div class="card stat-card accent-cyan"><span class="s-label">Soma das unidades</span>
          <span class="s-value">${fmtBRL(bloq ? m.total_individual : somaTela)}</span></div>
        <div class="card stat-card accent-amber"><span class="s-label">Área comum</span>
          <span class="s-value">${fmtBRL(m.valor_area_comum)}</span></div>
        <div class="card stat-card"><span class="s-label">Fatura global</span>
          <span class="s-value">${fmtBRL(m.valor_global)}</span></div>
      </div>
      <div class="card">
        <h2>Rateio por unidade — ${mesLabel(r)}
          <span class="spacer"></span>
          ${bloq ? '<span class="badge badge-finalizado">Finalizado</span>' : '<span class="badge badge-rascunho">Rascunho</span>'}</h2>
        <div class="table-wrap" style="max-height:60vh;overflow-y:auto;box-shadow:none;border:none;">
          <table class="data">
            <thead><tr>
              <th>Unidade</th><th>Hidrômetro</th><th class="num">Anterior</th><th class="num">Atual</th>
              <th class="num">Consumo (m³)</th><th class="num">Água (R$)</th>
              <th class="num">Esgoto (R$)</th><th class="num">Total (R$)</th><th class="center">Foto</th><th>Medição por</th><th></th>
            </tr></thead>
            <tbody>
              ${detail.linhas.map((l) => `
                <tr data-exp="${l.apartment_id}" style="cursor:pointer;">
                  <td class="apt-tag">${l.etiqueta}</td>
                  <td class="small" style="font-family:ui-monospace,monospace;">${esc(l.hidrometro || '—')}</td>
                  <td class="num">${l.leitura_anterior != null ? fmtNum(l.leitura_anterior, 2) : '—'}</td>
                  <td class="num">${l.leitura_atual != null ? fmtNum(l.leitura_atual, 2) : '—'}</td>
                  <td class="num">${l.consumo != null ? fmtNum(l.consumo, 2) : '—'}</td>
                  <td class="num">${fmtBRL(l.valor_agua)}</td>
                  <td class="num">${fmtBRL(l.valor_esgoto)}</td>
                  <td class="num"><strong>${fmtBRL(l.valor_total)}</strong></td>
                  <td class="center">${l.foto ? `<a href="${fotoUrl(l.foto)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><img src="${fotoUrl(l.foto)}" class="foto-thumb" alt="foto"></a>` : '<span class="small">—</span>'}</td>
                  <td class="small">${esc(l.medido_por || '—')}</td>
                  <td class="center">${l.faixas ? '<button class="expand-btn">detalhar ▾</button>' : ''}</td>
                </tr>
                ${l.faixas ? `<tr id="fx-${l.apartment_id}" hidden><td colspan="11" class="faixa-row">
                  <div class="faixa-inner">
                    ${l.faixas.filter((f) => f.m3 > 0).map((f) =>
                      `<span><b>Faixa ${f.faixa}</b> (${f.descricao}): ${fmtNum(f.m3, 2)} m³ × ${fmtBRL(f.aliquota).replace('R$', '')} = <b>${fmtBRL(f.valor)}</b></span>`).join('')}
                    <span>💧 Água: <b>${fmtBRL(l.valor_agua)}</b></span>
                    <span>🚿 Esgoto 100%: <b>${fmtBRL(l.valor_esgoto)}</b></span>
                    <span>Total: <b>${fmtBRL(l.valor_total)}</b></span>
                  </div>
                </td></tr>` : ''}`).join('')}
            </tbody>
            <tfoot>
              <tr><td colspan="7">TOTAL DAS UNIDADES (água + esgoto)</td><td class="num">${fmtBRL(bloq ? m.total_individual : somaTela)}</td><td colspan="2"></td></tr>
              <tr><td colspan="7">ÁREA COMUM (saldo da fatura global)</td><td class="num">${fmtBRL(m.valor_area_comum)}</td><td colspan="2"></td></tr>
              <tr><td colspan="7">FATURA GLOBAL DO CONDOMÍNIO</td><td class="num">${fmtBRL(m.valor_global)}</td><td colspan="2"></td></tr>
            </tfoot>
          </table>
        </div>
        <p class="small mt-16">Clique em "detalhar" para ver a memória de cálculo (fatiamento em faixas) da unidade.</p>
      </div>`;

    body.querySelectorAll('[data-exp]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const fx = document.getElementById(`fx-${tr.dataset.exp}`);
        if (fx) fx.hidden = !fx.hidden;
      });
    });
  }
}

// ================================================================
// CONFIGURAÇÕES
// ================================================================
// MEDIÇÃO DIÁRIA — acompanhamento do medidor macro (sem cobrança).
// Alerta fixo: consumo do dia >= 1,5× a média móvel de 30 dias.
// ================================================================

let DRA = null;
let DRA_DATA = '';

function draHoje() { return (DRA && DRA.hoje) || new Date().toISOString().slice(0, 10); }

async function renderDiaria(el) {
  el.innerHTML = '<p class="muted" style="padding:24px;">Carregando medição diária…</p>';
  let dados;
  try { dados = await apiGet('/api/diaria?dias=120'); }
  catch (e) { el.innerHTML = `<div class="card"><p>⚠️ ${esc(e.message)}</p></div>`; return; }
  DRA = dados;
  if (!DRA_DATA || DRA_DATA > dados.hoje) DRA_DATA = dados.hoje;

  const cab = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <div>
        <h2 style="margin:0;">Medição diária</h2>
        <p class="muted" style="margin:4px 0 0;">Acompanhamento do medidor macro de ${esc(state.condo ? state.condo.nome : '—')} — não afeta a fatura mensal. Alerta automático quando o dia passa de 1,5× a média dos últimos 30 dias.</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="dra-novo">+ Cadastrar medidor</button>
    </div>
    <div class="card" style="display:flex;align-items:center;gap:12px;padding:10px 16px;margin-bottom:14px;flex-wrap:wrap;">
      <label style="font-weight:700;" for="dra-data">Dia da medição</label>
      <input type="date" id="dra-data" value="${DRA_DATA}" max="${dados.hoje}">
      <button class="btn btn-ghost btn-sm" id="dra-hoje" type="button">Ir para hoje</button>
      ${DRA_DATA < dados.hoje ? `<span class="small" style="color:#b45309;">✏️ ajustando o dia ${brData(DRA_DATA)} — corrija e salve (deixar em branco e salvar apaga o registro do dia)</span>` : ''}
    </div>
    <div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 16px;margin-bottom:14px;flex-wrap:wrap;background:#f0fdfa;border-color:#99f6e4;">
      <strong class="small">📄 Relatório do período:</strong>
      <label class="small">de <input type="date" id="dra-rel-de" max="${dados.hoje}"></label>
      <label class="small">até <input type="date" id="dra-rel-ate" max="${dados.hoje}" value="${dados.hoje}"></label>
      <button class="btn btn-ghost btn-sm" data-relp="7" type="button">Últimos 7 dias</button>
      <button class="btn btn-ghost btn-sm" data-relp="30" type="button">Últimos 30</button>
      <button class="btn btn-ghost btn-sm" data-relp="mes" type="button">Este mês</button>
      <span style="flex:1;"></span>
      <button class="btn btn-primary btn-sm" id="dra-rel-pdf" type="button">🖨️ Ver / Imprimir / PDF</button>
      <button class="btn btn-ghost btn-sm" id="dra-rel-csv" type="button">⬇️ CSV (Excel)</button>
    </div>`;

  const vazio = `
    <div class="card" style="text-align:center;padding:48px 24px;">
      <div style="font-size:40px;">📟</div>
      <h2 style="margin:10px 0 6px;">Nenhum medidor macro cadastrado</h2>
      <p class="muted" style="max-width:560px;margin:0 auto 18px;">
        Cadastre o hidrômetro macro (o medidor geral do prédio) para acompanhar o consumo dia a dia.
        A leitura mensal da cobrança continua exatamente como está — aqui é só monitoramento.
      </p>
      <button class="btn btn-primary" id="dra-novo-0">+ Cadastrar medidor macro</button>
    </div>`;

  el.innerHTML = cab + (dados.medidores.length ? dados.medidores.map(draCard).join('') : vazio);

  document.getElementById('dra-data').addEventListener('change', (ev) => { DRA_DATA = ev.target.value || dados.hoje; renderDiaria(el); });
  document.getElementById('dra-hoje').addEventListener('click', () => { DRA_DATA = dados.hoje; renderDiaria(el); });
  document.getElementById('dra-novo').addEventListener('click', () => draModalMedidor(el, null));
  const relDe = document.getElementById('dra-rel-de');
  const relAte = document.getElementById('dra-rel-ate');
  relDe.value = dados.hoje.slice(0, 7) + '-01';
  const draShift = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  el.querySelectorAll('[data-relp]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.relp === 'mes') relDe.value = dados.hoje.slice(0, 7) + '-01';
    else relDe.value = draShift(dados.hoje, -(Number(b.dataset.relp) - 1));
    relAte.value = dados.hoje;
  }));
  document.getElementById('dra-rel-pdf').addEventListener('click', () => {
    const de = relDe.value || dados.hoje.slice(0, 7) + '-01';
    const ate = relAte.value || dados.hoje;
    window.open(urlComToken(`/api/diaria/relatorio?de=${de}&ate=${ate}&condo=${getCondo() || ''}`), '_blank');
  });
  document.getElementById('dra-rel-csv').addEventListener('click', () => {
    const de = relDe.value || dados.hoje.slice(0, 7) + '-01';
    const ate = relAte.value || dados.hoje;
    const rows = [['Medidor', 'Dia', 'Leitura (m³)', 'Consumo (m³)', 'm³/dia', 'Média 30d (m³/dia)', 'Situação', 'Observação']];
    let usados = 0;
    DRA.medidores.forEach((m) => (m.serie || []).forEach((r) => {
      if (r.date < de || r.date > ate) return;
      usados++;
      const sit = (r.motivos || []).includes('retrocesso') ? 'RETROCESSO' : r.alerta ? 'ALERTA 1,5x media' : (r.leitura != null ? 'Normal' : 'Sem leitura');
      rows.push([m.nome, r.date, r.leitura ?? '', r.consumo ?? '', r.consumo_dia ?? '', r.media ?? '', sit, r.obs || '']);
    }));
    if (usados < 1) { toast('Nenhuma leitura nesse intervalo. Ajuste as datas.', 'error'); return; }
    downloadCSV(`medicao-diaria-${de}_a_${ate}.csv`, rows);
    toast(`${usados} linha(s) exportada(s) para o Excel`);
  });
  const b0 = document.getElementById('dra-novo-0');
  if (b0) b0.addEventListener('click', () => draModalMedidor(el, null));
  el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => draModalMedidor(el, DRA.medidores.find((m) => m.id === b.dataset.editar))));
  el.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', () => draExcluirMedidor(el, DRA.medidores.find((m) => m.id === b.dataset.excluir))));
  el.querySelectorAll('[data-salvar]').forEach((b) => b.addEventListener('click', () => draSalvarLeitura(el, b.dataset.salvar)));
  el.querySelectorAll('.dra-leitura').forEach((inp) => {
    inp.addEventListener('blur', () => { const card = inp.closest('[data-med]'); if (card) draSalvarLeitura(el, card.dataset.med, { silencioso: true }); });
    inp.addEventListener('input', () => draChecarRetrocesso(inp));
  });
  el.querySelectorAll('.dra-foto').forEach((inp) => inp.addEventListener('change', () => draEnviarFoto(el, inp)));
  el.querySelectorAll('[data-foto-del]').forEach((b) => b.addEventListener('click', async () => {
    try { await apiPost('/api/diaria/foto-excluir', { medidor_id: b.dataset.fotoDel, date: DRA_DATA }); renderDiaria(el); }
    catch (e) { toast(e.message, 'error'); }
  }));
  el.querySelectorAll('.dra-lote-ok').forEach((b) => b.addEventListener('click', () => draSalvarLote(el, b)));
  el.querySelectorAll('[data-ajustar]').forEach((b) => b.addEventListener('click', () => {
    DRA_DATA = b.dataset.ajustar;
    renderDiaria(el).then(() => {
      const form = el.querySelector('.dra-form');
      if (form) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); const inp = form.querySelector('.dra-leitura'); if (inp) setTimeout(() => inp.focus(), 350); }
    });
  }));
}

function draCard(m) {
  const serie = m.serie || [];
  const alvo = serie.find((s) => s.date === DRA_DATA) || null;
  let anterior = null;
  for (const s of serie) { if (s.date < DRA_DATA && s.leitura != null) anterior = s; }
  const diasSemRegistro = m.ultima
    ? Math.max(0, Math.round((new Date(`${DRA_DATA}T12:00:00Z`) - new Date(`${m.ultima}T12:00:00Z`)) / 86400000))
    : null;
  const status = !alvo || alvo.leitura == null
    ? '<span class="chip" style="background:#fef3c7;color:#92400e;">sem leitura neste dia</span>'
    : (alvo.motivos || []).includes('retrocesso')
      ? '<span class="chip" style="background:#fee2e2;color:#b91c1c;">⚠️ leitura menor que a anterior</span>'
      : alvo.alerta
        ? '<span class="chip" style="background:#fee2e2;color:#b91c1c;">🚨 consumo acima de 1,5× a média — verificar vazamento</span>'
        : '<span class="chip" style="background:#dcfce7;color:#15803d;">✓ dentro da média</span>';

  // gráficos e destaques
  const pts = serie.filter((s) => s.consumo_dia != null).map((s) => ({ label: `${s.date.slice(8)}/${s.date.slice(5, 7)}`, value: s.consumo_dia }));
  const chart = pts.length >= 2
    ? `<div class="chart-wrap" style="margin:10px 0;">${lineChartSVG(pts, { fmtVal: (v) => `${fmtNum(v, 1)} m³`, aria: 'consumo diário em m³ por dia' })}<p class="muted small" style="text-align:center;margin:2px 0 0;">consumo por dia (m³/dia) — acompanhamento do ritmo do prédio</p></div>`
    : '<p class="muted small" style="margin:10px 0;">o gráfico aparece a partir de 2 dias de leitura.</p>';

  const ult5 = serie.slice(-5).reverse().map((s) => {
    const chip = (s.motivos || []).includes('retrocesso') ? '<span class="chip" style="background:#fee2e2;color:#b91c1c;">retrocesso</span>'
      : s.alerta ? '<span class="chip" style="background:#fee2e2;color:#b91c1c;">1,5× média</span>' : '';
    return `<tr${s.date === DRA_DATA ? ' style="background:#f0f9ff;"' : ''}>
      <td><strong>${brData(s.date)}</strong></td>
      <td class="right">${s.leitura == null ? '—' : fmtNum(s.leitura, 3)}</td>
      <td class="right">${s.consumo == null ? '—' : fmtNum(s.consumo, 3)}</td>
      <td class="right">${s.consumo_dia == null ? '—' : `<strong>${fmtNum(s.consumo_dia, 2)}</strong>`}</td>
      <td>${chip}</td>
      <td>${s.foto ? `<a href="${fotoUrl(s.foto)}" target="_blank" rel="noopener" title="ver foto">📷</a>` : ''}</td>
      <td style="text-align:right;white-space:nowrap;"><button class="btn btn-ghost btn-sm" data-ajustar="${s.date}" title="corrigir a leitura deste dia">✏️ Ajustar</button></td>
    </tr>`;
  }).join('');

  // dias do mês atual ainda sem leitura (de ontem para trás — hoje tem campo próprio acima)
  const hoje = (DRA && DRA.hoje) || new Date().toISOString().slice(0, 10);
  const mesAtual = hoje.slice(0, 7);
  const medidos = new Set(serie.filter((s) => s.leitura != null).map((s) => s.date));
  const faltantes = [];
  for (let d = 1; d <= Number(hoje.slice(8, 10)) - 1; d++) {
    const dt = `${mesAtual}-${String(d).padStart(2, '0')}`;
    if (!medidos.has(dt)) faltantes.push(dt);
  }
  const emAberto = faltantes.length ? `
    <details style="margin:10px 0;" ${faltantes.length ? '' : 'open'}>
      <summary style="cursor:pointer;font-weight:700;color:#b45309;">📝 Lançar dias em aberto — ${faltantes.length} dia(s) de ${mesLabel(mesAtual)}</summary>
      <p class="muted small" style="margin:6px 0 8px;">Digite as leituras já feitas nestes dias (m³). Deixe em branco o que não tiver; a série e o gráfico se reorganizam sozinhos.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;">
        ${faltantes.map((dt) => `
          <label style="display:block;"><span class="small" style="font-weight:700;">${brData(dt).slice(0, 5)}</span>
            <input type="number" step="0.001" min="0" class="dra-lote" data-date="${dt}" placeholder="m³" style="width:100%;padding:7px 9px;border:2px solid #cbd5e1;border-radius:9px;font-size:15px;">
          </label>`).join('')}
      </div>
      <div style="margin-top:10px;"><button class="btn btn-primary btn-sm dra-lote-ok">💾 Salvar lançamentos em lote</button></div>
    </details>` : '';

  const ultimas = serie.slice().reverse().slice(0, 30).map((s) => {
    const chips = [];
    if ((s.motivos || []).includes('retrocesso')) chips.push('<span class="chip" style="background:#fee2e2;color:#b91c1c;">retrocesso</span>');
    else if (s.alerta) chips.push('<span class="chip" style="background:#fee2e2;color:#b91c1c;">1,5× média</span>');
    return `<tr>
      <td>${brData(s.date)}</td>
      <td class="right">${s.leitura == null ? '—' : fmtNum(s.leitura, 3)}</td>
      <td class="right">${s.consumo == null ? '—' : fmtNum(s.consumo, 3)}</td>
      <td class="right">${s.consumo_dia == null ? '—' : fmtNum(s.consumo_dia, 2)}</td>
      <td class="right">${s.media == null ? '—' : fmtNum(s.media, 2)}</td>
      <td>${chips.join(' ')}</td>
      <td>${s.foto ? `<a href="${fotoUrl(s.foto)}" target="_blank" rel="noopener" title="ver foto">📷</a>` : ''}</td>
      <td class="small muted">${esc(s.obs || '')}</td>
      <td style="text-align:right;white-space:nowrap;"><button class="btn btn-ghost btn-sm" data-ajustar="${s.date}" title="corrigir a leitura deste dia">✏️</button></td>
    </tr>`;
  }).join('');

  return `
  <div class="card" style="margin-bottom:16px;padding:18px;" data-med="${m.id}">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
      <strong style="font-size:17px;">💧 ${esc(m.nome)}</strong>
      ${m.numero ? `<span class="muted small">nº ${esc(m.numero)}</span>` : ''}
      ${m.ativo ? '' : '<span class="chip" style="background:#e2e8f0;color:#475569;">inativo</span>'}
      <span style="flex:1;"></span>
      ${status}
      <button class="btn btn-ghost btn-sm" data-editar="${m.id}" title="editar medidor">✏️</button>
      <button class="btn btn-danger btn-sm" data-excluir="${m.id}" title="excluir medidor">🗑️</button>
    </div>
    <p class="muted small" style="margin:0 0 12px;">
      ${m.ultima ? `última leitura: <strong>${brData(m.ultima)}</strong>${diasSemRegistro > 1 ? ` · há ${diasSemRegistro} dias sem registrar` : ''}` : 'nenhuma leitura registrada ainda'}
      ${m.hoje && m.hoje.medido_por ? ` · dia ${brData(DRA_DATA)} medido por ${esc(m.hoje.medido_por)}` : ''}
    </p>
    <div class="dra-form" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;background:#f8fafc;border:1px solid var(--border,#e2e8f0);border-radius:12px;padding:12px;margin-bottom:12px;">
      <label style="display:block;"><span class="small" style="font-weight:700;">Leitura do dia ${brData(DRA_DATA)} (m³)</span><br>
        <input type="number" step="0.001" min="0" class="dra-leitura" data-lido="${alvo && alvo.leitura != null ? alvo.leitura : ''}"
          value="${alvo && alvo.leitura != null ? alvo.leitura : ''}" placeholder="ex.: 81234.5" style="width:150px;padding:8px 10px;border:2px solid #cbd5e1;border-radius:10px;font-size:16px;">
      </label>
      <label style="display:block;flex:1;min-width:180px;"><span class="small" style="font-weight:700;">Observação (opcional)</span><br>
        <input type="text" class="dra-obs" maxlength="240" value="${alvo && alvo.obs ? esc(alvo.obs) : ''}" placeholder="ex.: verificação de rotina" style="width:100%;padding:8px 10px;border:2px solid #cbd5e1;border-radius:10px;font-size:15px;">
      </label>
      ${alvo && alvo.foto ? `
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <img src="${fotoUrl(alvo.foto)}" alt="foto do dia" style="height:44px;border-radius:8px;border:1px solid #cbd5e1;cursor:pointer;" onclick="window.open('${fotoUrl(alvo.foto)}','_blank')">
          <button class="btn btn-ghost btn-sm" data-foto-del="${m.id}" title="remover foto">✖</button>
        </span>` : ''}
      <label class="btn btn-ghost btn-sm" style="cursor:pointer;">📷 ${alvo && alvo.foto ? 'Trocar' : 'Foto'}
        <input type="file" accept="image/*" class="dra-foto" data-med="${m.id}" hidden>
      </label>
      <button class="btn btn-primary btn-sm" data-salvar="${m.id}" style="padding:9px 16px;">Salvar</button>
      <span class="small retro-aviso" style="color:#b91c1c;font-weight:700;"></span>
    </div>
    ${ult5 ? `
    <p style="margin:0 0 4px;font-weight:700;font-size:14px;">🕐 Últimos lançamentos</p>
    <div style="overflow-x:auto;">
      <table class="tbl tbl-lanc" style="margin-bottom:6px;">
        <thead><tr><th>Dia</th><th class="right">Leitura (m³)</th><th class="right">Consumo (m³)</th><th class="right">m³/dia</th><th>Status</th><th>Foto</th><th></th></tr></thead>
        <tbody>${ult5}</tbody>
      </table>
    </div>` : ''}
    ${chart}
    ${emAberto}
    ${ultimas ? `
    <details>
      <summary class="small muted" style="cursor:pointer;margin-bottom:6px;">tabela completa (últimos ${Math.min(serie.length, 30)} dias registrados)</summary>
      <div style="overflow-x:auto;">
        <table class="tbl tbl-lanc">
          <thead><tr><th>Dia</th><th class="right">Leitura</th><th class="right">Consumo (m³)</th><th class="right">m³/dia</th><th class="right">Média 30d</th><th>Status</th><th>Foto</th><th>Obs</th><th></th></tr></thead>
          <tbody>${ultimas}</tbody>
        </table>
      </div>
    </details>` : ''}
  </div>`;
}

async function draSalvarLote(el, btn) {
  const card = btn.closest('[data-med]');
  const medidorId = card.dataset.med;
  const itens = [];
  card.querySelectorAll('.dra-lote').forEach((inp) => {
    if (String(inp.value).trim() !== '') itens.push({ date: inp.dataset.date, leitura: inp.value.trim() });
  });
  if (!itens.length) { toast('Digite ao menos uma leitura antes de salvar.', 'error'); return; }
  btn.disabled = true;
  try {
    const r = await apiPost('/api/diaria/lancamentos', { medidor_id: medidorId, itens });
    if (r.erros && r.erros.length) toast(`Salvos ${r.salvos}; problema em ${brData(r.erros[0].date)}: ${r.erros[0].error}`, 'error');
    else toast(`${r.salvos} leitura(s) lançada(s)!`);
    await renderDiaria(el);
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// vermelho imediato se o número digitado for menor que a última leitura anterior ao dia
function draChecarRetrocesso(inp) {
  const card = inp.closest('[data-med]');
  const aviso = card.querySelector('.retro-aviso');
  const m = DRA.medidores.find((x) => x.id === card.dataset.med);
  let anterior = null;
  for (const s of (m ? m.serie : [])) { if (s.date < DRA_DATA && s.leitura != null) anterior = s; }
  const v = Number(String(inp.value).replace(',', '.'));
  const retro = inp.value !== '' && Number.isFinite(v) && anterior && anterior.leitura != null && v < anterior.leitura;
  inp.style.borderColor = retro ? '#dc2626' : '#cbd5e1';
  aviso.textContent = retro ? `⚠️ menor que a leitura de ${brData(anterior.date)} (${fmtNum(anterior.leitura, 3)} m³)` : '';
}

async function draSalvarLeitura(el, medidorId, opts = {}) {
  const card = el.querySelector(`[data-med="${medidorId}"]`);
  if (!card) return;
  const inp = card.querySelector('.dra-leitura');
  const obs = card.querySelector('.dra-obs');
  const valor = inp.value.trim();
  const obsVal = obs ? obs.value.trim() : '';
  if (valor === (inp.dataset.lido || '') && obsVal === ((() => { const m = DRA.medidores.find((x) => x.id === medidorId); return m && m.serie.find((s) => s.date === DRA_DATA)?.obs || ''; })())) return;
  try {
    await apiPost('/api/diaria/leitura', { medidor_id: medidorId, date: DRA_DATA, leitura: valor, obs: obsVal });
    if (!opts.silencioso) toast(valor === '' ? 'Registro do dia removido' : 'Leitura do dia salva');
    await renderDiaria(el);
  } catch (e) { toast(e.message, 'error'); }
}

async function draEnviarFoto(el, inp) {
  const file = inp.files && inp.files[0];
  if (!file) return;
  try {
    const dataUrl = await processImage(file); // redimensiona + carimbo data/hora
    toast('Enviando foto…');
    await apiPost('/api/diaria/foto', { medidor_id: inp.dataset.med, date: DRA_DATA, foto: dataUrl });
    toast('Foto salva');
    await renderDiaria(el);
  } catch (e) { toast(e.message, 'error'); }
}

function draModalMedidor(el, m) {
  const edit = !!m;
  openModal(`
    <h3>${edit ? 'Editar medidor macro' : 'Cadastrar medidor macro'}</h3>
    <p class="muted small" style="margin:2px 0 12px;">O medidor macro é o hidrômetro geral do prédio. O acompanhamento é só seu, gestor — a equipe ainda não recebe link nesta etapa.</p>
    <div class="field"><label>Nome / localização</label>
      <input id="dmm-nome" maxlength="80" placeholder="ex.: Hidrômetro macro — hall torres A/C" value="${edit ? esc(m.nome) : ''}"></div>
    <div class="field"><label>Número do hidrômetro (opcional)</label>
      <input id="dmm-numero" maxlength="40" placeholder="ex.: 1234567" value="${edit ? esc(m.numero || '') : ''}"></div>
    ${edit ? `<label class="small" style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="dmm-ativo" ${m.ativo !== false ? 'checked' : ''}> Medidor ativo (aparece no topo da lista)</label>` : ''}
    <p class="small" id="dmm-erro" style="color:#b91c1c;display:none;"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="dmm-ok">${edit ? 'Salvar alterações' : 'Cadastrar'}</button>
    </div>`);
  document.getElementById('dmm-ok').addEventListener('click', async () => {
    const nome = document.getElementById('dmm-nome').value.trim();
    const numero = document.getElementById('dmm-numero').value.trim();
    const err = document.getElementById('dmm-erro');
    if (!nome) { err.textContent = 'Informe o nome do medidor.'; err.style.display = ''; return; }
    try {
      if (edit) await apiPut(`/api/diaria/medidor/${m.id}`, { nome, numero, ativo: document.getElementById('dmm-ativo').checked });
      else await apiPost('/api/diaria/medidor', { nome, numero });
      closeModal();
      toast(edit ? 'Medidor atualizado' : 'Medidor macro cadastrado! Já pode registrar a leitura do dia.');
      await renderDiaria(el);
    } catch (e) { err.textContent = e.message; err.style.display = ''; }
  });
}

function draExcluirMedidor(el, m) {
  const n = (m.serie || []).length;
  openModal(`
    <h3>Excluir medidor "${esc(m.nome)}"?</h3>
    <p class="small" style="margin:6px 0 0;">Serão removidas também <strong>${n} leitura(s) diária(s)</strong>${n ? ' e as fotos delas' : ''}. A fatura mensal não é afetada em nada.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" id="dxe-ok">Excluir definitivamente</button>
    </div>`);
  document.getElementById('dxe-ok').addEventListener('click', async () => {
    try {
      await apiFetch(`/api/diaria/medidor/${m.id}`, { method: 'DELETE' });
      closeModal();
      toast('Medidor excluído');
      await renderDiaria(el);
    } catch (e) { toast(e.message, 'error'); }
  });
}


// ================================================================

async function renderConfiguracoes(el) {
  el.innerHTML = `<div class="empty-state"><p>Carregando...</p></div>`;
  const condosResp = await apiGet('/api/condominios');
  state.condominios = condosResp.condominios;
  const isGestor = !state.isAdmin && state.user && state.user.condo_id;
  const meuCondo = state.isAdmin
    ? (state.condo || state.condominios[0])
    : state.condominios.find((c) => c.id === state.user.condo_id) || state.condominios[0];

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Configurações</h1>
      <p>Seus dados, o condomínio, a logo e os hidrômetros da área comum</p></div>
    </div>

    <div class="grid grid-2 mb-24">
      <div class="card">
        <h2>👤 Minha conta</h2>
        <p class="small mb-16">Login: <code>${esc(state.user.username)}</code></p>
        <div class="field mb-16"><label>Nome de exibição</label>
          <input type="text" id="cfg-nome" value="${esc(state.user.nome || '')}" maxlength="80"></div>
        <div class="flex" style="gap:10px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="cfg-salvar-nome">Salvar nome</button>
          <button class="btn btn-ghost btn-sm" id="cfg-trocar-senha">🔐 Alterar senha</button>
        </div>
      </div>

      <div class="card">
        <h2>🏢 Condomínio</h2>
        ${state.condominios.length > 1 ? `
        <div class="field mb-16"><label>Condomínio selecionado</label>
          <select id="cfg-condo">${state.condominios.map((c) =>
            `<option value="${c.id}" ${meuCondo && c.id === meuCondo.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>` : ''}
        <div class="flex" style="align-items:center;gap:14px;margin-bottom:12px;">
          ${meuCondo && meuCondo.logo
            ? `<img src="${fotoUrl(meuCondo.logo)}" class="condo-logo-card" alt="logo" id="cfg-logo-img">`
            : '<div class="condo-logo-card" id="cfg-logo-img" style="display:flex;align-items:center;justify-content:center;font-size:26px;">🏢</div>'}
          <div>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer;">🖼️ Trocar logo
              <input type="file" id="cfg-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden></label>
            <p class="small mt-16" id="cfg-logo-nome">A logo aparece no menu e nos relatórios.</p>
          </div>
        </div>
        <div class="field"><label>Nome do condomínio</label>
          <input type="text" id="cfg-condo-nome" value="${esc(meuCondo ? meuCondo.nome : '')}" maxlength="120"></div>
        <button class="btn btn-primary btn-sm mt-16" id="cfg-salvar-condo">Salvar dados do condomínio</button>
      </div>
    </div>

    <div class="card mb-24">
      <h2>💧 Hidrômetros da área comum</h2>
      <p class="small mb-16">Cadastre os hidrômetros de uso comum (ex.: piscina, salão de festas, irrigação,
      hidrômetro mestre). A cada mês você registra a leitura deles — fica o histórico do que marcou cada medidor.
      <strong>Estas leituras são apenas de controle/registro</strong> e não entram no rateio das unidades.</p>
      <div class="filter-bar">
        <div class="field"><label>Mês de referência</label>
          <input type="month" id="hac-mes" value="${mesPadrao()}"></div>
        <div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" id="hac-novo">+ Cadastrar hidrômetro</button>
      </div>
      <div id="hac-lista" class="mt-16"><div class="empty-state"><p>Carregando...</p></div></div>
    </div>

    ${isGestor ? '' : `
    <div class="card">
      <h2>🔢 Números dos hidrômetros das unidades</h2>
      <p class="small mb-16">Confira ou corrija o número do hidrômetro de cada apartamento (o número que está gravado no relógio de água).</p>
      <div class="filter-bar">
        <div class="field"><label>Torre</label><select id="hm-bloco"><option value="">Todas</option></select></div>
        <div class="field" style="flex:1;"><input type="search" id="hm-q" placeholder="Buscar unidade ou hidrômetro..."></div>
      </div>
      <div id="hm-lista" class="table-wrap mt-16" style="box-shadow:none;border:none;max-height:50vh;overflow-y:auto;"><p class="small">Carregando...</p></div>
    </div>`}
  `;

  // ---------- Minha conta ----------
  document.getElementById('cfg-trocar-senha').addEventListener('click', modalTrocarSenha);
  document.getElementById('cfg-salvar-nome').addEventListener('click', async () => {
    const nome = document.getElementById('cfg-nome').value.trim();
    if (!nome) return toast('Informe seu nome.', 'error');
    try {
      const r = await apiPost('/api/me/perfil', { nome });
      state.user.nome = r.user.nome;
      document.getElementById('user-name').textContent = r.user.nome;
      toast('Nome atualizado!', 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  // ---------- Condomínio / logo ----------
  const selCondo = document.getElementById('cfg-condo');
  if (selCondo) selCondo.addEventListener('change', () => { setCondo(selCondo.value); renderConfiguracoes(el); });

  document.getElementById('cfg-salvar-condo').addEventListener('click', async () => {
    const nome = document.getElementById('cfg-condo-nome').value.trim();
    if (!nome) return toast('Informe o nome do condomínio.', 'error');
    try {
      await apiPut(`/api/condominios/${meuCondo.id}`, { nome });
      const { condominios } = await apiGet('/api/condominios');
      state.condominios = condominios;
      state.condo = condominios.find((c) => c.id === meuCondo.id);
      montarShell();
      toast('Condomínio atualizado!', 'success');
      renderConfiguracoes(el);
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('cfg-logo').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) return toast('Imagem muito grande (máx. 8 MB).', 'error');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await apiPost(`/api/condominios/${meuCondo.id}/logo`, { logo: String(reader.result) });
        state.condominios = state.condominios.map((c) => c.id === meuCondo.id ? { ...c, logo: r.logo } : c);
        state.condo = { ...(state.condo || {}), logo: r.logo };
        montarShell();
        document.getElementById('cfg-logo-img').src = fotoUrl(r.logo);
        document.getElementById('cfg-logo-nome').textContent = '✅ Logo atualizada!';
        toast('Logo atualizada!', 'success');
      } catch (err) { toast(err.message, 'error'); }
    };
    reader.readAsDataURL(f);
  });

  // ---------- Hidrômetros de área comum ----------
  const inpMes = document.getElementById('hac-mes');
  document.getElementById('hac-novo').addEventListener('click', modalNovoHidrometroComum);
  inpMes.addEventListener('change', carregarHac);

  async function carregarHac() {
    const ref = inpMes.value;
    const box = document.getElementById('hac-lista');
    if (!ref) { box.innerHTML = '<p class="small">Selecione um mês.</p>'; return; }
    let resp;
    try {
      resp = await apiGet(`/api/hidrometros-comuns/${ref}`);
    } catch (e) {
      box.innerHTML = `<div class="empty-state"><p>${esc(e.message)}<br><span class="small">Crie o lançamento do mês na aba Lançamento Mensal para registrar as leituras.</span></p></div>`;
      return;
    }
    if (!resp.medidores.length) {
      box.innerHTML = '<div class="empty-state"><p>Nenhum hidrômetro de área comum cadastrado. Clique em <strong>+ Cadastrar hidrômetro</strong>.</p></div>';
      return;
    }
    const porId = new Map(resp.leituras.map((l) => [l.id, l]));
    box.innerHTML = `<div class="table-wrap" style="box-shadow:none;border:none;">
      <table class="data"><thead><tr>
        <th>Descrição do hidrômetro</th><th>Nº do hidrômetro</th>
        <th class="num">Leitura mês passado (m³)</th><th class="num">Leitura deste mês (m³)</th>
        <th class="num">Consumo (m³)</th><th class="center">Ações</th>
      </tr></thead><tbody>
      ${resp.medidores.map((m) => {
        const l = porId.get(m.id) || {};
        const tem = l.leitura != null;
        const consumo = tem && l.leitura_anterior != null ? Math.round((l.leitura - l.leitura_anterior) * 1000) / 1000 : null;
        return `<tr>
          <td class="apt-tag">${esc(m.nome)}</td>
          <td class="small" style="font-family:ui-monospace,monospace;">${esc(m.numero || '—')}</td>
          <td class="num">${l.leitura_anterior != null ? fmtNum(l.leitura_anterior, 2) : '—'}</td>
          <td class="num"><input type="number" step="any" min="0" class="reading-input hac-leitura" style="width:120px;"
              data-meter="${m.id}" value="${tem ? l.leitura : ''}" placeholder="0"></td>
          <td class="num" data-hac-consumo="${m.id}">${consumo != null ? fmtNum(consumo, 2) : '—'}</td>
          <td class="center" style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm" data-hac-edit="${m.id}" data-nome="${esc(m.nome)}" data-numero="${esc(m.numero || '')}">✏️</button>
            <button class="btn btn-danger btn-sm" data-hac-del="${m.id}">🗑️</button>
          </td>
        </tr>`;
      }).join('')}
      </tbody></table></div>`;

    // auto-save das leituras
    box.querySelectorAll('.hac-leitura').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const meter = inp.dataset.meter;
        const val = inp.value === '' ? '' : Number(inp.value);
        if (val !== '' && (!Number.isFinite(val) || val < 0)) return toast('Leitura inválida.', 'error');
        try {
          await apiPost(`/api/hidrometros-comuns/leitura/${ref}`, {
            leitura: { meter_id: meter, leitura: val, data_leitura: new Date().toISOString().slice(0, 10) },
          });
          toast('Leitura da área comum salva.', 'success');
          carregarHac();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
    box.querySelectorAll('[data-hac-edit]').forEach((b) => b.addEventListener('click', () =>
      modalNovoHidrometroComum({ id: b.dataset.hacEdit, nome: b.dataset.nome, numero: b.dataset.numero })));
    box.querySelectorAll('[data-hac-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Excluir este hidrômetro de área comum e o histórico de leituras dele?')) return;
      await apiFetch(`/api/hidrometros-comuns/id/${b.dataset.hacDel}`, { method: 'DELETE' });
      toast('Hidrômetro excluído.', 'success');
      carregarHac();
    }));
  }
  carregarHac();

  function modalNovoHidrometroComum(editar) {
    openModal(`
      <h3>${editar ? 'Editar' : 'Cadastrar'} hidrômetro de área comum</h3>
      <p class="m-sub">Ex.: "Hidrômetro da piscina", "Salão de festas", "Irrigação do jardim", "Hidrômetro mestre".</p>
      <div class="field" style="margin-bottom:10px;"><label>Descrição *</label>
        <input type="text" id="nh-nome" maxlength="80" value="${editar ? esc(editar.nome) : ''}" placeholder="Ex.: Piscina"></div>
      <div class="field"><label>Número do hidrômetro (o que está gravado no relógio)</label>
        <input type="text" id="nh-numero" maxlength="40" value="${editar ? esc(editar.numero) : ''}" placeholder="Ex.: S7025000"></div>
      <div id="nh-erro" class="login-error" hidden style="margin:8px 0;"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>Cancelar</button>
        <button class="btn btn-primary" id="nh-salvar">${editar ? 'Salvar' : 'Cadastrar'}</button>
      </div>`);
    setTimeout(() => document.getElementById('nh-nome').focus(), 80);
    document.getElementById('nh-salvar').addEventListener('click', async () => {
      const nome = document.getElementById('nh-nome').value.trim();
      const numero = document.getElementById('nh-numero').value.trim();
      const er = document.getElementById('nh-erro');
      er.hidden = true;
      if (!nome) { er.textContent = 'Informe a descrição.'; er.hidden = false; return; }
      try {
        if (editar) await apiFetch(`/api/hidrometros-comuns/id/${editar.id}`, { method: 'PUT', body: JSON.stringify({ nome, numero }) });
        else await apiPost('/api/hidrometros-comuns', { nome, numero });
        closeModal();
        toast(editar ? 'Hidrômetro atualizado!' : 'Hidrômetro cadastrado!', 'success');
        carregarHac();
      } catch (e) { er.textContent = e.message; er.hidden = false; }
    });
  }

  // ---------- Números dos hidrômetros das unidades (admin) ----------
  if (!isGestor) {
    const aps = (await apiGet('/api/apartamentos')).apartamentos;
    const torres = [...new Set(aps.map((a) => a.torre))].sort();
    const selBloco = document.getElementById('hm-bloco');
    torres.forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = 'Torre ' + t; selBloco.appendChild(o); });
    const lista = document.getElementById('hm-lista');
    const renderAps = () => {
      const torre = selBloco.value;
      const q = document.getElementById('hm-q').value.trim().toUpperCase();
      const dados = aps.filter((a) =>
        (!torre || a.torre === torre) &&
        (!q || a.etiqueta.toUpperCase().includes(q) || (a.hidrometro || '').toUpperCase().includes(q)))
        .slice(0, 150);
      lista.innerHTML = `<table class="data"><thead><tr><th>Unidade</th><th>Torre</th><th>Nº do hidrômetro</th><th></th></tr></thead><tbody>
        ${dados.map((a) => `<tr>
          <td class="apt-tag">${a.etiqueta}</td><td>${a.torre}</td>
          <td><input type="text" class="reading-input" style="width:160px;font-family:ui-monospace,monospace;"
              data-hm-id="${a.id}" value="${esc(a.hidrometro || '')}" placeholder="nº do hidrômetro"></td>
          <td><button class="btn btn-primary btn-sm" data-hm-salvar="${a.id}">Salvar</button></td>
        </tr>`).join('')}
      </tbody></table>
      ${aps.filter((a) => (!torre || a.torre === torre) && (!q || a.etiqueta.toUpperCase().includes(q) || (a.hidrometro || '').toUpperCase().includes(q))).length > 150
        ? '<p class="small mt-16">Mostrando as 150 primeiras — use a busca para refinar.</p>' : ''}`;
      lista.querySelectorAll('[data-hm-salvar]').forEach((b) => b.addEventListener('click', async () => {
        const id = b.dataset.hmSalvar;
        const inp = lista.querySelector(`[data-hm-id="${id}"]`);
        await apiFetch(`/api/apartamentos/${id}/hidrometro`, { method: 'PUT', body: JSON.stringify({ hidrometro: inp.value.trim() }) });
        const apt = aps.find((x) => String(x.id) === String(id));
        if (apt) apt.hidrometro = inp.value.trim();
        toast(`Hidrômetro de ${apt ? apt.etiqueta : ''} atualizado.`, 'success');
      }));
    };
    selBloco.addEventListener('change', renderAps);
    document.getElementById('hm-q').addEventListener('input', renderAps);
    renderAps();
  }
}

// ================================================================
// USUÁRIOS (admin)
// ================================================================

async function renderUsuarios(el) {
  el.innerHTML = `<div class="empty-state"><p>Carregando...</p></div>`;
  const data = await apiGet('/api/usuarios');
  const { usuarios, condominios } = data;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Usuários</h1>
      <p>Crie logins vinculados a um condomínio. O gestor vê apenas o seu condomínio.</p></div>
    </div>

    <div class="card mb-24">
      <h2>Novo usuário</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
        <div class="field"><label>Nome completo</label><input type="text" id="u-nome" placeholder="Ex.: João da Síndica"></div>
        <div class="field"><label>Login de acesso</label><input type="text" id="u-login" placeholder="Ex.: joao.silva"></div>
        <div class="field"><label>Senha (mín. 6)</label><input type="text" id="u-senha" placeholder="••••••"></div>
        <div class="field"><label>Condomínio</label>
          <select id="u-condo">
            ${condominios.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}
          </select></div>
        <div class="field" style="justify-content:flex-end;">
          <button class="btn btn-primary" id="u-criar">Criar usuário</button>
        </div>
      </div>
      <p class="small mt-16">O usuário criado terá acesso ao lançamento, histórico, relatórios e fotos do condomínio
      selecionado — e <strong>não</strong> enxergará os demais condomínios.</p>
      <div id="u-erro" class="login-error" style="margin-top:10px;" hidden></div>
    </div>

    <div class="card">
      <h2>Usuários cadastrados</h2>
      <div class="table-wrap" style="box-shadow:none;border:none;">
        <table class="data">
          <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Condomínio</th><th>Situação</th><th></th></tr></thead>
          <tbody id="u-linhas"></tbody>
        </table>
      </div>
    </div>`;

  function listar() {
    document.getElementById('u-linhas').innerHTML = usuarios.map((u) => `
      <tr>
        <td class="apt-tag">${esc(u.nome || '—')}</td>
        <td><code>${esc(u.username)}</code></td>
        <td>${u.role === 'admin' ? '<span class="badge badge-inicial">Administrador</span>' : '<span class="badge badge-lido">Gestor</span>'}</td>
        <td>${esc(u.condominio || 'Todos (admin)')}</td>
        <td>${u.ativo ? '<span class="badge badge-lido">Ativo</span>' : '<span class="badge badge-pendente">Inativo</span>'}</td>
        <td class="center" style="white-space:nowrap;">
          ${u.role === 'admin' && u.username === 'admin' ? '<span class="small">—</span>' :
            `<button class="btn btn-ghost btn-sm" data-senha="${u.id}" data-nome="${esc(u.username)}">🔑 Redefinir senha</button>
             <button class="btn btn-ghost btn-sm" data-user="${u.id}" data-ativo="${u.ativo ? 0 : 1}">
               ${u.ativo ? 'Desativar' : 'Ativar'}</button>`}
        </td>
      </tr>`).join('');
    el.querySelectorAll('[data-user]').forEach((b) => b.addEventListener('click', async () => {
      await apiPost(`/api/usuarios/${b.dataset.user}/ativo?ativo=${b.dataset.ativo}`);
      toast('Usuário atualizado.', 'success');
      const d2 = await apiGet('/api/usuarios');
      usuarios.length = 0; usuarios.push(...d2.usuarios); listar();
    }));
    el.querySelectorAll('[data-senha]').forEach((b) => b.addEventListener('click', () => {
      const alvo = b.dataset.nome;
      openModal(`
        <h3>Redefinir senha — ${esc(alvo)}</h3>
        <p class="m-sub">Informe uma senha temporária. O usuário será <strong>obrigado a trocá-la no próximo acesso</strong>.</p>
        <div class="field" style="margin-bottom:10px;"><label>Nova senha temporária (mín. 6)</label>
          <div class="senha-wrap"><input type="text" id="rs-senha" placeholder="Ex.: agua2026">
          <button type="button" class="olho" data-alvo="rs-senha">👁️</button></div></div>
        <div id="rs-erro" class="login-error" hidden style="margin:8px 0;"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>Cancelar</button>
          <button class="btn btn-primary" id="rs-salvar">Redefinir senha</button>
        </div>`);
      setTimeout(() => document.getElementById('rs-senha').focus(), 80);
      document.getElementById('rs-salvar').addEventListener('click', async () => {
        const senha = document.getElementById('rs-senha').value;
        const er = document.getElementById('rs-erro');
        er.hidden = true;
        if (senha.length < 6) { er.textContent = 'A senha deve ter ao menos 6 caracteres.'; er.hidden = false; return; }
        try {
          await apiPost(`/api/usuarios/${b.dataset.senha}/senha`, { nova_senha: senha });
          closeModal();
          toast(`Senha de ${alvo} redefinida.`, 'success');
        } catch (e) { er.textContent = e.message; er.hidden = false; }
      });
    }));
  }
  listar();

  document.getElementById('u-criar').addEventListener('click', async () => {
    const errBox = document.getElementById('u-erro');
    errBox.hidden = true;
    try {
      const resp = await apiPost('/api/usuarios', {
        nome: document.getElementById('u-nome').value.trim(),
        username: document.getElementById('u-login').value.trim(),
        password: document.getElementById('u-senha').value,
        condo_id: document.getElementById('u-condo').value,
        role: 'gestor',
      });
      toast(`Usuário "${resp.usuario.username}" criado!`, 'success');
      usuarios.push(resp.usuario);
      ['u-nome', 'u-login', 'u-senha'].forEach((id) => document.getElementById(id).value = '');
      const d2 = await apiGet('/api/usuarios');
      usuarios.length = 0; usuarios.push(...d2.usuarios); listar();
    } catch (e) { errBox.textContent = e.message; errBox.hidden = false; }
  });
}

function modalTrocarLogo(condoId, nome) {
  const condo = state.condominios.find((c) => c.id === condoId);
  openModal(`
    <h3>Trocar logo — ${esc(nome)}</h3>
    <p class="m-sub">Envie a logo oficial do condomínio (PNG, JPG, WEBP ou SVG). Ela aparecerá no menu e nos relatórios.</p>
    <div class="flex" style="align-items:center;gap:18px;margin:14px 0;">
      <img id="ml-preview" class="condo-logo-card" alt="prévia"
           style="width:96px;height:96px;${condo && condo.logo ? '' : 'display:none;'}"
           src="${condo && condo.logo ? fotoUrl(condo.logo) : ''}">
      <div>
        <label class="btn btn-ghost" style="cursor:pointer;">
          📷 Selecionar imagem
          <input type="file" id="ml-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
        </label>
        <p class="small mt-16" id="ml-nome">${condo && condo.logo ? 'Logo atual carregada.' : 'Nenhuma imagem selecionada.'}</p>
      </div>
    </div>
    <div id="ml-erro" class="login-error" style="margin:8px 0;" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" id="ml-salvar" disabled>Salvar logo</button>
    </div>`);

  let dataUrl = '';
  document.getElementById('ml-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      const er = document.getElementById('ml-erro');
      er.textContent = 'Imagem muito grande (máx. 8 MB).'; er.hidden = false; return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      dataUrl = String(reader.result);
      const pv = document.getElementById('ml-preview');
      pv.src = dataUrl; pv.style.display = '';
      document.getElementById('ml-nome').textContent = f.name;
      document.getElementById('ml-salvar').disabled = false;
    };
    reader.readAsDataURL(f);
  });

  document.getElementById('ml-salvar').addEventListener('click', async () => {
    if (!dataUrl) return;
    const btn = document.getElementById('ml-salvar');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      const resp = await apiPost(`/api/condominios/${condoId}/logo`, { logo: dataUrl });
      state.condominios = state.condominios.map((c) =>
        c.id === condoId ? { ...c, logo: resp.logo } : c);
      if (state.condo && state.condo.id === condoId) {
        state.condo = { ...state.condo, logo: resp.logo };
        montarShell();
      }
      closeModal();
      toast('Logo atualizada!', 'success');
      // recarrega a tela de condomínios para refletir
      const el = document.getElementById('view');
      renderCondominios(el);
    } catch (err) {
      const er = document.getElementById('ml-erro');
      er.textContent = err.message; er.hidden = false;
      btn.disabled = false; btn.textContent = 'Salvar logo';
    }
  });
}

// ================================================================
// CONDOMÍNIOS (cadastro / troca)
// ================================================================

async function renderCondominios(el) {
  el.innerHTML = `<div class="empty-state"><p>Carregando...</p></div>`;
  const { condominios } = await apiGet('/api/condominios');
  state.condominios = condominios;

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Condomínios</h1>
      <p>Selecione um condomínio para medir ou cadastre um novo</p></div>
    </div>

    <div class="grid grid-2 mb-24">
      ${condominios.map((c) => `
        <div class="card condo-card ${state.condo && c.id === state.condo.id ? 'selected' : ''}">
          <div class="flex" style="align-items:center;gap:14px;">
            ${c.logo ? `<img src="${fotoUrl(c.logo)}" class="condo-logo-card" alt="logo">` : '<div class="condo-logo-card" style="display:flex;align-items:center;justify-content:center;font-size:26px;">🏢</div>'}
            <div>
              <h2 style="margin:0;">${esc(c.nome)}</h2>
              <p class="small" style="margin:4px 0 0;">${(() => {
                const mm = !(c.medicoes && c.medicoes.mensal === false);
                const dd = !(c.medicoes && c.medicoes.diaria_macro === false);
                if (mm && dd) return `💵 ${c.total_unidades} unidades · ${c.total_meses} lançamento(s) · 📅 diária do macro`;
                if (mm) return `💵 ${c.total_unidades} unidades · ${c.total_meses} lançamento(s)`;
                return '📅 somente diária do medidor macro';
              })()}</p>
            </div>
          </div>
          <div class="flex mt-16">
            <button class="btn btn-primary btn-sm" data-usar="${c.id}">Usar este condomínio</button>
            ${state.isAdmin ? `<button class="btn btn-ghost btn-sm" data-logo="${c.id}" data-nome="${esc(c.nome)}">🖼️ Trocar logo</button>` : ''}
            ${state.isAdmin ? `<button class="btn btn-ghost btn-sm" data-editar-condo="${c.id}">✏️ Editar</button>` : ''}
            ${state.isAdmin ? `<button class="btn btn-danger btn-sm" data-excluir-condo="${c.id}">🗑️ Excluir</button>` : ''}
          </div>
        </div>`).join('')}
    </div>

    <div class="card">
      <h2>Cadastrar novo condomínio</h2>
      <p class="small mb-16">Cadastre as torres, unidades e hidrômetros. Após o cadastro o condomínio já entra no sistema para medição.</p>

      <div class="grid grid-2 mb-16" style="align-items:end;">
        <div class="field">
          <label for="nc-nome">Nome do condomínio</label>
          <input type="text" id="nc-nome" placeholder="Ex.: RESIDENCIAL ÁGUAS CLARAS">
        </div>
        <div class="field">
          <label>Logo do condomínio <span style="color:var(--red);">*</span></label>
          <div class="flex" style="gap:12px;align-items:center;">
            <img id="nc-logo-preview" class="condo-logo-card" alt="prévia da logo"
                 style="display:none;width:64px;height:64px;">
            <label class="btn btn-ghost btn-sm" style="cursor:pointer;">
              📷 Selecionar logo
              <input type="file" id="nc-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
            </label>
            <span class="small" id="nc-logo-nome">Nenhuma imagem selecionada</span>
          </div>
        </div>
      </div>

      <div class="field mb-16">
        <label>O que será medido neste condomínio? <span class="muted" style="font-weight:normal;">(marque um, outro ou os dois)</span></label>
        <label class="small" style="display:flex;gap:9px;align-items:flex-start;margin-top:8px;cursor:pointer;">
          <input type="checkbox" id="nc-med-mensal" checked style="margin-top:2px;">
          <span><b>Cobrança mensal nas unidades</b> — leitura dos hidrômetros por unidade no fim do mês, com rateio e fatura. Requer o cadastro das unidades.</span>
        </label>
        <label class="small" style="display:flex;gap:9px;align-items:flex-start;margin-top:10px;cursor:pointer;">
          <input type="checkbox" id="nc-med-diaria" checked style="margin-top:2px;">
          <span><b>Medição diária do medidor macro</b> — acompanhamento dia a dia do hidrômetro geral, com alerta de consumo e relatório. Não afeta a cobrança.</span>
        </label>
      </div>

      <div id="nc-torres"></div>
      <button class="btn btn-ghost btn-sm mb-16" id="nc-add-torre">+ Adicionar torre</button>

      <div id="nc-paste-box" class="formula-box" style="background:#f8fafc;border-color:var(--border);color:var(--text);margin-top:0;">
        <strong>Importação rápida (opcional):</strong> cole ou digite as unidades no formato
        <code>UNIDADE;HIDRÔMETRO</code> (uma por linha). Ex.: <code>201A;S7025041</code>.
        <textarea id="nc-paste" rows="4" style="width:100%;margin-top:8px;font-family:ui-monospace,monospace;font-size:12.5px;" placeholder="201A;S7025041&#10;202A;S7025040&#10;..."></textarea>
      </div>

      <div class="flex mt-16" id="nc-rodape">
        <span class="small" id="nc-contagem">0 unidades configuradas</span>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="nc-salvar">Cadastrar condomínio</button>
      </div>
      <div id="nc-erro" class="login-error" style="margin-top:12px;" hidden></div>
    </div>`;

  const torresBox = document.getElementById('nc-torres');
  function addTrecho(div, faixa = '', qtd = '') {
    const row = document.createElement('div');
    row.className = 'nc-trecho';
    row.style.cssText = 'display:flex;gap:10px;align-items:flex-end;margin-bottom:8px;';
    row.innerHTML = `
      <div class="field" style="flex:1;margin:0;"><label>Andares do trecho (ex.: 1-10 · 3 = só o 3º · 0 = térreo)</label>
        <input type="text" class="nc-torre-andares" value="${esc(faixa)}" placeholder="1-10"></div>
      <div class="field" style="width:150px;margin:0;"><label>Unidades por andar</label>
        <input type="number" class="nc-torre-qtd" min="1" max="20" value="${qtd}" placeholder="12"></div>
      <button type="button" class="btn btn-ghost btn-sm nc-del-trecho" title="Remover trecho" style="margin-bottom:2px;">✕</button>`;
    row.querySelector('.nc-del-trecho').addEventListener('click', () => {
      const box = div.querySelector('.nc-trechos');
      if (box.querySelectorAll('.nc-trecho').length > 1) row.remove();
      else row.querySelectorAll('input').forEach((i) => { i.value = ''; });
      atualizarContagem();
    });
    row.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', atualizarContagem));
    div.querySelector('.nc-trechos').appendChild(row);
  }
  function addTorre(nome = '') {
    const div = document.createElement('div');
    div.className = 'torre-config card';
    div.style.cssText = 'background:#f8fafc;margin-bottom:12px;padding:14px 16px;';
    div.innerHTML = `
      <div class="field" style="max-width:220px;margin:0;"><label>Torre (letra/nome)</label>
        <input type="text" class="nc-torre-nome" value="${esc(nome)}" placeholder="A" style="text-transform:uppercase;"></div>
      <div class="nc-trechos" style="margin-top:10px;"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-add-trecho>+ Adicionar trecho de andares</button>
      <p class="small mt-16">Cada torre pode ter trechos diferentes (ex.: térreo <b>0</b> com 11 unidades; <b>1-10</b> com 12). Gera unidades como <b class="nc-exemplo">—</b>. Hidrômetros podem ser preenchidos depois no lançamento/colagem.</p>
      <button class="btn btn-danger btn-sm" style="margin-top:4px;" data-remover>Remover torre</button>`;
    div.querySelector('[data-add-trecho]').addEventListener('click', () => { addTrecho(div); atualizarContagem(); });
    div.querySelector('[data-remover]').addEventListener('click', () => { div.remove(); atualizarContagem(); });
    div.querySelector('.nc-torre-nome').addEventListener('input', atualizarContagem);
    torresBox.appendChild(div);
    addTrecho(div);
    atualizarContagem();
  }
  document.getElementById('nc-add-torre').addEventListener('click', () => addTorre());
  addTorre('A');

  const temMensal = () => document.getElementById('nc-med-mensal').checked;
  ['nc-med-mensal', 'nc-med-diaria'].forEach((id) => document.getElementById(id).addEventListener('change', () => {
    const esconder = temMensal() ? '' : 'none';
    document.getElementById('nc-torres').style.display = esconder;
    document.getElementById('nc-add-torre').style.display = esconder;
    document.getElementById('nc-paste-box').style.display = esconder;
    document.getElementById('nc-contagem').style.display = esconder;
  }));

  // logo
  let logoDataUrl = '';
  document.getElementById('nc-logo').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast('Imagem muito grande (máx. 8 MB).', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      logoDataUrl = String(reader.result);
      const pv = document.getElementById('nc-logo-preview');
      pv.src = logoDataUrl; pv.style.display = '';
      document.getElementById('nc-logo-nome').textContent = f.name;
    };
    reader.readAsDataURL(f);
  });

  function coletarUnidades() {
    const unidades = new Map();
    // geração por torre
    torresBox.querySelectorAll('.torre-config').forEach((div) => {
      const t = div.querySelector('.nc-torre-nome').value.trim().toUpperCase();
      div.querySelectorAll('.nc-trecho').forEach((tr) => {
        const faixa = tr.querySelector('.nc-torre-andares').value.trim();
        const qtd = parseInt(tr.querySelector('.nc-torre-qtd').value, 10);
        if (!faixa || !qtd) return;
        const mt = faixa.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
        if (!mt) return;
        const ini = parseInt(mt[1], 10), fim = mt[2] != null ? parseInt(mt[2], 10) : ini;
        for (let andar = ini; andar <= fim; andar++) {
          for (let u = 1; u <= qtd; u++) {
            const etiqueta = `${andar}${String(u).padStart(2, '0')}${t}`;
            unidades.set(etiqueta, { etiqueta, torre: t, numero: `${andar}${String(u).padStart(2, '0')}`, hidrometro: '' });
          }
        }
      });
    });
    // colagem (sobrescreve hidrômetro / adiciona unidades)
    const paste = document.getElementById('nc-paste').value.trim();
    if (paste) {
      paste.split(/\r?\n/).forEach((linha) => {
        const partes = linha.split(/[;,\t]/).map((x) => x.trim()).filter(Boolean);
        if (!partes.length) return;
        const etiqueta = partes[0].toUpperCase();
        if (!/^\d{2,4}[A-Z0-9]$/.test(etiqueta)) return;
        const torre = etiqueta.slice(-1);
        const existente = unidades.get(etiqueta) || { etiqueta, torre, numero: etiqueta.slice(0, -1), hidrometro: '' };
        if (partes[1]) existente.hidrometro = partes[1];
        unidades.set(etiqueta, existente);
      });
    }
    return [...unidades.values()].sort((a, b) =>
      a.torre === b.torre
        ? a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })
        : a.torre.localeCompare(b.torre));
  }

  function atualizarContagem() {
    const lista = coletarUnidades();
    document.getElementById('nc-contagem').textContent = `${lista.length} unidades configuradas`;
    const ex = lista.slice(0, 4).map((u) => u.etiqueta).join(', ');
    document.querySelectorAll('.nc-exemplo').forEach((e) => { e.textContent = ex || '—'; });
  }
  document.getElementById('nc-paste').addEventListener('input', atualizarContagem);

  el.querySelectorAll('[data-usar]').forEach((btn) => btn.addEventListener('click', () => {
    setCondo(btn.dataset.usar);
    state.condo = state.condominios.find((c) => c.id === btn.dataset.usar);
    montarShell();
    location.hash = '#/dashboard';
  }));

  el.querySelectorAll('[data-logo]').forEach((btn) => btn.addEventListener('click', () => {
    modalTrocarLogo(btn.dataset.logo, btn.dataset.nome);
  }));

  el.querySelectorAll('[data-excluir-condo]').forEach((btn) => btn.addEventListener('click', () => {
    modalExcluirCondominio(el, btn.dataset.excluirCondo);
  }));

  el.querySelectorAll('[data-editar-condo]').forEach((btn) => btn.addEventListener('click', () => {
    const c = state.condominios.find((x) => x.id === btn.dataset.editarCondo);
    modalEditarCondominio(el, c);
  }));

  document.getElementById('nc-salvar').addEventListener('click', async () => {
    const nome = document.getElementById('nc-nome').value.trim();
    const errBox = document.getElementById('nc-erro');
    errBox.hidden = true;
    if (!nome) { errBox.textContent = 'Informe o nome do condomínio.'; errBox.hidden = false; return; }
    if (!logoDataUrl) { errBox.textContent = 'A logo do condomínio é obrigatória.'; errBox.hidden = false; return; }
    const querMensal = temMensal();
    const querDiaria = document.getElementById('nc-med-diaria').checked;
    if (!querMensal && !querDiaria) { errBox.textContent = 'Escolha ao menos um tipo de medição (mensal e/ou diária).'; errBox.hidden = false; return; }
    const unidades = querMensal ? coletarUnidades() : [];
    if (querMensal && !unidades.length) { errBox.textContent = 'Configure ao menos uma torre/andares ou cole unidades.'; errBox.hidden = false; return; }
    try {
      const resp = await apiPost('/api/condominios', { nome, unidades, logo: logoDataUrl, medicoes: { mensal: querMensal, diaria_macro: querDiaria } });
      const modos = [querMensal && `${resp.criadas} unidades p/ cobrança mensal`, querDiaria && 'diária do macro'].filter(Boolean).join(' + ');
      toast(`Condomínio "${resp.condo.nome}" cadastrado (${modos})!`, 'success');
      const { condominios } = await apiGet('/api/condominios');
      state.condominios = condominios;
      setCondo(resp.condo.id);
      state.condo = resp.condo;
      montarShell();
      location.hash = querMensal ? '#/dashboard' : '#/diaria';
    } catch (e) {
      errBox.textContent = e.message; errBox.hidden = false;
    }
  });
}


// ---------- Medição Inicial: hidrômetro + leitura + FOTO antes da ocupação (sem cobrança) ----------
async function renderIniciais(el) {
  el.innerHTML = `<div class="empty-state"><p>Carregando...</p></div>`;
  let units;
  try { units = (await apiGet('/api/medicao-inicial')).unidades; }
  catch (e) { el.innerHTML = `<div class="empty-state"><p>${esc(e.message)}</p></div>`; return; }
  const hoje = new Date().toISOString().slice(0, 10);
  let modo = 'lista';

  const feitas = () => units.filter((u) => u.leitura_inicial != null).length;
  function atualizarProg() {
    const el2 = document.getElementById('ini-progresso');
    if (el2) el2.textContent = `${feitas()} de ${units.length} unidades preenchidas`;
  }

  async function copiar(txt, btn) {
    try {
      await navigator.clipboard.writeText(txt);
      const old = btn.textContent;
      btn.textContent = '✔ copiado';
      setTimeout(() => { btn.textContent = old; }, 1600);
    } catch { window.prompt('Copie o link:', txt); }
  }

  async function salvarItem(aptId, patch) {
    const dataInp = document.getElementById('ini-data');
    const body = { apartment_id: aptId, data: (dataInp && dataInp.value) || null, ...patch };
    const resp = await apiPut('/api/medicao-inicial', { itens: [body] });
    const u = units.find((x) => x.apartment_id === aptId);
    if (u) {
      if (patch.hidrometro !== undefined) u.hidrometro = patch.hidrometro;
      if (patch.leitura_inicial !== undefined) u.leitura_inicial = patch.leitura_inicial === null || patch.leitura_inicial === '' ? null : Number(patch.leitura_inicial);
      if (resp && resp.foto) u.foto_inicial = resp.foto;
    }
    atualizarProg();
  }

  function fotoCel(u) {
    return `${u.foto_inicial ? `<a href="${fotoUrl(u.foto_inicial)}" target="_blank" class="btn btn-ghost btn-sm" title="ver foto salva">👁</a>` : ''}`
      + `<button class="btn btn-ghost btn-sm ini-shot" title="tirar/enviar foto">📷</button>`
      + `<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" class="ini-file" hidden>`;
  }

  // captura + compressão + carimbo (usa o processImage do app) e salva
  async function fotoDoArquivo(file, aptId, after) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('Imagem muito grande (máx. 8 MB).', 'error'); return; }
    try {
      const dataUrl = await processImage(file);
      await salvarItem(aptId, { foto: dataUrl });
      toast('Foto salva ✔', 'ok');
      if (after) after();
    } catch (e) { toast('Não foi possível processar a foto.', 'error'); }
  }

  async function gerarLink(u, btn) {
    try {
      const r = await apiPost(`/api/apartamentos/${u.apartment_id}/link-inicial`, {});
      const url = `${location.origin}/inicial?token=${encodeURIComponent(r.link.token)}`;
      openModal(`
        <h3>Link de medição inicial — ${esc(u.etiqueta)}</h3>
        <p class="small">Envie este link para o morador/porteiro da unidade. Quem abrir poderá informar nº do hidrômetro, leitura e foto — sem login e sem cobrança.</p>
        <div class="field"><input type="text" id="ilk-url" readonly value="${url}" style="width:100%;font-size:12px;"></div>
        <div class="flex mt-16" style="gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="ilk-copiar">📋 Copiar link</button>
          <a class="btn btn-ghost btn-sm" href="https://wa.me/?text=${encodeURIComponent(`Olá! Medição INICIAL do hidrômetro da unidade ${u.etiqueta} (sem cobrança — é o cadastro antes da mudança). Registre aqui em 1 minuto: ${url}`)}" target="_blank" rel="noopener">💬 Enviar no WhatsApp</a>
        </div>
        <button class="btn btn-ghost btn-sm mt-16" onclick="closeModal()">Fechar</button>`);
      document.getElementById('ilk-copiar').addEventListener('click', (ev) => copiar(url, ev.target));
    } catch (e) { toast(e.message, 'error'); }
  }

  async function linksTodos() {
    try {
      const { links } = await apiGet('/api/medicao-inicial/links');
      const base = `${location.origin}/inicial?token=`;
      const txt = links.map((l) => `${l.etiqueta}\t${base}${l.token}`).join('\n');
      openModal(`
        <h3>Links de medição inicial — ${links.length} unidades</h3>
        <p class="small">Um link por unidade (já criados e válidos para sempre, até serem revogados). Copie tudo e distribua, ou baixe o arquivo TXT.</p>
        <textarea id="ilinks-txt" style="width:100%;height:220px;font-size:11px;" spellcheck="false">${esc(txt)}</textarea>
        <div class="flex mt-16" style="gap:8px;">
          <button class="btn btn-primary btn-sm" id="ilinks-copiar">📋 Copiar tudo</button>
          <button class="btn btn-ghost btn-sm" id="ilinks-dl">⬇️ Baixar TXT</button>
          <button class="btn btn-ghost btn-sm" onclick="closeModal()">Fechar</button>
        </div>`);
      document.getElementById('ilinks-copiar').addEventListener('click', (ev) => copiar(txt, ev.target));
      document.getElementById('ilinks-dl').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
        a.download = 'links-medicao-inicial.txt';
        a.click();
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- modo LISTA ----------
  function renderLista() {
    el.innerHTML = `
      <div class="page-head"><div><h1>Medição Inicial</h1>
        <p>Leitura de cada hidrômetro <b>antes da ocupação</b> + número + <b>foto como prova</b>. Nada é cobrado: esses valores viram a <b>leitura anterior automática</b> da primeira fatura.</p></div></div>
      <div class="card" style="padding:16px 18px;">
        <div class="flex" style="gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
          <label class="small" for="ini-data">Data da verificação</label>
          <input type="date" id="ini-data" value="${hoje}" style="width:170px;">
          <span class="small" id="ini-progresso">${feitas()} de ${units.length} unidades preenchidas</span>
          <span style="flex:1;"></span>
          <button class="btn btn-ghost btn-sm" id="ini-modo">🧭 Modo guiado (unidade a unidade)</button>
          <button class="btn btn-ghost btn-sm" id="ini-links">🔗 Gerar links de todas as unidades</button>
        </div>
        <table class="tbl tbl-lanc" style="margin-bottom:6px;">
          <thead><tr><th style="width:100px;">Unidade</th><th>Nº do hidrômetro</th><th style="width:180px;">Leitura inicial (m³)</th><th style="width:110px;">Foto</th><th style="width:80px;">Link</th><th style="width:100px;">Situação</th></tr></thead>
          <tbody>
          ${units.map((u) => `
            <tr data-apt="${u.apartment_id}" data-base-hid="${esc(u.hidrometro || '')}" data-base-ler="${u.leitura_inicial == null ? '' : u.leitura_inicial}">
              <td><b>${esc(u.etiqueta)}</b></td>
              <td><input type="text" class="ini-hid" value="${esc(u.hidrometro || '')}" placeholder="ex.: S7025041" style="width:100%;box-sizing:border-box;"></td>
              <td><input type="number" step="0.001" min="0" class="ini-ler" value="${u.leitura_inicial == null ? '' : u.leitura_inicial}" placeholder="0,000" style="width:100%;box-sizing:border-box;"></td>
              <td class="ini-foto">${fotoCel(u)}</td>
              <td><button class="btn btn-ghost btn-sm ini-link-btn" title="gerar/copiar link">🔗</button></td>
              <td class="ini-st">${u.leitura_inicial == null ? '<span class="small">aguardando</span>' : '<span style="color:#16a34a;font-weight:700;">✔ salva</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <p class="small" style="margin-top:8px;">💡 Salvamento automático ao sair do campo. 👁 = ver foto salva · 📷 = nova foto (substitui). Para anular uma leitura, apague o valor e saia do campo.</p>
      </div>`;
    document.getElementById('ini-modo').addEventListener('click', () => { modo = 'guiado'; renderGuiado(); });
    document.getElementById('ini-links').addEventListener('click', linksTodos);
    el.querySelectorAll('tbody tr').forEach((tr) => {
      const aptId = Number(tr.dataset.apt);
      tr.querySelectorAll('.ini-hid, .ini-ler').forEach((inp) => inp.addEventListener('change', async () => {
        const hid = tr.querySelector('.ini-hid').value.trim();
        const lerRaw = tr.querySelector('.ini-ler').value;
        if (hid === tr.dataset.baseHid && lerRaw === tr.dataset.baseLer) return;
        const st = tr.querySelector('.ini-st');
        st.innerHTML = '<span class="small">salvando…</span>';
        try {
          await salvarItem(aptId, { hidrometro: hid, leitura_inicial: lerRaw === '' ? null : Number(lerRaw) });
          tr.dataset.baseHid = hid; tr.dataset.baseLer = lerRaw;
          st.innerHTML = lerRaw === '' ? '<span class="small">aguardando</span>' : '<span style="color:#16a34a;font-weight:700;">✔ salva</span>';
        } catch (e) { st.innerHTML = `<span style="color:#b91c1c;">❌ ${esc(e.message)}</span>`; }
      }));
      const fotoCell = tr.querySelector('.ini-foto');
      tr.querySelector('.ini-shot').addEventListener('click', () => fotoCell.querySelector('.ini-file').click());
      fotoCell.querySelector('.ini-file').addEventListener('change', async (ev) => {
        await fotoDoArquivo(ev.target.files[0], aptId, () => {
          const u = units.find((x) => x.apartment_id === aptId);
          fotoCell.innerHTML = fotoCel(u);
          fotoCell.querySelector('.ini-shot').addEventListener('click', () => fotoCell.querySelector('.ini-file').click());
          fotoCell.querySelector('.ini-file').addEventListener('change', (e2) => fotoDoArquivo(e2.target.files[0], aptId, () => { }));
        });
      });
      tr.querySelector('.ini-link-btn').addEventListener('click', () => gerarLink(units.find((x) => x.apartment_id === aptId), tr));
    });
  }

  // ---------- modo GUIADO (unidade a unidade, com sentido de percurso) ----------
  function renderGuiado() {
    el.innerHTML = `
      <div class="page-head"><div><h1>Medição Inicial — modo guiado</h1>
        <p>Um apartamento por vez, com foto. Escolha por onde começar e o sentido do percurso.</p></div></div>
      <div class="card" style="padding:16px 18px;max-width:560px;">
        <div class="grid grid-2" style="gap:12px;">
          <div class="field"><label for="gd-dir">Sentido</label>
            <select id="gd-dir">
              <option value="baixo">De baixo para cima (térreo → cobertura)</option>
              <option value="cima">De cima para baixo (cobertura → térreo)</option>
            </select></div>
          <div class="field"><label for="gd-inicio">Começar de</label>
            <input id="gd-inicio" list="gd-eps" placeholder="ex.: 001A (vazio = 1º do sentido)">
            <datalist id="gd-eps">${units.map((u) => `<option value="${esc(u.etiqueta)}"></option>`).join('')}</datalist></div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;font-size:13.5px;margin-top:4px;">
          <input type="checkbox" id="gd-so" checked style="width:auto;"> mostrar só as ainda não preenchidas (${units.length - feitas()} de ${units.length})
        </label>
        <label style="display:block;font-size:13.5px;margin-top:10px;">Data da verificação
          <input type="date" id="ini-data" value="${hoje}" style="width:180px;display:block;margin-top:4px;"></label>
        <div class="flex" style="gap:12px;align-items:center;margin-top:8px;">
          <button class="btn btn-primary" id="gd-start">▶️ Iniciar percurso</button>
          <button class="btn btn-ghost" id="gd-voltar-lista">☰ Ver lista completa</button>
          <span class="small" id="ini-progresso">${feitas()} de ${units.length} unidades preenchidas</span>
        </div>
      </div>`;
    document.getElementById('gd-voltar-lista').addEventListener('click', () => { modo = 'lista'; renderLista(); });
    document.getElementById('gd-start').addEventListener('click', () => {
      const dir = document.getElementById('gd-dir').value;
      let seq = [...units].sort((a, b) =>
        String(a.torre || '').localeCompare(String(b.torre || '')) ||
        String(a.etiqueta).localeCompare(String(b.etiqueta), 'pt-BR', { numeric: true }));
      if (dir === 'cima') seq.reverse();
      if (document.getElementById('gd-so').checked) seq = seq.filter((u) => u.leitura_inicial == null);
      if (!seq.length) { toast('Nenhuma unidade pendente — tudo preenchido 🎉', 'ok'); return; }
      const alvo = (document.getElementById('gd-inicio').value || '').trim().toUpperCase();
      let idx = 0;
      if (alvo) { const i = seq.findIndex((u) => u.etiqueta === alvo); if (i >= 0) idx = i; }
      percurso(seq, idx);
    });
  }

  function percurso(seq, idx) {
    if (idx >= seq.length) {
      el.innerHTML = `<div class="card" style="max-width:520px;margin:40px auto;text-align:center;padding:34px;">
        <div style="font-size:44px;">🎉</div><h2 style="justify-content:center;">Percurso concluído!</h2>
        <p class="small">${feitas()} de ${units.length} unidades com medição inicial salva.</p>
        <button class="btn btn-primary" id="pc-lista" style="margin-top:10px;">☰ Ver lista completa</button></div>`;
      document.getElementById('pc-lista').addEventListener('click', () => { modo = 'lista'; renderLista(); });
      return;
    }
    const u = seq[idx];
    el.innerHTML = `
      <div class="card" style="max-width:520px;margin:26px auto;padding:22px;">
        <div class="flex" style="justify-content:space-between;align-items:center;">
          <span class="small">${idx + 1} de ${seq.length}</span>
          <span class="small" id="ini-progresso">${feitas()} de ${units.length} preenchidas no total</span>
        </div>
        <div style="text-align:center;margin:10px 0 4px;">
          <div style="font-size:34px;font-weight:800;color:#ea580c;">${esc(u.etiqueta)}</div>
          <div class="small">Torre ${esc(u.torre || '—')}${u.leitura_inicial != null ? ' · <b style="color:#16a34a;">já salva (pode corrigir)</b>' : ''}</div>
        </div>
        <div class="field"><label for="gu-hid">Nº do hidrômetro</label>
          <input id="gu-hid" type="text" value="${esc(u.hidrometro || '')}" placeholder="ex.: S7025041"></div>
        <div class="field"><label for="gu-ler">Leitura inicial (m³)</label>
          <input id="gu-ler" type="number" step="0.001" min="0" value="${u.leitura_inicial == null ? '' : u.leitura_inicial}" placeholder="0,000" inputmode="decimal" style="font-size:20px;"></div>
        <div class="field"><label>Foto do hidrômetro (prova)</label>
          <div class="flex" style="gap:8px;align-items:center;">
            <button class="btn btn-ghost btn-sm" id="gu-shot">📷 ${u.foto_inicial ? 'trocar foto' : 'tirar foto'}</button>
            ${u.foto_inicial ? `<a href="${fotoUrl(u.foto_inicial)}" target="_blank" class="small">👁 ver salva</a>` : '<span class="small">sem foto ainda</span>'}
            <input id="gu-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden>
          </div>
          <img id="gu-prev" alt="prévia" style="display:none;max-width:100%;max-height:230px;border-radius:10px;border:1px solid #e7e5e4;margin-top:8px;"></div>
        <div class="flex mt-16" style="gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" id="gu-prev-btn" ${idx === 0 ? 'disabled' : ''}>◀ Anterior</button>
          <button class="btn btn-ghost btn-sm" id="gu-skip">Pular</button>
          <span style="flex:1;"></span>
          <button class="btn btn-primary" id="gu-save">💾 Salvar e próximo →</button>
        </div>
        <div id="gu-erro" class="login-error" style="margin-top:10px;" hidden></div>
      </div>`;
    let fotoNova = '';
    const $id = (i) => document.getElementById(i);
    const erro = (m) => { const e0 = $id('gu-erro'); e0.textContent = m; e0.hidden = false; };
    $id('gu-shot').addEventListener('click', () => $id('gu-file').click());
    $id('gu-file').addEventListener('change', async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { return erro('Foto muito grande (máx. 8 MB).'); }
      try {
        fotoNova = await processImage(f);
        const pv = $id('gu-prev');
        pv.src = fotoNova; pv.style.display = '';
      } catch { erro('Não consegui ler a foto. Tente de novo.'); }
    });
    $id('gu-prev-btn').addEventListener('click', () => percurso(seq, idx - 1));
    $id('gu-skip').addEventListener('click', () => percurso(seq, idx + 1));
    $id('gu-save').addEventListener('click', async () => {
      const ler = $id('gu-ler').value.trim();
      if (ler === '' || !Number.isFinite(Number(ler)) || Number(ler) < 0) return erro('Informe a leitura (número em m³) — ou use Pular.');
      $id('gu-save').disabled = true;
      try {
        await salvarItem(u.apartment_id, { hidrometro: $id('gu-hid').value.trim(), leitura_inicial: Number(ler), ...(fotoNova ? { foto: fotoNova } : {}) });
        percurso(seq, idx + 1);
      } catch (e) { erro(e.message || 'Falha ao salvar.'); $id('gu-save').disabled = false; }
    });
    setTimeout(() => { const i0 = $id('gu-ler'); if (i0) i0.focus(); }, 80);
  }

  if (modo === 'guiado') renderGuiado(); else renderLista();
}

// Exclusão de condomínio com relatório de impacto + confirmação por digitação (irreversível).
async function modalExcluirCondominio(el, id) {
  let info;
  try { info = await apiGet(`/api/condominios/${id}/impacto`); }
  catch (e) { return toast(e.message, 'error'); }
  const im = info.impacto;
  const row = (t, v, warn) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;${warn ? 'color:#b91c1c;font-weight:700;' : ''}"><span>${t}</span><b>${v}</b></div>`;
  openModal(`
    <h3>Excluir condomínio "${esc(info.nome)}"?</h3>
    <p class="small" style="margin:4px 0 10px;">Esta ação <b>apaga todo o cadastro deste condomínio e não pode ser desfeita</b> — nem eu consigo recuperar depois. Os outros condomínios não são tocados.</p>
    <div class="formula-box" style="background:#fef2f2;border-color:#fecaca;color:var(--text);max-width:460px;text-align:left;">
      ${row('Unidades cadastradas', im.unidades)}
      ${row('Meses de lançamento', im.meses + (im.meses_finalizados ? ` — sendo ${im.meses_finalizados} FINALIZADO(s)` : ''), im.meses_finalizados > 0)}
      ${row('Leituras com valor registrado', im.leituras)}
      ${row('Fotos que serão apagadas', im.fotos)}
      ${row('Medidores de área comum', im.medidores_comuns)}
      ${row('Medidor(es) macro / leituras diárias', im.medidores_diarios + ' / ' + im.leituras_diarias)}
      ${row('Links de medição / conferência', im.links + ' / ' + im.links_conferencia)}
      ${im.contas_vinculadas ? row('Contas de acesso vinculadas (serão desativadas)', im.contas_vinculadas, true) : ''}
    </div>
    <div class="field" style="margin-top:12px;">
      <label for="xc-conf">Para confirmar, digite <b>EXCLUIR</b> neste campo</label>
      <input id="xc-conf" autocomplete="off" placeholder="EXCLUIR">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" id="xc-ok" disabled style="opacity:.45;">🗑️ Excluir definitivamente</button>
    </div>`);
  const conf = document.getElementById('xc-conf');
  const ok = document.getElementById('xc-ok');
  conf.addEventListener('input', () => {
    const liberado = conf.value.trim().toUpperCase() === 'EXCLUIR';
    ok.disabled = !liberado;
    ok.style.opacity = liberado ? '' : '.45';
  });
  conf.focus();
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      const r = await apiFetch(`/api/condominios/${id}`, { method: 'DELETE' });
      closeModal();
      const { condominios } = await apiGet('/api/condominios');
      state.condominios = condominios;
      if (state.condo && state.condo.id === id) {
        if (condominios.length) { setCondo(condominios[0].id); state.condo = condominios[0]; }
        else { setCondo(''); state.condo = null; }
      } else {
        state.condo = condominios.find((c) => state.condo && c.id === state.condo.id) || state.condo;
      }
      montarShell();
      toast(`Condomínio "${r.nome}" excluído (${r.removidos.unidades} unidade(s), ${r.removidos.meses} mês(es)).`, 'success');
      renderCondominios(el);
    } catch (e) { toast(e.message, 'error'); ok.disabled = false; ok.style.opacity = '.45'; }
  });
}


// Edição do cadastro do condomínio: nome + modo de medição (não apaga nada ao trocar).
function modalEditarCondominio(el, c) {
  if (!c) return;
  const mensal = !(c.medicoes && c.medicoes.mensal === false);
  const diaria = !(c.medicoes && c.medicoes.diaria_macro === false);
  openModal(`
    <h3>Editar condomínio</h3>
    <div class="field" style="margin-top:10px;">
      <label for="ce-nome">Nome do condomínio</label>
      <input id="ce-nome" maxlength="120" value="${esc(c.nome)}">
    </div>
    <p class="small" style="margin:10px 0 6px;"><b>O que será medido neste condomínio?</b> <span class="muted">(pode marcar os dois)</span></p>
    <label class="small" style="display:flex;gap:9px;align-items:flex-start;cursor:pointer;">
      <input type="checkbox" id="ce-med-mensal" ${mensal ? 'checked' : ''} style="margin-top:2px;">
      <span><b>Cobrança mensal nas unidades</b> — abas Lançamento e Histórico.</span>
    </label>
    <label class="small" style="display:flex;gap:9px;align-items:flex-start;margin-top:8px;cursor:pointer;">
      <input type="checkbox" id="ce-med-diaria" ${diaria ? 'checked' : ''} style="margin-top:2px;">
      <span><b>Medição diária do medidor macro</b> — aba Medição diária (acompanhamento e relatório).</span>
    </label>
    <p class="muted small" style="margin-top:10px;">Trocar o modo <b>não apaga nada</b>: esconder as telas mensais preserva unidades, leituras e fotos — se o modo voltar, tudo reaparece.</p>
    <p id="ce-erro" class="small" style="color:#b91c1c;display:none;margin:8px 0 0;"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="ce-ok">Salvar alterações</button>
    </div>`);
  document.getElementById('ce-ok').addEventListener('click', async () => {
    const err = document.getElementById('ce-erro');
    const nome = document.getElementById('ce-nome').value.trim();
    const querMensal = document.getElementById('ce-med-mensal').checked;
    const querDiaria = document.getElementById('ce-med-diaria').checked;
    if (!nome) { err.textContent = 'Informe o nome do condomínio.'; err.style.display = ''; return; }
    if (!querMensal && !querDiaria) { err.textContent = 'Escolha ao menos um tipo de medição (mensal e/ou diária).'; err.style.display = ''; return; }
    try {
      await apiPut(`/api/condominios/${c.id}`, { nome, medicoes: { mensal: querMensal, diaria_macro: querDiaria } });
      const { condominios } = await apiGet('/api/condominios');
      state.condominios = condominios;
      if (state.condo && state.condo.id === c.id) {
        state.condo = condominios.find((x) => x.id === c.id) || state.condo;
        aplicarAbasCondominio();
        if (!condoMedeMensal() && ['#/lancamento', '#/historico'].some((h) => location.hash.startsWith(h))) location.hash = '#/diaria';
      }
      closeModal();
      toast('Condomínio atualizado!', 'success');
      renderCondominios(el);
    } catch (e) { err.textContent = e.message; err.style.display = ''; }
  });
}

init();
