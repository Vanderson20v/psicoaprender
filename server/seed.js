/**
 * Carga inicial: estrutura da clínica PsicoAprender + dados de demonstração.
 * A equipe e as duas salas de atendimento são reais; pacientes são fictícios
 * para demonstração e podem ser removidos.
 */
const db = require('./db');
const { hashSenha } = require('./auth');

const iso = (d) => d.toISOString().slice(0, 10);
const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
const dias = (n, base = hoje) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

const AREAS = ['atencao', 'concentracao', 'memoria', 'linguagem', 'leitura', 'escrita',
  'raciocinio_logico', 'coordenacao_motora', 'organizacao', 'interacao_social', 'autonomia'];

const SALAS = ['Sala de atendimento 1', 'Sala de atendimento 2'];

/* Pacientes fictícios só são criados quando DADOS_DEMO=1.
   Em uso normal o sistema nasce apenas com a equipe, as salas e os modelos. */
const DEMO = process.env.DADOS_DEMO === '1';


/* ---------------------------------------------------------------------------
   Roteiro padrão da anamnese
   ---------------------------------------------------------------------------
   É apenas um ponto de partida: a clínica edita blocos e perguntas em
   Configurações → Anamnese. Predomina seleção em vez de digitação, porque a
   entrevista acontece com a família na sala, quase sempre no tablet.
   O sistema não conclui nada a partir daqui — apenas organiza o que foi dito.
--------------------------------------------------------------------------- */
const ROTEIRO_ANAMNESE = [
  {
    id: 'queixa', titulo: 'Motivo da procura',
    perguntas: [
      { id: 'quem_encaminhou', rotulo: 'Quem indicou a clínica', tipo: 'selecao',
        opcoes: ['Escola', 'Pediatra', 'Neurologista', 'Psicólogo(a)', 'Fonoaudiólogo(a)', 'Indicação de família', 'Procura espontânea', 'Outro'] },
      { id: 'queixa_principal', rotulo: 'Queixa principal (nas palavras da família)', tipo: 'texto' },
      { id: 'inicio_dificuldade', rotulo: 'Desde quando percebem a dificuldade', tipo: 'selecao',
        opcoes: ['Sempre foi assim', 'Menos de 6 meses', 'Cerca de 1 ano', 'Mais de 2 anos', 'Após entrar na escola', 'Não sabem precisar'] },
      { id: 'avaliacoes_anteriores', rotulo: 'Já passou por avaliação ou terapia antes', tipo: 'texto' },
      { id: 'laudo', rotulo: 'Possui laudo ou diagnóstico já fechado', tipo: 'selecao',
        opcoes: ['Não possui', 'Em investigação', 'Sim — trouxe o documento', 'Sim — não trouxe'] }
    ]
  },
  {
    id: 'gestacao', titulo: 'Gestação e nascimento',
    perguntas: [
      { id: 'gestacao', rotulo: 'Como foi a gestação', tipo: 'selecao',
        opcoes: ['Sem intercorrências', 'Com intercorrências', 'Não sabe informar'] },
      { id: 'gestacao_detalhe', rotulo: 'Se houve intercorrência, qual', tipo: 'texto' },
      { id: 'tipo_parto', rotulo: 'Tipo de parto', tipo: 'selecao', opcoes: ['Normal', 'Cesárea', 'Fórceps', 'Não sabe informar'] },
      { id: 'prematuro', rotulo: 'Nasceu prematuro', tipo: 'sim_nao' },
      { id: 'intercorrencia_parto', rotulo: 'Intercorrências no parto ou logo após', tipo: 'texto' }
    ]
  },
  {
    id: 'desenvolvimento', titulo: 'Desenvolvimento',
    perguntas: [
      { id: 'sentou_andou', rotulo: 'Idade em que sentou e andou', tipo: 'selecao',
        opcoes: ['Dentro do esperado', 'Um pouco depois do esperado', 'Bem depois do esperado', 'Não sabe informar'] },
      { id: 'primeiras_palavras', rotulo: 'Primeiras palavras', tipo: 'selecao',
        opcoes: ['Dentro do esperado', 'Um pouco depois do esperado', 'Bem depois do esperado', 'Não sabe informar'] },
      { id: 'fala_atual', rotulo: 'Como está a fala hoje', tipo: 'selecao',
        opcoes: ['Clara e compreensível', 'Trocas pontuais de sons', 'Difícil de compreender', 'Fala pouco', 'Não verbal'] },
      { id: 'controle_esfincter', rotulo: 'Controle de esfíncteres', tipo: 'selecao',
        opcoes: ['Adquirido na idade esperada', 'Adquirido mais tarde', 'Ainda em processo', 'Usa fralda'] },
      { id: 'observacoes_desenvolvimento', rotulo: 'Outras observações da família', tipo: 'texto' }
    ]
  },
  {
    id: 'saude', titulo: 'Saúde',
    perguntas: [
      { id: 'acompanhamento_medico', rotulo: 'Acompanhamento médico atual', tipo: 'texto' },
      { id: 'medicacao', rotulo: 'Faz uso de medicação', tipo: 'texto' },
      { id: 'visao_audicao', rotulo: 'Visão e audição já avaliadas', tipo: 'selecao',
        opcoes: ['Ambas avaliadas, sem alteração', 'Com alteração — em acompanhamento', 'Ainda não avaliadas', 'Não sabe informar'] },
      { id: 'alergias', rotulo: 'Alergias, crises ou condições de saúde relevantes', tipo: 'texto' }
    ]
  },
  {
    id: 'escola', titulo: 'Vida escolar',
    perguntas: [
      { id: 'escola_atual', rotulo: 'Escola e ano que cursa', tipo: 'texto' },
      { id: 'adaptacao', rotulo: 'Adaptação à escola', tipo: 'selecao',
        opcoes: ['Boa', 'Com dificuldade no início', 'Ainda difícil', 'Recusa ir à escola'] },
      { id: 'relato_escola', rotulo: 'O que a escola relata', tipo: 'texto' },
      { id: 'dificuldade_escolar', rotulo: 'Onde aparece a maior dificuldade', tipo: 'selecao',
        opcoes: ['Leitura', 'Escrita', 'Matemática', 'Atenção em sala', 'Comportamento', 'Relação com colegas', 'Várias áreas'] },
      { id: 'apoio_escolar', rotulo: 'Tem apoio na escola (AEE, mediador, adaptação)', tipo: 'texto' },
      { id: 'licao_casa', rotulo: 'Como é a lição de casa', tipo: 'selecao',
        opcoes: ['Faz sozinha', 'Faz com ajuda', 'Só faz com muita insistência', 'Não faz'] }
    ]
  },
  {
    id: 'rotina', titulo: 'Rotina e autonomia',
    perguntas: [
      { id: 'sono', rotulo: 'Sono', tipo: 'selecao',
        opcoes: ['Dorme bem', 'Demora a pegar no sono', 'Acorda várias vezes', 'Dorme pouco'] },
      { id: 'alimentacao', rotulo: 'Alimentação', tipo: 'selecao',
        opcoes: ['Come de tudo', 'Seletiva', 'Muito seletiva', 'Com dificuldade de mastigação'] },
      { id: 'telas', rotulo: 'Tempo de telas por dia', tipo: 'selecao',
        opcoes: ['Até 1 hora', 'De 1 a 3 horas', 'De 3 a 5 horas', 'Mais de 5 horas'] },
      { id: 'autonomia', rotulo: 'Autonomia no dia a dia (vestir, higiene, organizar o material)', tipo: 'selecao',
        opcoes: ['Faz sozinha', 'Faz com lembretes', 'Precisa de ajuda', 'Depende totalmente'] },
      { id: 'atividades', rotulo: 'Atividades de que gosta', tipo: 'texto' }
    ]
  },
  {
    id: 'familia', titulo: 'Família e convivência',
    perguntas: [
      { id: 'com_quem_mora', rotulo: 'Com quem mora', tipo: 'texto' },
      { id: 'irmaos', rotulo: 'Irmãos', tipo: 'texto' },
      { id: 'quem_acompanha', rotulo: 'Quem acompanha os estudos em casa', tipo: 'texto' },
      { id: 'mudancas', rotulo: 'Mudanças recentes na família (separação, luto, mudança de cidade)', tipo: 'texto' },
      { id: 'convivio', rotulo: 'Como é a relação com outras crianças', tipo: 'selecao',
        opcoes: ['Interage bem', 'Prefere ficar sozinha', 'Tem conflitos frequentes', 'Muito tímida'] }
    ]
  },
  {
    id: 'observacao', titulo: 'Observação da criança na sessão',
    perguntas: [
      { id: 'apresentacao', rotulo: 'Como chegou à sala', tipo: 'selecao',
        opcoes: ['Tranquila', 'Tímida', 'Agitada', 'Resistente a entrar', 'Chorosa'] },
      { id: 'contato', rotulo: 'Contato e comunicação', tipo: 'selecao',
        opcoes: ['Estabelece contato com facilidade', 'Precisa de tempo', 'Pouco contato visual', 'Não se comunicou verbalmente'] },
      { id: 'atencao_sessao', rotulo: 'Atenção durante a atividade', tipo: 'selecao',
        opcoes: ['Manteve-se atenta', 'Dispersou algumas vezes', 'Dispersou com frequência', 'Não sustentou a atividade'] },
      { id: 'observacoes_sessao', rotulo: 'Outras observações da profissional', tipo: 'texto' }
    ]
  }
];

