/* Conflito de horário: em NENHUM caminho a tela pode fechar e seguir. */
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
  const expor = ['App', 'api', 'Token', 'modalAtendimento', 'modalGerarAgenda', 'modalDetalheAtendimento',
    'modalDesmarcar', 'fecharModal', 'aviso', 'navegar'];
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

  // conta as navegações: "foi para a próxima tela" é exatamente isto
  let navegou = 0;
  const navegarReal = w.navegar;
  w.navegar = (...a) => { navegou++; return navegarReal?.(...a); };
  w.eval('navegar = window.navegar;');

  const profs = await chamar('GET', '/api/profissionais');
  const vanessa = profs.find(p => p.nome.includes('Vanessa'));
  const pacA = await chamar('POST', '/api/pacientes', { nome: 'TESTE Ocupante', data_nascimento: '2016-01-01', profissional_id: vanessa.id, status: 'Ativo' });
  const pacB = await chamar('POST', '/api/pacientes', { nome: 'TESTE Segundo', data_nascimento: '2016-02-02', profissional_id: vanessa.id, status: 'Ativo' });

  const dia = mais(9);
  await chamar('POST', '/api/atendimentos', {
    paciente_id: pacA.id, profissional_id: vanessa.id, data: dia, hora: '14:00',
    sala: 'Sala de atendimento 1', tipo: 'Psicopedagogia'
  });
  ok('horário das 14:00 ocupado por TESTE Ocupante');

  // ---------- CAMINHO 1: agendamento avulso pela Agenda ----------
  navegou = 0;
  await w.modalAtendimento({ data: dia });
  await espera(600);
  const f = w.document.querySelector('.modal-fundo');
  if (!f) return falha('o modal de atendimento não abriu') || fim();

  const form = f.querySelector('#form-at');
  form.querySelector('[name="paciente_id"]').value = pacB.id;
  form.querySelector('[name="data"]').value = dia;
  form.querySelector('[name="hora"]').value = '14:00';
  const salaSel = form.querySelector('[name="sala"]');
  if (salaSel) salaSel.value = 'Sala de atendimento 1';
  form.reportValidity = () => true;

  f.querySelector('#salvar').click();
  await espera(900);

  w.document.querySelector('.modal-fundo')
    ? ok('avulso: a tela continua aberta depois do conflito')
    : falha('avulso: a tela FECHOU — parece que agendou');

  navegou === 0 ? ok('avulso: não foi para a próxima tela')
    : falha('avulso: navegou ' + navegou + ' vez(es) mesmo com conflito');

  const textoErro = f.querySelector('#at-aviso')?.textContent || '';
  textoErro.includes('ocupada') || textoErro.includes('ocupado')
    ? ok('avulso: o impedimento aparece DENTRO da tela')
    : falha('avulso: o aviso não apareceu dentro da tela: "' + textoErro.trim() + '"');

  textoErro.includes('TESTE Ocupante')
    ? ok('avulso: diz qual criança já ocupa o horário')
    : falha('avulso: não nomeia o ocupante: "' + textoErro.trim().slice(0, 80) + '"');

  const criadosErrados = (await chamar('GET', '/api/atendimentos?paciente_id=' + pacB.id)).length;
  criadosErrados === 0 ? ok('avulso: nada foi criado')
    : falha('avulso: criou ' + criadosErrados + ' atendimento(s) em cima de outra criança');

  // corrigir o horário na mesma tela deve funcionar
  form.querySelector('[name="hora"]').value = '16:00';
  f.querySelector('#salvar').click();
  await espera(900);
  const agora = await chamar('GET', '/api/atendimentos?paciente_id=' + pacB.id);
  agora.length === 1 && agora[0].hora === '16:00'
    ? ok('avulso: corrigindo o horário na mesma tela, o agendamento é criado')
    : falha('avulso: não criou após a correção: ' + JSON.stringify(agora.map(a => a.hora)));
  !w.document.querySelector('.modal-fundo')
    ? ok('avulso: aí sim a tela fecha')
    : falha('avulso: a tela ficou aberta mesmo dando certo');

  // ---------- CAMINHO 2: série de horários habituais ----------
  const pacC = await chamar('POST', '/api/pacientes', {
    nome: 'TESTE Serie', data_nascimento: '2016-03-03', profissional_id: vanessa.id, status: 'Ativo',
    horarios: [{ dia: new Date(dia + 'T12:00').getDay(), hora: '14:00', sala: 'Sala de atendimento 1' }]
  });
  navegou = 0;
  w.document.querySelectorAll('.modal-fundo').forEach(m => m.remove());
  await w.modalGerarAgenda(pacC);
  await espera(1000);
  const g = w.document.querySelector('.modal-fundo');
  g ? ok('série: a tela abriu') : falha('série: não abriu');

  const painel = g.querySelector('#ga-conflitos')?.textContent || '';
  painel.includes('não estão disponíveis')
    ? ok('série: mostra o conflito dentro da tela')
    : falha('série: não mostrou conflito: "' + painel.trim().slice(0, 80) + '"');
  g.querySelector('#ga-criar').disabled === true
    ? ok('série: botão bloqueado até decidir')
    : falha('série: deixou criar direto');
  navegou === 0 ? ok('série: não navegou') : falha('série: navegou sozinho');
  (await chamar('GET', '/api/atendimentos?paciente_id=' + pacC.id)).length === 0
    ? ok('série: nada criado') : falha('série: criou sem confirmação');

  // ---------- CAMINHO 3: reposição em horário ocupado ----------
  const orig = (await chamar('POST', '/api/atendimentos', {
    paciente_id: pacB.id, profissional_id: vanessa.id, data: mais(-4), hora: '09:00',
    sala: 'Sala de atendimento 1', tipo: 'Psicopedagogia'
  }))[0];
  navegou = 0;
  w.document.querySelectorAll('.modal-fundo').forEach(m => m.remove());
  await w.modalDesmarcar(orig, pacB, 'falta');
  await espera(500);
  const d3 = w.document.querySelector('.modal-fundo');
  d3.querySelector('#ds-data').value = dia;      // data e hora já ocupadas
  d3.querySelector('#ds-hora').value = '14:00';
  d3.querySelector('#ds-sala').value = 'Sala de atendimento 1';
  d3.querySelector('#ds-salvar').click();
  await espera(900);

  w.document.querySelector('.modal-fundo')
    ? ok('reposição: a tela continua aberta depois do conflito')
    : falha('reposição: a tela FECHOU com o conflito');
  navegou === 0 ? ok('reposição: não foi para a próxima tela')
    : falha('reposição: navegou ' + navegou + ' vez(es)');

  const painel3 = d3.querySelector('#ds-aviso')?.textContent || '';
  painel3.includes('ocupada') || painel3.includes('ocupado')
    ? ok('reposição: o impedimento aparece dentro da tela')
    : falha('reposição: impedimento só no rodapé, não na tela: "' + painel3.trim().slice(0, 70) + '"');

  const depois = (await chamar('GET', '/api/atendimentos?paciente_id=' + pacB.id));
  depois.filter(a => a.reposicao_de).length === 0
    ? ok('reposição: nenhuma reposição criada em cima de outra criança')
    : falha('reposição: criou por cima');

  const origDepois = depois.find(a => a.id === orig.id);
  origDepois.status !== 'falta'
    ? ok('reposição: a falta não é registrada antes de a data ser aceita')
    : falha('reposição: registrou a falta mesmo sem conseguir marcar a reposição');

  fim();
  function fim() {
    console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
    process.exit(erros ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
