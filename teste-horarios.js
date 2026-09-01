/* Dias e horários habituais: mais de um dia por semana, e o cadastro antigo
   de um dia só continua valendo. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const BASE = 'http://localhost:3000';
let erros = 0;
const ok = (m) => console.log('ok    ' + m);
const falha = (m) => { erros++; console.log('FALHA ' + m); };

async function entrar(email, senha) {
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha })
  });
  const j = await r.json();
  if (!j.token) throw new Error('login falhou: ' + JSON.stringify(j));
  return j.token;
}

(async () => {
  const token = await entrar('suporte@psicoaprender.com.br', 'psico123');
  const chamar = async (metodo, url, corpo) => {
    const r = await fetch(BASE + url + (url.includes('?') ? '&' : '?') + 'token=' + token, {
      method: metodo, headers: { 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    return { status: r.status, corpo: await r.json().catch(() => null) };
  };

  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toasts"></div></body></html>',
    { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (u, o) => fetch(u.startsWith('http') ? u : BASE + u, o);
  w.scrollTo = () => {};

  const arquivos = ['core.js', 'login.js', 'paginas-clinicas.js', 'paginas-gestao.js'];
  const codigo = arquivos.map(a => fs.readFileSync('public/app/' + a, 'utf8')).join('\n;\n');
  const expor = ['App', 'api', 'Token', 'DIAS', 'DIAS_CURTO', 'horariosDe', 'resumoHorarios',
    'modalPaciente', 'abrirModal', 'fecharModal', 'aviso'];
  w.eval(codigo + '\n' + expor.map(n => `window.${n}=${n};`).join(''));

  w.Token.set(token);
  const sessao = await (await fetch(BASE + '/api/sessao?token=' + token)).json();
  w.App.sessao = sessao.usuario; w.App.permissoes = sessao.permissoes; w.App.config = sessao.config;

  // ---- leitura do formato antigo e do novo ----
  const antigo = { dia_semana: 2, horario: '14:00', sala: 'Sala de atendimento 1' };
  const lidoAntigo = w.horariosDe(antigo);
  lidoAntigo.length === 1 && lidoAntigo[0].dia === 2 && lidoAntigo[0].hora === '14:00'
    ? ok('cadastro antigo (um dia só) continua sendo entendido')
    : falha('perdeu o horário do cadastro antigo: ' + JSON.stringify(lidoAntigo));

  const novo = { horarios: [{ dia: 1, hora: '09:00', sala: 'Sala de atendimento 1' }, { dia: 4, hora: '15:00', sala: 'Sala de atendimento 2' }] };
  w.horariosDe(novo).length === 2 ? ok('cadastro novo devolve os dois dias')
    : falha('não leu os dois dias');

  w.horariosDe({}).length === 0 ? ok('paciente sem horário definido não inventa nenhum')
    : falha('inventou horário onde não havia');

  const resumo = w.resumoHorarios(novo);
  resumo === 'Seg 09:00 · Qui 15:00' ? ok('resumo para listas: "' + resumo + '"')
    : falha('resumo saiu errado: "' + resumo + '"');

  // desordenado deve sair em ordem de semana
  const bagunçado = { horarios: [{ dia: 5, hora: '08:00' }, { dia: 1, hora: '10:00' }] };
  w.resumoHorarios(bagunçado) === 'Seg 10:00 · Sex 08:00'
    ? ok('dias fora de ordem são exibidos na ordem da semana')
    : falha('não ordenou: ' + w.resumoHorarios(bagunçado));

  // ---- a tela ----
  await w.modalPaciente();
  await new Promise(r => setTimeout(r, 400));
  const grade = w.document.querySelector('#grade-dias');
  if (!grade) return falha('a grade de dias não apareceu no formulário') || fim();

  const linhas = grade.querySelectorAll('.dia-linha');
  linhas.length === 7 ? ok('os 7 dias da semana estão disponíveis')
    : falha('apareceram ' + linhas.length + ' dias');

  const freq = w.document.querySelector('select[name="frequencia"]');
  const textos = freq ? [...freq.options].map(o => o.textContent) : [];
  textos.includes('Duas vezes por semana') && textos.includes('Três vezes por semana')
    ? ok('frequência oferece duas e três vezes por semana')
    : falha('faltou opção de frequência: ' + textos.join(', '));

  // marcar dois dias
  const seg = grade.querySelector('[data-dia="1"]');
  const qui = grade.querySelector('[data-dia="4"]');
  seg.querySelector('.dia-hora').disabled === true
    ? ok('dia não marcado tem hora bloqueada')
    : falha('hora editável num dia não marcado');

  seg.querySelector('.dia-botao').click();
  seg.classList.contains('ativo') && seg.querySelector('.dia-hora').disabled === false
    ? ok('marcar segunda libera a hora daquele dia')
    : falha('marcar o dia não liberou a hora');

  seg.querySelector('.dia-hora').value = '09:00';
  seg.querySelector('.dia-sala').value = 'Sala de atendimento 1';
  qui.querySelector('.dia-botao').click();

  qui.classList.contains('ativo') && seg.classList.contains('ativo')
    ? ok('segunda e quinta marcadas ao mesmo tempo — o problema relatado')
    : falha('não consegue marcar dois dias');

  qui.querySelector('.dia-hora').value === '09:00'
    ? ok('o segundo dia herda o horário do primeiro (menos digitação)')
    : falha('não repetiu o horário: "' + qui.querySelector('.dia-hora').value + '"');

  qui.querySelector('.dia-hora').value = '15:00';

  // desmarcar limpa
  const sex = grade.querySelector('[data-dia="5"]');
  sex.querySelector('.dia-botao').click();
  sex.querySelector('.dia-hora').value = '11:00';
  sex.querySelector('.dia-botao').click();
  sex.querySelector('.dia-hora').value === '' && sex.querySelector('.dia-hora').disabled
    ? ok('desmarcar o dia limpa o horário (sem horário fantasma)')
    : falha('sobrou horário num dia desmarcado');

  // salvar
  const form = w.document.querySelector('#form-p');
  form.querySelector('[name="nome"]').value = 'TESTE Dois Dias';
  const nasc = form.querySelector('[name="data_nascimento"]') || form.querySelector('[name="nascimento"]');
  if (nasc) nasc.value = '2017-05-20';
  const selFreq = form.querySelector('select[name="frequencia"]');
  if (selFreq) selFreq.value = 'Duas vezes por semana';

  w.document.querySelector('#salvar').click();
  await new Promise(r => setTimeout(r, 700));

  const lista = (await chamar('GET', '/api/pacientes')).corpo;
  const salvo = lista.find(p => p.nome === 'TESTE Dois Dias');
  if (!salvo) return falha('o paciente não foi salvo') || fim();
  ok('paciente salvo');

  Array.isArray(salvo.horarios) && salvo.horarios.length === 2
    ? ok('os dois horários chegaram ao servidor')
    : falha('gravou ' + (salvo.horarios?.length ?? 0) + ' horário(s): ' + JSON.stringify(salvo.horarios));

  const s1 = salvo.horarios?.find(h => h.dia === 1);
  const s4 = salvo.horarios?.find(h => h.dia === 4);
  s1?.hora === '09:00' && s4?.hora === '15:00'
    ? ok('segunda 09:00 e quinta 15:00, cada uma com seu horário')
    : falha('horários trocados: ' + JSON.stringify(salvo.horarios));

  s1?.sala === 'Sala de atendimento 1'
    ? ok('a sala é guardada por dia')
    : falha('sala não foi guardada: ' + JSON.stringify(s1));

  salvo.dia_semana === 1 && salvo.horario === '09:00'
    ? ok('campos antigos espelhados (agenda e relatórios seguem funcionando)')
    : falha('compatibilidade quebrada: dia_semana=' + salvo.dia_semana + ' horario=' + salvo.horario);

  w.resumoHorarios(salvo) === 'Seg 09:00 · Qui 15:00'
    ? ok('a lista de pacientes mostra os dois dias')
    : falha('lista mostra: ' + w.resumoHorarios(salvo));

  // reabrir para editar: os dois dias voltam marcados
  w.document.querySelectorAll('.modal-fundo, .modal').forEach(m => m.remove());
  await w.modalPaciente(salvo);
  await new Promise(r => setTimeout(r, 400));
  const grade2 = w.document.querySelector('#grade-dias');
  const ativos = grade2.querySelectorAll('.dia-linha.ativo');
  ativos.length === 2 ? ok('ao reabrir a ficha, os dois dias voltam marcados')
    : falha('reabriu com ' + ativos.length + ' dia(s) marcado(s)');

  grade2.querySelector('[data-dia="4"] .dia-hora').value === '15:00'
    ? ok('o horário de quinta foi recuperado corretamente')
    : falha('horário de quinta não voltou');

  fim();
  function fim() {
    console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
    process.exit(erros ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
