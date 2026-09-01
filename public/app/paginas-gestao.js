/* =======================================================================
   Telas de gestão: Atendimentos · Evolução · Relatórios · Financeiro
   Documentos · Responsáveis · Profissionais · Configurações
   ======================================================================= */

/* ========================= ATENDIMENTOS (diários) ========================= */
App.paginas.atendimentos = async (alvo, rota) => {
  const filtro = rota.query.filtro || 'todos';
  const [ats, regs, faltas] = await Promise.all([
    api.get('/api/atendimentos', { de: somaDias(hojeISO(), -120), ate: hojeISO() }),
    api.get('/api/registros'),
    api.get('/api/faltas')
  ]);
  const semRegistro = ats.filter(a => a.status === 'realizado' && !a.tem_registro);

  const conteudo = {
    todos: () => tabela(['Data', 'Paciente', 'Tipo', 'Objetivo trabalhado', 'Profissional', ''],
      regs.slice(0, 120).map(r => `<tr class="clicavel" data-reg="${r.id}">
        <td class="td-principal">${dataBR(r.data)}</td>
        <td class="td-principal">${esc(r.paciente?.nome || '')}</td>
        <td class="td-secundario">${esc(r.tipo || '')}</td>
        <td class="td-secundario" style="max-width:380px">${esc((r.objetivo || '—').slice(0, 110))}</td>
        <td class="td-secundario">${esc(primeiroNome(r.profissional?.nome))}</td>
        <td style="text-align:right"><button class="btn btn-sutil" data-editar="${r.id}">${ico('editar')}</button></td>
      </tr>`), { vazio: 'Nenhum registro de sessão.' }),
    sem_registro: () => tabela(['Data', 'Paciente', 'Hora', 'Profissional', ''],
      semRegistro.map(a => `<tr>
        <td class="td-principal">${dataBR(a.data)}</td>
        <td class="td-principal">${esc(a.paciente?.nome || '')}</td>
        <td>${a.hora}</td>
        <td class="td-secundario">${esc(primeiroNome(a.profissional?.nome))}</td>
        <td style="text-align:right"><button class="btn btn-primario btn-sutil" data-registrar="${a.id}">Registrar agora</button></td>
      </tr>`), { vazio: 'Todos os atendimentos realizados possuem diário. ' }),
    faltas: () => tabela(['Data', 'Paciente', 'Motivo', 'Aviso prévio', 'Reposição', 'Cobrança'],
      faltas.map(f => `<tr>
        <td class="td-principal">${dataBR(f.data)}</td>
        <td class="td-principal">${esc(f.paciente?.nome || '')}</td>
        <td class="td-secundario">${esc(f.motivo || '—')}</td>
        <td class="td-secundario">${esc(f.aviso_previo || '—')}</td>
        <td><select data-falta="${f.id}" data-campo="reposicao" style="min-width:150px">
              ${['Não', 'Sim — reagendado', 'Sim — realizada'].map(o => `<option ${f.reposicao === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select></td>
        <td><select data-falta="${f.id}" data-campo="cobrado" style="min-width:130px">
              <option value="true" ${f.cobrado ? 'selected' : ''}>Cobrado</option>
              <option value="false" ${!f.cobrado ? 'selected' : ''}>Não cobrado</option>
            </select></td>
      </tr>`), { vazio: 'Nenhuma falta registrada.' })
  };

  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Atendimentos', 'Diários de sessão, pendências e controle de faltas',
    `<button class="btn btn-primario" id="novo">${ico('mais')} Registrar atendimento</button>`)}
    <div class="escolhas" style="margin-bottom:14px">
      <div class="escolha ${filtro === 'todos' ? 'ativa' : ''}" data-f="todos">Registros (${regs.length})</div>
      <div class="escolha ${filtro === 'sem_registro' ? 'ativa' : ''}" data-f="sem_registro">Diários pendentes (${semRegistro.length})</div>
      <div class="escolha ${filtro === 'faltas' ? 'ativa' : ''}" data-f="faltas">Faltas e cancelamentos (${faltas.length})</div>
    </div>
    <div class="painel"><div class="painel-corpo sem-padding">${(conteudo[filtro] || conteudo.todos)()}</div></div>
  </div>`;

  alvo.querySelectorAll('[data-f]').forEach(el => el.addEventListener('click', () => location.hash = '/atendimentos?filtro=' + el.dataset.f));
  alvo.querySelector('#novo').addEventListener('click', () => abrirDiario({}));
  alvo.querySelectorAll('[data-registrar]').forEach(b => b.addEventListener('click', () => abrirDiario({ atendimento_id: Number(b.dataset.registrar) })));
  alvo.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = regs.find(x => x.id === Number(b.dataset.editar));
    abrirDiario({ paciente_id: r.paciente_id, registro: r });
  }));
  alvo.querySelectorAll('tr[data-reg]').forEach(tr => tr.addEventListener('click', () => {
    const r = regs.find(x => x.id === Number(tr.dataset.reg));
    location.hash = `/paciente/${r.paciente_id}?aba=diario`;
  }));
  alvo.querySelectorAll('[data-falta]').forEach(s => s.addEventListener('change', async () => {
    const valor = s.dataset.campo === 'cobrado' ? s.value === 'true' : s.value;
    await api.put('/api/faltas/' + s.dataset.falta, { [s.dataset.campo]: valor });
    aviso('Falta atualizada.');
  }));
};

/* ============================ EVOLUÇÃO (geral) ============================ */
App.paginas.evolucao = async (alvo, rota) => {
  const pacientes = await api.get('/api/pacientes');
  const ativos = pacientes.filter(p => p.status !== 'Inativo');
  const id = rota.query.paciente || ativos[0]?.id;
  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Evolução', 'Linha do tempo construída a partir dos registros de sessão',
    selecao('paciente', ativos.map(p => [p.id, p.nome]), id, 'id="sel-paciente" style="min-width:250px"') +
    (id ? `<button class="btn btn-primario" id="gerar-relatorio">${ico('relatorios')} Gerar relatório</button>` : ''))}
    <div id="area-evolucao"><div class="vazio-estado">Carregando…</div></div>
  </div>`;
  alvo.querySelector('#sel-paciente').addEventListener('change', (e) => location.hash = '/evolucao?paciente=' + e.target.value);
  /* Ler a evolução e concluir que é hora do relatório é o caminho natural:
     o botão evita ter de ir até Relatórios e escolher o paciente de novo. */
  alvo.querySelector('#gerar-relatorio')?.addEventListener('click', () => modalNovoRelatorio(Number(id)));
  if (id) abaEvolucao(alvo.querySelector('#area-evolucao'), { id: Number(id) });
};

/* =============================== RELATÓRIOS =============================== */
App.paginas.relatorios = async (alvo) => {
  const relatorios = await api.get('/api/relatorios');
  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Relatórios', 'Documentos gerados a partir dos registros do acompanhamento',
    `<button class="btn btn-primario" id="novo">${ico('mais')} Novo relatório</button>`)}
    <div class="painel"><div class="painel-corpo sem-padding">
      ${tabela(['Paciente', 'Tipo', 'Período', 'Profissional', 'Situação', 'Criado em', ''],
      relatorios.map(r => `<tr>
          <td class="td-principal">${esc(r.paciente?.nome || '')}</td>
          <td>${esc(r.tipo)}</td>
          <td class="td-secundario">${dataBR(r.periodo_inicio)} a ${dataBR(r.periodo_fim)}</td>
          <td class="td-secundario">${esc(r.profissional?.nome || '')}</td>
          <td><span class="tag simples ${r.status === 'Concluído' ? 't-pago' : 't-pendente'}">${esc(r.status)}</span></td>
          <td class="td-secundario">${dataBR(r.criado_em)}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sutil" data-ver="${r.id}">Abrir</button>
            <button class="btn btn-sutil" data-excluir="${r.id}">${ico('lixeira')}</button>
          </td></tr>`), { vazio: 'Nenhum relatório criado.' })}
    </div></div></div>`;
  alvo.querySelector('#novo').addEventListener('click', () => modalNovoRelatorio());
  alvo.querySelectorAll('[data-ver]').forEach(b => b.addEventListener('click', () =>
    visualizarRelatorio(relatorios.find(r => r.id === Number(b.dataset.ver)))));
  alvo.querySelectorAll('[data-excluir]').forEach(b => b.addEventListener('click', () =>
    confirmar('Excluir este relatório?', async () => { await api.del('/api/relatorios/' + b.dataset.excluir); navegar(); })));
};

