/* Teste de fumaça: simula o navegador em iframe com cookies E localStorage bloqueados,
   faz login pela interface e percorre todas as telas e modais. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const rotas = ['#/dashboard', '#/agenda', '#/agenda?v=dia', '#/pacientes', '#/paciente/1', '#/paciente/1?aba=agenda',
  '#/paciente/1?aba=diario', '#/paciente/1?aba=evolucao', '#/paciente/1?aba=documentos',
  '#/paciente/1?aba=financeiro', '#/responsaveis', '#/atendimentos', '#/atendimentos?filtro=sem_registro',
  '#/atendimentos?filtro=faltas', '#/evolucao', '#/relatorios', '#/financeiro', '#/documentos',
  '#/profissionais', '#/configuracoes', '#/configuracoes?aba=mensagens', '#/configuracoes?aba=usuarios',
  '#/configuracoes?aba=seguranca'];

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'public/sistema.html'), 'utf8'), {
    url: BASE + '/sistema.html', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  const erros = [];

  // ---- ambiente hostil: sem cookies, sem localStorage e com proxy que remove
  //      o cabeçalho Authorization (iframe de origem opaca atrás de proxy)
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('localStorage bloqueado'); } });
  w.fetch = (url, opt = {}) => {
    const cabecalhos = { ...(opt.headers || {}) };
    delete cabecalhos.cookie;                       // nenhum cookie trafega
    delete cabecalhos.Authorization;                // proxy remove o cabeçalho
    delete cabecalhos.authorization;
    return fetch(url.startsWith('http') ? url : BASE + url, { ...opt, headers: cabecalhos });
  };
  w.alert = () => { }; w.confirm = () => true; w.prompt = () => 'teste'; w.scrollTo = () => { };
  w.addEventListener('error', e => erros.push('window error: ' + e.message));

  const fontes = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js', 'inicio.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n;\n');
  const expor = ['navegar', 'telaLogin', 'iniciarSessao', 'modalPaciente', 'abrirDiario', 'modalAtendimento',
    'modalNovoRelatorio', 'modalPagamento', 'modalDocumento', 'fecharModal', 'api', 'Token'];
  try { w.eval(fontes + '\n' + expor.map(n => `window.${n}=${n};`).join('')); }
  catch (e) { erros.push('scripts: ' + e.message); }
  await esperar(800);

  // ---- 1. deve exibir o login (sem sessão)
  const temLogin = !!w.document.getElementById('form-login');
  console.log((temLogin ? 'ok    ' : 'FALHA ') + 'tela de login exibida sem sessão');
  if (!temLogin) erros.push('login não exibido');

  // ---- 2. login pela interface
  w.document.querySelector('[name=email]').value = 'vanessa@psicoaprender.com.br';
  w.document.querySelector('[name=senha]').value = 'psico123';
  w.document.getElementById('form-login').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await esperar(1500);
  const entrou = !!w.document.getElementById('menu') && !w.document.getElementById('form-login');
  console.log((entrou ? 'ok    ' : 'FALHA ') + 'entrou no sistema após o login (sem cookie e sem storage)');
  if (!entrou) { erros.push('login não entrou: ' + (w.document.getElementById('msg')?.textContent || '')); }

  // ---- 3. senha errada
  if (entrou) {
    for (const rota of rotas) {
      w.location.hash = rota;
      try { await w.navegar(); } catch (e) { erros.push(`${rota}: ${e.message}`); }
      await esperar(110);
      const html = w.document.getElementById('pagina')?.innerHTML || '';
      const falha = html.includes('aviso erro') || html.length < 200;
      console.log((falha ? 'FALHA ' : 'ok    ') + rota + ' (' + html.length + ' chars)');
      if (falha) erros.push(rota + ' -> ' + html.slice(0, 200));
    }
    const modais = [
      ['novo paciente', () => w.modalPaciente()],
      ['diário', () => w.abrirDiario({ paciente_id: 1 })],
      ['atendimento', () => w.modalAtendimento({})],
      ['relatório', () => w.modalNovoRelatorio(1)],
      ['pagamento', () => w.modalPagamento('2026-08', 1)],
      ['documento', () => w.modalDocumento(null, 1)]
    ];
    for (const [nome, fn] of modais) {
      try {
        await fn(); await esperar(450);
        const m = w.document.querySelector('.modal-corpo');
        const ok = m && m.innerHTML.length > 200;
        console.log((ok ? 'ok    ' : 'FALHA ') + 'modal ' + nome);
        if (!ok) erros.push('modal ' + nome);
        w.fecharModal(true);
      } catch (e) { erros.push('modal ' + nome + ': ' + e.message); console.log('FALHA modal ' + nome); }
    }
  }

  console.log(erros.length ? '\nERROS:\n' + erros.join('\n---\n') : '\nSem erros.');
  process.exit(erros.length ? 1 : 0);
})();
