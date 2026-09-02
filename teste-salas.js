/* Uma criança ocupa UMA sala. A outra pode aparecer indisponível para a mesma
   profissional — mas isso não é a sala estar reservada. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:3000';
let erros = 0;
const ok = (m) => console.log('ok    ' + m);
const falha = (m) => { erros++; console.log('FALHA ' + m); };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const hoje = new Date().toLocaleDateString('en-CA');
const mais = (n) => { const d = new Date(hoje + 'T12:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="raiz"></div><div id="toasts"></div></body></html>',
    { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const nativo = fetch;
  w.fetch = (u, o) => nativo(String(u).startsWith('http') ? u : BASE + u, o);
  w.scrollTo = () => {}; w.print = () => {};

  const fontes = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n;\n');
  const expor = ['App', 'api', 'Token', 'montarMapaVagas', 'rotuloIndisponivel', 'gradeSalas',
    'modalAtendimento', 'fecharModal', 'aviso', 'SALAS'];
  w.eval(fontes + '\n' + expor.map(n => `window.${n}=${n};`).join(''));

  const r = await nativo(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'suporte@psicoaprender.com.br', senha: 'psico123' })
  });
  const { token } = await r.json();
  w.Token.set(token);
  const sessao = await (await nativo(BASE + '/api/sessao?token=' + token)).json();
  w.App.sessao = sessao.usuario; w.App.permissoes = sessao.permissoes; w.App.config = sessao.config;
  const chamar = async (m, u, c) => (await nativo(BASE + u + (u.includes('?') ? '&' : '?') + 'token=' + token,
    { method: m, headers: { 'Content-Type': 'application/json' }, body: c ? JSON.stringify(c) : undefined })).json();

  const profs = await chamar('GET', '/api/profissionais');
  const vanessa = profs.find(p => p.nome.includes('Vanessa'));
  const helen = profs.find(p => p.nome.includes('Helen'));

  const dia = mais(8);
  const luiza = await chamar('POST', '/api/pacientes', { nome: 'TESTE Luiza', data_nascimento: '2016-04-04', profissional_id: vanessa.id, status: 'Ativo' });
  const at = (await chamar('POST', '/api/atendimentos', {
    paciente_id: luiza.id, profissional_id: vanessa.id, data: dia, hora: '10:00',
    sala: 'Sala de atendimento 1', tipo: 'Psicopedagogia'
  }))[0];

  // ---------- o dado ----------
  at.sala === 'Sala de atendimento 1'
    ? ok('o atendimento foi gravado em UMA sala')
    : falha('gravou em: ' + at.sala);

  const todos = await chamar('GET', '/api/atendimentos?data=' + dia);
  todos.filter(a => a.paciente_id === luiza.id).length === 1
    ? ok('existe um único registro na agenda (não dois)')
    : falha('há ' + todos.filter(a => a.paciente_id === luiza.id).length + ' registros para a mesma sessão');

  // ---------- a visão de salas ----------
  const html = w.gradeSalas(dia, todos, []);
  const celulas = html.split('agenda-celula').length - 1;
  const ocorrencias = (html.match(/TESTE Luiza/g) || []).length;
  ocorrencias === 1
    ? ok('na visão de salas a criança aparece em uma coluna só')
    : falha('aparece ' + ocorrencias + ' vezes na grade das salas');

  // ---------- outra profissional continua livre na sala 2 ----------
  const bento = await chamar('POST', '/api/pacientes', { nome: 'TESTE Bento', data_nascimento: '2015-02-02', profissional_id: helen.id, status: 'Ativo' });
  const outro = await chamar('POST', '/api/atendimentos', {
    paciente_id: bento.id, profissional_id: helen.id, data: dia, hora: '10:00',
    sala: 'Sala de atendimento 2', tipo: 'Fonoaudiologia'
  });
  Array.isArray(outro) && outro.length === 1
    ? ok('outra profissional consegue usar a Sala 2 no mesmo horário')
    : falha('a Sala 2 estava travada: ' + JSON.stringify(outro));
  await chamar('DELETE', '/api/atendimentos/' + outro[0].id);

  // ---------- o rótulo do mapa ----------
  w.rotuloIndisponivel({ motivo: 'sala' }) === 'Sala ocupada'
    ? ok('rótulo de sala ocupada está correto')
    : falha('rótulo errado para sala: ' + w.rotuloIndisponivel({ motivo: 'sala' }));
  /profissional ocupada/i.test(w.rotuloIndisponivel({ motivo: 'profissional' }))
    ? ok('quando é a profissional que está ocupada, o mapa diz isso')
    : falha('rótulo confuso: ' + w.rotuloIndisponivel({ motivo: 'profissional' }));
  w.rotuloIndisponivel({ motivo: 'bloqueio' }) === 'Bloqueado'
    ? ok('bloqueio continua identificado como bloqueio')
    : falha('rótulo errado para bloqueio');

  // ---------- o mapa desenhado ----------
  const alvo = w.document.createElement('div');
  w.document.body.appendChild(alvo);
  await w.montarMapaVagas(alvo, { data: dia, duracao: 50, profissional_id: vanessa.id });
  await espera(600);

  const linhas = [...alvo.querySelectorAll('.mapa-linha')];
  const linha10 = linhas.find(l => l.querySelector('.mapa-hora')?.textContent === '10:00');
  const celulas10 = [...linha10.querySelectorAll('.mapa-vaga')];
  celulas10.length === 2 ? ok('as duas salas aparecem na linha das 10:00') : falha('linha com ' + celulas10.length + ' células');

  celulas10[0].classList.contains('ocupada') && celulas10[0].textContent.includes('Sala ocupada')
    ? ok('Sala 1 (onde a criança está) marcada como sala ocupada')
    : falha('Sala 1: "' + celulas10[0].textContent.trim() + '"');

  celulas10[1].classList.contains('indisponivel')
    ? ok('Sala 2 marcada de forma diferente — não é "ocupada"')
    : falha('Sala 2 recebeu a mesma marcação da Sala 1: "' + celulas10[1].className + '"');
  /profissional ocupada/i.test(celulas10[1].textContent)
    ? ok('e explica: a sala está livre, quem não pode é a profissional')
    : falha('Sala 2 sem explicação: "' + celulas10[1].textContent.trim() + '"');

  alvo.querySelector('.mapa-legenda')
    ? ok('o mapa traz legenda explicando as três situações')
    : falha('sem legenda');

  // com outra profissional, a Sala 2 das 10:00 tem de aparecer livre
  const alvo2 = w.document.createElement('div');
  w.document.body.appendChild(alvo2);
  await w.montarMapaVagas(alvo2, { data: dia, duracao: 50, profissional_id: helen.id });
  await espera(600);
  const l2 = [...alvo2.querySelectorAll('.mapa-linha')].find(l => l.querySelector('.mapa-hora')?.textContent === '10:00');
  const c2 = [...l2.querySelectorAll('.mapa-vaga')];
  c2[1].dataset.hora === '10:00'
    ? ok('para outra profissional, a Sala 2 às 10:00 aparece livre e clicável')
    : falha('Sala 2 bloqueada para quem não tem conflito: "' + c2[1].textContent.trim() + '"');
  c2[0].classList.contains('ocupada')
    ? ok('e a Sala 1 continua ocupada para todo mundo')
    : falha('Sala 1 deveria estar ocupada');

  console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
  process.exit(erros ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