async function modalNovoRelatorio(pacienteId) {
  const pacientes = await api.get('/api/pacientes');
  const id = pacienteId || pacientes[0]?.id;
  abrirModal({
    titulo: 'Novo relatório',
    largo: true,
    corpo: `<form id="form-r">
      <div class="linha-campos tres">
        ${campo('Paciente', selecao('paciente_id', pacientes.map(p => [p.id, p.nome]), id, 'id="r-paciente"'))}
        ${campo('Início do período', entrada('periodo_inicio', somaDias(hojeISO(), -90), 'date', 'id="r-de"'))}
        ${campo('Fim do período', entrada('periodo_fim', hojeISO(), 'date', 'id="r-ate"'))}
      </div>
      ${campo('Tipo de relatório', selecao('tipo', ['Relatório de evolução', 'Relatório de acompanhamento', 'Relatório para responsáveis', 'Relatório personalizado']))}
      <div class="aviso info" id="base-info">Carregando os dados registrados no período…</div>
      <fieldset><legend>Seções do documento</legend>
        <div id="secoes" style="display:grid;gap:6px;margin-bottom:12px"></div>
      </fieldset>
      <div id="campos-texto"></div>
    </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button>
             <button class="btn" id="rascunho">Salvar rascunho</button>
             <button class="btn btn-primario" id="gerar">Gerar documento</button>`,
    aoAbrir: async (f) => {
      const carregar = async () => {
        const escolhido = f.querySelector('#r-paciente').value;
        if (!escolhido) {
          f.querySelector('#base-info').innerHTML =
            'Nenhum paciente cadastrado ainda. Cadastre o paciente e registre os atendimentos para gerar um relatório.';
          return;
        }
        const base = await api.get('/api/relatorios/base/' + escolhido,
          { de: f.querySelector('#r-de').value, ate: f.querySelector('#r-ate').value });
        f.querySelector('#base-info').innerHTML =
          `No período: <b>${base.sessoes_realizadas}</b> sessões realizadas, <b>${base.registros}</b> com diário registrado, <b>${base.faltas}</b> falta(s).
           Os campos abaixo vêm dos seus registros — revise e ajuste o texto antes de gerar.`;
        const secoes = [
          ['objetivos', 'Objetivos trabalhados', base.objetivos.join(' ')],
          ['estrategias', 'Estratégias e atividades utilizadas', [...base.atividades, ...base.recursos].join(' ')],
          ['evolucao', 'Evolução observada', base.evolucoes.join(' ')],
          ['pendencias', 'Pontos que ainda precisam ser trabalhados', base.dificuldades.join(' ')],
          ['recomendacoes', 'Recomendações', base.orientacoes.join(' ')],
          ['consideracoes', 'Considerações finais', '']
        ];
        f.querySelector('#secoes').innerHTML = secoes.map(s => `
          <label style="display:flex;gap:8px;align-items:center;font-size:13.5px">
            <input type="checkbox" checked data-secao="${s[0]}" style="width:18px;min-height:18px"> ${s[1]}</label>`).join('');
        f.querySelector('#campos-texto').innerHTML = secoes.map(s => `
          <div class="campo" data-bloco="${s[0]}"><label>${s[1]}</label><textarea name="${s[0]}" rows="3">${esc(s[2])}</textarea></div>`).join('');
        f.querySelectorAll('[data-secao]').forEach(c => c.addEventListener('change', () => {
          f.querySelector(`[data-bloco="${c.dataset.secao}"]`).style.display = c.checked ? '' : 'none';
        }));
      };
      await carregar();
      ['#r-paciente', '#r-de', '#r-ate'].forEach(s => f.querySelector(s).addEventListener('change', carregar));

      const montar = (status) => {
        const d = dadosFormulario(f.querySelector('#form-r'));
        const conteudo = {};
        f.querySelectorAll('[data-secao]').forEach(c => { if (c.checked) conteudo[c.dataset.secao] = d[c.dataset.secao]; });
        return { paciente_id: Number(d.paciente_id), tipo: d.tipo, periodo_inicio: d.periodo_inicio, periodo_fim: d.periodo_fim, conteudo, status };
      };
      f.querySelector('#rascunho').addEventListener('click', async () => {
        await api.post('/api/relatorios', montar('Rascunho')); fecharModal(true); aviso('Rascunho salvo.'); navegar();
      });
      f.querySelector('#gerar').addEventListener('click', async () => {
        const r = await api.post('/api/relatorios', montar('Concluído'));
        fecharModal(true);
        const completo = (await api.get('/api/relatorios')).find(x => x.id === r.id);
        visualizarRelatorio(completo);
      });
    }
  });
}

function visualizarRelatorio(r) {
  if (!r) return;
  const c = r.conteudo || {};
  const rotulos = {
    objetivos: 'Objetivos trabalhados', estrategias: 'Estratégias utilizadas', evolucao: 'Evolução observada',
    pendencias: 'Pontos que ainda precisam ser trabalhados', recomendacoes: 'Recomendações', consideracoes: 'Considerações finais'
  };
  const cfg = App.config;
  abrirModal({
    titulo: r.tipo, largo: true,
    corpo: `<div class="documento" id="doc">
      <div class="doc-cabecalho">
        <img src="/assets/marca.png" alt="PsicoAprender" style="width:52px;height:52px;border-radius:8px;object-fit:cover">
        <div><div style="font-weight:700;font-size:16px">PsicoAprender <span style="font-weight:500;color:#6f9c72">· Espaço de Aprendizagem</span></div>
          <div style="font-size:11.5px;color:#666">${esc(cfg.endereco || '')}${cfg.telefone ? ' · ' + esc(cfg.telefone) : ''}${cfg.instagram ? ' · ' + esc(cfg.instagram) : ''}</div></div>
        <div style="margin-left:auto;font-size:11.5px;color:#666;text-align:right">Documento emitido em<br><b>${dataBR(hojeISO())}</b></div>
      </div>
      <h1>${esc(r.tipo).toUpperCase()}</h1>
      <div class="doc-dados">
        <div><b>Paciente:</b> ${esc(r.paciente?.nome || '')}</div>
        <div><b>Data de nascimento:</b> ${dataBR(r.paciente?.nascimento)}</div>
        <div><b>Período analisado:</b> ${dataBR(r.periodo_inicio)} a ${dataBR(r.periodo_fim)}</div>
        <div><b>Profissional:</b> ${esc(r.profissional?.nome || '')}</div>
        <div><b>Responsável:</b> ${esc(r.paciente?.responsaveis?.[0]?.nome || '—')}</div>
        <div><b>Registro profissional:</b> ${esc(r.profissional?.registro || '—')}</div>
      </div>
      ${Object.entries(c).filter(([, v]) => (v || '').trim()).map(([k, v]) =>
      `<h3>${rotulos[k] || k}</h3><p>${esc(v).replace(/\n/g, '<br>')}</p>`).join('')}
      <div class="assinatura">
        <div class="linha-assinatura"></div>
        <div style="font-size:13px"><b>${esc(r.profissional?.nome || '')}</b></div>
        <div style="font-size:12px;color:#555">${esc(r.profissional?.profissao || '')} · ${esc(r.profissional?.registro || '')}</div>
      </div>
      <div class="doc-rodape"><span>PsicoAprender — Espaço de Aprendizagem · ${esc(cfg.email || '')}</span><span>Página 1 de 1</span></div>
    </div>`,
    rodape: `<button class="btn" data-fechar>Fechar</button>
             <button class="btn btn-primario" id="imprimir">${ico('imprimir')} Exportar em PDF</button>`,
    aoAbrir: (f) => f.querySelector('#imprimir').addEventListener('click', () => window.print())
  });
}

