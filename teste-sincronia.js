/* Alterar os dias no cadastro tem de conversar com a agenda já marcada. */
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
const diaDaSemana = (iso) => new Date(iso + 'T12:00').getDay();

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="raiz"></div><div id="toasts"></div></body></html>',
    { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const nativo = fetch;
  w.fetch = (u, o) => nativo(String(u).startsWith('http') ? u : BASE + u, o);
  w.scrollTo = () => {}; w.print = () => {};

  const fontes = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n;\n');
  const expor = ['App', 'api', 'Token', 'modalPaciente', 'modalGerarAgenda', 'horariosDe',
    'conferirAgendaDoPaciente', 'fecharModal', 'aviso', 'navegar', 'DIAS'];
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

  // Rogério: segunda 10:00, com agenda criada
  const proximaSegunda = (() => { let d = mais(1); while (diaDaSemana(d) !== 1) d = mais((new Date(d + 'T12:00') - new Date(hoje + 'T12:00')) / 86400000 + 1); return d; })();
  const rogerio = await chamar('POST', '/api/pacientes', {
    nome: 'Rogerio (Teste)', data_nascimento: '2015-07-07', profissional_id: vanessa.id,
    status: 'Ativo', frequencia: 'Semanal', valor_sessao: 150,
    horarios: [{ dia: 1, hora: '10:00', sala: 'Sala de atendimento 1' }],
    dia_semana: 1, horario: '10:00', sala: 'Sala de atendimento 1'
  });
  await chamar('POST', '/api/atendimentos', {
    paciente_id: rogerio.id, profissional_id: vanessa.id, data: proximaSegunda, hora: '10:00',
    sala: 'Sala de atendimento 1', tipo: 'Psicopedagogia', recorrente: true, repeticoes: 6, intervalo: 'semanal'
  });
  // uma sessão passada já realizada e uma falta: não podem ser tocadas
  const passada = (await chamar('POST', '/api/atendimentos', {
    paciente_id: rogerio.id, profissional_id: vanessa.id, data: mais(-7), hora: '10:00',
    sala: 'Sala de atendimento 1', tipo: 'Psicopedagogia'
  }))[0];
  await chamar('PUT', '/api/atendimentos/' + passada.id, { status: 'realizado' });

  const antes = await chamar('GET', '/api/atendimentos?paciente_id=' + rogerio.id);
  ok('Rogério criado com ' + antes.length + ' horários (6 futuros + 1 realizado)');

  // ---------- retirar o dia no cadastro ----------
  const atual = await chamar('GET', '/api/pacientes/' + rogerio.id);
  await w.modalPaciente(atual);
  await espera(500);
  const grade = w.document.querySelector('#grade-dias');
  const seg = grade.querySelector('[data-dia="1"]');
  seg.classList.contains('ativo') ? ok('a ficha reabre com segunda marcada') : falha('não reabriu marcada');
  seg.querySelector('.dia-botao').click();          // desmarca segunda
  !seg.classList.contains('ativo') ? ok('segunda desmarcada no cadastro') : falha('não desmarcou');

  w.document.querySelector('#salvar').click();
  await espera(1200);

  const salvo = await chamar('GET', '/api/pacientes/' + rogerio.id);
  (salvo.horarios || []).length === 0
    ? ok('o cadastro foi salvo sem dias habituais')
    : falha('o cadastro manteve ' + salvo.horarios.length + ' horário(s)');

  // ---------- o sistema tem de avisar da divergência ----------
  const modal = w.document.querySelector('.modal-fundo');
  modal ? ok('o sistema avisa que a agenda ficou diferente do cadastro')
    : falha('salvou calado — a agenda continuaria com o horário antigo');

  const texto = modal?.textContent || '';
  texto.includes('Segunda às 10:00')
    ? ok('diz qual combinação foi retirada')
    : falha('não diz o que mudou: "' + texto.replace(/\s+/g, ' ').trim().slice(0, 100) + '"');
  /6 horário\(s\)/.test(texto)
    ? ok('conta os 6 horários futuros que sobraram na agenda')
    : falha('contagem errada: "' + texto.replace(/\s+/g, ' ').trim().slice(0, 120) + '"');

  const aindaLa = await chamar('GET', '/api/atendimentos?paciente_id=' + rogerio.id);
  aindaLa.length === antes.length
    ? ok('nada foi apagado antes da decisão')
    : falha('apagou sozinho ' + (antes.length - aindaLa.length) + ' horário(s)');

  modal.querySelector('#ag-manter') && modal.querySelector('#ag-remover')
    ? ok('oferece manter ou remover — a decisão é da profissional')
    : falha('não oferece as duas saídas');

  // ---------- remover ----------
  modal.querySelector('#ag-remover').click();
  await espera(2500);

  const depois = await chamar('GET', '/api/atendimentos?paciente_id=' + rogerio.id);
  depois.length === 1
    ? ok('os 6 horários futuros saíram da agenda')
    : falha('sobraram ' + depois.length + ' atendimentos (esperado 1)');

  depois[0]?.status === 'realizado' && depois[0]?.data === mais(-7)
    ? ok('a sessão já realizada foi preservada (histórico intacto)')
    : falha('mexeu no histórico: ' + JSON.stringify(depois.map(a => [a.data, a.status])));

  // ---------- manter: a outra saída ----------
  const bia = await chamar('POST', '/api/pacientes', {
    nome: 'TESTE Bia Manter', data_nascimento: '2016-09-09', profissional_id: vanessa.id,
    status: 'Ativo', horarios: [{ dia: 3, hora: '08:00', sala: 'Sala de atendimento 2' }],
    dia_semana: 3, horario: '08:00', sala: 'Sala de atendimento 2'
  });
  let quarta = mais(1); while (diaDaSemana(quarta) !== 3) quarta = mais(Math.round((new Date(quarta + 'T12:00') - new Date(hoje + 'T12:00')) / 86400000) + 1);
  await chamar('POST', '/api/atendimentos', {
    paciente_id: bia.id, profissional_id: vanessa.id, data: quarta, hora: '08:00',
    sala: 'Sala de atendimento 2', tipo: 'Psicopedagogia', recorrente: true, repeticoes: 3
  });
  w.document.querySelectorAll('.modal-fundo').forEach(m => m.remove());
  const assumiu = await w.conferirAgendaDoPaciente(
    await chamar('GET', '/api/pacientes/' + bia.id),
    [{ dia: 3, hora: '08:00', sala: 'Sala de atendimento 2' }],
    []);
  await espera(400);
  assumiu === true ? ok('a conferência assume a conversa quando há divergência')
    : falha('não assumiu');
  w.document.querySelector('#ag-manter').click();
  await espera(600);
  (await chamar('GET', '/api/atendimentos?paciente_id=' + bia.id)).length === 3
    ? ok('escolhendo manter, a agenda fica como estava')
    : falha('removeu mesmo tendo escolhido manter');

  // ---------- reposição nunca é removida ----------
  const caio = await chamar('POST', '/api/pacientes', {
    nome: 'TESTE Caio Reposicao Preservada', data_nascimento: '2015-05-05',
    profissional_id: vanessa.id, status: 'Ativo',
    horarios: [{ dia: 5, hora: '13:00', sala: 'Sala de atendimento 1' }],
    dia_semana: 5, horario: '13:00', sala: 'Sala de atendimento 1'
  });
  let sexta = mais(1); while (diaDaSemana(sexta) !== 5) sexta = mais(Math.round((new Date(sexta + 'T12:00') - new Date(hoje + 'T12:00')) / 86400000) + 1);
  const perdida = (await chamar('POST', '/api/atendimentos', {
    paciente_id: caio.id, profissional_id: vanessa.id, data: mais(-3), hora: '13:00',
    sala: 'Sala de atendimento 1', tipo: 'Psicopedagogia'
  }))[0];
  await chamar('PUT', '/api/atendimentos/' + perdida.id, { status: 'falta', reposicao: 'Marcada' });
  await chamar('POST', '/api/atendimentos/' + perdida.id + '/reposicao', {
    data: sexta, hora: '13:00', sala: 'Sala de atendimento 1'
  });
  w.document.querySelectorAll('.modal-fundo').forEach(m => m.remove());
  const assumiu2 = await w.conferirAgendaDoPaciente(
    await chamar('GET', '/api/pacientes/' + caio.id),
    [{ dia: 5, hora: '13:00', sala: 'Sala de atendimento 1' }], []);
  await espera(400);
  if (assumiu2 && w.document.querySelector('#ag-remover')) {
    w.document.querySelector('#ag-remover').click();
    await espera(1200);
  }
  const doCaio = await chamar('GET', '/api/atendimentos?paciente_id=' + caio.id);
  doCaio.some(a => a.reposicao_de)
    ? ok('a reposição combinada não é removida junto')
    : falha('apagou a reposição da criança');
  doCaio.some(a => a.status === 'falta')
    ? ok('a falta registrada continua no histórico')
    : falha('apagou o registro da falta');

  // ---------- sem mudança, sem incômodo ----------
  const semMudanca = await w.conferirAgendaDoPaciente(
    await chamar('GET', '/api/pacientes/' + bia.id),
    [{ dia: 3, hora: '08:00' }], [{ dia: 3, hora: '08:00' }]);
  semMudanca === false ? ok('cadastro salvo sem mexer nos dias não incomoda ninguém')
    : falha('abriu conversa sem necessidade');

  console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
  process.exit(erros ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
