/* Reposição de sessão: quem desmarcou, o que vira pendência e o que não é cobrado. */
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
  if (!j.token) throw new Error('login falhou: ' + email);
  return j.token;
}
const cliente = (t) => async (metodo, url, corpo) => {
  const r = await fetch(BASE + url + (url.includes('?') ? '&' : '?') + 'token=' + t, {
    method: metodo, headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const somaDias = (iso, n) => {
  const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};
const hoje = new Date().toLocaleDateString('en-CA');

(async () => {
  const admin = cliente(await entrar('suporte@psicoaprender.com.br', 'psico123'));
  const profs = (await admin('GET', '/api/profissionais')).corpo;
  const vanessa = profs.find(p => p.nome.includes('Vanessa'));
  const helen = profs.find(p => p.nome.includes('Helen'));

  const criarPaciente = async (nome, prof) => (await admin('POST', '/api/pacientes', {
    nome, data_nascimento: '2017-06-01', profissional_id: prof.id, status: 'Ativo',
    valor_sessao: 150
  })).corpo;
  const marcar = async (pac, data, hora, sala, prof) => (await admin('POST', '/api/atendimentos', {
    paciente_id: pac.id, profissional_id: (prof || vanessa).id, data, hora,
    sala: sala || 'Sala de atendimento 1', tipo: 'Psicopedagogia', valor: 150
  })).corpo[0];

  // ---------- 1. família avisa e repõe na hora ----------
  const ana = await criarPaciente('TESTE Ana Reposicao', vanessa);
  const orig = await marcar(ana, somaDias(hoje, -3), '14:00');

  await admin('PUT', '/api/atendimentos/' + orig.id, {
    status: 'falta', origem: 'familia', aviso_previo: 'Com antecedência',
    motivo: 'criança adoeceu', reposicao: 'Marcada'
  });
  const rep = await admin('POST', '/api/atendimentos/' + orig.id + '/reposicao', {
    data: somaDias(hoje, 4), hora: '15:00', sala: 'Sala de atendimento 2'
  });
  rep.status === 200 ? ok('reposição criada a partir do atendimento perdido')
    : falha('não criou a reposição: ' + JSON.stringify(rep.corpo));

  const nova = rep.corpo;
  nova.reposicao_de === orig.id ? ok('a reposição sabe de qual sessão veio')
    : falha('vínculo com a original perdido');

  const originalAgora = (await admin('GET', '/api/atendimentos?paciente_id=' + ana.id)).corpo
    .find(a => a.id === orig.id);
  originalAgora.status === 'falta' ? ok('a sessão perdida continua no histórico como falta')
    : falha('o histórico foi sobrescrito: ' + originalAgora.status);
  originalAgora.reposta_por === nova.id ? ok('a original aponta para a reposição')
    : falha('a original não aponta para a reposição');

  Number(nova.valor) === 0
    ? ok('a reposição não gera cobrança nova (a sessão já foi paga)')
    : falha('a reposição veio com valor ' + nova.valor);

  nova.status === 'agendado' ? ok('a reposição entra na agenda como agendada')
    : falha('status inesperado: ' + nova.status);

  const faltas = (await admin('GET', '/api/faltas')).corpo;
  const f1 = faltas.find(f => f.atendimento_id === orig.id);
  f1?.reposicao === 'Marcada' && f1?.reposicao_atendimento_id === nova.id
    ? ok('o histórico de faltas registra que foi reposta')
    : falha('falta não ficou marcada como reposta: ' + JSON.stringify(f1));
  f1?.origem === 'familia' && f1?.motivo === 'criança adoeceu'
    ? ok('quem desmarcou e o motivo ficaram guardados')
    : falha('origem/motivo perdidos');

  // não pode repor duas vezes
  // ---------- a reposição carrega a data e o porquê da sessão perdida ----------
  const naAgenda = (await admin('GET', '/api/atendimentos?paciente_id=' + ana.id)).corpo
    .find(a => a.id === nova.id);
  naAgenda?.origem_reposicao?.data === orig.data
    ? ok('a reposição informa a data do atendimento que não aconteceu (' + orig.data + ')')
    : falha('não trouxe a data original: ' + JSON.stringify(naAgenda?.origem_reposicao));
  naAgenda?.origem_reposicao?.hora === '14:00'
    ? ok('e também o horário original')
    : falha('sem o horário original');
  naAgenda?.origem_reposicao?.motivo === 'criança adoeceu'
    ? ok('o motivo registrado viaja junto (útil ao falar com a família)')
    : falha('motivo não chegou: ' + naAgenda?.origem_reposicao?.motivo);
  naAgenda?.origem_reposicao?.origem === 'familia' && naAgenda?.origem_reposicao?.aviso_previo === 'Com antecedência'
    ? ok('quem desmarcou e se avisou antes também')
    : falha('origem/aviso não chegaram');
  naAgenda?.origem_reposicao?.situacao === 'falta'
    ? ok('e a situação da sessão perdida (falta ou cancelamento)')
    : falha('situação não chegou');

  const originalNaAgenda = (await admin('GET', '/api/atendimentos?paciente_id=' + ana.id)).corpo
    .find(a => a.id === orig.id);
  originalNaAgenda?.destino_reposicao?.data === naAgenda.data
    ? ok('o caminho inverso também: a sessão perdida diz em que dia foi reposta')
    : falha('a original não informa a data da reposição');

  const duplicada = await admin('POST', '/api/atendimentos/' + orig.id + '/reposicao', {
    data: somaDias(hoje, 5), hora: '16:00'
  });
  duplicada.status === 409 ? ok('não deixa marcar duas reposições da mesma sessão')
    : falha('permitiu reposição duplicada: ' + duplicada.status);

  // ---------- 2. profissional desmarca e a reposição fica pendente ----------
  const bruno = await criarPaciente('TESTE Bruno Reposicao', vanessa);
  const orig2 = await marcar(bruno, somaDias(hoje, -25), '09:00');
  await admin('PUT', '/api/atendimentos/' + orig2.id, {
    status: 'cancelado', origem: 'profissional', aviso_previo: 'Com antecedência',
    motivo: 'profissional em formação', reposicao: 'Pendente'
  });

  const f2 = (await admin('GET', '/api/faltas')).corpo.find(f => f.atendimento_id === orig2.id);
  f2?.reposicao === 'Pendente' && f2?.origem === 'profissional'
    ? ok('cancelamento pela profissional também entra no histórico')
    : falha('cancelamento não gerou registro: ' + JSON.stringify(f2));

  const pend = (await admin('GET', '/api/reposicoes-pendentes')).corpo;
  pend.some(x => x.atendimento_id === orig2.id)
    ? ok('aparece na lista de reposições pendentes')
    : falha('não entrou nas pendências');
  pend.find(x => x.atendimento_id === orig2.id)?.dias_espera >= 24
    ? ok('a lista mostra há quantos dias espera')
    : falha('não calculou o tempo de espera');

  const alertas = (await admin('GET', '/api/alertas')).corpo;
  const alertaRep = alertas.find(a => a.tipo === 'reposicao' && a.link.includes('/paciente/' + bruno.id));
  alertaRep ? ok('vira alerta: "' + alertaRep.titulo + '"')
    : falha('não gerou alerta de reposição');
  alertaRep?.prioridade === 'alta'
    ? ok('esperando há mais de 21 dias, o alerta sobe para prioridade alta')
    : falha('prioridade não subiu: ' + alertaRep?.prioridade);
  alertaRep?.detalhe.includes('desmarcada pela profissional')
    ? ok('o alerta diz que a profissional foi quem desmarcou')
    : falha('o alerta não distingue quem desmarcou');

  const doBruno = (await admin('GET', '/api/atendimentos?paciente_id=' + bruno.id)).corpo;
  doBruno.find(a => a.id === orig2.id)?.reposicao_pendente === true
    ? ok('a ficha da criança sinaliza a reposição a marcar')
    : falha('a ficha não sinaliza a pendência');

  // marcar depois: sai da pendência
  const rep2 = await admin('POST', '/api/atendimentos/' + orig2.id + '/reposicao', {
    data: somaDias(hoje, 6), hora: '09:00'
  });
  rep2.status === 200 ? ok('a reposição pendente pode ser marcada depois') : falha('falhou ao marcar depois');
  const pend2 = (await admin('GET', '/api/reposicoes-pendentes')).corpo;
  !pend2.some(x => x.atendimento_id === orig2.id)
    ? ok('depois de marcada, sai da lista de pendências')
    : falha('continuou pendente');
  const alertas2 = (await admin('GET', '/api/alertas')).corpo;
  !alertas2.some(a => a.tipo === 'reposicao' && a.link.includes('/paciente/' + bruno.id))
    ? ok('o alerta some quando a reposição é marcada')
    : falha('o alerta continuou');

  // ---------- 3. sem reposição ----------
  const caio = await criarPaciente('TESTE Caio Reposicao', vanessa);
  const orig3 = await marcar(caio, somaDias(hoje, -2), '11:00');
  await admin('PUT', '/api/atendimentos/' + orig3.id, {
    status: 'falta', origem: 'familia', aviso_previo: 'Sem aviso', reposicao: 'Não'
  });
  const pend3 = (await admin('GET', '/api/reposicoes-pendentes')).corpo;
  !pend3.some(x => x.atendimento_id === orig3.id)
    ? ok('falta sem reposição combinada não vira pendência')
    : falha('criou pendência onde não havia combinação');

  // ---------- 4. a reposição respeita a agenda ----------
  const outra = await criarPaciente('TESTE Ocupa Sala', helen);
  const dataDisputada = somaDias(hoje, 10);
  await marcar(outra, dataDisputada, '08:00', 'Sala de atendimento 1', helen);
  const orig4 = await marcar(caio, somaDias(hoje, -1), '17:00');
  await admin('PUT', '/api/atendimentos/' + orig4.id, { status: 'falta', reposicao: 'Pendente' });
  const conflito = await admin('POST', '/api/atendimentos/' + orig4.id + '/reposicao', {
    data: dataDisputada, hora: '08:00', sala: 'Sala de atendimento 1'
  });
  conflito.status === 409
    ? ok('reposição em sala ocupada é barrada: "' + String(conflito.corpo.erro).slice(0, 50) + '…"')
    : falha('marcou reposição por cima de outra criança');

  // ---------- 5. permissão ----------
  const recepcao = cliente(await entrar('recepcao@psicoaprender.com.br', 'psico123'));
  const podeRecepcao = await recepcao('GET', '/api/reposicoes-pendentes');
  podeRecepcao.status === 200
    ? ok('a recepção acompanha as reposições pendentes (é ela quem liga)')
    : falha('recepção sem acesso às pendências: ' + podeRecepcao.status);

  const outraProf = cliente(await entrar('helen@psicoaprender.com.br', 'psico123'));
  const alheio = await outraProf('POST', '/api/atendimentos/' + orig3.id + '/reposicao', {
    data: somaDias(hoje, 3), hora: '10:00'
  });
  alheio.status === 403
    ? ok('profissional não repõe sessão de paciente de outra colega')
    : falha('vazou entre profissionais: ' + alheio.status);

  console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
  process.exit(erros ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