/* =============================== FINANCEIRO =============================== */
App.paginas.financeiro = async (alvo, rota) => {
  const competencia = rota.query.competencia || hojeISO().slice(0, 7);
  const status = rota.query.status || '';
  const [resumo, pagamentos] = await Promise.all([
    api.get('/api/financeiro/resumo', { competencia }),
    api.get('/api/pagamentos', { status })
  ]);
  const doMes = status ? pagamentos : pagamentos.filter(p => p.competencia === competencia);

  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Financeiro',
    App.permissoes.todos_pacientes
      ? 'Controle de mensalidades e recebimentos'
      : 'Mensalidades e recebimentos dos seus pacientes',
    `<input type="month" value="${competencia}" id="mes" style="width:auto">
       <button class="btn btn-primario" id="novo">${ico('mais')} Lançamento</button>`)}

    <div class="grade g-4" style="margin-bottom:16px">
      ${indicador('Recebido no mês', moeda(resumo.recebido), '', 'destaque')}
      ${indicador('A receber', moeda(resumo.a_receber))}
      ${indicador('Em atraso', moeda(resumo.em_atraso), '', resumo.em_atraso ? 'alerta' : '')}
      ${indicador('Atendimentos realizados', resumo.total_atendimentos, 'no mês')}
    </div>

    <div class="grade g-agenda">
      <section class="painel">
        <div class="painel-titulo"><h2>Lançamentos</h2>
          <div class="acoes"><div class="escolhas">
            ${[['', 'Todos'], ['pendente', 'Pendentes'], ['em_atraso', 'Em atraso'], ['pago', 'Pagos']].map(s =>
      `<div class="escolha ${status === s[0] ? 'ativa' : ''}" data-status="${s[0]}">${s[1]}</div>`).join('')}
          </div></div></div>
        <div class="painel-corpo sem-padding">
          ${tabela(['Paciente', 'Descrição', 'Vencimento', 'Valor', 'Forma', 'Status', ''],
        doMes.map(p => `<tr>
              <td class="td-principal">${esc(p.paciente?.nome || '')}</td>
              <td class="td-secundario">${esc(p.descricao || '')}</td>
              <td class="td-secundario">${dataBR(p.vencimento)}</td>
              <td class="td-principal">${moeda(p.valor)}</td>
              <td class="td-secundario">${esc(p.forma || '—')}</td>
              <td>${tag(p.status, ROTULO_PAGTO)}</td>
              <td style="text-align:right;white-space:nowrap">
                ${p.status !== 'pago' ? `<button class="btn btn-sutil" data-pagar="${p.id}">Registrar pagamento</button>` : ''}
                ${p.status === 'em_atraso' ? `<button class="btn btn-sutil" data-cobrar="${p.paciente_id}" data-valor="${p.valor}" data-venc="${p.vencimento}">${ico('whatsapp')}</button>` : ''}
                <button class="btn btn-sutil" data-excluir="${p.id}">${ico('lixeira')}</button>
              </td></tr>`), { vazio: 'Nenhum lançamento no período.' })}
        </div>
      </section>

      <div style="display:grid;gap:16px">
        <section class="painel"><div class="painel-titulo"><h2>${App.permissoes.todos_pacientes ? 'Faturamento por profissional' : 'Meu faturamento'}</h2></div>
          <div class="painel-corpo sem-padding"><ul class="lista-limpa">
            ${resumo.por_profissional.map(p => `<li>
              <div style="flex:1"><div class="td-principal">${esc(p.profissional)}</div>
                <div class="td-secundario">Previsto ${moeda(p.previsto)}</div></div>
              <strong>${moeda(p.recebido)}</strong></li>`).join('')}
          </ul></div></section>
        <section class="painel"><div class="painel-titulo"><h2>Recebimentos por mês</h2></div>
          <div class="painel-corpo"><ul class="lista-limpa" style="margin:-16px">
            ${resumo.serie_mensal.map(m => {
          const max = Math.max(...resumo.serie_mensal.map(x => x.recebido), 1);
          return `<li style="flex-direction:column;gap:5px">
                <div style="display:flex;width:100%"><span class="td-secundario">${MESES[Number(m.competencia.slice(5, 7)) - 1]}</span>
                  <strong style="margin-left:auto">${moeda(m.recebido)}</strong></div>
                <div class="barra-progresso" style="width:100%"><i style="width:${(m.recebido / max) * 100}%"></i></div></li>`;
        }).join('')}
          </ul></div></section>
      </div>
    </div>
  </div>`;

  alvo.querySelector('#mes').addEventListener('change', (e) => location.hash = '/financeiro?competencia=' + e.target.value);
  alvo.querySelectorAll('[data-status]').forEach(el => el.addEventListener('click', () =>
    location.hash = '/financeiro?competencia=' + competencia + (el.dataset.status ? '&status=' + el.dataset.status : '')));
  alvo.querySelector('#novo').addEventListener('click', () => modalPagamento(competencia));
  alvo.querySelectorAll('[data-pagar]').forEach(b => b.addEventListener('click', () => modalBaixa(b.dataset.pagar)));
  alvo.querySelectorAll('[data-excluir]').forEach(b => b.addEventListener('click', () =>
    confirmar('Excluir este lançamento?', async () => { await api.del('/api/pagamentos/' + b.dataset.excluir); navegar(); })));
  alvo.querySelectorAll('[data-cobrar]').forEach(b => b.addEventListener('click', async () => {
    const p = await api.get('/api/pacientes/' + b.dataset.cobrar);
    modalWhatsapp(p, { valor: moeda(b.dataset.valor), vencimento: dataBR(b.dataset.venc) });
  }));
};

async function modalPagamento(competencia, pacienteId) {
  const pacientes = await api.get('/api/pacientes');
  abrirModal({
    titulo: 'Novo lançamento',
    corpo: `<form id="form-pg">
      ${campo('Paciente', selecao('paciente_id', pacientes.map(p => [p.id, p.nome]), pacienteId, 'id="pg-pac"'))}
      <div class="linha-campos tres">
        ${campo('Competência', entrada('competencia', competencia, 'month'))}
        ${campo('Sessões', entrada('sessoes', '4', 'number', 'id="pg-sessoes" min="1"'))}
        ${campo('Valor total', entrada('valor', '', 'number', 'id="pg-valor" step="0.01"'))}
      </div>
      ${campo('Descrição', entrada('descricao', 'Mensalidade'))}
      <div class="linha-campos tres">
        ${campo('Vencimento', entrada('vencimento', competencia + '-10', 'date'))}
        ${campo('Forma', selecao('forma', ['', 'PIX', 'Dinheiro', 'Cartão', 'Transferência', 'Outros']))}
        ${campo('Status', selecao('status', [['pendente', 'Pendente'], ['pago', 'Pago'], ['cancelado', 'Cancelado']]))}
      </div>
    </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="s">Salvar</button>`,
    aoAbrir: (f) => {
      const calcular = () => {
        const p = pacientes.find(x => x.id === Number(f.querySelector('#pg-pac').value));
        f.querySelector('#pg-valor').value = (p?.valor_sessao || 0) * Number(f.querySelector('#pg-sessoes').value || 0);
      };
      calcular();
      f.querySelector('#pg-pac').addEventListener('change', calcular);
      f.querySelector('#pg-sessoes').addEventListener('input', calcular);
      f.querySelector('#s').addEventListener('click', async () => {
        const d = dadosFormulario(f.querySelector('#form-pg'));
        if (d.status === 'pago') d.pago_em = hojeISO();
        await api.post('/api/pagamentos', d);
        fecharModal(true); aviso('Lançamento criado.'); navegar();
      });
    }
  });
}

function modalBaixa(id) {
  abrirModal({
    titulo: 'Registrar pagamento',
    corpo: `<form id="form-b">
      <div class="linha-campos">
        ${campo('Data do pagamento', entrada('pago_em', hojeISO(), 'date'))}
        ${campo('Forma de pagamento', selecao('forma', ['PIX', 'Dinheiro', 'Cartão', 'Transferência', 'Outros']))}
      </div>
      ${campo('Observação', entrada('observacao'))}</form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="s">Confirmar recebimento</button>`,
    aoAbrir: (f) => f.querySelector('#s').addEventListener('click', async () => {
      await api.put('/api/pagamentos/' + id, { ...dadosFormulario(f.querySelector('#form-b')), status: 'pago' });
      fecharModal(true); aviso('Pagamento registrado.'); navegar();
    })
  });
}

async function abaFinanceiro(cont, p) {
  const pagamentos = await api.get('/api/pagamentos', { paciente_id: p.id });
  const ats = await api.get('/api/atendimentos', { paciente_id: p.id, status: 'realizado' });
  cont.innerHTML = `
    <div class="grade g-4" style="margin-bottom:16px">
      ${indicador('Sessões realizadas', ats.length)}
      ${indicador('Valor por sessão', moeda(p.valor_sessao))}
      ${indicador('Em aberto', moeda(p.financeiro.aberto))}
      ${indicador('Em atraso', moeda(p.financeiro.atraso), '', p.financeiro.atraso ? 'alerta' : '')}
    </div>
    <div class="painel">
      <div class="painel-titulo"><h2>Histórico financeiro</h2>
        <div class="acoes"><button class="btn btn-sutil" id="novo">${ico('mais')} Lançamento</button></div></div>
      <div class="painel-corpo sem-padding">
        ${tabela(['Competência', 'Descrição', 'Vencimento', 'Valor', 'Pago em', 'Forma', 'Status', ''],
    pagamentos.map(x => `<tr>
            <td class="td-principal">${esc(x.competencia || '')}</td>
            <td class="td-secundario">${esc(x.descricao || '')}</td>
            <td class="td-secundario">${dataBR(x.vencimento)}</td>
            <td>${moeda(x.valor)}</td>
            <td class="td-secundario">${x.pago_em ? dataBR(x.pago_em) : '—'}</td>
            <td class="td-secundario">${esc(x.forma || '—')}</td>
            <td>${tag(x.status, ROTULO_PAGTO)}</td>
            <td style="text-align:right">${x.status !== 'pago' ? `<button class="btn btn-sutil" data-pagar="${x.id}">Baixar</button>` : ''}</td>
          </tr>`), { vazio: 'Nenhum lançamento.' })}
      </div></div>`;
  cont.querySelector('#novo').addEventListener('click', () => modalPagamento(hojeISO().slice(0, 7), p.id));
  cont.querySelectorAll('[data-pagar]').forEach(b => b.addEventListener('click', () => modalBaixa(b.dataset.pagar)));
}

/* =============================== DOCUMENTOS =============================== */
const CATEGORIAS_DOC = ['Termo de consentimento', 'Autorização dos responsáveis', 'Contrato',
  'Autorização de imagem', 'Avaliação externa', 'Relatório', 'Documento enviado pelos responsáveis', 'Outros'];

App.paginas.documentos = async (alvo) => {
  const [docs, pacientes] = await Promise.all([api.get('/api/documentos'), api.get('/api/pacientes')]);
  const pendentes = pacientes.filter(p => p.documentacao === 'pendente' && p.status !== 'Inativo');
  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Documentos', 'Termos, autorizações e arquivos por paciente',
    `<button class="btn btn-primario" id="novo">${ico('upload')} Anexar documento</button>`)}
    ${pendentes.length ? `<div class="aviso atencao"><b>${pendentes.length} paciente(s) com documentação pendente:</b>
      ${pendentes.slice(0, 6).map(p => esc(p.nome)).join(' · ')}</div>` : ''}
    <div class="painel"><div class="painel-corpo sem-padding">
      ${tabela(['Documento', 'Paciente', 'Categoria', 'Enviado em', 'Enviado por', ''],
      docs.map(d => `<tr>
          <td class="td-principal">${esc(d.nome)}</td>
          <td class="td-secundario">${esc(d.paciente?.nome || '')}</td>
          <td><span class="tag simples t-neutro">${esc(d.categoria)}</span></td>
          <td class="td-secundario">${dataBR(d.enviado_em)}</td>
          <td class="td-secundario">${esc(d.enviado_por || '')}</td>
          <td style="text-align:right;white-space:nowrap">
            <a class="btn btn-sutil" href="${comToken(`/api/documentos/${d.id}/download`)}" download>${ico('baixar')}</a>
            <button class="btn btn-sutil" data-excluir="${d.id}">${ico('lixeira')}</button>
          </td></tr>`), { vazio: 'Nenhum documento anexado.' })}
    </div></div></div>`;
  alvo.querySelector('#novo').addEventListener('click', () => modalDocumento(pacientes));
  alvo.querySelectorAll('[data-excluir]').forEach(b => b.addEventListener('click', () =>
    confirmar('Excluir este documento? A ação ficará registrada no log de auditoria.', async () => {
      await api.del('/api/documentos/' + b.dataset.excluir); navegar();
    })));
};

