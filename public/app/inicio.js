/* Inicialização: token vindo da URL (quando a página de login externa foi usada),
   depois sessão existente; sem sessão, mostra o login dentro da própria aplicação. */
(async function iniciar() {
  try {
    const naUrl = new URLSearchParams(location.search).get('t')
      || (location.hash.startsWith('#t=') ? location.hash.slice(3) : '');
    if (naUrl) {
      Token.set(naUrl);
      try { history.replaceState(null, '', location.pathname); } catch (_) { }
    }
    window.addEventListener('hashchange', () => { if (App.sessao) navegar(); });
    if (!(await iniciarSessao())) telaLogin();
  } catch (e) {
    document.getElementById('raiz').innerHTML =
      `<div class="pagina"><div class="aviso erro">${esc(e.message)}</div></div>`;
  }
})();
