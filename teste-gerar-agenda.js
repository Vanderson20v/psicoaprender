/* Reproduz o caso relatado: cadastrar paciente com dias e horários e esperar
   vê-los na agenda. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:3000';
let erros = 0;
const ok = (m) => console.log('ok    ' + m);
const falha = (m) => { erros++; console.log('FALHA ' + m); };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const hojeISO0 = new Date().toLocaleDateString('en-CA');
const somaDiasISO = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

(async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="raiz"></div><div id="toasts"></div></body></html>',
    { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const nativo = fetch;
  w.fetch = (u, o) => nativo(String(u).startsWith('http') ? u : BASE + u, o);
  w.scrollTo = () => {};
  w.print = () => {};

  const fontes = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js']
    .map(f => fs.readFileSync(path.join(__dirname, 'public/app', f), 'utf8')).join('\n;\n');
  const expor = ['App', 'api', 'Token', 'DIAS', 'DIAS_CURTO', 'horariosDe', 'resumoHorarios',
    'modalPaciente', 'modalGerarAgenda', 'abaAgenda', 'fecharModal', 'aviso', 'navegar'];
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
  const vanessa = profs.find(x => x.nome.includes('Vanessa'));

  // ---------- exatamente o que o usuário fez ----------
  await w.modalPaciente();
  await espera(400);
  const form = w.document.querySelector('#form-p');
  form.querySelector('[name="nome"]').value = 'Teste Paciente Vanessa';
  const nasc = form.querySelector('[name="data_nascimento"]') || form.querySelector('[name="nascimento"]');
  if (nasc) nasc.value = '2016-03-14';
  const selProf = form.querySelector('select[name="profissional_id"]');
  if (selProf) selProf.value = vanessa.id;
  form.querySelector('select[name="frequencia"]').value = 'Duas vezes por semana';

  const grade = w.document.querySelector('#grade-dias');
  const marcar = (dia, hora, sala) => {
    const l = grade.querySelector(`[data-dia="${dia}"]`);
    l.querySelector('.dia-botao').click();
    l.querySelector('.dia-hora').value = hora;
    l.querySelector('.dia-sala').value = sala;
  };
  marcar(2, '14:00', 'Sala de atendimento 1');   // terça
  marcar(4, '10:00', 'Sala de atendimento 2');   // quinta
  ok('paciente preenchido com terça 14:00 e quinta 10:00');

  w.document.querySelector('#salvar').click();
  await espera(800);

  // ---------- o sistema tem de OFERECER criar na agenda ----------
  const corpoModal = w.document.body.textContent;
  corpoModal.includes('Criar os horários na agenda')
    ? ok('após salvar, o sistema pergunta se cria os horários na agenda')
    : falha('o sistema salvou e não ofereceu nada — o problema relatado');

  const previa = w.document.querySelector('#ga-previa');
  if (!previa) return falha('não apareceu a prévia dos horários') || fim();
  previa.textContent.includes('Terça às 14:00') && previa.textContent.includes('Quinta às 10:00')
    ? ok('a prévia mostra os dois dias antes de criar qualquer coisa')
    : falha('prévia incompleta: ' + previa.textContent.replace(/\s+/g, ' ').trim());

  const pacientes = await chamar('GET', '/api/pacientes');
  const pac = pacientes.find(p => p.nome === 'Teste Paciente Vanessa');
  const antes = (await chamar('GET', '/api/atendimentos?paciente_id=' + pac.id)).length;
  antes === 0 ? ok('nada foi criado sem a confirmação') : falha('criou ' + antes + ' sem perguntar');

  // a tela confere a agenda sozinha antes de deixar criar
  await espera(600);
  const painelLivre = w.document.querySelector('#ga-conflitos').textContent;
  painelLivre.includes('livres')
    ? ok('a tela confere a agenda e informa que está tudo livre')
    : falha('não conferiu a agenda: "' + painelLivre.trim() + '"');
  w.document.querySelector('#ga-criar').disabled === false
    ? ok('sem conflito, o botão criar fica liberado')
    : falha('botão travado sem motivo');

  // 8 semanas
  w.document.querySelector('#ga-semanas').value = '8';
  w.document.querySelector('#ga-semanas').dispatchEvent(new w.Event('change'));
  await espera(700);
  w.document.querySelector('#ga-criar').click();
  await espera(1800);

  const ats = await chamar('GET', '/api/atendimentos?paciente_id=' + pac.id);
  ats.length === 16
    ? ok('16 atendimentos criados (2 dias × 8 semanas)')
    : falha('criou ' + ats.length + ' atendimentos, esperava 16');

  const tercas = ats.filter(a => new Date(a.data + 'T12:00').getDay() === 2);
  const quintas = ats.filter(a => new Date(a.data + 'T12:00').getDay() === 4);
  tercas.length === 8 && quintas.length === 8
    ? ok('8 terças e 8 quintas, nos dias certos da semana')
    : falha(tercas.length + ' terças e ' + quintas.length + ' quintas');

  tercas.every(a => a.hora === '14:00') && quintas.every(a => a.hora === '10:00')
    ? ok('cada dia manteve o seu horário')
    : falha('horários embaralhados');

  tercas.every(a => a.sala === 'Sala de atendimento 1') && quintas.every(a => a.sala === 'Sala de atendimento 2')
    ? ok('cada dia manteve a sua sala')
    : falha('salas embaralhadas');

  ats.every(a => a.profissional_id === vanessa.id)
    ? ok('todos com a profissional responsável')
    : falha('profissional errada em algum atendimento');

  ats.every(a => a.status === 'agendado')
    ? ok('todos nascem como "agendado"')
    : falha('status inesperado');

  const datas = tercas.map(a => a.data).sort();
  const dif = (new Date(datas[1]) - new Date(datas[0])) / 86400000;
  dif === 7 ? ok('intervalo semanal correto entre as repetições')
    : falha('intervalo de ' + dif + ' dias');

  // ---------- aparece na agenda geral, não só na ficha ----------
  const agendaDia = await chamar('GET', '/api/atendimentos?data=' + tercas[0].data);
  agendaDia.some(a => a.paciente_id === pac.id)
    ? ok('o atendimento aparece na agenda do dia')
    : falha('não apareceu na agenda geral');

  // ---------- conflito: outra criança na mesma sala e horário ----------
  const outro = await chamar('POST', '/api/pacientes', {
    nome: 'TESTE Conflito', data_nascimento: '2015-01-01',
    profissional_id: vanessa.id, status: 'Ativo'
  });
  const conflitante = await chamar('POST', '/api/atendimentos', {
    paciente_id: outro.id, profissional_id: vanessa.id,
    data: tercas[2].data, hora: '14:00', sala: 'Sala de atendimento 1'
  });
  Array.isArray(conflitante) && conflitante.length === 0
    ? ok('a agenda barra o horário já ocupado (nada duplicado)')
    : (conflitante.erro ? ok('a agenda barra o horário ocupado: "' + conflitante.erro.slice(0, 60) + '…"')
      : falha('permitiu dois atendimentos na mesma sala e horário'));

  // ---------- conflito: a tela NÃO pode fechar como se tivesse marcado ----------
  const clara = await chamar('POST', '/api/pacientes', {
    nome: 'TESTE Clara Conflito', data_nascimento: '2016-08-08',
    profissional_id: vanessa.id, status: 'Ativo',
    horarios: [{ dia: 2, hora: '14:00', sala: 'Sala de atendimento 1' }],
    dia_semana: 2, horario: '14:00', sala: 'Sala de atendimento 1'
  });
  w.document.querySelectorAll('.modal-fundo, .modal').forEach(m => m.remove());
  await w.modalGerarAgenda(clara);
  await espera(900);

  const painel = w.document.querySelector('#ga-conflitos');
  const texto = painel.textContent;
  texto.includes('não estão disponíveis') || texto.includes('indisponível')
    ? ok('avisa que os horários não estão disponíveis')
    : falha('não avisou do conflito: "' + texto.trim().slice(0, 90) + '"');

  texto.includes('Teste Paciente Vanessa')
    ? ok('diz quem já ocupa o horário (nome da criança e da profissional)')
    : falha('não informou quem ocupa: "' + texto.replace(/\s+/g, ' ').trim().slice(0, 120) + '"');

  const antesDoConflito = (await chamar('GET', '/api/atendimentos?paciente_id=' + clara.id)).length;
  antesDoConflito === 0 ? ok('nada foi criado enquanto o conflito não é resolvido')
    : falha('criou ' + antesDoConflito + ' atendimento(s) mesmo com conflito');

  w.document.querySelector('.modal-fundo')
    ? ok('a tela continua aberta — não fecha como se tivesse marcado')
    : falha('a tela fechou sozinha, dando a impressão de que agendou');

  const criar = w.document.querySelector('#ga-criar');
  criar.disabled === true
    ? ok('o botão criar fica bloqueado até haver uma decisão')
    : falha('deixou seguir sem decidir nada');

  const aceitar = w.document.querySelector('#ga-aceitar');
  aceitar ? ok('oferece a opção de criar só os livres e deixar os ocupados de fora')
    : falha('não ofereceu saída');

  // marcar a caixa libera o botão
  aceitar.checked = true;
  aceitar.dispatchEvent(new w.Event('change'));
  criar.disabled === false
    ? ok('ao concordar explicitamente, o botão libera')
    : falha('mesmo concordando, o botão continuou travado');

  // desmarcar volta a travar
  aceitar.checked = false;
  aceitar.dispatchEvent(new w.Event('change'));
  criar.disabled === true ? ok('desmarcar volta a travar') : falha('não voltou a travar');

  // mudar a data some com o conflito
  const semConflito = new Date(hojeISO0 + 'T12:00');
  w.document.querySelector('#ga-inicio').value = somaDiasISO(hojeISO0, 200);
  w.document.querySelector('#ga-inicio').dispatchEvent(new w.Event('change'));
  await espera(900);
  w.document.querySelector('#ga-conflitos').textContent.includes('livres')
    ? ok('mudando a data de início, o conflito desaparece e libera')
    : falha('mudar a data não reavaliou a agenda');
  w.document.querySelector('#ga-criar').disabled === false
    ? ok('sem conflito, pode criar direto')
    : falha('continuou travado sem conflito');

  // ---------- gerar de novo, pela ficha, não duplica em silêncio ----------
  const antesRepetir = ats.length;
  const pac2 = await chamar('GET', '/api/pacientes/' + pac.id);
  w.document.querySelectorAll('.modal-fundo, .modal').forEach(m => m.remove());
  await w.modalGerarAgenda(pac2);
  await espera(400);
  w.document.querySelector('#ga-semanas').value = '4';
  w.document.querySelector('#ga-criar').click();
  await espera(1500);
  const depois = await chamar('GET', '/api/atendimentos?paciente_id=' + pac.id);
  depois.length === antesRepetir
    ? ok('gerar de novo não duplica: as datas ocupadas são puladas')
    : (depois.length > antesRepetir
      ? falha('duplicou ' + (depois.length - antesRepetir) + ' atendimento(s)')
      : falha('perdeu atendimentos'));

  fim();
  function fim() {
    console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
    process.exit(erros ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
