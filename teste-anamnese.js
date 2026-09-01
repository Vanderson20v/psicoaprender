/* Teste da tela de anamnese: percorre o caminho real da profissional —
   abre a aba, inicia, responde por toque, escolhe áreas do plano e conclui. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const erros = [];
const ok = (b, t) => { console.log((b ? 'ok    ' : 'FALHA ') + t); if (!b) erros.push(t); };

(async () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="raiz"></div><div id="toasts"></div></body></html>`,
    { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  w.fetch = (url, opt) => fetch(String(url).startsWith('http') ? url : BASE + url, opt);
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  w.print = () => { w.__imprimiu = true; };

  const fontes = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n;\n');
  const expor = ['App', 'api', 'Token', 'abaAnamnese', 'abaEvolucao', 'fecharModal', 'aviso'];
  w.eval(fontes + '\n' + expor.map(n => `window.${n}=${n};`).join(''));

  // login pela API, direto
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'suporte@psicoaprender.com.br', senha: 'psico123' })
  });
  const { token } = await r.json();
  w.Token.set(token);
  const sessao = await (await fetch(BASE + '/api/sessao?token=' + token)).json();
  w.App.sessao = sessao.usuario; w.App.permissoes = sessao.permissoes; w.App.config = sessao.config;

  // paciente de teste
  const pac = await (await fetch(BASE + '/api/pacientes?token=' + token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'Criança da Anamnese', nascimento: '2019-02-10', status: 'Ativo' })
  })).json();

  const cont = w.document.getElementById('raiz');
  const p = await w.api.get('/api/pacientes/' + pac.id);

  // ---- 1. estado inicial
  await w.abaAnamnese(cont, p);
  await esperar(400);
  ok(!!cont.querySelector('#iniciar'), 'aba mostra o convite para iniciar a anamnese');
  ok(/primeiro encontro com a família/i.test(cont.textContent), 'explica o que é a anamnese');

  // ---- 2. iniciar
  cont.querySelector('#iniciar').dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(700);
  const blocos = cont.querySelectorAll('.painel-titulo h2');
  ok(blocos.length >= 8, `roteiro carregado na tela (${blocos.length} seções)`);
  ok(!!cont.querySelector('.escolhas-anamnese'), 'perguntas de toque presentes');
  ok(cont.querySelectorAll('.linha-area-plano').length === 11, 'as 11 áreas aparecem no plano');

  // ---- 3. responder por toque
  const grupo = cont.querySelector('.escolhas-anamnese');
  const opcao = grupo.querySelectorAll('.escolha')[0];
  opcao.dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(120);
  ok(opcao.classList.contains('ativa'), 'toque marca a resposta');
  opcao.dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(120);
  ok(!opcao.classList.contains('ativa'), 'tocar de novo desmarca (resposta em branco)');
  opcao.dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(120);

  // texto livre
  const txt = cont.querySelector('[data-texto]');
  txt.value = 'Relato da mãe durante a entrevista';
  txt.dispatchEvent(new w.Event('input', { bubbles: true }));

  // ---- 4. concluir sem área do plano deve ser barrado
  cont.querySelector('#concluir-anamnese').dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(500);
  const aindaEditando = !!cont.querySelector('#concluir-anamnese');
  ok(aindaEditando, 'não conclui sem escolher área do plano');

  // ---- 5. escolher áreas
  const linhaEscrita = cont.querySelector('.linha-area-plano[data-area="escrita"]');
  linhaEscrita.querySelector('.alternar-area').dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(150);
  ok(linhaEscrita.classList.contains('marcada'), 'área do plano marcada com um toque');
  ok(!linhaEscrita.querySelector('input').disabled, 'campo de objetivo liberado ao marcar');
  linhaEscrita.querySelector('input').value = 'Reduzir trocas de letras';

  const linhaAtencao = cont.querySelector('.linha-area-plano[data-area="atencao"]');
  linhaAtencao.querySelector('.alternar-area').dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(120);

  cont.querySelector('[data-campo="hipoteses"]').value = 'Hipótese de dificuldade em consciência fonológica.';
  cont.querySelector('[data-campo="informante"]').value = 'Mãe';

  // ---- 6. concluir
  cont.querySelector('#concluir-anamnese').dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(900);

  const salva = (await w.api.get('/api/anamneses', { paciente_id: pac.id }))[0];
  ok(!!salva && salva.concluida, 'anamnese concluída e gravada');
  ok(salva.plano.areas.length === 2, `plano com 2 áreas (veio ${salva.plano?.areas?.length})`);
  ok(salva.plano.areas.some(a => a.objetivo === 'Reduzir trocas de letras'), 'objetivo por área gravado');
  ok(/consciência fonológica/.test(salva.hipoteses || ''), 'hipóteses gravadas');
  ok(salva.informante === 'Mãe', 'informante gravado');

  // ---- 7. reabrir mostra o que foi preenchido
  const p2 = await w.api.get('/api/pacientes/' + pac.id);
  ok(!!p2.anamnese, 'ficha do paciente passa a indicar anamnese registrada');
  await w.abaAnamnese(cont, p2);
  await esperar(600);
  ok(!cont.querySelector('#iniciar'), 'ao reabrir, mostra a anamnese existente');
  ok(cont.querySelector('.linha-area-plano.marcada'), 'áreas do plano voltam marcadas');
  ok(/Reduzir trocas de letras/.test(cont.innerHTML), 'objetivo por área reaparece preenchido');

  // ---- 8. PDF
  cont.querySelector('#imprimir-anamnese').dispatchEvent(new w.Event('click', { bubbles: true }));
  await esperar(400);
  const doc = w.document.querySelector('.documento');
  ok(!!doc, 'documento de impressão montado');
  ok(/não constitui diagnóstico/i.test(doc?.textContent || ''), 'documento traz a ressalva de que não é diagnóstico');
  ok(/Plano de trabalho/.test(doc?.textContent || ''), 'documento traz o plano de trabalho');

  // ---- 9. evolução destaca o plano
  const cont2 = w.document.createElement('div');
  w.document.body.appendChild(cont2);
  await w.abaEvolucao(cont2, p2);
  await esperar(700);
  ok(/Plano definido na anamnese/.test(cont2.textContent), 'evolução mostra o plano da anamnese');
  ok(/sem registro/.test(cont2.textContent), 'evolução avisa que as áreas do plano ainda não têm registro');

  console.log('');
  if (erros.length) { console.log('ERROS:'); erros.forEach(e => console.log('- ' + e)); process.exit(1); }
  console.log('Sem erros.');
})().catch(e => { console.error('QUEBROU:', e); process.exit(1); });