function seed() {
  if (db.usuarios.all().length) {
    ajustarContasExistentes();
    garantirContaSuporte();
    somenteSuporteAdministra();
    garantirRoteiroAnamnese();
    return;
  }

  db.config.set({
    clinica: 'PsicoAprender',
    marca_complemento: 'Espaço de Aprendizagem',
    sistema: 'PsicoAprender Gestão',
    subtitulo: 'Organização para cuidar melhor.',
    salas: SALAS,
    roteiro_anamnese: ROTEIRO_ANAMNESE,
    endereco: 'QNE 15, Lote 25, Sala 106 — Taguatinga Norte, Brasília/DF',
    telefone: '(61) 99921-4773',
    email: 'psicoaprenderdf@gmail.com',
    instagram: '@psicoaprenderdf',
    instagram_url: 'https://www.instagram.com/psicoaprenderdf/',
    horario_inicio: '08:00',
    horario_fim: '18:00',
    duracao_padrao: 50,
    politica_falta: 'Faltas avisadas com menos de 24h são cobradas integralmente.',
    mensagens: {
      confirmacao: 'Olá, {responsavel}. Aqui é da PsicoAprender. Passando para confirmar o atendimento de {paciente} {quando}, às {horario}. Podemos confirmar?',
      lembrete: 'Olá, {responsavel}. Lembrando do atendimento de {paciente} {quando}, às {horario}, na PsicoAprender. Até lá!',
      cobranca: 'Olá, {responsavel}. Consta em aberto o valor de {valor} referente aos atendimentos de {paciente}, com vencimento em {vencimento}. Qualquer dúvida, estou à disposição.',
      reagendamento: 'Olá, {responsavel}. Precisamos reagendar o atendimento de {paciente} de {quando}. Tenho disponibilidade em outros horários — qual fica melhor para vocês?',
      ausencia: 'Olá, {responsavel}. Por um imprevisto, não poderei atender {paciente} {quando}. Vamos combinar a reposição?',
      relatorio: 'Olá, {responsavel}. O relatório de acompanhamento de {paciente} está pronto. Posso enviar por aqui ou entregar pessoalmente na próxima sessão.'
    }
  });

  // ---------- Equipe PsicoAprender ----------
  const equipe = [
    {
      nome: 'Vanessa Gomes', profissao: 'Psicopedagoga clínica e institucional',
      registro: '', telefone: '', email: 'vanessa@psicoaprender.com.br', status: 'Ativo',
      cor: '#6f5493', foto: '/assets/equipe/vanessa.jpg',
      formacao: 'Formação em Pedagogia',
      especialidades: 'Especialista em psicopedagogia clínica e institucional · Pós-graduada em AEE (Atendimento Educacional Especializado)',
      papel: 'profissional'
    },
    {
      nome: 'Helen Cristina', profissao: 'Psicopedagoga clínica e institucional',
      registro: '', telefone: '', email: 'helen@psicoaprender.com.br', status: 'Ativo',
      cor: '#7fa87a', foto: '/assets/equipe/helen.jpg',
      formacao: 'Formação em Pedagogia — UnB',
      especialidades: 'Especialista em psicopedagogia clínica e institucional, transtornos e dificuldades de aprendizagem · Pós-graduanda em ABA, dislexia, distúrbios da leitura/escrita e síndrome de Down',
      papel: 'profissional'
    },
    {
      nome: 'Patrícia Monteiro', profissao: 'Psicopedagoga clínica e institucional',
      registro: '', telefone: '', email: 'patricia@psicoaprender.com.br', status: 'Ativo',
      cor: '#5d87a8', foto: '/assets/equipe/patricia.jpg',
      formacao: 'Formação em Pedagogia',
      especialidades: 'Especialista em psicopedagogia clínica e institucional · Pós-graduanda em ABA e alfabetização de crianças típicas e atípicas',
      papel: 'profissional'
    },
    {
      nome: 'Jennifer', profissao: 'Musicoterapeuta e psicopedagoga',
      registro: '', telefone: '', email: 'jennifer@psicoaprender.com.br', status: 'Ativo',
      cor: '#b9852f', foto: '/assets/equipe/jennifer.jpg',
      formacao: 'Formação em Pedagogia — IESB',
      especialidades: 'Especialista em musicoterapia, musicalização infantil e ABA · Pós-graduanda em psicopedagogia clínica e institucional e educação especial',
      papel: 'profissional'
    },
    {
      nome: 'Josyllene Dias', profissao: 'Psicopedagoga clínica e institucional',
      registro: '', telefone: '', email: 'josyllene@psicoaprender.com.br', status: 'Ativo',
      cor: '#a35a6d', foto: '/assets/equipe/josyllene.jpg',
      formacao: 'Formação em Pedagogia — UnB',
      especialidades: 'Especialista em educação precoce, alfabetização e letramento · Pós-graduada em psicopedagogia clínica e institucional e orientação educacional',
      papel: 'profissional'
    },
    {
      nome: 'Malu Nogueira', profissao: 'Neuropsicopedagoga',
      registro: '', telefone: '', email: 'malu@psicoaprender.com.br', status: 'Ativo',
      cor: '#4f7a70', foto: '/assets/equipe/malu.jpg',
      formacao: 'Formação em Letras — UnB e Pedagogia — IESB',
      especialidades: 'Especialista em psicopedagogia clínica e institucional, neuropsicopedagogia, alfabetização e letramento · Pós-graduanda em ABA, síndrome de Down e autismo',
      papel: 'profissional'
    }
  ];

  const prof = equipe.map(p => {
    const { papel, ...dados } = p;
    const registro = db.profissionais.insert(dados);
    db.usuarios.insert({
      nome: p.nome, email: p.email, senha: hashSenha('psico123'), trocar_senha: true,
      papel, profissional_id: registro.id, ativo: true
    });
    return registro;
  });

  db.usuarios.insert({
    nome: 'Recepção', email: 'recepcao@psicoaprender.com.br', senha: hashSenha('psico123'), trocar_senha: true,
    papel: 'administrativo', profissional_id: null, ativo: true
  });

  // ---------- Modelos de registro ----------
  [
    {
      nome: 'Sessão de leitura e escrita', tipo: 'Psicopedagogia', profissional_id: prof[0].id,
      campos: {
        objetivo: 'Consciência fonológica e fluência de leitura.',
        atividades: 'Leitura compartilhada de texto curto; jogo de rimas; ditado de palavras com sílabas complexas.',
        recursos: 'Livro de literatura infantil, cartelas de sílabas, caderno.',
        orientacoes: 'Leitura diária de 10 minutos com a família, sem cobrança de velocidade.'
      }
    },
    {
      nome: 'Sessão de raciocínio lógico', tipo: 'Psicopedagogia', profissional_id: prof[0].id,
      campos: {
        objetivo: 'Resolução de problemas e organização do pensamento.',
        atividades: 'Jogo de sequência lógica; problemas de subtração com material concreto.',
        recursos: 'Material dourado, jogo de trilha, folhas de atividade.',
        orientacoes: 'Retomar contagem em situações do dia a dia (compras, receitas).'
      }
    },
    {
      nome: 'Sessão de musicalização', tipo: 'Musicoterapia', profissional_id: prof[3].id,
      campos: {
        objetivo: 'Atenção compartilhada, ritmo e turnos de interação.',
        atividades: 'Canções com gestos, imitação rítmica e exploração de instrumentos.',
        recursos: 'Violão, instrumentos de percussão, cartelas de figuras.',
        orientacoes: 'Retomar em casa as canções trabalhadas na sessão.'
      }
    },
    {
      nome: 'Devolutiva com responsáveis', tipo: 'Orientação', profissional_id: prof[0].id,
      campos: {
        objetivo: 'Alinhar percepções da família e da escola sobre o período.',
        atividades: 'Conversa estruturada com apresentação da linha do tempo de evolução.',
        recursos: 'Relatório de evolução impresso.',
        orientacoes: 'Combinar rotina de estudos em casa e retorno em 30 dias.'
      }
    }
  ].forEach(m => db.templates.insert(m));

  if (DEMO) {
    /* ---------- Pacientes de demonstração ----------
       A grade é montada sem choque de sala: cada linha define
       dia da semana, horário e sala fixos.                              */
    const base = [
      { nome: 'João Pedro Almeida', nascimento: '2017-04-12', sexo: 'Masculino', prof: 0, dia: 2, hora: '09:00', sala: 0, tipo: 'Psicopedagogia', status: 'Ativo', valor: 180, queixa: 'Dificuldade na leitura e na escrita; troca de letras.', objetivo: 'Desenvolver consciência fonológica e autonomia na leitura.', resp: [{ nome: 'Patrícia Almeida', parentesco: 'Mãe', telefone: '61981110001' }, { nome: 'Rafael Almeida', parentesco: 'Pai', telefone: '61981110002' }] },
      { nome: 'Maria Clara Souza', nascimento: '2016-09-03', sexo: 'Feminino', prof: 1, dia: 2, hora: '09:00', sala: 1, tipo: 'Psicopedagogia', status: 'Ativo', valor: 180, queixa: 'Desatenção em sala e baixo rendimento em matemática.', objetivo: 'Ampliar atenção sustentada e estratégias de cálculo.', resp: [{ nome: 'Juliana Souza', parentesco: 'Mãe', telefone: '61981110003' }] },
      { nome: 'Pedro Henrique Lima', nascimento: '2018-01-27', sexo: 'Masculino', prof: 0, dia: 2, hora: '10:00', sala: 0, tipo: 'Psicopedagogia', status: 'Ativo', valor: 180, queixa: 'Dificuldade de organização e de finalizar tarefas.', objetivo: 'Rotina de estudos e organização do material.', resp: [{ nome: 'Fernanda Lima', parentesco: 'Mãe', telefone: '61981110004' }] },
      { nome: 'Helena Martins', nascimento: '2019-06-15', sexo: 'Feminino', prof: 3, dia: 2, hora: '10:00', sala: 1, tipo: 'Musicoterapia', status: 'Ativo', valor: 190, queixa: 'Pouca interação e vocabulário reduzido.', objetivo: 'Ampliar comunicação e turnos de interação.', resp: [{ nome: 'Carla Martins', parentesco: 'Mãe', telefone: '61981110005' }] },
      { nome: 'Arthur Nogueira', nascimento: '2015-11-08', sexo: 'Masculino', prof: 2, dia: 3, hora: '14:00', sala: 0, tipo: 'Psicopedagogia', status: 'Ativo', valor: 180, queixa: 'Resistência às atividades escolares.', objetivo: 'Retomar vínculo com a aprendizagem e autoestima acadêmica.', resp: [{ nome: 'Simone Nogueira', parentesco: 'Mãe', telefone: '61981110006' }] },
      { nome: 'Lívia Barbosa', nascimento: '2017-08-30', sexo: 'Feminino', prof: 5, dia: 3, hora: '14:00', sala: 1, tipo: 'Neuropsicopedagogia', status: 'Ativo', valor: 190, queixa: 'Dificuldade na alfabetização; escrita pouco legível.', objetivo: 'Alfabetização, traçado e organização espacial.', resp: [{ nome: 'Renata Barbosa', parentesco: 'Mãe', telefone: '61981110007' }] },
      { nome: 'Bernardo Castro', nascimento: '2016-02-19', sexo: 'Masculino', prof: 4, dia: 3, hora: '15:00', sala: 0, tipo: 'Avaliação', status: 'Em avaliação', valor: 200, queixa: 'Avaliação psicopedagógica solicitada pela escola.', objetivo: 'Concluir processo avaliativo e devolutiva.', resp: [{ nome: 'Aline Castro', parentesco: 'Mãe', telefone: '61981110008' }] },
      { nome: 'Sofia Ribeiro', nascimento: '2018-12-05', sexo: 'Feminino', prof: 1, dia: 3, hora: '15:00', sala: 1, tipo: 'Psicopedagogia', status: 'Ativo', valor: 190, queixa: 'Atraso na aquisição da leitura.', objetivo: 'Alfabetização e compreensão leitora.', resp: [{ nome: 'Marcos Ribeiro', parentesco: 'Pai', telefone: '61981110009' }] },
      { nome: 'Théo Fontes', nascimento: '2017-03-22', sexo: 'Masculino', prof: 4, dia: 4, hora: '09:00', sala: 0, tipo: 'Educação precoce', status: 'Ativo', valor: 180, queixa: 'Dificuldade de interação com colegas.', objetivo: 'Habilidades sociais e regulação em grupo.', resp: [{ nome: 'Débora Fontes', parentesco: 'Mãe', telefone: '61981110010' }] },
      { nome: 'Alice Moreira', nascimento: '2018-07-19', sexo: 'Feminino', prof: 2, dia: 4, hora: '09:00', sala: 1, tipo: 'Psicopedagogia', status: 'Ativo', valor: 180, queixa: 'Trocas na escrita e insegurança na leitura.', objetivo: 'Consolidar correspondência letra-som.', resp: [{ nome: 'Bianca Moreira', parentesco: 'Mãe', telefone: '61981110012' }] },
      { nome: 'Miguel Tavares', nascimento: '2016-10-02', sexo: 'Masculino', prof: 5, dia: 4, hora: '10:00', sala: 0, tipo: 'Neuropsicopedagogia', status: 'Ativo', valor: 190, queixa: 'Dificuldade de memória de trabalho.', objetivo: 'Estratégias de memorização e organização.', resp: [{ nome: 'Sandra Tavares', parentesco: 'Mãe', telefone: '61981110013' }] },
      { nome: 'Isabela Prado', nascimento: '2015-05-09', sexo: 'Feminino', prof: 0, dia: 4, hora: '10:00', sala: 1, tipo: 'Psicopedagogia', status: 'Alta', valor: 180, queixa: 'Acompanhamento concluído.', objetivo: 'Manutenção dos ganhos; alta com orientação à família.', resp: [{ nome: 'Luciana Prado', parentesco: 'Mãe', telefone: '61981110011' }] }
    ];

    const pacientes = base.map((p, i) => {
      const pac = db.pacientes.insert({
        nome: p.nome, nome_social: '', nascimento: p.nascimento, sexo: p.sexo, cpf: '',
        inicio_acompanhamento: iso(dias(-(120 + i * 7))),
        status: p.status, foto: '', profissional_id: prof[p.prof].id,
        frequencia: 'Semanal', dia_semana: p.dia, horario: p.hora, sala: SALAS[p.sala],
        valor_sessao: p.valor, forma_pagamento: rnd(['PIX', 'PIX', 'Transferência', 'Cartão']),
        dia_vencimento: 10, convenio: '',
        queixa: p.queixa, objetivo: p.objetivo,
        observacoes_iniciais: 'Informações complementares coletadas na anamnese com a família.',
        avaliacao_inicial: iso(dias(-(118 + i * 7))),
        reavaliacao_prevista: iso(dias([12, 40, 75, 20, 95, 130, 8, 60, 45, 110, 25, 200][i])),
        encaminhamento: i % 4 === 0 ? 'Escola — coordenação pedagógica' : '',
        profissionais_externos: i % 3 === 0 ? 'Neuropediatra Dr. Sérgio Vaz' : '',
        escola: rnd(['Colégio Sagrado', 'Escola Classe 12', 'Colégio Marista', 'Escola Vivenda']),
        ano_escolar: rnd(['1º ano', '2º ano', '3º ano', '4º ano', 'Educação Infantil'])
      });
      p.resp.forEach((r, k) => db.responsaveis.insert({
        paciente_id: pac.id, nome: r.nome, parentesco: r.parentesco,
        telefone: r.telefone, whatsapp: r.telefone,
        email: r.nome.toLowerCase().split(' ')[0] + '@email.com', principal: k === 0
      }));
      return { ...pac, _cfg: p };
    });

    // ---------- Documentos ----------
    pacientes.forEach((p, i) => {
      const docs = [
        { categoria: 'Termo de consentimento', nome: 'Termo de consentimento assinado.pdf' },
        { categoria: 'Contrato', nome: 'Contrato de prestação de serviços.pdf' }
      ];
      if (i % 3 !== 1) docs.push({ categoria: 'Autorização de imagem', nome: 'Autorização de uso de imagem.pdf' });
      if (i % 4 === 0) docs.push({ categoria: 'Avaliação externa', nome: 'Relatório escolar.pdf' });
      docs.forEach(d => db.documentos.insert({
        paciente_id: p.id, nome: d.nome, categoria: d.categoria, tipo: 'application/pdf',
        tamanho: 120000 + i * 3000, arquivo: null, referencia: 'demo',
        enviado_por: 'Vanessa Gomes', enviado_em: iso(dias(-110 + i))
      }));
    });

    // ---------- Agenda, diários, faltas e financeiro ----------
    pacientes.forEach((p, idx) => {
      const cfg = p._cfg;
      if (cfg.status === 'Alta') return;
      const recorrencia = `rec-${p.id}`;
      for (let w = -16; w <= 8; w++) {
        const d = new Date(hoje);
        d.setDate(d.getDate() + ((cfg.dia - d.getDay() + 7) % 7) + w * 7);
        const data = iso(d);
        const passado = data < iso(hoje);
        const ehHoje = data === iso(hoje);
        let status = 'agendado';
        if (passado) status = Math.random() < 0.08 ? (Math.random() < 0.6 ? 'falta' : 'cancelado') : 'realizado';
        else if (ehHoje) status = 'confirmado';
        else if (w <= 2) status = Math.random() < 0.5 ? 'confirmado' : 'agendado';

        const at = db.atendimentos.insert({
          paciente_id: p.id, profissional_id: prof[cfg.prof].id, data, hora: cfg.hora,
          duracao: 50, tipo: cfg.tipo, status, sala: SALAS[cfg.sala],
          recorrencia_id: recorrencia, observacao: '', valor: cfg.valor
        });

        if (status === 'realizado' && !(w >= -2 && Math.random() < 0.5)) {
          const areas = {};
          AREAS.forEach(a => {
            const r = Math.random();
            areas[a] = r < 0.35 ? 'nao_trabalhado' : r < 0.6 ? 'em_desenvolvimento' : r < 0.87 ? 'evoluindo' : 'consolidado';
          });
          db.registros.insert({
            atendimento_id: at.id, paciente_id: p.id, profissional_id: prof[cfg.prof].id,
            data, hora: cfg.hora, duracao: 50, tipo: cfg.tipo, sala: SALAS[cfg.sala],
            objetivo: rnd(['Consciência fonológica.', 'Atenção sustentada em tarefa dirigida.', 'Organização e planejamento da tarefa.', 'Compreensão leitora.', 'Cálculo mental e resolução de problemas.']),
            atividades: rnd(['Jogo de rimas e leitura compartilhada.', 'Trilha matemática com material concreto.', 'Ditado de palavras e correção conjunta.', 'Atividade de recorte, colagem e sequência.', 'Leitura de texto curto com perguntas de compreensão.']),
            recursos: rnd(['Cartelas de sílabas, livro infantil.', 'Material dourado e jogo de trilha.', 'Caderno, lápis, folhas de atividade.', 'Jogos de tabuleiro pedagógicos.']),
            comportamento: rnd(['Participativo e colaborativo.', 'Iniciou disperso, engajou após a segunda atividade.', 'Demonstrou boa disponibilidade.', 'Apresentou cansaço no fim da sessão.']),
            desempenho: rnd(['Realizou as atividades com apoio pontual.', 'Necessitou de mediação constante.', 'Executou com autonomia parcial.', 'Bom desempenho, sem necessidade de apoio.']),
            evolucao: rnd(['Evolução perceptível em relação à sessão anterior.', 'Mantém o desempenho observado nas últimas semanas.', 'Avanço na autonomia durante a tarefa.', 'Ainda oscila conforme o cansaço.']),
            dificuldades: rnd(['Sílabas complexas.', 'Manter atenção acima de 10 minutos.', 'Organizar a folha e o material.', 'Frustração diante do erro.', '']),
            orientacoes: rnd(['Leitura diária de 10 minutos.', 'Retomar o jogo trabalhado em casa duas vezes na semana.', 'Rotina de estudo com pausa a cada 15 minutos.', '']),
            observacoes: '', areas, criado_por: prof[cfg.prof].nome
          });
        }

        if (status === 'falta') {
          db.faltas.insert({
            paciente_id: p.id, atendimento_id: at.id, data,
            motivo: rnd(['Criança adoentada', 'Compromisso escolar', 'Sem aviso', 'Viagem da família']),
            aviso_previo: rnd(['Mais de 24h', 'Menos de 24h', 'Sem aviso']),
            reposicao: rnd(['Não', 'Sim — reagendado', 'Não']),
            cobrado: Math.random() < 0.5
          });
        }
      }

      for (let m = 4; m >= 0; m--) {
        const ref = new Date(hoje.getFullYear(), hoje.getMonth() - m, 1);
        const competencia = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
        let status = 'pago';
        if (m === 0) status = idx % 4 === 0 ? 'pendente' : (idx % 4 === 1 ? 'pago' : 'pendente');
        if (m === 1 && idx % 5 === 0) status = 'em_atraso';
        db.pagamentos.insert({
          paciente_id: p.id, profissional_id: prof[cfg.prof].id, competencia,
          descricao: `Mensalidade ${competencia} — 4 sessões`,
          sessoes: 4, valor: cfg.valor * 4, vencimento: `${competencia}-10`,
          pago_em: status === 'pago' ? `${competencia}-10` : null,
          forma: status === 'pago' ? 'PIX' : '', status
        });
      }
    });

    // ---------- Bloqueios ----------
    db.bloqueios.insert({ profissional_id: null, sala: SALAS[0], data: iso(hoje), hora_inicio: '12:00', hora_fim: '13:00', tipo: 'Almoço', motivo: 'Intervalo' });
    db.bloqueios.insert({ profissional_id: null, sala: SALAS[1], data: iso(hoje), hora_inicio: '12:00', hora_fim: '13:00', tipo: 'Almoço', motivo: 'Intervalo' });
    db.bloqueios.insert({ profissional_id: null, sala: '', data: iso(dias(21)), hora_inicio: '08:00', hora_fim: '18:00', tipo: 'Feriado', motivo: 'Feriado municipal' });
    db.bloqueios.insert({ profissional_id: prof[0].id, sala: SALAS[0], data: iso(dias(4)), hora_inicio: '16:00', hora_fim: '18:00', tipo: 'Reunião', motivo: 'Reunião com escola' });

    // ---------- Relatório de exemplo ----------
    db.relatorios.insert({
      paciente_id: pacientes[0].id, profissional_id: prof[0].id, tipo: 'Relatório de evolução',
      periodo_inicio: iso(dias(-90)), periodo_fim: iso(dias(-1)), status: 'Concluído',
      conteudo: {
        objetivos: 'Desenvolvimento da consciência fonológica, fluência de leitura e autonomia na produção escrita.',
        estrategias: 'Sessões semanais de 50 minutos, com jogos de rimas, leitura compartilhada, ditado mediado e produção de textos curtos.',
        evolucao: 'Houve avanço na identificação de sílabas complexas e na leitura de palavras dissílabas e trissílabas. A criança demonstra maior disponibilidade para as atividades de escrita.',
        pendencias: 'Escrita ainda apresenta trocas em encontros consonantais; permanece necessária a mediação em textos mais longos.',
        recomendacoes: 'Manter a leitura diária em casa, sem cobrança de velocidade, e continuidade do acompanhamento semanal.',
        consideracoes: 'O acompanhamento tem se mostrado produtivo; sugere-se reavaliação em três meses.'
      },
      criado_por: 'Vanessa Gomes'
    });
  }

  garantirContaSuporte();
  db.config.set({ ...db.config.get(), papeis_revisados: true });

  db.persistNow();
  console.log(DEMO
    ? 'Dados iniciais da PsicoAprender criados (com pacientes de demonstração).'
    : 'Dados iniciais da PsicoAprender criados: equipe, salas e modelos. Sem pacientes fictícios.');
}

