/**
 * PsicoAprender Gestão — API
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { seed, AREAS, ROTEIRO_ANAMNESE } = require('./seed');
const A = require('./auth');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

const hojeISO = () => new Date().toISOString().slice(0, 10);
const fim2 = (hora, duracao = 50) => {
  const t = Number(String(hora).slice(0, 2)) * 60 + Number(String(hora).slice(3, 5)) + Number(duracao || 50);
  return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

/* ---------------- Salas e verificação de conflitos ---------------- */
const salas = () => db.config.get().salas || ['Sala de atendimento 1', 'Sala de atendimento 2'];
const minutos = (hhmm) => (Number(String(hhmm).slice(0, 2)) * 60) + Number(String(hhmm).slice(3, 5));
const fim = (hora, duracao) => minutos(hora) + (Number(duracao) || 50);
const cruza = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/**
 * Verifica se um horário está livre. Retorna null quando livre ou
 * um objeto descrevendo o impedimento (sala ocupada, profissional ocupada
 * ou bloqueio de agenda), sempre informando por quem.
 */
function conflitoDeAgenda({ data, hora, duracao = 50, sala, profissional_id, ignorar_id, ignorar_recorrencia, usuario }) {
  /* Quem não acompanha aquele paciente não precisa saber de quem é o horário:
     basta saber que está ocupado e com qual profissional. */
  const nomeVisivel = (paciente) =>
    (!usuario || A.podeVerPaciente(usuario, paciente)) ? (paciente?.nome || 'paciente') : 'atendimento reservado';
  const ini = minutos(hora), termino = fim(hora, duracao);
  const doDia = db.atendimentos.find({ data }).filter(a =>
    !['cancelado', 'falta'].includes(a.status) &&
    a.id !== Number(ignorar_id) &&
    (!ignorar_recorrencia || a.recorrencia_id !== ignorar_recorrencia));

  for (const a of doDia) {
    if (!cruza(ini, termino, minutos(a.hora), fim(a.hora, a.duracao))) continue;
    const paciente = db.pacientes.byId(a.paciente_id);
    const profissional = db.profissionais.byId(a.profissional_id);
    if (sala && a.sala === sala) {
      return {
        motivo: 'sala',
        mensagem: `${sala} já está ocupada em ${data.split('-').reverse().join('/')} às ${a.hora} — ${nomeVisivel(paciente)} com ${profissional?.nome || 'profissional'}.`,
        atendimento: { id: a.id, hora: a.hora, duracao: a.duracao, sala: a.sala, paciente: nomeVisivel(paciente), profissional: profissional?.nome }
      };
    }
    if (profissional_id && a.profissional_id === Number(profissional_id)) {
      return {
        motivo: 'profissional',
        mensagem: `${profissional?.nome || 'A profissional'} já tem atendimento em ${data.split('-').reverse().join('/')} às ${a.hora} (${nomeVisivel(paciente)}, ${a.sala || 'sem sala'}).`,
        atendimento: { id: a.id, hora: a.hora, duracao: a.duracao, sala: a.sala, paciente: nomeVisivel(paciente), profissional: profissional?.nome }
      };
    }
  }

  for (const b of db.bloqueios.find({ data })) {
    if (!cruza(ini, termino, minutos(b.hora_inicio), minutos(b.hora_fim))) continue;
    const mesmaSala = !b.sala || b.sala === sala;
    const mesmaProf = !b.profissional_id || b.profissional_id === Number(profissional_id);
    if (mesmaSala && mesmaProf) {
      return {
        motivo: 'bloqueio',
        mensagem: `Horário bloqueado (${b.tipo}${b.motivo ? ' — ' + b.motivo : ''}) das ${b.hora_inicio} às ${b.hora_fim}${b.sala ? ' na ' + b.sala : ''}.`,
        bloqueio: b
      };
    }
  }
  return null;
}


/* ============================ AUTENTICAÇÃO ============================ */

app.post('/api/login', (req, res) => {
  const { email, senha } = req.body || {};
  const usuario = db.usuarios.findOne({ email: (email || '').trim().toLowerCase() });
  if (!usuario || !usuario.ativo || !A.conferirSenha(senha || '', usuario.senha)) {
    db.logs.insert({ usuario_id: null, usuario_nome: email || '—', acao: 'login_falhou', entidade: 'usuarios', ip: req.ip });
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }
  const { token, expira } = A.criarSessao(usuario, req);
  db.usuarios.update(usuario.id, { ultimo_acesso: new Date().toISOString() });
  // Cookie httpOnly quando possível; em contexto de iframe/HTTPS usa SameSite=None.
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('pa_sessao', token, seguro
    ? { httpOnly: true, sameSite: 'none', secure: true, maxAge: 12 * 3600e3 }
    : { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600e3 });
  req.usuario = usuario;
  A.registrarLog(req, 'login', 'usuarios', usuario.id);
  // O token também é devolvido para clientes onde o cookie de terceiros é bloqueado.
  res.json({ ok: true, expira, token });
});

app.post('/api/logout', (req, res) => {
  const u = A.usuarioDaRequisicao(req);
  if (u) { db.sessoes.removeWhere({ token: u._token }); req.usuario = u; A.registrarLog(req, 'logout', 'usuarios', u.id); }
  res.clearCookie('pa_sessao');
  res.json({ ok: true });
});

app.post('/api/recuperar-senha', (req, res) => {
  const usuario = db.usuarios.findOne({ email: (req.body?.email || '').trim().toLowerCase() });
  if (usuario) {
    const codigo = Math.random().toString(36).slice(2, 8).toUpperCase();
    db.usuarios.update(usuario.id, { recuperacao: { codigo, expira: new Date(Date.now() + 3600e3).toISOString() } });
    db.logs.insert({ usuario_id: usuario.id, usuario_nome: usuario.nome, acao: 'recuperacao_solicitada', entidade: 'usuarios', entidade_id: usuario.id, ip: req.ip });
    // Em produção: envio por e-mail. Em ambiente local, o código é exibido ao administrador.
    return res.json({ ok: true, aviso: 'Código gerado. Solicite ao administrador da clínica.', codigo_demo: codigo });
  }
  res.json({ ok: true, aviso: 'Se o e-mail estiver cadastrado, o código de recuperação será enviado.' });
});

app.post('/api/redefinir-senha', (req, res) => {
  const { email, codigo, senha } = req.body || {};
  const usuario = db.usuarios.findOne({ email: (email || '').trim().toLowerCase() });
  if (!usuario?.recuperacao || usuario.recuperacao.codigo !== (codigo || '').toUpperCase() || usuario.recuperacao.expira < new Date().toISOString())
    return res.status(400).json({ erro: 'Código inválido ou expirado.' });
  if (!senha || senha.length < 6) return res.status(400).json({ erro: 'A senha deve ter ao menos 6 caracteres.' });
  db.usuarios.update(usuario.id, { senha: A.hashSenha(senha), recuperacao: null });
  db.logs.insert({ usuario_id: usuario.id, usuario_nome: usuario.nome, acao: 'senha_redefinida', entidade: 'usuarios', entidade_id: usuario.id, ip: req.ip });
  res.json({ ok: true });
});

app.get('/api/sessao', (req, res) => {
  const u = A.usuarioDaRequisicao(req);
  if (!u) return res.status(401).json({ erro: 'sem sessão' });
  const p = u.profissional_id ? db.profissionais.byId(u.profissional_id) : null;
  res.json({
    usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel, profissional_id: u.profissional_id, profissional: p, trocar_senha: !!u.trocar_senha },
    permissoes: A.permissoesDe(u),
    config: db.config.get()
  });
});

app.use('/api', A.exigirLogin);

/* Troca da própria senha. Usado tanto na troca obrigatória do primeiro acesso
   quanto quando a profissional quiser mudar depois, em Minha conta. */
app.post('/api/minha-senha', (req, res) => {
  const u = A.usuarioDaRequisicao(req);
  const { atual, nova } = req.body || {};
  if (!A.conferirSenha(atual || '', u.senha)) {
    return res.status(400).json({ erro: 'A senha atual está incorreta.' });
  }
  if (!nova || nova.length < 6) {
    return res.status(400).json({ erro: 'A nova senha deve ter ao menos 6 caracteres.' });
  }
  if (nova === atual) {
    return res.status(400).json({ erro: 'A nova senha precisa ser diferente da atual.' });
  }
  db.usuarios.update(u.id, { senha: A.hashSenha(nova), trocar_senha: false, recuperacao: null });
  A.registrarLog(req, 'senha_alterada', 'usuarios', u.id);
  res.json({ ok: true });
});

/* ============================ HELPERS ============================ */

const idade = (nasc) => {
  if (!nasc) return '';
  const d = new Date(nasc + 'T12:00:00'), h = new Date();
  let a = h.getFullYear() - d.getFullYear();
  const m = h.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && h.getDate() < d.getDate())) a--;
  return a;
};