async function modalDocumento(pacientes, pacienteId) {
  const lista = pacientes || await api.get('/api/pacientes');
  abrirModal({
    titulo: 'Anexar documento',
    corpo: `<form id="form-doc">
      ${campo('Paciente', selecao('paciente_id', lista.map(p => [p.id, p.nome]), pacienteId))}
      ${campo('Categoria', selecao('categoria', CATEGORIAS_DOC))}
      ${campo('Arquivo', '<input type="file" id="arq" style="padding:8px">', 'PDF, imagens ou documentos até 20 MB.')}
    </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="s">Anexar</button>`,
    aoAbrir: (f) => f.querySelector('#s').addEventListener('click', async () => {
      const arquivo = f.querySelector('#arq').files[0];
      if (!arquivo) return aviso('Selecione um arquivo.', 'erro');
      const d = dadosFormulario(f.querySelector('#form-doc'));
      const leitor = new FileReader();
      leitor.onload = async () => {
        try {
          await api.post('/api/documentos', { ...d, nome: arquivo.name, tipo: arquivo.type, conteudo: leitor.result });
          fecharModal(true); aviso('Documento anexado.'); navegar();
        } catch (e) { erroAviso(e); }
      };
      leitor.readAsDataURL(arquivo);
    })
  });
}

async function abaDocumentos(cont, p) {
  const docs = await api.get('/api/documentos', { paciente_id: p.id });
  const obrigatorios = ['Termo de consentimento', 'Contrato', 'Autorização de imagem'];
  cont.innerHTML = `
    <div class="painel" style="margin-bottom:16px">
      <div class="painel-titulo"><h2>Consentimentos e contratos</h2></div>
      <div class="painel-corpo sem-padding"><ul class="lista-limpa">
        ${obrigatorios.map(c => {
    const tem = docs.find(d => d.categoria === c);
    return `<li><span style="flex:1">${c}</span>
            ${tem ? `<span class="tag simples t-pago">Entregue em ${dataBR(tem.enviado_em)}</span>`
        : '<span class="tag simples t-pendente">Pendente</span>'}</li>`;
  }).join('')}
      </ul></div>
    </div>
    <div class="painel">
      <div class="painel-titulo"><h2>Arquivos (${docs.length})</h2>
        <div class="acoes"><button class="btn btn-sutil" id="novo">${ico('upload')} Anexar</button></div></div>
      <div class="painel-corpo sem-padding">
        ${tabela(['Documento', 'Categoria', 'Enviado em', ''], docs.map(d => `<tr>
          <td class="td-principal">${esc(d.nome)}</td>
          <td><span class="tag simples t-neutro">${esc(d.categoria)}</span></td>
          <td class="td-secundario">${dataBR(d.enviado_em)}</td>
          <td style="text-align:right"><a class="btn btn-sutil" href="${comToken(`/api/documentos/${d.id}/download`)}" download>${ico('baixar')}</a></td>
        </tr>`), { vazio: 'Nenhum documento anexado.' })}
      </div></div>`;
  cont.querySelector('#novo').addEventListener('click', async () => modalDocumento(null, p.id));
}

