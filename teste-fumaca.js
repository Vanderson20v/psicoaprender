/* Teste de fumaça: simula o navegador em iframe com cookies E localStorage bloqueados,
   faz login pela interface e percorre todas as telas e modais. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
/* O sistema nasce sem pacientes: o teste cria o seu próprio antes de percorrer as telas.
   {ID} é trocado pelo id do paciente criado. */
const rotas = ['#/dashboard', '#/agenda', '#/agenda?v=dia', '#/pacientes', '#/paciente/{ID}', '#/paciente/{ID}?aba=agenda',
  '#/paciente/{ID}?aba=diario', '#/paciente/{ID}?aba=evolucao', '#/paciente/{ID}?aba=documentos',
  '#/paciente/{ID}?aba=financeiro', '#/responsaveis', '#/atendimentos', '#/atendimentos?filtro=sem_registro',
  '#/atendimentos?filtro=faltas', '#/evolucao', '#/relatorios', '#/financeiro', '#/documentos',
  '#/profissionais', '#/configuracoes', '#/configuracoes?aba=mensagens', '#/configuracoes?aba=usuarios',
  '#/configuracoes?aba=seguranca'];

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const EMAIL_TESTE = 'suporte@psicoaprender.com.br';
  const SENHA_INICIAL = 'psico123';
  const SENHA_NOVA = 'SenhaDeTeste2026';
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
  w.document.querySelector('[name=email]').value = EMAIL_TESTE;
  w.document.querySelector('[name=senha]').value = SENHA_INICIAL;
  w.document.getElementById('form-login').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await esperar(1500);

  /* Em base nova a senha ainda é a provisória; se o teste já rodou antes nesta base,
     a conta usa SENHA_NOVA e a etapa de troca é pulada — assim o teste é repetível. */
  const jaTrocada = /inválidos/.test(w.document.getElementById('msg')?.textContent || '');
  if (jaTrocada) {
    w.document.querySelector('[name=email]').value = EMAIL_TESTE;
    w.document.querySelector('[name=senha]').value = SENHA_NOVA;
    w.document.getElementById('form-login').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await esperar(1500);
    console.log('ok    senha já trocada nesta base — etapa de primeiro acesso pulada');
  }

  // ---- 2b. primeiro acesso: o sistema exige criar uma senha própria antes de tudo
  const pediuTroca = !!w.document.getElementById('form-senha');
  if (!jaTrocada) {
    console.log((pediuTroca ? 'ok    ' : 'FALHA ') + 'primeiro acesso exige trocar a senha provisória');
    if (!pediuTroca) erros.push('não pediu troca de senha no primeiro acesso');
  }
  if (pediuTroca) {
    // senhas diferentes: precisa recusar sem chamar o servidor
    w.document.querySelector('#form-senha [name=atual]').value = SENHA_INICIAL;
    w.document.querySelector('#form-senha [name=nova]').value = SENHA_NOVA;
    w.document.querySelector('#form-senha [name=repetir]').value = 'outra-coisa';
    w.document.getElementById('form-senha').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await esperar(300);
    const recusou = /não são iguais/.test(w.document.getElementById('msg-senha')?.textContent || '');
    console.log((recusou ? 'ok    ' : 'FALHA ') + 'recusa quando as duas senhas novas diferem');
    if (!recusou) erros.push('aceitou senhas novas diferentes');

    w.document.querySelector('#form-senha [name=repetir]').value = SENHA_NOVA;
    w.document.getElementById('form-senha').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await esperar(1500);
  }

  const entrou = !!w.document.getElementById('menu') && !w.document.getElementById('form-login');
  console.log((entrou ? 'ok    ' : 'FALHA ') + 'entrou no sistema após o login (sem cookie e sem storage)');
  if (!entrou) { erros.push('login não entrou: ' + (w.document.getElementById('msg')?.textContent || '')); }

  // ---- 3. senha errada
  if (entrou) {
    // fixture: um paciente com atendimento, para as telas terem o que exibir
    const jaExistem = await w.api.get('/api/pacientes');
    const pac = jaExistem[0] || await w.api.post('/api/pacientes', {
      nome: 'Paciente de Teste', nascimento: '2018-05-05', status: 'Ativo',
      profissional_id: w.App.sessao.profissional_id, valor_sessao: 180
    });
    if (!jaExistem.length) {
      const hoje = new Date().toISOString().slice(0, 10);
      await w.api.post('/api/atendimentos', {
        paciente_id: pac.id, profissional_id: w.App.sessao.profissional_id,
        data: hoje, hora: '11:00', duracao: 50, sala: w.SALAS[0], tipo: 'Psicopedagogia'
      });
    }
    console.log('ok    paciente de teste criado (id ' + pac.id + ')');

    for (const rotaBruta of rotas) {
      const rota = rotaBruta.replace(/\{ID\}/g, pac.id);
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
      ['diário', () => w.abrirDiario({ paciente_id: pac.id })],
      ['atendimento', () => w.modalAtendimento({})],
      ['relatório', () => w.modalNovoRelatorio(pac.id)],
      ['pagamento', () => w.modalPagamento(new Date().toISOString().slice(0, 7), pac.id)],
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