function resumoFinanceiroPaciente(id) {
  const pg = db.pagamentos.find({ paciente_id: id });
  const hoje = hojeISO();
  let aberto = 0, atraso = 0, pago = 0;
  pg.forEach(p => {
    if (p.status === 'pago') pago += num(p.valor);
    else if (p.status === 'cancelado') return;
    else {
      aberto += num(p.valor);
      if (p.vencimento < hoje) atraso += num(p.valor);
    }
  });
  return { aberto, atraso, pago, situacao: atraso > 0 ? 'Em atraso' : aberto > 0 ? 'Pendente' : 'Em dia' };
}

function enriquecerPaciente(p, perm) {
  const hoje = hojeISO();
  const ats = db.atendimentos.find({ paciente_id: p.id }).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  const proximo = ats.find(a => a.data >= hoje && ['agendado', 'confirmado'].includes(a.status)) || null;
  const ultimo = [...ats].reverse().find(a => a.status === 'realizado') || null;
  const resp = db.responsaveis.find({ paciente_id: p.id });
  const prof = db.profissionais.byId(p.profissional_id);
  const docs = db.documentos.find({ paciente_id: p.id });
  const obrig = ['Termo de consentimento', 'Contrato'];
  const documentacao = obrig.every(c => docs.some(d => d.categoria === c)) ? 'completa' : 'pendente';
  const out = {
    ...p, idade: idade(p.nascimento), responsaveis: resp, profissional: prof,
    proximo_atendimento: proximo, ultimo_atendimento: ultimo,
    total_atendimentos: ats.filter(a => a.status === 'realizado').length,
    documentacao, financeiro: resumoFinanceiroPaciente(p.id)
  };
  const anam = db.anamneses.findOne({ paciente_id: p.id });
  out.anamnese = anam ? { id: anam.id, data: anam.data, concluida: !!anam.concluida } : null;
  if (!perm?.clinico) { delete out.queixa; delete out.objetivo; delete out.observacoes_iniciais; delete out.encaminhamento; delete out.anamnese; }
  return out;
}

/* ============================ PACIENTES ============================ */

app.get('/api/pacientes', (req, res) => {
  const lista = A.pacientesVisiveis(req.usuario).map(p => enriquecerPaciente(p, req.perm));
  res.json(lista.sort((a, b) => a.nome.localeCompare(b.nome)));
});