/* Decisão de 01/09/2026: enquanto a equipe não definir quem administra o sistema,
   nenhuma profissional fica com acesso de administradora — só a conta de suporte.
   Roda uma única vez; depois disso os papéis são definidos pela tela de usuários. */
/* Bases criadas antes da anamnese existir recebem o roteiro padrão. */
function garantirRoteiroAnamnese() {
  const cfg = db.config.get() || {};
  if (Array.isArray(cfg.roteiro_anamnese) && cfg.roteiro_anamnese.length) return;
  db.config.set({ ...cfg, roteiro_anamnese: ROTEIRO_ANAMNESE });
  db.persistNow();
  console.log('Roteiro padrão de anamnese instalado.');
}

function somenteSuporteAdministra() {
  const cfg = db.config.get() || {};
  if (cfg.papeis_revisados) return;
  let mudou = 0;
  for (const u of db.usuarios.all()) {
    if (u.papel === 'admin' && !u.suporte) {
      db.usuarios.update(u.id, { papel: 'profissional' });
      mudou++;
    }
  }
  db.config.set({ ...cfg, papeis_revisados: true });
  db.persistNow();
  if (mudou) console.log(`Acesso de administradora removido de ${mudou} conta(s) de profissional.`);
}

/* Conta técnica de quem acompanha os testes e implementa as melhorias.
   Tem acesso de administrador, mas não é uma profissional: não aparece na equipe,
   na agenda nem nos relatórios. O e-mail pode ser trocado pela variável de ambiente
   EMAIL_SUPORTE, e a senha inicial pela SENHA_SUPORTE. */
