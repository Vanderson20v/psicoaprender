/* =======================================================================
   Login dentro da própria aplicação — sem troca de página.
   Necessário porque em iframes com origem opaca o navegador bloqueia
   cookies e localStorage; o token de sessão fica em memória.
   ======================================================================= */

function telaLogin(mensagem = '') {
  document.body.style.overflow = '';
  document.querySelectorAll('.modal-fundo, .nav-inferior, .fundo-menu').forEach(e => e.remove());
  document.getElementById('raiz').innerHTML = `
  <div class="entrada">
    <section class="lado">
      <div class="marca">
        <img src="/assets/marca.png" alt="PsicoAprender" style="width:46px;height:46px;border-radius:10px;object-fit:cover">
        <div><div class="marca-texto" style="color:#fff;font-size:17px">PsicoAprender</div>
          <div class="marca-sub" style="color:rgba(255,255,255,.75)">Espaço de Aprendizagem · Gestão</div></div>
      </div>
      <div>
        <h2>Toda a rotina da clínica em um só lugar.</h2>
        <p>Agenda, diário de atendimentos, evolução dos pacientes, relatórios e financeiro — sem planilhas soltas e sem depender da memória.</p>
        <ul>
          <li><b>Agenda</b> — recorrências, bloqueios e confirmação por WhatsApp.</li>
          <li><b>Diário de sessão</b> — registro em poucos minutos, direto no tablet.</li>
          <li><b>Evolução</b> — linha do tempo e indicadores por área trabalhada.</li>
          <li><b>Relatórios</b> — construídos a partir do que foi registrado.</li>
        </ul>
      </div>
      <div style="font-size:12.5px;color:rgba(255,255,255,.6)">Dados de crianças protegidos conforme a LGPD · acesso individual e auditado.</div>
    </section>

    <section class="formulario">
      <div class="caixa">
        <img src="/assets/logo.png" alt="PsicoAprender" style="width:150px;display:block;margin:0 auto 18px">
        <h1 style="font-size:21px;margin-bottom:4px">Entrar no sistema</h1>
        <p style="color:var(--tinta-3);font-size:13.5px;margin:0 0 24px">Use seu acesso individual.</p>
        <div id="msg">${mensagem ? `<div class="aviso info">${esc(mensagem)}</div>` : ''}</div>
        <form id="form-login">
          <div class="campo"><label>E-mail</label>
            <input type="email" name="email" required autocomplete="username" value="vanessa@psicoaprender.com.br"></div>
          <div class="campo"><label>Senha</label>
            <input type="password" name="senha" required autocomplete="current-password" value="psico123"></div>
          <button class="btn btn-primario btn-bloco btn-grande" id="entrar" type="submit">Entrar</button>
        </form>
        <button class="btn btn-sutil btn-bloco" style="margin-top:10px" id="esqueci">Esqueci minha senha</button>
        <div class="demo">
          <b>Acessos da equipe</b><br>
          Administradora — vanessa@psicoaprender.com.br<br>
          Profissionais — helen@, patricia@, jennifer@, josyllene@, malu@<br>
          Administrativo — recepcao@psicoaprender.com.br<br>
          Senha inicial de todas: <b>psico123</b>
        </div>
        <div style="margin-top:20px;text-align:center;display:flex;gap:14px;justify-content:center">
          <a href="/" style="font-size:13px;color:var(--tinta-3)">Voltar ao site</a>
          <a href="/sistema.html" target="_blank" rel="noopener" style="font-size:13px;color:var(--tinta-3)">Abrir em nova aba</a>
        </div>
      </div>
    </section>
  </div>`;

  const msg = document.getElementById('msg');
  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.target));
    const botao = document.getElementById('entrar');
    botao.disabled = true; botao.textContent = 'Entrando…';
    msg.innerHTML = '';
    try {
      const r = await buscar('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify(dados)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || `Não foi possível entrar (erro ${r.status}).`);
      if (!j.token) throw new Error('O servidor não devolveu o token de sessão. Recarregue a página (o navegador pode estar com a versão antiga em cache).');
      Token.set(j.token);
      const entrou = await iniciarSessao();   // entra sem recarregar a página
      if (!entrou) throw new Error('O login foi aceito, mas a sessão não foi reconhecida na sequência. Recarregue a página e tente novamente.');
    } catch (err) {
      msg.innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
      botao.disabled = false; botao.textContent = 'Entrar';
    }
  });

  document.getElementById('esqueci').addEventListener('click', async () => {
    const email = document.querySelector('[name=email]').value;
    if (!email) return;
    const r = await buscar('/api/recuperar-senha', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
    });
    const j = await r.json();
    msg.innerHTML = `<div class="aviso info">${esc(j.aviso)}${j.codigo_demo ? ' Código: <b>' + j.codigo_demo + '</b>' : ''}</div>`;
  });
}

/** Encerra a sessão local e volta para a tela de login (sem trocar de página). */
function encerrarSessao(mensagem = '') {
  Token.limpar();
  App.sessao = null;
  telaLogin(mensagem);
}

/** Busca a sessão e monta o sistema. Retorna false se não houver sessão válida. */
async function iniciarSessao() {
  const t = Token.get();
  const cabecalhos = t ? { Authorization: 'Bearer ' + t } : {};
  // token também na URL: proxies podem remover o cabeçalho Authorization
  const r = await buscar(t ? comToken('/api/sessao') : '/api/sessao',
    { credentials: 'same-origin', headers: cabecalhos });
  if (!r.ok) return false;
  const dados = await r.json();
  App.sessao = dados.usuario;
  App.permissoes = dados.permissoes;
  App.config = dados.config || {};
  montarLayout();
  if (!location.hash.startsWith('#/')) location.hash = '#/dashboard';
  await navegar();
  try {
    const alertas = await api.get('/api/alertas');
    App.alertas = alertas;
    if (alertas.some(a => a.prioridade === 'alta')) {
      const ponto = document.getElementById('ponto-alerta');
      if (ponto) ponto.style.display = 'block';
    }
  } catch (_) { }
  return true;
}