app.get('/api/pacientes/:id', (req, res) => {
  const p = db.pacientes.byId(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Paciente não encontrado.' });
  if (!A.podeVerPaciente(req.usuario, p)) return res.status(403).json({ erro: 'Sem acesso a este paciente.' });
  A.registrarLog(req, 'consulta', 'pacientes', p.id, p.nome);
  res.json(enriquecerPaciente(p, req.perm));
});

app.post('/api/pacientes', A.exigir('pacientes'), (req, res) => {
  const { responsaveis = [], ...dados } = req.body || {};
  if (!dados.nome) return res.status(400).json({ erro: 'Informe o nome do paciente.' });
  const p = db.pacientes.insert({ ...dados, criado_por: req.usuario.nome });
  responsaveis.forEach((r, i) => db.responsaveis.insert({ ...r, paciente_id: p.id, principal: i === 0 }));
  A.registrarLog(req, 'criacao', 'pacientes', p.id, p.nome);
  res.json(enriquecerPaciente(p, req.perm));
});

app.put('/api/pacientes/:id', A.exigir('pacientes'), (req, res) => {
  const atual = db.pacientes.byId(req.params.id);
  if (!A.podeVerPaciente(req.usuario, atual)) return res.status(403).json({ erro: 'Sem acesso.' });
  const { responsaveis, ...dados } = req.body || {};
  const p = db.pacientes.update(atual.id, dados);
  if (Array.isArray(responsaveis)) {
    db.responsaveis.removeWhere({ paciente_id: p.id });
    responsaveis.forEach((r, i) => db.responsaveis.insert({ ...r, paciente_id: p.id, principal: i === 0 }));
  }
  A.registrarLog(req, 'alteracao', 'pacientes', p.id, p.nome);
  res.json(enriquecerPaciente(p, req.perm));
});

app.delete('/api/pacientes/:id', (req, res) => {
  if (req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem excluir pacientes.' });
  const p = db.pacientes.byId(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Não encontrado.' });
  db.pacientes.remove(p.id);
  ['responsaveis', 'atendimentos', 'registros', 'pagamentos', 'documentos', 'relatorios', 'faltas', 'anamneses']
    .forEach(c => db[c].removeWhere({ paciente_id: p.id }));
  A.registrarLog(req, 'exclusao', 'pacientes', p.id, p.nome);
  res.json({ ok: true });
});

/* ============================ AGENDA ============================ */

function enriquecerAtendimento(a) {
  const p = db.pacientes.byId(a.paciente_id);
  return {
    ...a,
    paciente: p ? { id: p.id, nome: p.nome, nascimento: p.nascimento } : null,
    profissional: db.profissionais.byId(a.profissional_id),
    tem_registro: !!db.registros.findOne({ atendimento_id: a.id }),
    /* Combinaram repor, mas a data ainda não foi definida. */
    reposicao_pendente: db.faltas.findOne({ atendimento_id: a.id, reposicao: 'Pendente' }) ? true : false,
    /* Os dois lados do vínculo carregam a data (e o porquê) da sessão perdida:
       é o que a profissional precisa ter à mão ao falar com a família. */
    ...dadosDaReposicao(a)
  };
}

function dadosDaReposicao(a) {
  const extra = {};
  if (a.reposicao_de) {
    const original = db.atendimentos.byId(a.reposicao_de);
    if (original) {
      const falta = db.faltas.findOne({ atendimento_id: original.id });
      extra.origem_reposicao = {
        data: original.data, hora: original.hora,
        situacao: original.status,                 // falta ou cancelado
        origem: falta?.origem || '',               // familia | profissional | outro
        motivo: falta?.motivo || '',
        aviso_previo: falta?.aviso_previo || ''
      };
    }
  }
  if (a.reposta_por) {
    const nova = db.atendimentos.byId(a.reposta_por);
    if (nova) extra.destino_reposicao = { data: nova.data, hora: nova.hora, status: nova.status };
  }
  return extra;
}

/* A agenda é compartilhada para ninguém marcar em cima de ninguém, mas o horário de
   outra profissional aparece apenas como reservado: sem nome de paciente, sem valor,
   sem observação. Quem cuida da recepção continua vendo tudo, é o trabalho dela. */
function ocultarDadosDeOutra(a) {
  return {
    id: a.id, data: a.data, hora: a.hora, duracao: a.duracao, sala: a.sala,
    status: a.status, profissional_id: a.profissional_id,
    profissional: db.profissionais.byId(a.profissional_id),
    paciente: null, paciente_id: null,
    reservado_por_outra: true,
    tipo: 'Horário reservado', observacao: '', valor: null, tem_registro: false
  };
}

app.get('/api/atendimentos', (req, res) => {
  const { de, ate, paciente_id, profissional_id, status, so_meus } = req.query;
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  const meus = (a) => visiveis.has(a.paciente_id);

  /* Fora da agenda (listas de atendimentos, filtros de falta, etc.) continua valendo
     só o que é da profissional; a visão compartilhada é pedida com agenda=1. */
  const compartilhada = req.query.agenda === '1' && !so_meus;
  let lista = db.atendimentos.all().filter(a => compartilhada || meus(a));

  if (de) lista = lista.filter(a => a.data >= de);
  if (ate) lista = lista.filter(a => a.data <= ate);
  if (paciente_id) lista = lista.filter(a => a.paciente_id === Number(paciente_id));
  if (profissional_id) lista = lista.filter(a => a.profissional_id === Number(profissional_id));
  if (status) lista = lista.filter(a => a.status === status);

  res.json(lista
    .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora))
    .map(a => meus(a) ? enriquecerAtendimento(a) : ocultarDadosDeOutra(a)));
});

app.post('/api/atendimentos', A.exigir('agenda'), (req, res) => {
  const d = req.body || {};
  if (!d.paciente_id || !d.data || !d.hora) return res.status(400).json({ erro: 'Paciente, data e horário são obrigatórios.' });
  const paciente = db.pacientes.byId(d.paciente_id);
  const sala = d.sala || paciente.sala || salas()[0];
  const profissional_id = Number(d.profissional_id) || paciente.profissional_id;
  const duracao = Number(d.duracao) || 50;
  const bases = {
    paciente_id: Number(d.paciente_id), profissional_id, hora: d.hora, duracao, sala,
    tipo: d.tipo || 'Psicopedagogia', observacao: d.observacao || '', valor: num(d.valor) || paciente.valor_sessao
  };

  // Datas a criar (uma ou a série recorrente)
  const datas = [];
  if (d.recorrente && Number(d.repeticoes) > 1) {
    const passo = d.intervalo === 'quinzenal' ? 14 : 7;
    let data = d.data;
    for (let i = 0; i < Math.min(Number(d.repeticoes), 60); i++) { datas.push(data); data = addDias(data, passo); }
  } else datas.push(d.data);

  // Trava: nenhuma data pode conflitar com sala, profissional ou bloqueio
  const conflitos = [];
  for (const data of datas) {
    const c = conflitoDeAgenda({ data, hora: d.hora, duracao, sala, profissional_id, usuario: req.usuario });
    if (c) conflitos.push({ data, ...c });
  }
  if (conflitos.length && !d.ignorar_conflitos) {
    return res.status(409).json({
      erro: conflitos.length === 1 ? conflitos[0].mensagem
        : `${conflitos.length} das ${datas.length} datas estão ocupadas. Primeira: ${conflitos[0].mensagem}`,
      conflitos
    });
  }

  const rec = datas.length > 1 ? 'rec-' + Date.now() : undefined;
  const criados = datas
    .filter(data => !conflitos.some(c => c.data === data))   // pula datas ocupadas quando autorizado
    .map(data => db.atendimentos.insert({ ...bases, data, status: 'agendado', recorrencia_id: rec, criado_por: req.usuario.nome }));

  A.registrarLog(req, 'criacao', 'atendimentos', criados[0]?.id, `${paciente.nome} — ${criados.length} horário(s) · ${sala}`);
  res.json(criados.map(enriquecerAtendimento));
});

app.put('/api/atendimentos/:id', A.exigir('agenda'), (req, res) => {
  const a = db.atendimentos.byId(req.params.id);
  if (!a) return res.status(404).json({ erro: 'Atendimento não encontrado.' });
  const antes = { ...a };
  const corpo = req.body || {};

  // Se muda data/hora/sala/profissional, revalida a trava de conflito
  if (['data', 'hora', 'sala', 'profissional_id', 'duracao'].some(k => corpo[k] !== undefined)) {
    const c = conflitoDeAgenda({
      data: corpo.data || a.data, hora: corpo.hora || a.hora,
      duracao: corpo.duracao || a.duracao, sala: corpo.sala || a.sala,
      profissional_id: corpo.profissional_id || a.profissional_id, ignorar_id: a.id,
      usuario: req.usuario
    });
    if (c) return res.status(409).json({ erro: c.mensagem, conflito: c });
  }

  const at = db.atendimentos.update(a.id, corpo);
  /* Falta e cancelamento entram no mesmo histórico: o que muda é quem desmarcou.
     "reposicao" nasce como Pendente quando as duas partes combinaram repor. */
  const desmarcou = ['falta', 'cancelado'].includes(req.body?.status);
  if (desmarcou && !['falta', 'cancelado'].includes(antes.status) && !db.faltas.findOne({ atendimento_id: a.id })) {
    db.faltas.insert({
      paciente_id: a.paciente_id, atendimento_id: a.id, data: a.data,
      profissional_id: a.profissional_id,
      situacao: req.body.status,
      origem: req.body.origem || (req.body.status === 'falta' ? 'familia' : 'profissional'),
      motivo: req.body.motivo_falta || req.body.motivo || '',
      aviso_previo: req.body.aviso_previo || 'Sem aviso',
      reposicao: req.body.reposicao || 'Não',
      reposicao_atendimento_id: null,
      cobrado: false
    });
  }
  A.registrarLog(req, 'alteracao', 'atendimentos', a.id, `status ${antes.status} → ${at.status}`);
  res.json(enriquecerAtendimento(at));
});


/* ---------------------------- REPOSIÇÃO ----------------------------
   Uma reposição é um atendimento novo, ligado ao que foi perdido. Não é
   remarcação: o original continua no histórico como falta ou cancelamento,
   para que o motivo e a frequência real não se percam. Como a reposição
   substitui a sessão perdida, ela não gera cobrança extra. */
app.post('/api/atendimentos/:id/reposicao', A.exigir('agenda'), (req, res) => {
  const original = db.atendimentos.byId(req.params.id);
  if (!original) return res.status(404).json({ erro: 'Atendimento não encontrado.' });
  if (!A.podeVerPaciente(req.usuario, db.pacientes.byId(original.paciente_id))) {
    return res.status(403).json({ erro: 'Sem acesso a este paciente.' });
  }
  if (original.reposta_por && db.atendimentos.byId(original.reposta_por)) {
    return res.status(409).json({ erro: 'Este atendimento já tem uma reposição marcada.' });
  }
  const d = req.body || {};
  if (!d.data || !d.hora) return res.status(400).json({ erro: 'Data e horário da reposição são obrigatórios.' });

  const sala = d.sala || original.sala;
  const profissional_id = Number(d.profissional_id) || original.profissional_id;
  const duracao = Number(d.duracao) || original.duracao || 50;
  const c = conflitoDeAgenda({ data: d.data, hora: d.hora, duracao, sala, profissional_id, usuario: req.usuario });
  if (c) return res.status(409).json({ erro: c.mensagem, conflito: c });

  const nova = db.atendimentos.insert({
    paciente_id: original.paciente_id, profissional_id, data: d.data, hora: d.hora,
    duracao, sala, tipo: original.tipo, valor: 0,          // já paga na sessão perdida
    status: 'agendado', reposicao_de: original.id,
    observacao: d.observacao || `Reposição do atendimento de ${dataBR(original.data)}.`,
    criado_por: req.usuario.nome
  });
  db.atendimentos.update(original.id, { reposta_por: nova.id });

  const falta = db.faltas.findOne({ atendimento_id: original.id });
  if (falta) db.faltas.update(falta.id, { reposicao: 'Marcada', reposicao_atendimento_id: nova.id });

  A.registrarLog(req, 'criacao', 'atendimentos', nova.id,
    `reposição de ${dataBR(original.data)} → ${dataBR(d.data)} ${d.hora}`);
  res.json(enriquecerAtendimento(nova));
});

/* Reposições combinadas mas ainda sem data marcada. */
app.get('/api/reposicoes-pendentes', A.exigir('agenda'), (req, res) => {
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  const lista = db.faltas.all()
    .filter(f => f.reposicao === 'Pendente' && visiveis.has(f.paciente_id))
    .map(f => ({
      ...f,
      paciente: db.pacientes.byId(f.paciente_id)?.nome || '—',
      profissional: db.profissionais.byId(f.profissional_id)?.nome || '',
      dias_espera: Math.max(0, Math.round((new Date(hojeISO()) - new Date(f.data)) / 86400000))
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
  res.json(lista);
});

app.delete('/api/atendimentos/:id', A.exigir('agenda'), (req, res) => {
  const a = db.atendimentos.byId(req.params.id);
  if (!a) return res.status(404).json({ erro: 'Não encontrado.' });
  if (req.query.serie === '1' && a.recorrencia_id) {
    const n = db.atendimentos.removeWhere({ recorrencia_id: a.recorrencia_id, data: v => v >= a.data, status: ['agendado', 'confirmado'] });
    A.registrarLog(req, 'exclusao', 'atendimentos', a.id, `série (${n} horários)`);
    return res.json({ ok: true, removidos: n });
  }
  db.atendimentos.remove(a.id);
  A.registrarLog(req, 'exclusao', 'atendimentos', a.id, '');
  res.json({ ok: true });
});

/* ---- Disponibilidade: mapa de ocupação das salas em um dia ---- */

/* Confere uma série ANTES de criar. A tela precisa poder mostrar o que está
   ocupado, e por quem, sem já ter marcado metade das datas. */
app.post('/api/agenda/verificar', A.exigir('agenda'), (req, res) => {
  const { horarios = [], inicio, repeticoes = 1, intervalo = 'semanal', paciente_id, profissional_id } = req.body || {};
  if (!inicio || !horarios.length) return res.status(400).json({ erro: 'Informe o início e ao menos um horário.' });
  const paciente = db.pacientes.byId(paciente_id);
  if (!paciente) return res.status(404).json({ erro: 'Paciente não encontrado.' });
  const passo = intervalo === 'quinzenal' ? 14 : 7;
  const prof = Number(profissional_id) || paciente.profissional_id;

  const primeiraData = (dia) => {
    const d = new Date(inicio + 'T12:00');
    return addDias(inicio, (Number(dia) - d.getDay() + 7) % 7);
  };

  const resultado = horarios.map(h => {
    const sala = h.sala || paciente.sala || salas()[0];
    const datas = [];
    let data = primeiraData(h.dia);
    for (let i = 0; i < Math.min(Number(repeticoes), 60); i++) { datas.push(data); data = addDias(data, passo); }
    const ocupadas = datas.map(data => {
      const c = conflitoDeAgenda({ data, hora: h.hora, duracao: Number(h.duracao) || 50, sala, profissional_id: prof, usuario: req.usuario });
      return c ? { data, motivo: c.motivo, mensagem: c.mensagem, ocupado_por: c.atendimento ? `${c.atendimento.paciente} · ${c.atendimento.profissional}` : (c.bloqueio?.tipo || '') } : null;
    }).filter(Boolean);
    return { dia: Number(h.dia), hora: h.hora, sala, total: datas.length, livres: datas.length - ocupadas.length, ocupadas };
  });

  res.json({
    total: resultado.reduce((n, r) => n + r.total, 0),
    livres: resultado.reduce((n, r) => n + r.livres, 0),
    ocupadas: resultado.reduce((n, r) => n + r.ocupadas.length, 0),
    por_horario: resultado
  });
});

app.get('/api/agenda/disponibilidade', (req, res) => {
  const data = req.query.data || hojeISO();
  const duracao = Number(req.query.duracao) || db.config.get().duracao_padrao || 50;
  const cfg = db.config.get();
  const hIni = parseInt((cfg.horario_inicio || '08:00').slice(0, 2), 10);
  const hFim = parseInt((cfg.horario_fim || '18:00').slice(0, 2), 10);
  const profissional_id = req.query.profissional_id ? Number(req.query.profissional_id) : null;

  const grade = salas().map(sala => {
    const horarios = [];
    for (let h = hIni; h < hFim; h++) {
      for (const m of ['00', '30']) {
        const hora = `${String(h).padStart(2, '0')}:${m}`;
        const c = conflitoDeAgenda({ data, hora, duracao, sala, profissional_id, usuario: req.usuario });
        horarios.push({
          hora,
          livre: !c,
          motivo: c?.motivo || null,
          ocupado_por: c?.atendimento ? `${c.atendimento.paciente} · ${c.atendimento.profissional}` : (c?.bloqueio ? c.bloqueio.tipo : null),
          /* Uma sessão de 50 min atravessa duas ou três faixas de 30. Sem dizer o
             horário real dela, o mapa parece ter três atendimentos onde há um. */
          sessao: c?.atendimento
            ? { inicio: c.atendimento.hora, fim: fim2(c.atendimento.hora, c.atendimento.duracao) }
            : (c?.bloqueio ? { inicio: c.bloqueio.hora_inicio, fim: c.bloqueio.hora_fim } : null),
          detalhe: c?.mensagem || null
        });
      }
    }
    return { sala, horarios };
  });
  res.json({ data, duracao, salas: salas(), grade });
});

/* ---- Bloqueios de agenda ---- */
app.get('/api/bloqueios', (req, res) => {
  const { de, ate } = req.query;
  let l = db.bloqueios.all();
  if (de) l = l.filter(b => b.data >= de);
  if (ate) l = l.filter(b => b.data <= ate);
  res.json(l.map(b => ({ ...b, profissional: b.profissional_id ? db.profissionais.byId(b.profissional_id) : null })));
});
app.post('/api/bloqueios', A.exigir('agenda'), (req, res) => {
  const b = db.bloqueios.insert({ ...req.body, criado_por: req.usuario.nome });
  A.registrarLog(req, 'criacao', 'bloqueios', b.id, b.tipo);
  res.json(b);
});
app.delete('/api/bloqueios/:id', A.exigir('agenda'), (req, res) => { db.bloqueios.remove(req.params.id); res.json({ ok: true }); });

/* ============================ DIÁRIO DE ATENDIMENTO ============================ */

app.get('/api/registros', A.exigir('clinico'), (req, res) => {
  const { paciente_id, de, ate } = req.query;
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  let l = db.registros.all().filter(r => visiveis.has(r.paciente_id));
  if (paciente_id) l = l.filter(r => r.paciente_id === Number(paciente_id));
  if (de) l = l.filter(r => r.data >= de);
  if (ate) l = l.filter(r => r.data <= ate);
  res.json(l.sort((a, b) => (b.data + (b.hora || '')).localeCompare(a.data + (a.hora || '')))
    .map(r => ({ ...r, paciente: db.pacientes.byId(r.paciente_id), profissional: db.profissionais.byId(r.profissional_id) })));
});

app.post('/api/registros', A.exigir('clinico'), (req, res) => {
  const d = req.body || {};
  if (!d.paciente_id || !d.data) return res.status(400).json({ erro: 'Paciente e data são obrigatórios.' });
  const existente = d.atendimento_id ? db.registros.findOne({ atendimento_id: Number(d.atendimento_id) }) : null;
  const dados = { ...d, paciente_id: Number(d.paciente_id), profissional_id: Number(d.profissional_id) || req.usuario.profissional_id };
  let reg;
  if (existente) { reg = db.registros.update(existente.id, dados); A.registrarLog(req, 'alteracao', 'registros', reg.id, 'diário de atendimento'); }
  else { reg = db.registros.insert({ ...dados, criado_por: req.usuario.nome }); A.registrarLog(req, 'criacao', 'registros', reg.id, 'diário de atendimento'); }
  if (d.atendimento_id) db.atendimentos.update(d.atendimento_id, { status: 'realizado' });
  res.json(reg);
});

app.put('/api/registros/:id', A.exigir('clinico'), (req, res) => {
  const r = db.registros.update(req.params.id, req.body || {});
  A.registrarLog(req, 'alteracao', 'registros', r?.id, 'diário de atendimento');
  res.json(r);
});

/* Contexto do paciente para a profissional decidir o atendimento de hoje.
   Tudo aqui é FATO já registrado: o plano combinado na anamnese, o que a última
   sessão trabalhou e o próximo passo que a própria profissional anotou.
   O sistema não sugere conduta — apenas evita que ela precise procurar. */
app.get('/api/pacientes/:id/contexto', A.exigir('clinico'), (req, res) => {
  const p = db.pacientes.byId(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Paciente não encontrado.' });
  if (!A.podeVerPaciente(req.usuario, p)) {
    return res.status(403).json({ erro: 'Este paciente não está sob seu acompanhamento.' });
  }

  const regs = db.registros.find({ paciente_id: p.id })
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const ultimo = regs[0] || null;
  const anamnese = db.anamneses.findOne({ paciente_id: p.id });

  /* Há quantas sessões cada área do plano não é trabalhada. Serve para a
     profissional perceber sozinha o que ficou de lado — sem nenhuma sugestão. */
  const objetivos = (anamnese?.plano?.areas || []).map(a => {
    let desde = 0;
    for (const r of regs) {
      const nivel = r.areas?.[a.area];
      if (nivel && nivel !== 'nao_trabalhado') break;
      desde++;
    }
    const trabalhada = desde < regs.length;
    return {
      area: a.area,
      objetivo: a.objetivo || '',
      nivel_atual: trabalhada ? regs[desde].areas[a.area] : null,
      sessoes_trabalhadas: regs.filter(r => r.areas?.[a.area] && r.areas[a.area] !== 'nao_trabalhado').length,
      sessoes_sem_registro: trabalhada ? desde : regs.length
    };
  });

  res.json({
    paciente: { id: p.id, nome: p.nome, objetivo: p.objetivo || '', queixa: p.queixa || '' },
    tem_anamnese: !!anamnese,
    plano: anamnese ? {
      objetivo_geral: anamnese.plano?.objetivo_geral || '',
      frequencia: anamnese.plano?.frequencia || ''
    } : null,
    objetivos,
    total_sessoes: regs.length,
    ultimo: ultimo ? {
      id: ultimo.id,
      data: ultimo.data,
      objetivo: ultimo.objetivo || '',
      atividades: ultimo.atividades || '',
      evolucao: ultimo.evolucao || '',
      dificuldades: ultimo.dificuldades || '',
      orientacoes: ultimo.orientacoes || '',
      proximo_passo: ultimo.proximo_passo || ''
    } : null
  });
});

app.get('/api/templates', A.exigir('clinico'), (req, res) => res.json(db.templates.all()));
app.post('/api/templates', A.exigir('clinico'), (req, res) => {
  const t = db.templates.insert({ ...req.body, profissional_id: req.usuario.profissional_id });
  A.registrarLog(req, 'criacao', 'templates', t.id, t.nome); res.json(t);
});
app.delete('/api/templates/:id', A.exigir('clinico'), (req, res) => { db.templates.remove(req.params.id); res.json({ ok: true }); });

/* ============================ EVOLUÇÃO ============================ */

app.get('/api/evolucao/:paciente_id', A.exigir('clinico'), (req, res) => {
  const p = db.pacientes.byId(req.params.paciente_id);
  if (!A.podeVerPaciente(req.usuario, p)) return res.status(403).json({ erro: 'Sem acesso.' });
  const { de, ate } = req.query;
  let regs = db.registros.find({ paciente_id: p.id });
  if (de) regs = regs.filter(r => r.data >= de);
  if (ate) regs = regs.filter(r => r.data <= ate);
  regs.sort((a, b) => b.data.localeCompare(a.data));

  const ordem = { nao_trabalhado: 0, em_desenvolvimento: 1, evoluindo: 2, consolidado: 3 };

  /* Áreas eleitas como prioridade no plano de trabalho da anamnese: a evolução
     destaca justamente o que foi combinado com a família. */
  const anamnese = db.anamneses.findOne({ paciente_id: p.id });
  const prioridades = new Map((anamnese?.plano?.areas || []).map(a => [a.area, a.objetivo || '']));

  const indicadores = AREAS.map(area => {
    const serie = regs.filter(r => r.areas?.[area] && r.areas[area] !== 'nao_trabalhado')
      .map(r => ({ data: r.data, nivel: r.areas[area] }));
    const prioridade = prioridades.has(area);
    const objetivo = prioridades.get(area) || '';
    if (!serie.length) return { area, sessoes: 0, atual: null, anterior: null, tendencia: 'sem_registro', prioridade, objetivo };
    const atual = serie[0].nivel;
    const anterior = serie[serie.length - 1].nivel;
    const dif = ordem[atual] - ordem[anterior];
    return { area, sessoes: serie.length, atual, anterior, tendencia: dif > 0 ? 'avanco' : dif < 0 ? 'queda' : 'estavel', prioridade, objetivo };
  });

  res.json({
    paciente: enriquecerPaciente(p, req.perm),
    linha_do_tempo: regs,
    indicadores,
    plano: anamnese ? { ...anamnese.plano, anamnese_id: anamnese.id, data: anamnese.data } : null
  });
});

/* ============================ FINANCEIRO ============================ */

app.get('/api/pagamentos', A.exigir('financeiro'), (req, res) => {
  const { paciente_id, competencia, status, de, ate } = req.query;
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  let l = db.pagamentos.all().filter(p => visiveis.has(p.paciente_id));
  if (paciente_id) l = l.filter(p => p.paciente_id === Number(paciente_id));
  if (competencia) l = l.filter(p => p.competencia === competencia);
  if (status) l = l.filter(p => p.status === status);
  if (de) l = l.filter(p => p.vencimento >= de);
  if (ate) l = l.filter(p => p.vencimento <= ate);
  const hoje = hojeISO();
  res.json(l.sort((a, b) => b.vencimento.localeCompare(a.vencimento)).map(p => ({
    ...p,
    status: p.status === 'pendente' && p.vencimento < hoje ? 'em_atraso' : p.status,
    paciente: db.pacientes.byId(p.paciente_id),
    profissional: db.profissionais.byId(p.profissional_id)
  })));
});

app.post('/api/pagamentos', A.exigir('financeiro'), (req, res) => {
  const d = req.body || {};
  const pac = db.pacientes.byId(d.paciente_id);
  const p = db.pagamentos.insert({
    ...d, paciente_id: Number(d.paciente_id),
    profissional_id: Number(d.profissional_id) || pac?.profissional_id,
    valor: num(d.valor), sessoes: Number(d.sessoes) || 1, status: d.status || 'pendente'
  });
  A.registrarLog(req, 'criacao', 'pagamentos', p.id, `${pac?.nome} — R$ ${p.valor}`);
  res.json(p);
});

app.put('/api/pagamentos/:id', A.exigir('financeiro'), (req, res) => {
  const p = db.pagamentos.update(req.params.id, req.body || {});
  A.registrarLog(req, 'alteracao', 'pagamentos', p?.id, `status ${p?.status}`);
  res.json(p);
});
app.delete('/api/pagamentos/:id', A.exigir('financeiro'), (req, res) => {
  db.pagamentos.remove(req.params.id); A.registrarLog(req, 'exclusao', 'pagamentos', Number(req.params.id)); res.json({ ok: true });
});

app.get('/api/financeiro/resumo', A.exigir('financeiro'), (req, res) => {
  const mes = req.query.competencia || hojeISO().slice(0, 7);
  const hoje = hojeISO();
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  const todos = db.pagamentos.all().filter(p => visiveis.has(p.paciente_id));
  const doMes = todos.filter(p => p.competencia === mes);
  const soma = (arr) => arr.reduce((s, p) => s + num(p.valor), 0);
  const recebido = soma(doMes.filter(p => p.status === 'pago'));
  const aReceber = soma(doMes.filter(p => p.status === 'pendente' && p.vencimento >= hoje));
  const emAtraso = soma(todos.filter(p => p.status === 'pendente' && p.vencimento < hoje));

  /* Quem só enxerga os próprios pacientes também só vê a própria linha: mostrar as
     colegas zeradas dava a impressão falsa de que ninguém havia faturado no mês. */
  const equipeVisivel = req.perm.todos_pacientes
    ? db.profissionais.all()
    : db.profissionais.all().filter(pr => pr.id === req.usuario.profissional_id);

  const porProfissional = equipeVisivel.map(pr => ({
    profissional: pr.nome,
    recebido: soma(doMes.filter(p => p.profissional_id === pr.id && p.status === 'pago')),
    previsto: soma(doMes.filter(p => p.profissional_id === pr.id && p.status !== 'cancelado'))
  }));

  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const comp = d.toISOString().slice(0, 7);
    meses.push({ competencia: comp, recebido: soma(todos.filter(p => p.competencia === comp && p.status === 'pago')) });
  }

  const atendimentosMes = db.atendimentos.all().filter(a => visiveis.has(a.paciente_id) && a.data.slice(0, 7) === mes);
  res.json({
    competencia: mes, recebido, a_receber: aReceber, em_atraso: emAtraso,
    total_atendimentos: atendimentosMes.filter(a => a.status === 'realizado').length,
    por_profissional: porProfissional, serie_mensal: meses
  });
});

/* ============================ ANAMNESE ============================ */
/* Primeiro encontro com a família. O sistema guarda as respostas e o plano de
   trabalho definido PELA PROFISSIONAL — não interpreta, não sugere hipótese e
   não conclui diagnóstico, que não é atribuição da psicopedagogia. */

const roteiroAnamnese = () => db.config.get().roteiro_anamnese || [];

function enriquecerAnamnese(a) {
  const p = db.pacientes.byId(a.paciente_id);
  return {
    ...a,
    paciente: p ? { id: p.id, nome: p.nome, nascimento: p.nascimento } : null,
    profissional: db.profissionais.byId(a.profissional_id)
  };
}

app.get('/api/anamneses', A.exigir('clinico'), (req, res) => {
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  let l = db.anamneses.all().filter(a => visiveis.has(a.paciente_id));
  if (req.query.paciente_id) l = l.filter(a => a.paciente_id === Number(req.query.paciente_id));
  res.json(l.sort((a, b) => (b.data || '').localeCompare(a.data || '')).map(enriquecerAnamnese));
});

app.get('/api/anamneses/:id', A.exigir('clinico'), (req, res) => {
  const a = db.anamneses.byId(req.params.id);
  if (!a) return res.status(404).json({ erro: 'Anamnese não encontrada.' });
  if (!A.podeVerPaciente(req.usuario, db.pacientes.byId(a.paciente_id))) {
    return res.status(403).json({ erro: 'Esta anamnese é de um paciente que não está sob seu acompanhamento.' });
  }
  res.json(enriquecerAnamnese(a));
});

app.post('/api/anamneses', A.exigir('clinico'), (req, res) => {
  const d = req.body || {};
  const paciente = db.pacientes.byId(d.paciente_id);
  if (!paciente) return res.status(404).json({ erro: 'Paciente não encontrado. Cadastre o paciente antes da anamnese.' });
  if (!A.podeVerPaciente(req.usuario, paciente)) {
    return res.status(403).json({ erro: 'Este paciente não está sob seu acompanhamento.' });
  }
  if (db.anamneses.find({ paciente_id: paciente.id }).length) {
    return res.status(409).json({ erro: 'Este paciente já tem uma anamnese registrada. Abra a existente para complementar.' });
  }
  const a = db.anamneses.insert({
    paciente_id: paciente.id,
    profissional_id: Number(d.profissional_id) || req.usuario.profissional_id || paciente.profissional_id,
    atendimento_id: d.atendimento_id ? Number(d.atendimento_id) : null,
    data: d.data || hojeISO(),
    informante: d.informante || '',
    respostas: d.respostas || {},
    hipoteses: d.hipoteses || '',
    encaminhamento: d.encaminhamento || '',
    plano: {
      areas: Array.isArray(d.plano?.areas) ? d.plano.areas : [],
      frequencia: d.plano?.frequencia || '',
      objetivo_geral: d.plano?.objetivo_geral || ''
    },
    concluida: !!d.concluida,
    criado_por: req.usuario.nome
  });
  /* A queixa dita pela família alimenta a ficha, para não digitar duas vezes. */
  const queixa = (d.respostas || {}).queixa_principal;
  if (queixa && !paciente.queixa) db.pacientes.update(paciente.id, { queixa });

  A.registrarLog(req, 'criacao', 'anamneses', a.id, paciente.nome);
  res.status(201).json(enriquecerAnamnese(a));
});

app.put('/api/anamneses/:id', A.exigir('clinico'), (req, res) => {
  const atual = db.anamneses.byId(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Anamnese não encontrada.' });
  if (!A.podeVerPaciente(req.usuario, db.pacientes.byId(atual.paciente_id))) {
    return res.status(403).json({ erro: 'Esta anamnese é de um paciente que não está sob seu acompanhamento.' });
  }
  const d = req.body || {};
  const a = db.anamneses.update(atual.id, {
    ...d,
    respostas: { ...(atual.respostas || {}), ...(d.respostas || {}) },
    plano: d.plano ? { ...(atual.plano || {}), ...d.plano } : atual.plano
  });
  A.registrarLog(req, 'alteracao', 'anamneses', a.id);
  res.json(enriquecerAnamnese(a));
});

app.delete('/api/anamneses/:id', A.exigir('clinico'), (req, res) => {
  const a = db.anamneses.byId(req.params.id);
  if (!a) return res.status(404).json({ erro: 'Anamnese não encontrada.' });
  if (!A.podeVerPaciente(req.usuario, db.pacientes.byId(a.paciente_id))) {
    return res.status(403).json({ erro: 'Esta anamnese é de um paciente que não está sob seu acompanhamento.' });
  }
  db.anamneses.remove(a.id);
  A.registrarLog(req, 'exclusao', 'anamneses', Number(req.params.id));
  res.json({ ok: true });
});

/* Roteiro: leitura para qualquer profissional, edição só para administrador. */
app.get('/api/anamnese/roteiro', (req, res) => res.json(roteiroAnamnese()));
app.get('/api/anamnese/roteiro/padrao', A.exigir('configuracoes'), (req, res) => res.json(ROTEIRO_ANAMNESE));

app.put('/api/anamnese/roteiro', A.exigir('configuracoes'), (req, res) => {
  const blocos = req.body?.blocos;
  if (!Array.isArray(blocos) || !blocos.length) {
    return res.status(400).json({ erro: 'Envie ao menos um bloco de perguntas.' });
  }
  const limpo = blocos.map((b, i) => ({
    id: b.id || `bloco_${i + 1}`,
    titulo: String(b.titulo || '').trim() || `Bloco ${i + 1}`,
    perguntas: (Array.isArray(b.perguntas) ? b.perguntas : []).map((q, j) => ({
      id: q.id || `pergunta_${i + 1}_${j + 1}`,
      rotulo: String(q.rotulo || '').trim() || `Pergunta ${j + 1}`,
      tipo: ['texto', 'selecao', 'sim_nao'].includes(q.tipo) ? q.tipo : 'texto',
      opcoes: Array.isArray(q.opcoes) ? q.opcoes.filter(Boolean).map(String) : []
    }))
  }));
  db.config.set({ ...db.config.get(), roteiro_anamnese: limpo });
  A.registrarLog(req, 'alteracao', 'config', 1, 'roteiro da anamnese');
  res.json(limpo);
});

/* ============================ FALTAS ============================ */

app.get('/api/faltas', (req, res) => {
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  let l = db.faltas.all().filter(f => visiveis.has(f.paciente_id));
  if (req.query.paciente_id) l = l.filter(f => f.paciente_id === Number(req.query.paciente_id));
  res.json(l.sort((a, b) => b.data.localeCompare(a.data)).map(f => ({ ...f, paciente: db.pacientes.byId(f.paciente_id) })));
});
app.put('/api/faltas/:id', (req, res) => { const f = db.faltas.update(req.params.id, req.body || {}); A.registrarLog(req, 'alteracao', 'faltas', f?.id); res.json(f); });

/* ============================ DOCUMENTOS ============================ */

app.get('/api/documentos', A.exigir('documentos'), (req, res) => {
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  let l = db.documentos.all().filter(d => visiveis.has(d.paciente_id));
  if (req.query.paciente_id) l = l.filter(d => d.paciente_id === Number(req.query.paciente_id));
  res.json(l.sort((a, b) => (b.enviado_em || '').localeCompare(a.enviado_em || ''))
    .map(d => ({ ...d, arquivo: undefined, paciente: db.pacientes.byId(d.paciente_id) })));
});

app.post('/api/documentos', A.exigir('documentos'), (req, res) => {
  const { paciente_id, nome, categoria, tipo, conteudo } = req.body || {};
  if (!paciente_id || !nome) return res.status(400).json({ erro: 'Paciente e arquivo são obrigatórios.' });
  let referencia = null, tamanho = 0;
  if (conteudo) {
    const b64 = conteudo.split(',').pop();
    const buf = Buffer.from(b64, 'base64');
    tamanho = buf.length;
    referencia = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    fs.writeFileSync(path.join(db.paths.UPLOAD_DIR, referencia), buf);
  }
  const d = db.documentos.insert({
    paciente_id: Number(paciente_id), nome, categoria: categoria || 'Outros',
    tipo: tipo || 'application/octet-stream', tamanho, referencia,
    enviado_por: req.usuario.nome, enviado_em: hojeISO()
  });
  A.registrarLog(req, 'upload', 'documentos', d.id, `${nome} (${d.categoria})`);
  res.json({ ...d, arquivo: undefined });
});

app.get('/api/documentos/:id/download', A.exigir('documentos'), (req, res) => {
  const d = db.documentos.byId(req.params.id);
  if (!d) return res.status(404).json({ erro: 'Não encontrado.' });
  if (!A.podeVerPaciente(req.usuario, db.pacientes.byId(d.paciente_id))) return res.status(403).json({ erro: 'Sem acesso.' });
  A.registrarLog(req, 'download', 'documentos', d.id, d.nome);
  const arq = d.referencia && d.referencia !== 'demo' ? path.join(db.paths.UPLOAD_DIR, d.referencia) : null;
  if (!arq || !fs.existsSync(arq)) return res.status(404).json({ erro: 'Arquivo de demonstração — sem conteúdo armazenado.' });
  res.setHeader('Content-Type', d.tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(d.nome)}"`);
  fs.createReadStream(arq).pipe(res);
});

app.delete('/api/documentos/:id', A.exigir('documentos'), (req, res) => {
  const d = db.documentos.byId(req.params.id);
  if (!d) return res.status(404).json({ erro: 'Não encontrado.' });
  if (req.usuario.papel === 'administrativo') return res.status(403).json({ erro: 'Perfil administrativo não pode excluir documentos.' });
  if (d.referencia && d.referencia !== 'demo') { try { fs.unlinkSync(path.join(db.paths.UPLOAD_DIR, d.referencia)); } catch (_) {} }
  db.documentos.remove(d.id);
  A.registrarLog(req, 'exclusao', 'documentos', d.id, d.nome);
  res.json({ ok: true });
});

/* ============================ RELATÓRIOS ============================ */

app.get('/api/relatorios', A.exigir('clinico'), (req, res) => {
  const visiveis = new Set(A.pacientesVisiveis(req.usuario).map(p => p.id));
  let l = db.relatorios.all().filter(r => visiveis.has(r.paciente_id));
  if (req.query.paciente_id) l = l.filter(r => r.paciente_id === Number(req.query.paciente_id));
  res.json(l.sort((a, b) => (b.criado_em || '').localeCompare(a.criado_em || ''))
    .map(r => ({ ...r, paciente: db.pacientes.byId(r.paciente_id), profissional: db.profissionais.byId(r.profissional_id) })));
});

app.post('/api/relatorios', A.exigir('clinico'), (req, res) => {
  const r = db.relatorios.insert({
    ...req.body, paciente_id: Number(req.body.paciente_id),
    profissional_id: Number(req.body.profissional_id) || req.usuario.profissional_id,
    criado_por: req.usuario.nome, status: req.body.status || 'Rascunho'
  });
  A.registrarLog(req, 'criacao', 'relatorios', r.id, r.tipo);
  res.json(r);
});
app.put('/api/relatorios/:id', A.exigir('clinico'), (req, res) => {
  const r = db.relatorios.update(req.params.id, req.body || {}); A.registrarLog(req, 'alteracao', 'relatorios', r?.id); res.json(r);
});
app.delete('/api/relatorios/:id', A.exigir('clinico'), (req, res) => { db.relatorios.remove(req.params.id); res.json({ ok: true }); });

/** Base factual para o relatório: apenas o que foi registrado pela profissional. */
app.get('/api/relatorios/base/:paciente_id', A.exigir('clinico'), (req, res) => {
  const p = db.pacientes.byId(req.params.paciente_id);
  if (!p) return res.status(404).json({ erro: 'Paciente não encontrado. Cadastre o paciente antes de gerar o relatório.' });
  if (!A.podeVerPaciente(req.usuario, p)) return res.status(403).json({ erro: 'Sem acesso.' });
  const de = req.query.de || addDias(hojeISO(), -90), ate = req.query.ate || hojeISO();
  const regs = db.registros.find({ paciente_id: p.id }).filter(r => r.data >= de && r.data <= ate).sort((a, b) => a.data.localeCompare(b.data));
  const ats = db.atendimentos.find({ paciente_id: p.id }).filter(a => a.data >= de && a.data <= ate);
  const unico = (arr) => [...new Set(arr.filter(Boolean).map(s => s.trim()))];
  res.json({
    paciente: enriquecerPaciente(p, req.perm), periodo: { de, ate },
    sessoes_realizadas: ats.filter(a => a.status === 'realizado').length,
    faltas: ats.filter(a => a.status === 'falta').length,
    registros: regs.length,
    objetivos: unico(regs.map(r => r.objetivo)),
    atividades: unico(regs.map(r => r.atividades)),
    recursos: unico(regs.map(r => r.recursos)),
    evolucoes: unico(regs.map(r => r.evolucao)),
    dificuldades: unico(regs.map(r => r.dificuldades)),
    orientacoes: unico(regs.map(r => r.orientacoes))
  });
});

/* ============================ PROFISSIONAIS E USUÁRIOS ============================ */

/* Campos da ficha cadastral: dados pessoais e de contato da própria profissional.
   Ficam visíveis apenas para a equipe clínica (admin e profissionais);
   o perfil administrativo recebe a versão sem esses dados. */
const CAMPOS_FICHA = ['nascimento', 'sexo', 'endereco', 'cpf', 'telefone_pessoal',
  'graduacao_1', 'instituicao_1', 'graduacao_2', 'instituicao_2',
  'especializacao_1', 'especializacao_2', 'especializacao_3',
  'emergencia_nome', 'emergencia_telefone', 'emergencia_parentesco',
  'areas_atuacao', 'idades_atendidas', 'dominio_especifico',
  'disponibilidade', 'local_atendimento', 'ficha_assinada_em'];

const semFicha = (p) => {
  const copia = { ...p };
  for (const c of CAMPOS_FICHA) delete copia[c];
  return copia;
};

app.get('/api/profissionais', (req, res) => {
  const clinico = req.usuario && req.usuario.papel !== 'administrativo';
  res.json(db.profissionais.all().map(p => {
    const u = db.usuarios.findOne({ profissional_id: p.id });
    const base = clinico ? p : semFicha(p);
    return {
      ...base,
      ficha_preenchida: !!(p.cpf || p.graduacao_1 || p.areas_atuacao),
      usuario: u ? { papel: u.papel, email: u.email } : null,
      pacientes: db.pacientes.find({ profissional_id: p.id }).length
    };
  }));
});

/** Cada profissional edita a própria ficha; a administradora edita qualquer uma. */
app.put('/api/profissionais/:id/ficha', A.exigirLogin, (req, res) => {
  const id = Number(req.params.id);
  const eu = req.usuario;
  if (eu.papel === 'administrativo') return res.status(403).json({ erro: 'Sem permissão para a ficha cadastral.' });
  if (eu.papel !== 'admin' && eu.profissional_id !== id) {
    return res.status(403).json({ erro: 'Você só pode preencher a sua própria ficha.' });
  }
  const dados = {};
  for (const c of CAMPOS_FICHA) if (c in (req.body || {})) dados[c] = req.body[c];
  dados.ficha_atualizada_em = new Date().toISOString();
  const p = db.profissionais.update(id, dados);
  if (!p) return res.status(404).json({ erro: 'Profissional não encontrada.' });
  A.registrarLog(req, 'alteracao', 'profissionais', id, 'ficha cadastral');
  res.json(p);
});
app.post('/api/profissionais', A.exigir('profissionais'), (req, res) => {
  const { criar_usuario, senha, papel, ...dados } = req.body || {};
  const p = db.profissionais.insert(dados);
  if (criar_usuario && dados.email) {
    db.usuarios.insert({ nome: dados.nome, email: dados.email.toLowerCase(), senha: A.hashSenha(senha || 'psico123'), trocar_senha: true, papel: papel || 'profissional', profissional_id: p.id, ativo: true });
  }
  A.registrarLog(req, 'criacao', 'profissionais', p.id, p.nome);
  res.json(p);
});
app.put('/api/profissionais/:id', A.exigir('profissionais'), (req, res) => {
  const p = db.profissionais.update(req.params.id, req.body || {}); A.registrarLog(req, 'alteracao', 'profissionais', p?.id, p?.nome); res.json(p);
});

app.get('/api/usuarios', A.exigir('configuracoes'), (req, res) =>
  res.json(db.usuarios.all().map(u => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo, profissional_id: u.profissional_id, ultimo_acesso: u.ultimo_acesso }))));
app.put('/api/usuarios/:id', A.exigir('configuracoes'), (req, res) => {
  const { senha, ...dados } = req.body || {};
  if (senha) { dados.senha = A.hashSenha(senha); dados.trocar_senha = true; }
  const u = db.usuarios.update(req.params.id, dados);
  A.registrarLog(req, 'alteracao', 'usuarios', u?.id, u?.nome);
  res.json({ id: u.id, nome: u.nome, papel: u.papel, ativo: u.ativo });
});
app.post('/api/usuarios', A.exigir('configuracoes'), (req, res) => {
  const d = req.body || {};
  if (db.usuarios.findOne({ email: (d.email || '').toLowerCase() })) return res.status(400).json({ erro: 'E-mail já cadastrado.' });
  const u = db.usuarios.insert({ nome: d.nome, email: (d.email || '').toLowerCase(), senha: A.hashSenha(d.senha || 'psico123'), trocar_senha: true, papel: d.papel || 'profissional', profissional_id: d.profissional_id ? Number(d.profissional_id) : null, ativo: true });
  A.registrarLog(req, 'criacao', 'usuarios', u.id, u.nome);
  res.json({ id: u.id });
});

/* ============================ DASHBOARD, ALERTAS, BUSCA ============================ */

app.get('/api/dashboard', (req, res) => {
  const hoje = hojeISO();
  const visiveis = A.pacientesVisiveis(req.usuario);
  const ids = new Set(visiveis.map(p => p.id));
  const doDia = db.atendimentos.all().filter(a => a.data === hoje && ids.has(a.paciente_id))
    .sort((a, b) => a.hora.localeCompare(b.hora)).map(enriquecerAtendimento);
  const agora = new Date().toTimeString().slice(0, 5);
  const proximo = doDia.find(a => a.hora >= agora && ['agendado', 'confirmado'].includes(a.status)) || null;

  const cfg = db.config.get();
  const inicio = parseInt((cfg.horario_inicio || '08:00').slice(0, 2), 10);
  const fim = parseInt((cfg.horario_fim || '18:00').slice(0, 2), 10);
  const ocupados = new Set(doDia.filter(a => a.status !== 'cancelado').map(a => a.hora.slice(0, 2)));
  const bloqueados = new Set(db.bloqueios.find({ data: hoje }).flatMap(b => {
    const arr = []; for (let h = parseInt(b.hora_inicio, 10); h < parseInt(b.hora_fim, 10); h++) arr.push(String(h).padStart(2, '0')); return arr;
  }));
  let livres = 0;
  for (let h = inicio; h < fim; h++) { const hh = String(h).padStart(2, '0'); if (!ocupados.has(hh) && !bloqueados.has(hh)) livres++; }

  const resumo = {
    agendados: doDia.filter(a => ['agendado', 'confirmado'].includes(a.status)).length,
    realizados: doDia.filter(a => a.status === 'realizado').length,
    faltas: doDia.filter(a => a.status === 'falta').length,
    cancelados: doDia.filter(a => a.status === 'cancelado').length,
    livres
  };

  let financeiro = null;
  if (req.perm.financeiro) {
    const mes = hoje.slice(0, 7);
    const pgs = db.pagamentos.all().filter(p => ids.has(p.paciente_id));
    const soma = (arr) => arr.reduce((s, p) => s + num(p.valor), 0);
    financeiro = {
      recebido_mes: soma(pgs.filter(p => p.competencia === mes && p.status === 'pago')),
      a_receber: soma(pgs.filter(p => p.competencia === mes && p.status === 'pendente' && p.vencimento >= hoje)),
      em_atraso: soma(pgs.filter(p => p.status === 'pendente' && p.vencimento < hoje))
    };
  }

  res.json({
    hoje, agenda_do_dia: doDia, proximo, resumo, financeiro,
    pacientes_ativos: visiveis.filter(p => p.status === 'Ativo').length,
    alertas: calcularAlertas(req).slice(0, 8)
  });
});

function calcularAlertas(req) {
  const hoje = hojeISO();
  const alertas = [];
  const visiveis = A.pacientesVisiveis(req.usuario);
  const ids = new Set(visiveis.map(p => p.id));

  if (req.perm.clinico) {
    const semDiario = db.atendimentos.all().filter(a =>
      a.status === 'realizado' && ids.has(a.paciente_id) && a.data <= hoje && a.data >= addDias(hoje, -45) &&
      !db.registros.findOne({ atendimento_id: a.id }));
    if (semDiario.length) alertas.push({
      tipo: 'diario', prioridade: 'alta',
      titulo: `${semDiario.length} atendimento${semDiario.length > 1 ? 's' : ''} sem evolução registrada`,
      detalhe: semDiario.slice(0, 3).map(a => `${db.pacientes.byId(a.paciente_id)?.nome} — ${a.data.split('-').reverse().join('/')}`).join(' · '),
      link: '#/atendimentos?filtro=sem_registro'
    });
  }

  if (req.perm.financeiro) {
    const atrasados = db.pagamentos.all().filter(p => ids.has(p.paciente_id) && p.status === 'pendente' && p.vencimento < hoje);
    if (atrasados.length) alertas.push({
      tipo: 'financeiro', prioridade: 'alta',
      titulo: `${atrasados.length} pagamento${atrasados.length > 1 ? 's' : ''} em atraso`,
      detalhe: atrasados.slice(0, 3).map(p => `${db.pacientes.byId(p.paciente_id)?.nome} — venc. ${p.vencimento.split('-').reverse().join('/')}`).join(' · '),
      link: '#/financeiro?status=em_atraso'
    });
  }

  visiveis.forEach(p => {
    if (p.status !== 'Ativo' && p.status !== 'Em avaliação') return;
    if (p.reavaliacao_prevista && p.reavaliacao_prevista <= addDias(hoje, 30) && p.reavaliacao_prevista >= addDias(hoje, -30)) {
      alertas.push({ tipo: 'reavaliacao', prioridade: 'media', titulo: `Reavaliação de ${p.nome.split(' ')[0]} prevista`, detalhe: `Data prevista: ${p.reavaliacao_prevista.split('-').reverse().join('/')}`, link: `#/paciente/${p.id}` });
    }
    const ultimos = db.atendimentos.find({ paciente_id: p.id, status: 'realizado' }).map(a => a.data).sort();
    const ultimo = ultimos[ultimos.length - 1];
    if (ultimo && ultimo < addDias(hoje, -30)) {
      alertas.push({ tipo: 'ausencia', prioridade: 'media', titulo: `${p.nome.split(' ')[0]} sem atendimento há mais de 30 dias`, detalhe: `Último atendimento em ${ultimo.split('-').reverse().join('/')}`, link: `#/paciente/${p.id}` });
    }
    /* Reposição combinada com a família e ainda sem data: some da agenda e
       é esquecida com facilidade, então vira alerta até ser marcada. */
    db.faltas.find({ paciente_id: p.id, reposicao: 'Pendente' }).forEach(f => {
      const dias = Math.round((new Date(hoje) - new Date(f.data)) / 86400000);
      alertas.push({
        tipo: 'reposicao',
        prioridade: dias > 21 ? 'alta' : 'media',
        titulo: `Reposição a marcar — ${p.nome.split(' ')[0]}`,
        detalhe: `Sessão de ${f.data.split('-').reverse().join('/')} não aconteceu` +
          (dias > 0 ? ` · há ${dias} dia(s)` : '') +
          (f.origem === 'profissional' ? ' · desmarcada pela profissional' : ''),
        link: `#/paciente/${p.id}?aba=agenda`
      });
    });

    /* Sem anamnese não há plano de trabalho combinado: é a pendência mais
       importante de um paciente que já começou a ser atendido. */
    if (req.perm.clinico && !db.anamneses.findOne({ paciente_id: p.id })) {
      const jaAtendido = db.atendimentos.find({ paciente_id: p.id }).some(a => a.status === 'realizado');
      alertas.push({
        tipo: 'anamnese', prioridade: jaAtendido ? 'alta' : 'media',
        titulo: `Anamnese pendente — ${p.nome.split(' ')[0]}`,
        detalhe: jaAtendido ? 'O paciente já foi atendido e ainda não tem anamnese registrada.' : 'Registrar no primeiro encontro com a família.',
        link: `#/paciente/${p.id}?aba=anamnese`
      });
    }
    const docs = db.documentos.find({ paciente_id: p.id });
    const faltando = ['Termo de consentimento', 'Contrato'].filter(c => !docs.some(d => d.categoria === c));
    if (faltando.length) alertas.push({ tipo: 'documento', prioridade: 'baixa', titulo: `Documentação pendente — ${p.nome.split(' ')[0]}`, detalhe: faltando.join(' · '), link: `#/paciente/${p.id}?aba=documentos` });
    if (p.nascimento) {
      const [, m, d] = p.nascimento.split('-');
      const aniv = `${hoje.slice(0, 4)}-${m}-${d}`;
      if (aniv >= hoje && aniv <= addDias(hoje, 7)) alertas.push({ tipo: 'aniversario', prioridade: 'baixa', titulo: `Aniversário de ${p.nome.split(' ')[0]}`, detalhe: `${d}/${m} — completa ${idade(p.nascimento) + 1} anos`, link: `#/paciente/${p.id}` });
    }
  });

  const ordem = { alta: 0, media: 1, baixa: 2 };
  return alertas.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade]);
}

app.get('/api/alertas', (req, res) => res.json(calcularAlertas(req)));

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

app.get('/api/busca', (req, res) => {
  const q = normalizar((req.query.q || '').trim());
  if (q.length < 2) return res.json([]);
  const pacientes = A.pacientesVisiveis(req.usuario)
    .filter(p => normalizar(p.nome).includes(q) || normalizar(p.nome_social).includes(q) ||
      db.responsaveis.find({ paciente_id: p.id }).some(r => normalizar(r.nome).includes(q)))
    .slice(0, 8)
    .map(p => {
      const e = enriquecerPaciente(p, req.perm);
      return {
        tipo: 'paciente', id: p.id, nome: p.nome, idade: e.idade, status: p.status,
        profissional: e.profissional?.nome, proximo: e.proximo_atendimento,
        ultimo: e.ultimo_atendimento, financeiro: req.perm.financeiro ? e.financeiro.situacao : null,
        responsavel: e.responsaveis[0]?.nome
      };
    });
  res.json(pacientes);
});

/* ============================ CONFIG, LOGS, BACKUP ============================ */

app.get('/api/config', (req, res) => res.json(db.config.get()));
app.put('/api/config', A.exigir('configuracoes'), (req, res) => { A.registrarLog(req, 'alteracao', 'config', null, 'configurações da clínica'); res.json(db.config.set(req.body || {})); });

app.get('/api/logs', A.exigir('configuracoes'), (req, res) =>
  res.json(db.logs.all().slice(-400).reverse()));

app.post('/api/backup', A.exigir('configuracoes'), (req, res) => {
  const nome = db.backup(); A.registrarLog(req, 'backup', 'sistema', null, nome); res.json({ ok: true, arquivo: nome, lista: db.backups() });
});
app.get('/api/backup', A.exigir('configuracoes'), (req, res) => res.json(db.backups()));

/**
 * Apaga todos os registros de pacientes (e tudo que depende deles).
 * Preserva equipe, usuários, modelos de registro, configurações e auditoria.
 * Só a administradora pode executar, e um backup é gerado antes.
 */
/**
 * Restaura um arquivo exportado (Configurações → Exportar dados).
 * Necessário no plano gratuito da hospedagem, onde cada publicação recria o banco:
 * a administradora exporta antes e restaura depois, sem perder os cadastros.
 */
app.post('/api/importar', A.exigirLogin, (req, res) => {
  if (req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Apenas a administradora pode restaurar dados.' });
  const dados = req.body?.dados;
  if (!dados || typeof dados !== 'object' || !Array.isArray(dados.pacientes)) {
    return res.status(400).json({ erro: 'Arquivo inválido: não parece uma exportação do PsicoAprender.' });
  }

  const backup = db.backup();
  const colecoes = ['pacientes', 'responsaveis', 'atendimentos', 'bloqueios', 'registros',
    'templates', 'pagamentos', 'faltas', 'documentos', 'relatorios', 'notificacoes', 'anamneses'];
  const restaurados = {};
  for (const nome of colecoes) {
    if (!Array.isArray(dados[nome])) continue;
    db[nome].removeWhere({});
    for (const registro of dados[nome]) db[nome].inserirBruto(registro);
    restaurados[nome] = dados[nome].length;
  }
  if (dados.config && typeof dados.config === 'object') db.config.set(dados.config);
  if (dados._seq) db.definirSequencias(dados._seq);

  db.persistNow();
  A.registrarLog(req, 'importacao', 'sistema', null,
    `restauração de dados (backup anterior ${backup}) — ` +
    Object.entries(restaurados).map(([k, n]) => `${k}: ${n}`).join(', '));
  res.json({ ok: true, backup, restaurados });
});

app.post('/api/limpar-dados', A.exigirLogin, (req, res) => {
  if (req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Apenas a administradora pode limpar os dados.' });
  if (req.body?.confirmacao !== 'APAGAR') return res.status(400).json({ erro: 'Confirmação inválida.' });

  const backup = db.backup();
  const colecoes = ['pacientes', 'responsaveis', 'atendimentos', 'bloqueios', 'registros',
    'pagamentos', 'faltas', 'documentos', 'relatorios', 'notificacoes', 'anamneses'];
  const apagados = {};
  for (const nome of colecoes) {
    apagados[nome] = db[nome].all().length;
    db[nome].removeWhere({});
  }
  db.persistNow();
  A.registrarLog(req, 'limpeza', 'sistema', null,
    `dados de pacientes apagados (backup ${backup}) — ` +
    Object.entries(apagados).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(', '));
  res.json({ ok: true, backup, apagados });
});

app.get('/api/exportar', A.exigir('configuracoes'), (req, res) => {
  A.registrarLog(req, 'exportacao', 'sistema', null, 'exportação completa (LGPD)');
  res.setHeader('Content-Disposition', 'attachment; filename="piscoaprender-dados.json"');
  res.json(db.raw);
});

/* ============================ ESTÁTICOS ============================ */

const PUB = path.join(__dirname, '..', 'public');
app.use(express.static(PUB, {
  extensions: ['html'],
  setHeaders: (res, arquivo) => {
    // HTML/JS/CSS sempre revalidados: evita o navegador servir versão antiga do sistema
    if (/\.(html|js|css)$/.test(arquivo)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.get('/sistema', (req, res) => res.sendFile(path.join(PUB, 'sistema.html')));
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.sendFile(path.join(PUB, 'index.html'));
});

const PORT = process.env.PORT || 3000;

/* O armazenamento é preparado antes de aceitar requisições: com Turso
   configurado, o estado vem do banco externo e sobrevive a novas publicações. */
(async () => {
  try {
    const info = await db.iniciar();
    console.log(info.modo === 'turso'
      ? `Dados no Turso (banco externo)${info.novo ? ' — banco iniciado agora' : ''}.`
      : `Dados em arquivo local: ${info.caminho}`);
    seed();
    app.listen(PORT, '0.0.0.0', () => console.log(`PsicoAprender Gestão em http://0.0.0.0:${PORT}`));
  } catch (err) {
    console.error('Não foi possível iniciar o armazenamento:', err.message);
    process.exit(1);
  }
})();
