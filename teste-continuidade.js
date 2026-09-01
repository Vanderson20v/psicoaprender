/* Testa a continuidade entre sessões: o que a profissional anota numa sessão
   precisa aparecer na frente dela na sessão seguinte. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const erros = [];
const ok = (b, t) => { console.log((b ? 'ok    ' : 'FALHA ') + t); if (!b) erros.push(t); };

(async () => {
  const dom = new JSDOM(`<!doctype html><html><body><div id="raiz"></div><div id="toasts"></div></body></html>`,
    { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (url, opt) => fetch(String(url).startsWith('http') ? url : BASE + url, opt);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {}; w.print = () => {};

  const fontes = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n;\n');
  const expor = ['App', 'api', 'Token', 'abrirDiario', 'fecharModal', 'aviso', 'faixaContexto'];
  w.eval(fontes + '\n' + expor.map(n => `window.${n}=${n};`).join(''));

  const { token } = await (await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'suporte@psicoaprender.com.br', senha: 'psico123' })
  })).json();
  w.Token.set(token);
  const sessao = await (await fetch(BASE + '/api/sessao?token=' + token)).json();
  w.App.sessao = sessao.usuario; w.App.permissoes = sessao.permissoes; w.App.config = sessao.config;

  const pac = await w.api.post('/api/pacientes', { nome: 'João Continuidade', nascimento: '2018-03-01', status: 'Ativo' });

  // anamnese com plano de 3 áreas, como no exemplo do usuário
  await w.api.post('/api/anamneses', {
    paciente_id: pac.id,
    plano: {
      objetivo_geral: 'Apoiar leitura e atenção',
      areas: [
        { area: 'atencao', objetivo: 'Desenvolver atenção sustentada' },
        { area: 'leitura', objetivo: 'Trabalhar reconhecimento de letras' },
        { area: 'coordenacao_motora', objetivo: 'Estimular coordenação motora fina' }
      ]
    },
    concluida: true
  });

  const contexto = () => w.api.get(`/api/pacientes/${pac.id}/contexto`);

  // ---- 1. primeira abertura: sem sessão anterior
  let ctx = await contexto();
  ok(ctx.objetivos.length === 3, 'os 3 objetivos do plano vêm no contexto');
  ok(ctx.objetivos[0].objetivo === 'Desenvolver atenção sustentada', 'objetivo escrito pela profissional preservado');
  ok(ctx.ultimo === null, 'sem última sessão no primeiro atendimento');

  let html = w.faixaContexto(ctx);
  ok(/Objetivos do plano/.test(html), 'faixa mostra os objetivos');
  ok(/Primeiro registro deste paciente/.test(html), 'faixa avisa que é o primeiro registro');
  ok(/Nada anotado na sessão anterior/.test(html), 'faixa não inventa combinado quando não há');

  // ---- 2. sessão 1: registra e anota o próximo passo
  await w.api.post('/api/registros', {
    paciente_id: pac.id, data: '2026-08-25',
    objetivo: 'Reconhecimento das letras A, E e O',
    atividades: 'Jogo de pareamento com letras móveis',
    evolucao: 'Boa participação, precisou de auxílio na diferenciação visual',
    areas: { leitura: 'em_desenvolvimento', atencao: 'em_desenvolvimento' },
    proximo_passo: 'Retomar diferenciação visual das letras trabalhadas antes de avançar'
  });

  ctx = await contexto();
  ok(ctx.total_sessoes === 1, 'contagem de sessões atualizada');
  ok(/diferenciação visual/.test(ctx.ultimo.proximo_passo), 'próximo passo gravado');
  ok(/A, E e O/.test(ctx.ultimo.objetivo), 'objetivo da última sessão disponível');

  html = w.faixaContexto(ctx);
  ok(/Combinado da última vez/.test(html), 'faixa traz o combinado');
  ok(/Retomar diferenciação visual/.test(html), 'faixa mostra exatamente o que a profissional escreveu');
  ok(/25\/08\/2026/.test(html), 'faixa data a última sessão');

  // ---- 3. a faixa aparece de fato ao abrir o registro
  await w.abrirDiario({ paciente_id: pac.id });
  await esperar(900);
  const modal = w.document.querySelector('.contexto-paciente');
  ok(!!modal, 'faixa renderizada dentro da janela de registro');
  ok(/Retomar diferenciação visual/.test(modal?.textContent || ''), 'combinado visível ao registrar');
  const campoPP = w.document.querySelector('[name=proximo_passo]');
  ok(!!campoPP, 'campo "próximo passo" presente no formulário');
  ok(!campoPP.required, 'campo é opcional (não obrigatório)');
  w.fecharModal(true);

  // ---- 4. áreas esquecidas
  for (const data of ['2026-08-26', '2026-08-27', '2026-08-28']) {
    await w.api.post('/api/registros', {
      paciente_id: pac.id, data, objetivo: 'Leitura', areas: { leitura: 'evoluindo' }
    });
  }
  ctx = await contexto();
  const motora = ctx.objetivos.find(o => o.area === 'coordenacao_motora');
  ok(motora.sessoes_sem_registro === 4, `coordenação motora sem registro há 4 sessões (veio ${motora.sessoes_sem_registro})`);
  const leitura = ctx.objetivos.find(o => o.area === 'leitura');
  ok(leitura.sessoes_sem_registro === 0, 'leitura trabalhada na última sessão');
  ok(leitura.sessoes_trabalhadas === 4, 'contagem de sessões por área correta');

  html = w.faixaContexto(ctx);
  ok(/sem registro há 4 sessões/.test(html), 'faixa alerta a área esquecida — sem sugerir conduta');

  // ---- 5. o combinado veio da sessão mais recente, não da antiga
  ok(!ctx.ultimo.proximo_passo, 'sessão sem próximo passo não herda o antigo');

  // ---- 6. permissão
  const rec = await (await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recepcao@psicoaprender.com.br', senha: 'psico123' })
  })).json();
  const r = await fetch(`${BASE}/api/pacientes/${pac.id}/contexto?token=${rec.token}`);
  ok(r.status === 403, `recepção não acessa o contexto clínico (veio ${r.status})`);

  console.log('');
  if (erros.length) { console.log('ERROS:'); erros.forEach(e => console.log('- ' + e)); process.exit(1); }
  console.log('Sem erros.');
})().catch(e => { console.error('QUEBROU:', e); process.exit(1); });