/* =============================== RESPONSÁVEIS =============================== */
App.paginas.responsaveis = async (alvo) => {
  const pacientes = await api.get('/api/pacientes');
  const linhas = [];
  pacientes.forEach(p => (p.responsaveis || []).forEach(r => linhas.push({ ...r, paciente: p })));
  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Responsáveis', `${linhas.length} contato(s) cadastrado(s)`,
    `<button class="btn btn-primario" id="novo-resp">${ico('mais')} Cadastrar responsável</button>`)}
    <div class="aviso info" style="margin-bottom:14px">O responsável é cadastrado dentro da ficha da criança,
      porque é lá que fica o vínculo. Esta tela reúne todos os contatos num lugar só.</div>
    <div class="painel"><div class="painel-corpo sem-padding">
      ${tabela(['Responsável', 'Parentesco', 'Criança', 'Telefone', 'E-mail', ''],
      linhas.map(r => `<tr class="clicavel" data-p="${r.paciente.id}">
          <td class="td-principal">${esc(r.nome)}</td>
          <td class="td-secundario">${esc(r.parentesco || '')}</td>
          <td>${esc(r.paciente.nome)}</td>
          <td class="td-secundario">${esc(r.telefone || '—')}</td>
          <td class="td-secundario">${esc(r.email || '—')}</td>
          <td style="text-align:right"><button class="btn btn-sutil" data-wpp="${r.paciente.id}">${ico('whatsapp')}</button></td>
        </tr>`), { vazio: 'Nenhum responsável cadastrado.' })}
    </div></div></div>`;
  /* Cadastrar responsável a partir daqui: escolhe a criança e abre a ficha dela,
     que é onde o vínculo existe. Evita a tela virar um beco sem saída. */
  alvo.querySelector('#novo-resp')?.addEventListener('click', () => {
    if (!pacientes.length) return aviso('Cadastre uma criança primeiro — o responsável fica vinculado a ela.');
    abrirModal({
      titulo: 'Cadastrar responsável',
      corpo: `<div class="campo"><label>De qual criança?</label>
          ${selecao('paciente_id', pacientes.map(p => [p.id, p.nome]), pacientes[0].id, 'id="resp-pac"')}</div>
        <div class="ajuda">A ficha da criança será aberta na seção de responsáveis.</div>`,
      rodape: `<button class="btn" data-fechar>Cancelar</button>
        <button class="btn btn-primario" id="ir">Abrir ficha</button>`,
      aoAbrir: (f) => f.querySelector('#ir').addEventListener('click', async () => {
        const pid = Number(f.querySelector('#resp-pac').value);
        fecharModal(true);
        modalPaciente(await api.get('/api/pacientes/' + pid));
      })
    });
  });

  alvo.querySelectorAll('tr[data-p]').forEach(tr => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-wpp]')) return;
    location.hash = '/paciente/' + tr.dataset.p;
  }));
  alvo.querySelectorAll('[data-wpp]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    modalWhatsapp(await api.get('/api/pacientes/' + b.dataset.wpp));
  }));
};

/* =============================== PROFISSIONAIS =============================== */
App.paginas.profissionais = async (alvo) => {
  const profs = await api.get('/api/profissionais');
  const podeEditar = App.permissoes.profissionais;
  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Profissionais', 'Equipe que atende no espaço',
    podeEditar ? `<button class="btn btn-primario" id="novo">${ico('mais')} Nova profissional</button>` : '')}
    <div class="grade g-3">
      ${profs.map(p => `<section class="painel">
        <div class="painel-corpo" style="display:flex;gap:14px;align-items:flex-start">
          ${p.foto ? `<img class="avatar avatar-foto grande" src="${esc(p.foto)}" alt="${esc(p.nome)}" style="width:72px;height:72px">`
            : `<div class="avatar grande" style="background:${esc(p.cor || '#6f5493')}">${iniciais(p.nome)}</div>`}
          <div style="min-width:0;flex:1">
            <div style="font-weight:650;font-size:15px">${esc(p.nome)}</div>
            <div style="color:var(--roxo);font-size:13px;font-weight:600">${esc(p.profissao || '')}</div>
            ${p.formacao ? `<div class="td-secundario">${esc(p.formacao)}</div>` : ''}
            ${p.especialidades ? `<div class="td-secundario" style="margin-top:6px;line-height:1.45">${esc(p.especialidades)}</div>` : ''}
            <div class="td-secundario" style="margin-top:6px">${esc(p.email || '')}${p.telefone ? ' · ' + esc(p.telefone) : ''}</div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              <span class="tag simples ${p.status === 'Ativo' ? 't-pago' : 't-neutro'}">${esc(p.status || '')}</span>
              <span class="tag simples t-neutro">${p.pacientes} pacientes</span>
              ${p.usuario ? `<span class="tag simples t-neutro">Acesso: ${({ admin: 'Administrador', profissional: 'Profissional', administrativo: 'Administrativo' })[p.usuario.papel]}</span>` : '<span class="tag simples t-pendente">Sem acesso ao sistema</span>'}
              ${App.sessao.papel !== 'administrativo'
                ? `<span class="tag simples ${p.ficha_preenchida ? 't-pago' : 't-pendente'}">Ficha ${p.ficha_preenchida ? 'preenchida' : 'pendente'}</span>` : ''}
            </div>
            ${App.sessao.papel !== 'administrativo' ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-sutil" data-ficha="${p.id}">
                ${p.ficha_preenchida ? 'Ver ficha cadastral' : 'Preencher ficha cadastral'}</button>
            </div>` : ''}
          </div>
          ${podeEditar ? `<button class="btn btn-sutil btn-icone" data-editar="${p.id}">${ico('editar')}</button>` : ''}
        </div></section>`).join('')}
    </div>
    ${podeEditar ? `<div class="aviso info" style="margin-top:16px">
      Perfis de acesso: <b>Administrador</b> (acesso total) · <b>Profissional</b> (apenas seus pacientes e registros) ·
      <b>Administrativo</b> (agenda e financeiro, sem acesso a informações clínicas).</div>` : ''}
  </div>`;
  alvo.querySelector('#novo')?.addEventListener('click', () => modalProfissional());
  alvo.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () =>
    modalProfissional(profs.find(p => p.id === Number(b.dataset.editar)))));
  alvo.querySelectorAll('[data-ficha]').forEach(b => b.addEventListener('click', () =>
    fichaProfissional(profs.find(p => p.id === Number(b.dataset.ficha)))));
};

/**
 * Ficha cadastral da profissional — espelha o formulário em papel da PsicoAprender.
 * Visível apenas para a equipe clínica; cada uma edita a própria ficha
 * (a administradora pode editar as demais).
 */
function fichaProfissional(p) {
  if (!p) return;
  const souEu = App.sessao.profissional_id === p.id;
  const podeEditar = souEu || App.sessao.papel === 'admin';
  const v = (c) => p[c] || '';

  abrirModal({
    titulo: 'Ficha cadastral — ' + p.nome,
    largo: true,
    corpo: `<form id="form-ficha">
      ${!podeEditar ? '<div class="aviso info" style="margin-bottom:14px">Somente leitura: apenas a própria profissional ou a administradora podem alterar esta ficha.</div>' : ''}
      <div class="aviso info" style="margin-bottom:16px">
        Estes dados ficam visíveis apenas para a equipe (administradora e profissionais).
        O perfil administrativo e o site público não têm acesso.
      </div>

      <fieldset><legend>Dados pessoais</legend>
        <div class="linha-campos">
          ${campo('Data de nascimento', entrada('nascimento', v('nascimento'), 'date'))}
          ${campo('Sexo', selecao('sexo', [['', '—'], 'Feminino', 'Masculino', 'Prefiro não informar'], v('sexo')))}
        </div>
        ${campo('Endereço', entrada('endereco', v('endereco')))}
        <div class="linha-campos">
          ${campo('CPF', entrada('cpf', v('cpf')))}
          ${campo('Telefone', entrada('telefone_pessoal', v('telefone_pessoal'), 'tel'))}
        </div>
      </fieldset>

      <fieldset><legend>Formação</legend>
        <div class="linha-campos">
          ${campo('1ª graduação', entrada('graduacao_1', v('graduacao_1')))}
          ${campo('Instituição', entrada('instituicao_1', v('instituicao_1')))}
        </div>
        <div class="linha-campos">
          ${campo('2ª graduação', entrada('graduacao_2', v('graduacao_2')))}
          ${campo('Instituição', entrada('instituicao_2', v('instituicao_2')))}
        </div>
        ${campo('Especialização', entrada('especializacao_1', v('especializacao_1')))}
        ${campo('Especialização', entrada('especializacao_2', v('especializacao_2')))}
        ${campo('Especialização', entrada('especializacao_3', v('especializacao_3')))}
      </fieldset>

      <fieldset><legend>Contato de emergência</legend>
        ${campo('Nome', entrada('emergencia_nome', v('emergencia_nome')))}
        <div class="linha-campos">
          ${campo('Telefone', entrada('emergencia_telefone', v('emergencia_telefone'), 'tel'))}
          ${campo('Parentesco', entrada('emergencia_parentesco', v('emergencia_parentesco')))}
        </div>
      </fieldset>

      <fieldset><legend>Áreas de atuação</legend>
        ${campo('Áreas de atuação', area('areas_atuacao', v('areas_atuacao'), 2))}
        ${campo('Idades atendidas', entrada('idades_atendidas', v('idades_atendidas')), 'Ex.: 3 a 12 anos')}
        ${campo('Possui maior domínio, experiência ou conhecimento em alguma área específica? Quais?', area('dominio_especifico', v('dominio_especifico'), 2))}
      </fieldset>

      <fieldset><legend>Disponibilidade</legend>
        ${campo('Dias e turnos', area('disponibilidade', v('disponibilidade'), 2), 'Ex.: segunda e quarta, manhã; terça, tarde')}
        ${campo('Atendimentos no espaço ou domiciliar?', selecao('local_atendimento', [['', '—'], 'No espaço', 'Domiciliar', 'No espaço e domiciliar'], v('local_atendimento')))}
      </fieldset>

      ${podeEditar ? `<label style="display:flex;gap:9px;align-items:flex-start;margin-top:6px">
        <input type="checkbox" id="assino" style="width:18px;min-height:18px;margin-top:3px" ${v('ficha_assinada_em') ? 'checked' : ''}>
        <span class="td-secundario">Declaro que as informações acima são verdadeiras.${v('ficha_assinada_em') ? `<br><b>Assinada em ${new Date(p.ficha_assinada_em).toLocaleDateString('pt-BR')}</b>` : ''}</span>
      </label>` : ''}
    </form>`,
    rodape: podeEditar
      ? `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="salvar-ficha">Salvar ficha</button>`
      : `<button class="btn" data-fechar>Fechar</button>`,
    aoAbrir: (f) => {
      if (!podeEditar) f.querySelectorAll('#form-ficha input, #form-ficha select, #form-ficha textarea')
        .forEach(el => { el.disabled = true; });
      f.querySelector('#salvar-ficha')?.addEventListener('click', async () => {
        const dados = dadosFormulario(f.querySelector('#form-ficha'));
        dados.ficha_assinada_em = f.querySelector('#assino')?.checked
          ? (p.ficha_assinada_em || new Date().toISOString()) : '';
        try {
          await api.put(`/api/profissionais/${p.id}/ficha`, dados);
          fecharModal(true); aviso('Ficha cadastral salva.'); navegar();
        } catch (e) { erroAviso(e); }
      });
    }
  });
}

function modalProfissional(p = null) {
  const d = p || {};
  abrirModal({
    titulo: p ? 'Editar profissional' : 'Nova profissional',
    corpo: `<form id="form-prof">
      <div class="linha-campos">
        ${campo('Nome *', entrada('nome', d.nome, 'text', 'required'))}
        ${campo('Profissão', entrada('profissao', d.profissao))}
      </div>
      <div class="linha-campos tres">
        ${campo('Registro profissional', entrada('registro', d.registro))}
        ${campo('Telefone', entrada('telefone', d.telefone))}
        ${campo('Status', selecao('status', ['Ativo', 'Inativo'], d.status || 'Ativo'))}
      </div>
      ${campo('E-mail', entrada('email', d.email, 'email'))}
      ${campo('Formação', entrada('formacao', d.formacao), 'Ex.: Formação em Pedagogia — UnB')}
      ${campo('Especialidades', area('especialidades', d.especialidades, 2))}
      ${campo('Foto (caminho ou URL)', entrada('foto', d.foto), 'Ex.: /assets/equipe/vanessa.jpg')}
      ${!p ? `<fieldset><legend>Acesso ao sistema</legend>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <input type="checkbox" name="criar_usuario" checked style="width:18px;min-height:18px"> Criar login para esta profissional</label>
        <div class="linha-campos">
          ${campo('Perfil de acesso', selecao('papel', [['profissional', 'Profissional'], ['administrativo', 'Administrativo'], ['admin', 'Administrador']]))}
          ${campo('Senha inicial', entrada('senha', 'psico123'))}
        </div></fieldset>` : ''}
    </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="s">Salvar</button>`,
    aoAbrir: (f) => f.querySelector('#s').addEventListener('click', async () => {
      const form = f.querySelector('#form-prof');
      if (!form.reportValidity()) return;
      const dados = dadosFormulario(form);
      dados.criar_usuario = !!dados.criar_usuario;
      try {
        if (p) await api.put('/api/profissionais/' + p.id, dados); else await api.post('/api/profissionais', dados);
        fecharModal(true); aviso('Profissional salva.'); navegar();
      } catch (e) { erroAviso(e); }
    })
  });
}

/* =============================== CONFIGURAÇÕES =============================== */
App.paginas.configuracoes = async (alvo, rota) => {
  const aba = rota.query.aba || 'clinica';
  const cfg = await api.get('/api/config');
  const admin = App.permissoes.configuracoes;
  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Configurações', 'Dados da clínica, acessos, mensagens e segurança')}
    <div class="painel">
      <div class="abas">${[['clinica', 'Clínica'], ['anamnese', 'Anamnese'], ['mensagens', 'Mensagens'], ['usuarios', 'Usuários e acessos'], ['seguranca', 'Segurança e LGPD']]
      .filter(a => admin || a[0] === 'clinica').map(a => `<button class="${aba === a[0] ? 'ativa' : ''}" data-aba="${a[0]}">${a[1]}</button>`).join('')}</div>
      <div class="painel-corpo" id="conf"></div>
    </div></div>`;
  alvo.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => location.hash = '/configuracoes?aba=' + b.dataset.aba));
  const c = alvo.querySelector('#conf');

  if (aba === 'clinica') {
    c.innerHTML = `<form id="form-c" style="max-width:720px">
      <div class="linha-campos">
        ${campo('Nome da clínica', entrada('clinica', cfg.clinica))}
        ${campo('Telefone', entrada('telefone', cfg.telefone))}
      </div>
      ${campo('Endereço', entrada('endereco', cfg.endereco))}
      <div class="linha-campos">
        ${campo('Salas de atendimento', entrada('salas_texto', (cfg.salas || []).join(', ')), 'Separe por vírgula. A agenda cria uma coluna por sala.')}
        ${campo('Instagram', entrada('instagram', cfg.instagram))}
      </div>
      <div class="linha-campos tres">
        ${campo('E-mail', entrada('email', cfg.email))}
        ${campo('Início da jornada', entrada('horario_inicio', cfg.horario_inicio, 'time'))}
        ${campo('Fim da jornada', entrada('horario_fim', cfg.horario_fim, 'time'))}
      </div>
      ${campo('Política de faltas', area('politica_falta', cfg.politica_falta, 2))}
      ${admin ? `<button type="button" class="btn btn-primario" id="salvar">Salvar configurações</button>` : '<div class="aviso info">Somente administradores podem alterar estas informações.</div>'}
    </form>`;
    c.querySelector('#salvar')?.addEventListener('click', async () => {
      const dados = dadosFormulario(c.querySelector('#form-c'));
      dados.salas = (dados.salas_texto || '').split(',').map(x => x.trim()).filter(Boolean);
      delete dados.salas_texto;
      const salvo = await api.put('/api/config', dados);
      App.config = salvo;
      aviso('Configurações salvas.');
    });
  }

  if (aba === 'anamnese') {
    /* Roteiro editável: a clínica ajusta o que pergunta na entrevista sem
       depender de alteração no sistema. */
    let blocos = JSON.parse(JSON.stringify(await api.get('/api/anamnese/roteiro')));

    const desenhar = () => {
      c.innerHTML = `<div class="aviso info">Este é o roteiro que aparece na aba <b>Anamnese</b> de cada paciente.
        Perguntas de seleção são respondidas com um toque — melhor para preencher no tablet durante a conversa.
        Alterar o roteiro não apaga anamneses já registradas.</div>
        <div id="blocos" style="display:grid;gap:14px;max-width:820px"></div>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button class="btn" id="add-bloco">${ico('mais')} Novo bloco</button>
          <button class="btn" id="restaurar">Restaurar roteiro padrão</button>
          <button class="btn btn-primario" id="salvar-roteiro" style="margin-left:auto">Salvar roteiro</button>
        </div>`;

      const cont = c.querySelector('#blocos');
      cont.innerHTML = blocos.map((b, i) => `
        <section class="painel" data-bloco="${i}">
          <div class="painel-titulo">
            <input type="text" value="${esc(b.titulo)}" data-titulo="${i}" style="font-weight:600;max-width:420px">
            <div class="acoes">
              <button class="btn btn-sutil" data-subir="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-sutil" data-descer="${i}" ${i === blocos.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn btn-sutil" data-remove-bloco="${i}">${ico('lixeira')}</button>
            </div>
          </div>
          <div class="painel-corpo" style="display:grid;gap:10px">
            ${b.perguntas.map((q, j) => `
              <div class="pergunta-roteiro">
                <input type="text" value="${esc(q.rotulo)}" data-rotulo="${i}.${j}" placeholder="Texto da pergunta">
                <select data-tipo="${i}.${j}">
                  ${[['texto', 'Resposta escrita'], ['selecao', 'Escolher uma opção'], ['sim_nao', 'Sim / Não']]
                    .map(t => `<option value="${t[0]}" ${q.tipo === t[0] ? 'selected' : ''}>${t[1]}</option>`).join('')}
                </select>
                <input type="text" value="${esc((q.opcoes || []).join(', '))}" data-opcoes="${i}.${j}"
                  placeholder="Opções separadas por vírgula" ${q.tipo === 'selecao' ? '' : 'disabled'}>
                <button class="btn btn-sutil" data-remove-pergunta="${i}.${j}">${ico('lixeira')}</button>
              </div>`).join('')}
            <button class="btn btn-sutil" data-add-pergunta="${i}" style="justify-self:start">+ Pergunta</button>
          </div>
        </section>`).join('');

      const ler = () => {
        c.querySelectorAll('[data-titulo]').forEach(e => { blocos[+e.dataset.titulo].titulo = e.value; });
        c.querySelectorAll('[data-rotulo]').forEach(e => {
          const [i, j] = e.dataset.rotulo.split('.').map(Number);
          blocos[i].perguntas[j].rotulo = e.value;
        });
        c.querySelectorAll('[data-tipo]').forEach(e => {
          const [i, j] = e.dataset.tipo.split('.').map(Number);
          blocos[i].perguntas[j].tipo = e.value;
        });
        c.querySelectorAll('[data-opcoes]').forEach(e => {
          const [i, j] = e.dataset.opcoes.split('.').map(Number);
          blocos[i].perguntas[j].opcoes = e.value.split(',').map(x => x.trim()).filter(Boolean);
        });
      };

      c.querySelectorAll('[data-tipo]').forEach(e => e.addEventListener('change', () => { ler(); desenhar(); }));
      c.querySelectorAll('[data-remove-bloco]').forEach(b => b.addEventListener('click', () => {
        ler(); blocos.splice(+b.dataset.removeBloco, 1); desenhar();
      }));
      c.querySelectorAll('[data-subir]').forEach(b => b.addEventListener('click', () => {
        ler(); const i = +b.dataset.subir; [blocos[i - 1], blocos[i]] = [blocos[i], blocos[i - 1]]; desenhar();
      }));
      c.querySelectorAll('[data-descer]').forEach(b => b.addEventListener('click', () => {
        ler(); const i = +b.dataset.descer; [blocos[i + 1], blocos[i]] = [blocos[i], blocos[i + 1]]; desenhar();
      }));
      c.querySelectorAll('[data-remove-pergunta]').forEach(b => b.addEventListener('click', () => {
        ler(); const [i, j] = b.dataset.removePergunta.split('.').map(Number);
        blocos[i].perguntas.splice(j, 1); desenhar();
      }));
      c.querySelectorAll('[data-add-pergunta]').forEach(b => b.addEventListener('click', () => {
        ler(); blocos[+b.dataset.addPergunta].perguntas.push({ id: 'p' + Date.now(), rotulo: '', tipo: 'texto', opcoes: [] });
        desenhar();
      }));
      c.querySelector('#add-bloco').addEventListener('click', () => {
        ler(); blocos.push({ id: 'b' + Date.now(), titulo: 'Novo bloco', perguntas: [] }); desenhar();
      });
      c.querySelector('#restaurar').addEventListener('click', () => {
        confirmar('Restaurar o roteiro padrão? As perguntas que você criou serão perdidas.', async () => {
          blocos = await api.get('/api/anamnese/roteiro/padrao');
          desenhar();
          aviso('Roteiro padrão carregado. Clique em Salvar para confirmar.');
        }, 'Restaurar');
      });
      c.querySelector('#salvar-roteiro').addEventListener('click', async () => {
        ler();
        const semTexto = blocos.some(b => b.perguntas.some(q => !q.rotulo.trim()));
        if (semTexto) return aviso('Há pergunta sem texto. Preencha ou remova antes de salvar.');
        await api.put('/api/anamnese/roteiro', { blocos });
        aviso('Roteiro salvo.');
      });
    };
    desenhar();
  }

  if (aba === 'mensagens') {
    const m = cfg.mensagens || {};
    const campos = [['confirmacao', 'Confirmação'], ['lembrete', 'Lembrete'], ['cobranca', 'Cobrança'],
    ['reagendamento', 'Reagendamento'], ['ausencia', 'Aviso de ausência'], ['relatorio', 'Envio de relatório']];
    c.innerHTML = `<div class="aviso info">Variáveis disponíveis: <code>{responsavel}</code>, <code>{paciente}</code>, <code>{quando}</code>, <code>{horario}</code>, <code>{valor}</code>, <code>{vencimento}</code>.</div>
      <form id="form-m" style="max-width:760px">${campos.map(x => campo(x[1], area(x[0], m[x[0]], 2))).join('')}
      <button type="button" class="btn btn-primario" id="salvar">Salvar mensagens</button></form>`;
    c.querySelector('#salvar').addEventListener('click', async () => {
      await api.put('/api/config', { mensagens: dadosFormulario(c.querySelector('#form-m')) });
      aviso('Mensagens salvas.');
    });
  }

  if (aba === 'usuarios' && admin) {
    const [usuarios, profs] = await Promise.all([api.get('/api/usuarios'), api.get('/api/profissionais')]);
    c.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        <button class="btn btn-primario" id="novo">${ico('mais')} Novo usuário</button></div>
      ${tabela(['Nome', 'E-mail', 'Perfil', 'Último acesso', 'Situação', ''],
      usuarios.map(u => `<tr>
          <td class="td-principal">${esc(u.nome)}</td><td class="td-secundario">${esc(u.email)}</td>
          <td><select data-papel="${u.id}" style="min-width:160px">
            ${[['admin', 'Administrador'], ['profissional', 'Profissional'], ['administrativo', 'Administrativo']]
          .map(p => `<option value="${p[0]}" ${u.papel === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></td>
          <td class="td-secundario">${u.ultimo_acesso ? dataBR(u.ultimo_acesso) : '—'}</td>
          <td>${u.ativo ? '<span class="tag simples t-pago">Ativo</span>' : '<span class="tag simples t-neutro">Inativo</span>'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-sutil" data-senha="${u.id}">Redefinir senha</button>
            <button class="btn btn-sutil" data-ativo="${u.id}" data-valor="${!u.ativo}">${u.ativo ? 'Desativar' : 'Ativar'}</button>
          </td></tr>`))}`;
    c.querySelectorAll('[data-papel]').forEach(s => s.addEventListener('change', async () => {
      await api.put('/api/usuarios/' + s.dataset.papel, { papel: s.value }); aviso('Perfil atualizado.');
    }));
    c.querySelectorAll('[data-ativo]').forEach(b => b.addEventListener('click', async () => {
      await api.put('/api/usuarios/' + b.dataset.ativo, { ativo: b.dataset.valor === 'true' }); navegar();
    }));
    c.querySelectorAll('[data-senha]').forEach(b => b.addEventListener('click', async () => {
      const senha = prompt('Nova senha (mínimo 6 caracteres):');
      if (senha && senha.length >= 6) { await api.put('/api/usuarios/' + b.dataset.senha, { senha }); aviso('Senha redefinida.'); }
    }));
    c.querySelector('#novo').addEventListener('click', () => abrirModal({
      titulo: 'Novo usuário',
      corpo: `<form id="form-u">
        ${campo('Nome', entrada('nome', '', 'text', 'required'))}
        ${campo('E-mail', entrada('email', '', 'email', 'required'))}
        <div class="linha-campos">
          ${campo('Perfil', selecao('papel', [['profissional', 'Profissional'], ['administrativo', 'Administrativo'], ['admin', 'Administrador']]))}
          ${campo('Vincular à profissional', selecao('profissional_id', [['', 'Nenhuma'], ...profs.map(p => [p.id, p.nome])]))}
        </div>
        ${campo('Senha inicial', entrada('senha', 'psico123'))}</form>`,
      rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="s">Criar</button>`,
      aoAbrir: (f) => f.querySelector('#s').addEventListener('click', async () => {
        try { await api.post('/api/usuarios', dadosFormulario(f.querySelector('#form-u'))); fecharModal(true); navegar(); }
        catch (e) { erroAviso(e); }
      })
    }));
  }

  if (aba === 'seguranca' && admin) {
    const [logs, backups] = await Promise.all([api.get('/api/logs'), api.get('/api/backup')]);
    c.innerHTML = `
      <div class="grade g-2" style="margin-bottom:18px">
        <div class="painel"><div class="painel-corpo">
          <h3 style="font-size:14px;margin-bottom:6px">Backup dos dados</h3>
          <p class="td-secundario" style="margin:0 0 12px">Gera uma cópia completa do banco na pasta segura do servidor. Último backup: ${backups[0] ? esc(backups[0].replace('backup-', '').slice(0, 10)) : 'nenhum'}.</p>
          <button class="btn" id="backup">Gerar backup agora</button>
          <a class="btn btn-sutil" href="${comToken('/api/exportar')}" download>Exportar dados (JSON)</a>
          <div class="aviso info" style="margin-top:12px">
            <b>Antes de cada atualização do sistema</b>, exporte os dados. Depois que a nova versão
            estiver no ar, use “Restaurar” abaixo para trazer tudo de volta.
          </div>
          <div style="margin-top:12px">
            <input type="file" id="arquivo-restauro" accept=".json,application/json" style="display:none">
            <button class="btn" id="restaurar">Restaurar de um arquivo exportado</button>
          </div>
        </div></div>
        <div class="painel"><div class="painel-corpo">
          <h3 style="font-size:14px;margin-bottom:6px">Limpar dados de pacientes</h3>
          <p class="td-secundario" style="margin:0 0 12px">Apaga <b>todos</b> os pacientes, responsáveis, atendimentos,
            diários, documentos, relatórios e lançamentos financeiros. A equipe, os modelos de registro e as
            configurações são mantidos. Um backup é gerado automaticamente antes.</p>
          <button class="btn btn-perigo" id="limpar">Apagar dados de pacientes</button>
        </div></div>
      </div>
      <div class="grade g-2" style="margin-bottom:18px">
        <div class="painel"><div class="painel-corpo">
          <h3 style="font-size:14px;margin-bottom:6px">Proteção de dados (LGPD)</h3>
          <ul class="td-secundario" style="margin:0;padding-left:18px;line-height:1.7">
            <li>Acesso individual com senha criptografada (scrypt).</li>
            <li>Sessões expiram automaticamente em 12 horas.</li>
            <li>Permissões por perfil — perfil administrativo não acessa dados clínicos.</li>
            <li>Registro de auditoria de consultas, alterações e downloads.</li>
            <li>Documentos armazenados fora da área pública do servidor.</li>
          </ul>
        </div></div>
      </div>
      <div class="painel"><div class="painel-titulo"><h2>Registro de auditoria</h2></div>
      <div class="painel-corpo sem-padding" style="max-height:460px;overflow:auto">
        ${tabela(['Data/hora', 'Usuário', 'Ação', 'Entidade', 'Detalhe'],
      logs.slice(0, 200).map(l => `<tr>
          <td class="td-secundario">${new Date(l.criado_em).toLocaleString('pt-BR')}</td>
          <td class="td-secundario">${esc(l.usuario_nome || '—')}</td>
          <td><span class="tag simples t-neutro">${esc(l.acao)}</span></td>
          <td class="td-secundario">${esc(l.entidade || '')}</td>
          <td class="td-secundario">${esc(l.detalhe || '')}</td></tr>`))}
      </div></div>`;
    c.querySelector('#backup').addEventListener('click', async () => {
      const r = await api.post('/api/backup'); aviso('Backup criado: ' + r.arquivo);
    });

    const entradaArquivo = c.querySelector('#arquivo-restauro');
    c.querySelector('#restaurar')?.addEventListener('click', () => entradaArquivo.click());
    entradaArquivo?.addEventListener('change', async () => {
      const arquivo = entradaArquivo.files[0];
      if (!arquivo) return;
      let dados;
      try { dados = JSON.parse(await arquivo.text()); }
      catch { entradaArquivo.value = ''; return aviso('Arquivo inválido: não é um JSON legível.', 'erro'); }

      const nomes = (dados.pacientes || []).length;
      confirmar(`Restaurar ${nomes} paciente(s) e todos os registros ligados a eles? ` +
        'Os dados atuais de pacientes serão substituídos (um backup é gerado antes).', async () => {
        try {
          const r = await api.post('/api/importar', { dados });
          const total = Object.values(r.restaurados).reduce((a, b) => a + b, 0);
          aviso(`${total} registro(s) restaurados.`); navegar();
        } catch (e) { erroAviso(e); }
        entradaArquivo.value = '';
      }, 'Restaurar');
    });

    c.querySelector('#limpar')?.addEventListener('click', () => {
      abrirModal({
        titulo: 'Apagar dados de pacientes',
        corpo: `<div class="aviso erro" style="margin-bottom:14px">
            Esta ação não pode ser desfeita pela interface. Serão apagados todos os pacientes,
            responsáveis, atendimentos, diários, documentos, relatórios e lançamentos financeiros.
          </div>
          <p class="td-secundario">A equipe, os modelos de registro e as configurações permanecem.
            Um backup do estado atual é gravado no servidor antes da limpeza.</p>
          ${campo('Para confirmar, digite APAGAR em letras maiúsculas', entrada('confirmacao', '', 'text', 'id="conf" autocomplete="off"'))}`,
        rodape: `<button class="btn" data-fechar>Cancelar</button>
                 <button class="btn btn-perigo" id="ok" disabled>Apagar definitivamente</button>`,
        aoAbrir: (f) => {
          const campoConf = f.querySelector('#conf'), botao = f.querySelector('#ok');
          campoConf.addEventListener('input', () => { botao.disabled = campoConf.value !== 'APAGAR'; });
          botao.addEventListener('click', async () => {
            botao.disabled = true; botao.textContent = 'Apagando…';
            try {
              const r = await api.post('/api/limpar-dados', { confirmacao: 'APAGAR' });
              const total = Object.values(r.apagados).reduce((a, b) => a + b, 0);
              fecharModal(true);
              aviso(`${total} registro(s) apagados. Backup salvo: ${r.backup}`);
              navegar();
            } catch (e) { erroAviso(e); botao.disabled = false; botao.textContent = 'Apagar definitivamente'; }
          });
        }
      });
    });
  }
};
