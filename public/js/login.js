'use strict';
// Se já estiver autenticado, vai direto ao app.
let token = '';
try { token = localStorage.getItem('agua_token') || ''; } catch { token = ''; }
(async () => {
  try {
    const res = await fetch('/api/me', {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) { window.location.href = '/app.html'; return; }
  } catch { /* segue no login */ }

  const form = document.getElementById('login-form');
  const errBox = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  document.querySelectorAll('.olho').forEach((b) => b.addEventListener('click', () => {
    const inp = document.getElementById(b.dataset.alvo);
    if (!inp) return;
    const mostrar = inp.type === 'password';
    inp.type = mostrar ? 'text' : 'password';
    b.textContent = mostrar ? '🙈' : '👁️';
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        errBox.textContent = data.error || 'Falha no login.';
        errBox.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Entrar';
        return;
      }
      try { if (data && data.token) localStorage.setItem('agua_token', data.token); } catch { /* ignore */ }
      window.location.href = '/app.html';
    } catch {
      errBox.textContent = 'Erro de conexão com o servidor.';
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
})();
