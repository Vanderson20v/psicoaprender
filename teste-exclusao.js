/* Confere a exclusão de paciente: quem pode, o que leva junto, o que fica. */
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
  if (!j.token) throw new Error('login falhou: ' + email + ' ' + JSON.stringify(j));
  return j.token;
}
const api = (t) => async (metodo, url, corpo) => {
  const r = await fetch(BASE + url + (url.includes('?') ? '&' : '?') + 'token=' + t, {
    method: metodo, headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  let j = null; try { j = await r.json(); } catch (e) { /* 204 */ }
  return { status: r.status, corpo: j };
};

(async () => {
  const admin = api(await entrar('suporte@psicoaprender.com.br', 'psico123'));
  const profs = (await admin('GET', '/api/profissionais')).corpo;
  const vanessa = profs.find(p => p.nome.includes('Vanessa'));

  // paciente descartável, com rastro em várias coleções
  const pac = (await admin('POST', '/api/pacientes', {
    nome: 'TESTE Exclusao', data_nascimento: '2018-04-02',
    profissional_id: vanessa.id, status: 'Em acompanhamento',
    responsaveis: [{ nome: 'Mãe Teste', telefone: '61999999999', parentesco: 'Mãe' }]
  })).corpo;
  if (!pac.id) return falha('não criou o paciente de teste');
  ok('paciente de teste criado (id ' + pac.id + ')');

  const at = (await admin('POST', '/api/atendimentos', {
    paciente_id: pac.id, profissional_id: vanessa.id, data: '2026-09-10',
    hora_inicio: '08:00', hora_fim: '08:50', sala: 'Sala de atendimento 1',
    tipo: 'Psicopedagogia', status: 'realizado'
  })).corpo;
  await admin('POST', '/api/registros', {
    paciente_id: pac.id, atendimento_id: at.id, profissional_id: vanessa.id,
    data: '2026-09-10', objetivo: 'teste', areas: { atencao: 'evoluindo' }
  });
  await admin('POST', '/api/pagamentos', {
    paciente_id: pac.id, profissional_id: vanessa.id, valor: 150,
    vencimento: '2026-09-15', situacao: 'pendente'
  });
  await admin('POST', '/api/anamneses', {
    paciente_id: pac.id, profissional_id: vanessa.id, data: '2026-09-01',
    respostas: { motivo_1: 'teste' }, plano: { areas: [{ area: 'atencao', objetivo: 'x' }] }
  });
  ok('rastro criado: atendimento, registro, pagamento, anamnese');

  // profissional NÃO pode excluir
  const prof = api(await entrar('vanessa@psicoaprender.com.br', 'psico123'));
  const negado = await prof('DELETE', '/api/pacientes/' + pac.id);
  negado.status === 403
    ? ok('profissional não consegue excluir paciente (403)')
    : falha('profissional excluiu paciente! status ' + negado.status);

  const aindaLa = await admin('GET', '/api/pacientes/' + pac.id);
  aindaLa.status === 200 ? ok('paciente continua lá após a tentativa negada')
    : falha('paciente sumiu depois de um 403');

  // admin pode
  const del = await admin('DELETE', '/api/pacientes/' + pac.id);
  del.status === 200 ? ok('administrador exclui o paciente')
    : falha('admin não conseguiu excluir: ' + del.status);

  const sumiu = await admin('GET', '/api/pacientes/' + pac.id);
  sumiu.status === 404 ? ok('ficha não existe mais (404)')
    : falha('ficha ainda responde: ' + sumiu.status);

  const lista = (await admin('GET', '/api/pacientes')).corpo;
  lista.some(p => p.id === pac.id)
    ? falha('paciente excluído ainda aparece na lista')
    : ok('sumiu da lista de pacientes');

  // o rastro tem de ir junto
  const ats = (await admin('GET', '/api/atendimentos')).corpo;
  ats.some(a => a.paciente_id === pac.id)
    ? falha('sobrou atendimento órfão na agenda')
    : ok('atendimentos apagados junto');

  const pags = (await admin('GET', '/api/pagamentos')).corpo;
  pags.some(x => x.paciente_id === pac.id)
    ? falha('sobrou lançamento financeiro órfão')
    : ok('lançamentos financeiros apagados junto');

  const anams = (await admin('GET', '/api/anamneses')).corpo;
  (anams || []).some(x => x.paciente_id === pac.id)
    ? falha('sobrou anamnese órfã')
    : ok('anamnese apagada junto');

  // e a exclusão fica registrada
  const logs = (await admin('GET', '/api/logs')).corpo || [];
  logs.some(l => l.acao === 'exclusao' && l.entidade === 'pacientes' && String(l.entidade_id) === String(pac.id))
    ? ok('exclusão registrada nos logs de acesso')
    : falha('exclusão não apareceu nos logs');

  // a equipe e as configurações não podem ter sido afetadas
  const equipe = (await admin('GET', '/api/profissionais')).corpo;
  equipe.length === profs.length ? ok('equipe intacta (' + equipe.length + ' profissionais)')
    : falha('a exclusão mexeu na equipe');

  console.log(erros ? '\n' + erros + ' falha(s).' : '\nSem erros.');
  process.exit(erros ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
