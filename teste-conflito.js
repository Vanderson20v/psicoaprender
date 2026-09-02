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

  // ---------- o mapa de vagas: mostrar o que sobra no dia ----------
  const mapa = d3.querySelector('#ds-mapa');
  mapa ? ok('reposição: a tela traz o mapa de horários do dia') : falha('reposição: sem mapa de horários');
  await espera(700);
  const textoMapa = mapa.textContent;
  textoMapa.includes('Horários de')
    ? ok('reposição: o mapa mostra o dia escolhido')
    : falha('reposição: mapa vazio: "' + textoMapa.trim().slice(0, 60) + '"');
  textoMapa.includes('Ocupado')
    ? ok('reposição: as 14:00 aparecem como ocupadas')
    : falha('reposição: não marcou o horário ocupado');
  const vagas = mapa.querySelectorAll('.mapa-vaga[data-hora]');
  vagas.length > 0
    ? ok('reposição: ' + vagas.length + ' vaga(s) livre(s) clicável(is) no dia')
    : falha('reposição: nenhuma vaga clicável');

  // tocar numa vaga preenche hora e sala
  const escolhida = vagas[0];
  escolhida.click();
  await espera(200);
  d3.querySelector('#ds-hora').value === escolhida.dataset.hora
    ? ok('reposição: tocar na vaga preenche o horário (' + escolhida.dataset.hora + ')')
    : falha('reposição: o toque não preencheu o horário');
  d3.querySelector('#ds-sala').value === escolhida.dataset.sala
    ? ok('reposição: e também a sala')
    : falha('reposição: não preencheu a sala');
  (d3.querySelector('#ds-aviso').textContent || '').includes('não está disponível')
    ? falha('reposição: o erro antigo continuou depois de escolher outra vaga')
    : ok('reposição: o aviso de erro some ao escolher uma vaga livre');

  d3.querySelector('#ds-abrir-agenda')
    ? ok('reposição: existe atalho para ver a agenda completa do dia')
    : falha('reposição: sem atalho para a agenda');

  // agora confirma e deve funcionar
  d3.querySelector('#ds-salvar').click();
  await espera(1200);
  !w.document.querySelector('.modal-fundo')
    ? ok('reposição: escolhendo vaga livre, a tela fecha e a reposição é criada')
    : falha('reposição: não concluiu mesmo com vaga livre');

  const depois = (await chamar('GET', '/api/atendimentos?paciente_id=' + pacB.id));
  const reposicoes = depois.filter(a => a.reposicao_de);
  reposicoes.length === 1 && reposicoes[0].hora === escolhida.dataset.hora
    ? ok('reposição: criada no horário livre escolhido, não em cima de ninguém')
    : falha('reposição: ' + reposicoes.length + ' reposição(ões) em horário inesperado');

  const origDepois = depois.find(a => a.id === orig.id);
  origDepois.status === 'falta'
    ? ok('reposição: só então a falta é registrada')
    : falha('reposição: a falta não foi registrada ao concluir');

  fim();
  function fim() {
    console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
    process.exit(erros ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
