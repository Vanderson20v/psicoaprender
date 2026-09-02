/* Exportar em PDF deve levar só o documento — não a tela que está atrás. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:3000';
let erros = 0;
const ok = (m) => console.log('ok    ' + m);
const falha = (m) => { erros++; console.log('FALHA ' + m); };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div class="lateral">menu</div>
       <div class="conteudo"><header class="topo">topo</header>
       <main id="pagina">LISTA DE RELATORIOS QUE NAO PODE IR PARA O PAPEL</main></div>
       <div id="toasts"></div></body></html>`,
    { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const nativo = fetch;
  w.fetch = (u, o) => nativo(String(u).startsWith('http') ? u : BASE + u, o);
  w.scrollTo = () => {};
  let impressoes = 0;
  let corpoNaHoraDeImprimir = null;
  w.print = () => {
    impressoes++;
    corpoNaHoraDeImprimir = {
      classes: w.document.body.className,
      folhas: w.document.querySelectorAll('.folha-impressa').length
    };
  };

  const fontes = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n;\n');
  const expor = ['App', 'api', 'Token', 'abrirModal', 'fecharModal', 'imprimirDocumento',
    'aviso', 'modalNovoRelatorio', 'App'];
  w.eval(fontes + '\n' + expor.map(n => `window.${n}=${n};`).join(''));

  const r = await nativo(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'suporte@psicoaprender.com.br', senha: 'psico123' })
  });
  const { token } = await r.json();
  w.Token.set(token);
  const sessao = await (await nativo(BASE + '/api/sessao?token=' + token)).json();
  w.App.sessao = sessao.usuario; w.App.permissoes = sessao.permissoes; w.App.config = sessao.config;

  // ---------- o CSS de impressão ----------
  const css = fs.readFileSync(path.join(__dirname, 'public/assets/sistema.css'), 'utf8');
  const bloco = css.slice(css.indexOf('@media print'), css.indexOf('@media print') + 1600);

  /body\.imprimindo \*\s*\{\s*visibility: hidden/.test(bloco)
    ? ok('regra de impressão esconde a tela inteira')
    : falha('não há regra escondendo a tela na impressão');

  /body\.imprimindo \.folha-impressa[^{]*\{[^}]*visibility: visible/.test(bloco)
    ? ok('e revela apenas o documento marcado')
    : falha('o documento não é revelado na impressão');

  /\.modal-corpo\s*\{[^}]*overflow: visible/.test(bloco)
    ? ok('modal sem rolagem na impressão (documento longo não é cortado)')
    : falha('modal manteve rolagem — documento longo seria cortado');

  /break-inside: avoid/.test(bloco)
    ? ok('assinatura e rodapé não se partem entre folhas')
    : falha('faltou controle de quebra de página');

  // ---------- o comportamento ----------
  w.abrirModal({
    titulo: 'Relatório de evolução',
    corpo: `<div class="documento"><h1>Relatório de evolução</h1>
      <p>Conteúdo do relatório da criança.</p>
      <div class="assinatura"><div class="linha-assinatura"></div>Profissional</div></div>`,
    rodape: `<button class="btn" data-fechar>Fechar</button>
      <button class="btn btn-primario" id="imprimir">Exportar em PDF</button>`,
    aoAbrir: (f) => f.querySelector('#imprimir').addEventListener('click', () => w.imprimirDocumento(f))
  });
  await espera(100);

  const doc = w.document.querySelector('.documento');
  doc ? ok('documento montado no modal') : falha('documento não apareceu');

  doc.classList.contains('folha-impressa')
    ? falha('o documento já estava marcado antes de imprimir')
    : ok('antes de imprimir, nada está marcado');

  w.document.querySelector('#imprimir').click();
  await espera(300);

  impressoes === 1 ? ok('a impressão foi disparada uma única vez')
    : falha('imprimiu ' + impressoes + ' vez(es)');

  corpoNaHoraDeImprimir?.classes.includes('imprimindo')
    ? ok('no momento da impressão o modo isolado está ativo')
    : falha('imprimiu sem o modo isolado — a lista iria junto na 1ª folha');

  corpoNaHoraDeImprimir?.folhas === 1
    ? ok('exatamente um elemento marcado como folha (só o relatório)')
    : falha(corpoNaHoraDeImprimir?.folhas + ' elementos marcados como folha');

  // depois de imprimir, a tela tem de voltar ao normal
  w.dispatchEvent(new w.Event('afterprint'));
  await espera(100);
  !w.document.body.classList.contains('imprimindo') && !doc.classList.contains('folha-impressa')
    ? ok('terminada a impressão, a tela volta ao normal')
    : falha('a tela ficou presa no modo de impressão');

  // imprimir de novo continua funcionando
  w.document.querySelector('#imprimir').click();
  await espera(300);
  impressoes === 2 && corpoNaHoraDeImprimir.folhas === 1
    ? ok('segunda impressão funciona igual')
    : falha('a segunda impressão falhou');
  w.dispatchEvent(new w.Event('afterprint'));

  // ---------- nenhuma chamada solta a window.print ----------
  const codigoTelas = ['paginas-clinicas.js', 'paginas-gestao.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n');
  const soltas = (codigoTelas.match(/window\.print\(\)/g) || []).length;
  soltas === 0 ? ok('nenhuma tela chama a impressão do navegador diretamente')
    : falha(soltas + ' chamada(s) direta(s) a window.print() ainda imprimem a página toda');

  const usos = (codigoTelas.match(/imprimirDocumento\(/g) || []).length;
  usos >= 2 ? ok('os ' + usos + ' botões de exportar usam a impressão isolada')
    : falha('só ' + usos + ' botão(ões) usam a impressão isolada');

  console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
  process.exit(erros ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