function garantirContaSuporte() {
  const email = (process.env.EMAIL_SUPORTE || 'suporte@psicoaprender.com.br').toLowerCase();
  if (db.usuarios.all().some(u => u.email === email)) return;
  db.usuarios.insert({
    nome: 'Suporte técnico',
    email,
    senha: hashSenha(process.env.SENHA_SUPORTE || 'psico123'),
    trocar_senha: true,
    papel: 'admin',
    profissional_id: null,
    suporte: true,
    ativo: true
  });
  db.persistNow();
  console.log(`Conta de suporte técnico disponível: ${email}`);
}

/* Contas criadas antes da troca obrigatória existir: enquanto estiverem com a senha
   inicial distribuída pelo administrador, precisam definir uma senha própria no
   primeiro acesso. Roda uma única vez por conta. */
function ajustarContasExistentes() {
  let mudou = 0;
  for (const u of db.usuarios.all()) {
    if (u.trocar_senha === undefined) { db.usuarios.update(u.id, { trocar_senha: true }); mudou++; }
  }
  if (mudou) {
    db.persistNow();
    console.log(`Troca de senha no primeiro acesso ativada para ${mudou} conta(s).`);
  }
}

module.exports = { seed, AREAS, SALAS, ROTEIRO_ANAMNESE };
