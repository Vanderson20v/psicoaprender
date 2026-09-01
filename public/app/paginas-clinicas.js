/* =======================================================================
   Telas clínicas: Dashboard · Agenda · Pacientes · Perfil · Diário · Evolução
   ======================================================================= */

/* ============================== DASHBOARD ============================== */
App.paginas.dashboard = async (alvo) => {
  const d = await api.get('/api/dashboard');
  const f = d.financeiro;
  const prox = d.proximo;

  alvo.innerHTML = `<div class="pagina">
    ${cabecalho(`Bom dia, ${primeiroNome(App.sessao.nome)}`, porExtenso(d.hoje) + ' · ' + d.pacientes_ativos + ' pacientes em acompanhamento',
    `<button class="btn" id="novo-atendimento">${ico('agenda')} Novo horário</button>
       <button class="btn btn-primario" id="registrar-rapido">${ico('diario')} Registrar atendimento</button>`)}

    ${prox ? `
      <div class="proximo" style="margin-bottom:16px">
        <div>
          <div style="font-size:11.5px;text-transform:uppercase;letter-spacing:.09em;opacity:.8">Próximo atendimento</div>
          <div style="display:flex;align-items:baseline;gap:12px;margin-top:4px">
            <div class="hora">${prox.hora}</div>
            <div><div class="nome">${esc(prox.paciente?.nome || '')}</div>
              <div class="meta">${esc(prox.tipo)} · ${esc(prox.profissional?.nome || '')} · ${prox.duracao} min · ${esc(prox.sala || '')}</div></div>
          </div>
        </div>
        <div class="acoes">
          <button class="btn" data-abrir-paciente="${prox.paciente?.id}">Abrir ficha</button>
          <button class="btn claro" data-registrar="${prox.id}">Registrar atendimento</button>
        </div>
      </div>` : `<div class="painel" style="padding:16px;margin-bottom:16px;color:var(--tinta-3)">Nenhum atendimento restante para hoje.</div>`}

    <div class="grade g-4" style="margin-bottom:16px">
      ${indicador('Agendados hoje', d.resumo.agendados)}
      ${indicador('Realizados', d.resumo.realizados, '', 'destaque')}
      ${indicador('Faltas / cancelamentos', d.resumo.faltas + ' / ' + d.resumo.cancelados)}
      ${indicador('Horários livres', d.resumo.livres, 'na jornada de hoje')}
    </div>

    <div class="grade g-agenda">
      <section class="painel">
        <div class="painel-titulo"><h2>Agenda de hoje</h2>
          <div class="acoes"><a class="btn btn-sutil" href="#/agenda">Ver agenda completa</a></div></div>
        <div class="painel-corpo sem-padding">
          ${tabela(['Horário', 'Paciente', 'Profissional', 'Sala', 'Tipo', 'Status', ''],
    d.agenda_do_dia.map(a => `
              <tr class="clicavel" data-abrir-paciente="${a.paciente?.id}">
                <td class="td-principal">${a.hora}</td>
                <td class="td-principal">${esc(a.paciente?.nome || '')}</td>
                <td class="td-secundario">${esc(primeiroNome(a.profissional?.nome))}</td>
                <td>${salaTag(a.sala)}</td>
                <td class="td-secundario">${esc(a.tipo)}</td>
                <td>${tag(a.status)}</td>
                <td style="text-align:right">${a.status === 'realizado' && !a.tem_registro
        ? `<span class="tag simples t-terra">Diário pendente</span>`
        : `<button class="btn btn-sutil" data-registrar="${a.id}">Registrar</button>`}</td>
              </tr>`), { vazio: 'Sem atendimentos hoje.' })}
        </div>
      </section>

      <div style="display:grid;gap:16px">
        ${f ? `<section class="painel">
          <div class="painel-titulo"><h2>Financeiro do mês</h2>
            <div class="acoes"><a class="btn btn-sutil" href="#/financeiro">Detalhar</a></div></div>
          <div class="painel-corpo" style="display:grid;gap:12px">
            <div style="display:flex;justify-content:space-between"><span>Recebido</span><strong>${moeda(f.recebido_mes)}</strong></div>
            <div style="display:flex;justify-content:space-between"><span>A receber</span><strong>${moeda(f.a_receber)}</strong></div>
            <div style="display:flex;justify-content:space-between;color:${f.em_atraso ? 'var(--vermelho)' : 'inherit'}">
              <span>Em atraso</span><strong>${moeda(f.em_atraso)}</strong></div>
          </div></section>` : ''}

        <section class="painel">
          <div class="painel-titulo"><h2>Alertas</h2>
            <div class="acoes"><span class="td-secundario">${d.alertas.length}</span></div></div>
          <div class="painel-corpo sem-padding">
            ${d.alertas.length ? d.alertas.map(itemAlerta).join('') : vazio('Nenhuma pendência.')}
          </div>
        </section>
      </div>
    </div>
  </div>`;

  alvo.querySelectorAll('[data-abrir-paciente]').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-registrar]')) return;
    location.hash = '/paciente/' + el.dataset.abrirPaciente;
  }));
  alvo.querySelectorAll('[data-registrar]').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation(); abrirDiario({ atendimento_id: Number(el.dataset.registrar) });
  }));
  alvo.querySelectorAll('.alerta-item').forEach(el => el.addEventListener('click', () => location.hash = el.dataset.link.replace('#', '')));
  alvo.querySelector('#novo-atendimento')?.addEventListener('click', () => modalAtendimento({}));
  alvo.querySelector('#registrar-rapido')?.addEventListener('click', () => abrirDiario({}));
};

/* ================================ AGENDA ================================ */
App.estadoAgenda = { visao: 'salas', data: hojeISO(), profissional: '', sala: '' };

App.paginas.agenda = async (alvo) => {
  const e = App.estadoAgenda;
  const base = new Date(e.data + 'T12:00:00');
  let de, ate;
  if (e.visao === 'dia' || e.visao === 'salas') { de = ate = e.data; }
  else if (e.visao === 'semana') {
    const ini = new Date(base); ini.setDate(ini.getDate() - ini.getDay());
    de = ini.toLocaleDateString('en-CA'); ate = somaDias(de, 6);
  } else {
    const ini = new Date(base.getFullYear(), base.getMonth(), 1);
    const fim = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    de = somaDias(ini.toLocaleDateString('en-CA'), -ini.getDay());
    ate = somaDias(fim.toLocaleDateString('en-CA'), 6 - fim.getDay());
  }

  const [ats, bloqueios, profs] = await Promise.all([
    api.get('/api/atendimentos', { de, ate, profissional_id: e.profissional }),
    api.get('/api/bloqueios', { de, ate }),
    api.get('/api/profissionais')
  ]);

  const titulo = e.visao === 'mes'
    ? `${MESES[base.getMonth()][0].toUpperCase() + MESES[base.getMonth()].slice(1)} de ${base.getFullYear()}`
    : (e.visao === 'dia' || e.visao === 'salas') ? porExtenso(e.data) : `${dataCurta(de)} a ${dataCurta(ate)}`;

  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Agenda', titulo,
    `<div class="escolhas">
        ${[['salas', 'Salas (visão geral)'], ['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']]
        .map(v => `<div class="escolha ${e.visao === v[0] ? 'ativa' : ''}" data-visao="${v[0]}">${v[1]}</div>`).join('')}
      </div>
      <button class="btn btn-icone" id="ant">${ico('voltar')}</button>
      <button class="btn" id="hoje">Hoje</button>
      <button class="btn btn-icone" id="prox" style="transform:rotate(180deg)">${ico('voltar')}</button>
      ${selecao('profissional', [['', 'Todas as profissionais'], ...profs.map(p => [p.id, p.nome])], e.profissional, 'id="filtro-prof" style="width:auto;min-width:190px"')}
      ${e.visao !== 'salas' ? selecao('sala', [['', 'Todas as salas'], ...SALAS.map(x => [x, x])], e.sala, 'id="filtro-sala" style="width:auto;min-width:170px"') : ''}
      <button class="btn" id="bloquear">Bloquear horário</button>
      <button class="btn btn-primario" id="novo">${ico('mais')} Atendimento</button>`)}
    ${e.visao === 'salas' ? '' : `<div class="aviso info" style="display:flex;gap:8px;align-items:center">
        Para conferir a ocupação das duas salas lado a lado, use a visão <b>Salas</b>. O sistema bloqueia automaticamente horários já ocupados.
      </div>`}
    <div class="painel agenda-rolagem" style="overflow:hidden">${gradeAgenda(e.visao, de, ate, ats.filter(a => !e.sala || a.sala === e.sala), bloqueios)}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;color:var(--tinta-3);font-size:12.5px;align-items:center">
      ${Object.keys(ROTULO_STATUS).map(s => `<span class="chip-area">${tag(s)}</span>`).join('')}
      <span style="margin-left:auto;display:flex;gap:8px">
        ${SALAS.map((x, i) => `<span class="sala-tag sala-${i + 1}">${x}</span>`).join('')}</span>
    </div>
  </div>`;

  alvo.querySelectorAll('[data-visao]').forEach(el => el.addEventListener('click', () => { e.visao = el.dataset.visao; navegar(); }));
  alvo.querySelector('#hoje').addEventListener('click', () => { e.data = hojeISO(); navegar(); });
  alvo.querySelector('#ant').addEventListener('click', () => { e.data = deslocar(e.data, e.visao, -1); navegar(); });
  alvo.querySelector('#prox').addEventListener('click', () => { e.data = deslocar(e.data, e.visao, 1); navegar(); });
  alvo.querySelector('#filtro-prof').addEventListener('change', (ev) => { e.profissional = ev.target.value; navegar(); });
  alvo.querySelector('#filtro-sala')?.addEventListener('change', (ev) => { e.sala = ev.target.value; navegar(); });
  alvo.querySelector('#novo').addEventListener('click', () => modalAtendimento({ data: e.data }));
  alvo.querySelector('#bloquear').addEventListener('click', () => modalBloqueio(e.data, profs));
  alvo.querySelectorAll('[data-evento]').forEach(el => el.addEventListener('click', () => {
    modalDetalheAtendimento(ats.find(a => a.id === Number(el.dataset.evento)));
  }));
  alvo.querySelectorAll('[data-celula]').forEach(el => el.addEventListener('click', () => {
    const [data, hora, sala] = el.dataset.celula.split(' ');
    modalAtendimento({ data, hora, sala: sala ? decodeURIComponent(sala) : '' });
  }));
  alvo.querySelectorAll('[data-dia]').forEach(el => el.addEventListener('click', () => {
    App.estadoAgenda.data = el.dataset.dia; App.estadoAgenda.visao = 'dia'; navegar();
  }));
};

function deslocar(data, visao, sinal) {
  if (visao === 'dia') return somaDias(data, sinal);
  if (visao === 'semana') return somaDias(data, 7 * sinal);
  const d = new Date(data + 'T12:00:00'); d.setMonth(d.getMonth() + sinal); return d.toLocaleDateString('en-CA');
}

function gradeAgenda(visao, de, ate, ats, bloqueios) {
  if (visao === 'mes') return gradeMes(de, ate, ats);
  if (visao === 'salas') return gradeSalas(de, ats, bloqueios);
  const dias = [];
  for (let d = de; d <= ate; d = somaDias(d, 1)) dias.push(d);
  const hIni = parseInt((App.config.horario_inicio || '08:00').slice(0, 2), 10);
  const hFim = parseInt((App.config.horario_fim || '18:00').slice(0, 2), 10);
  const hoje = hojeISO();

  let html = `<div class="agenda-cabecalho" style="--colunas:${dias.length}"><div></div>
    ${dias.map(d => `<div class="${d === hoje ? 'hoje' : ''}" data-dia="${d}" style="cursor:pointer">
      <div style="font-size:11px;color:var(--tinta-3)">${DIAS_CURTO[diaSemana(d)]}</div>
      <strong>${d.slice(8, 10)}</strong></div>`).join('')}</div>
    <div class="agenda-grade" style="--colunas:${dias.length}">`;

  for (let h = hIni; h <= hFim; h++) {
    const hora = String(h).padStart(2, '0') + ':00';
    html += `<div class="agenda-hora">${hora}</div>`;
    for (const d of dias) {
      const evs = ats.filter(a => a.data === d && a.hora.slice(0, 2) === String(h).padStart(2, '0'));
      const bloq = bloqueios.find(b => b.data === d && b.hora_inicio <= hora && b.hora_fim > hora);
      html += `<div class="agenda-celula ${bloq ? 'bloqueada' : ''}" ${!evs.length && !bloq ? `data-celula="${d} ${hora}"` : ''} style="cursor:${evs.length || bloq ? 'default' : 'pointer'}">
        ${bloq ? `<div style="font-size:11px;color:var(--tinta-3);padding:3px">${esc(bloq.tipo)}</div>` : ''}
        ${evs.map(a => `<div class="evento e-${a.status}" data-evento="${a.id}">
            <span class="p-nome">${esc(primeiroNome(a.paciente?.nome))} ${esc((a.paciente?.nome || '').split(' ')[1] || '')}</span>
            <span class="p-meta">${a.hora} · ${esc(primeiroNome(a.profissional?.nome))}</span>
            <span class="p-sala">${esc((a.sala || '').replace('Sala de atendimento ', 'Sala '))}</span>
          </div>`).join('')}
      </div>`;
    }
  }
  return html + '</div>';
}

/** Visão geral do dia com uma coluna por sala — evita choque de agendamento. */
function gradeSalas(data, ats, bloqueios) {
  const hIni = parseInt((App.config.horario_inicio || '08:00').slice(0, 2), 10);
  const hFim = parseInt((App.config.horario_fim || '18:00').slice(0, 2), 10);

  let html = `<div class="agenda-cabecalho" style="--colunas:${SALAS.length}"><div></div>
    ${SALAS.map((sala, i) => `<div><strong class="sala-tag sala-${i + 1}">${esc(sala)}</strong></div>`).join('')}</div>
    <div class="agenda-grade" style="--colunas:${SALAS.length}">`;

  for (let h = hIni; h <= hFim; h++) {
    const hora = String(h).padStart(2, '0') + ':00';
    html += `<div class="agenda-hora">${hora}</div>`;
    for (const sala of SALAS) {
      const evs = ats.filter(a => a.sala === sala && a.hora.slice(0, 2) === String(h).padStart(2, '0'));
      const bloq = bloqueios.find(b => (!b.sala || b.sala === sala) && b.hora_inicio <= hora && b.hora_fim > hora);
      html += `<div class="agenda-celula ${bloq ? 'bloqueada' : ''}"
          ${!evs.length && !bloq ? `data-celula="${data} ${hora} ${encodeURIComponent(sala)}"` : ''}
          style="cursor:${evs.length || bloq ? 'default' : 'pointer'}">
        ${bloq ? `<div style="font-size:11px;color:var(--tinta-3);padding:3px">${esc(bloq.tipo)}${bloq.motivo ? ' — ' + esc(bloq.motivo) : ''}</div>` : ''}
        ${evs.map(a => `<div class="evento e-${a.status}" data-evento="${a.id}">
            <span class="p-nome">${esc(a.paciente?.nome || '')}</span>
            <span class="p-meta">${a.hora} · ${esc(a.profissional?.nome || '')}</span>
            <span class="p-sala">${esc(a.tipo)}</span>
          </div>`).join('')}
      </div>`;
    }
  }
  return html + '</div>';
}

function gradeMes(de, ate, ats) {
  const hoje = hojeISO();
  const mesRef = new Date(App.estadoAgenda.data + 'T12:00:00').getMonth();
  let html = `<div class="mes-grade">${DIAS_CURTO.map(d => `<div style="padding:8px;text-align:center;font-size:11.5px;color:var(--tinta-3);border-bottom:1px solid var(--linha);background:var(--superficie-2)">${d}</div>`).join('')}</div>
    <div class="mes-grade">`;
  for (let d = de; d <= ate; d = somaDias(d, 1)) {
    const evs = ats.filter(a => a.data === d);
    const fora = new Date(d + 'T12:00:00').getMonth() !== mesRef;
    html += `<div class="mes-dia ${fora ? 'fora' : ''} ${d === hoje ? 'hoje' : ''}">
      <div class="num" data-dia="${d}" style="cursor:pointer">${d.slice(8, 10)}</div>
      ${evs.slice(0, 4).map(a => `<div class="mes-evento e-${a.status}" data-evento="${a.id}" style="border-left-color:${a.status === 'falta' ? 'var(--vermelho)' : a.status === 'realizado' ? 'var(--verde)' : a.status === 'confirmado' ? 'var(--azul)' : 'var(--tinta-3)'}">${a.hora} ${esc(primeiroNome(a.paciente?.nome))}</div>`).join('')}
      ${evs.length > 4 ? `<div class="td-secundario" style="font-size:11px">+${evs.length - 4} atendimentos</div>` : ''}
    </div>`;
  }
  return html + '</div>';
}

async function modalAtendimento(pre = {}) {
  const [pacientes, profs] = await Promise.all([api.get('/api/pacientes'), api.get('/api/profissionais')]);
  abrirModal({
    titulo: 'Novo atendimento',
    largo: true,
    corpo: `<form id="form-at">
      <div class="linha-campos">
        ${campo('Paciente', selecao('paciente_id', [['', 'Selecione…'], ...pacientes.filter(p => p.status !== 'Alta').map(p => [p.id, p.nome])], pre.paciente_id, 'required id="at-paciente"'))}
        ${campo('Profissional', selecao('profissional_id', profs.map(p => [p.id, p.nome]), App.sessao.profissional_id, 'id="at-prof"'))}
      </div>
      <div class="linha-campos tres">
        ${campo('Data', entrada('data', pre.data || hojeISO(), 'date', 'required id="at-data"'))}
        ${campo('Horário', entrada('hora', pre.hora || '09:00', 'time', 'required id="at-hora"'))}
        ${campo('Duração (min)', selecao('duracao', ['30', '45', '50', '60', '90'], '50', 'id="at-duracao"'))}
      </div>
      <div class="linha-campos">
        ${campo('Sala de atendimento', selecao('sala', SALAS, pre.sala || SALAS[0], 'id="at-sala"'))}
        ${campo('Tipo', selecao('tipo', ['Psicopedagogia', 'Neuropsicopedagogia', 'Educação precoce', 'Musicoterapia', 'Avaliação', 'Devolutiva', 'Orientação aos responsáveis'], pre.tipo))}
      </div>

      <fieldset><legend>Disponibilidade das salas no dia</legend>
        <div class="ajuda" style="margin-bottom:10px">Horários ocupados aparecem travados, com o nome de quem já está agendado. Toque em uma vaga livre para escolhê-la.</div>
        <div id="mapa"><div class="td-secundario">Carregando disponibilidade…</div></div>
      </fieldset>

      <fieldset><legend>Recorrência</legend>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <input type="checkbox" name="recorrente" id="rec" style="width:18px;min-height:18px"> Repetir semanalmente
        </label>
        <div class="linha-campos" id="rec-op" style="display:none">
          ${campo('Intervalo', selecao('intervalo', [['semanal', 'Toda semana'], ['quinzenal', 'A cada 15 dias']], 'semanal'))}
          ${campo('Quantidade de sessões', entrada('repeticoes', '24', 'number', 'min="2" max="60"'))}
        </div>
      </fieldset>
      ${campo('Observação (opcional)', area('observacao', '', 2))}
      <div id="at-aviso"></div>
    </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="salvar">Salvar atendimento</button>`,
    aoAbrir: (f) => {
      f.querySelector('#rec').addEventListener('change', (e) => f.querySelector('#rec-op').style.display = e.target.checked ? 'grid' : 'none');

      const campos = ['#at-data', '#at-duracao', '#at-prof'];
      const desenharMapa = async () => {
        const cont = f.querySelector('#mapa');
        cont.innerHTML = '<div class="td-secundario">Carregando disponibilidade…</div>';
        const dados = await api.get('/api/agenda/disponibilidade', {
          data: f.querySelector('#at-data').value,
          duracao: f.querySelector('#at-duracao').value,
          profissional_id: f.querySelector('#at-prof').value
        });
        const horas = dados.grade[0].horarios.map(h => h.hora);
        cont.innerHTML = `<div class="mapa-salas" style="--salas:${dados.salas.length}">
          <div class="mapa-linha"><div></div>
            ${dados.salas.map((x, i) => `<div class="sala-tag sala-${i + 1}" style="justify-content:center">${esc(x)}</div>`).join('')}</div>
          ${horas.map(hora => `<div class="mapa-linha">
            <div class="mapa-hora">${hora}</div>
            ${dados.grade.map(g => {
              const v = g.horarios.find(h => h.hora === hora);
              return v.livre
                ? `<button type="button" class="mapa-vaga" data-hora="${hora}" data-sala="${esc(g.sala)}">Livre<span class="quem">Toque para escolher</span></button>`
                : `<div class="mapa-vaga ocupada" title="${esc(v.detalhe || '')}">${v.motivo === 'bloqueio' ? 'Bloqueado' : 'Ocupado'}<span class="quem">${esc(v.ocupado_por || '')}</span></div>`;
            }).join('')}
          </div>`).join('')}
        </div>`;
        marcarEscolha();
        cont.querySelectorAll('.mapa-vaga[data-hora]').forEach(b => b.addEventListener('click', () => {
          f.querySelector('#at-hora').value = b.dataset.hora;
          f.querySelector('#at-sala').value = b.dataset.sala;
          marcarEscolha();
        }));
      };
      const marcarEscolha = () => {
        const hora = f.querySelector('#at-hora').value, sala = f.querySelector('#at-sala').value;
        f.querySelectorAll('.mapa-vaga[data-hora]').forEach(b =>
          b.classList.toggle('escolhida', b.dataset.hora === hora && b.dataset.sala === sala));
      };
      campos.forEach(sel => f.querySelector(sel).addEventListener('change', desenharMapa));
      f.querySelector('#at-hora').addEventListener('change', marcarEscolha);
      f.querySelector('#at-sala').addEventListener('change', marcarEscolha);
      // preenche a sala/horário sugeridos pelo paciente ao selecioná-lo
      f.querySelector('#at-paciente').addEventListener('change', (e) => {
        const p = pacientes.find(x => x.id === Number(e.target.value));
        if (!p) return;
        if (p.profissional_id) f.querySelector('#at-prof').value = p.profissional_id;
        if (p.horario) f.querySelector('#at-hora').value = p.horario;
        if (p.sala) f.querySelector('#at-sala').value = p.sala;
        desenharMapa();
      });
      desenharMapa();

      f.querySelector('#salvar').addEventListener('click', async () => {
        const form = f.querySelector('#form-at');
        if (!form.reportValidity()) return;
        const d = dadosFormulario(form);
        d.recorrente = !!d.recorrente;
        const aviso1 = f.querySelector('#at-aviso');
        try {
          const r = await api.post('/api/atendimentos', d);
          fecharModal(true); aviso(`${r.length} horário(s) criado(s).`); navegar();
        } catch (e) {
          // conflito: mostra o impedimento e oferece criar apenas as datas livres
          aviso1.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`;
          if (d.recorrente) {
            aviso1.insertAdjacentHTML('beforeend',
              `<button type="button" class="btn" id="pular">Criar apenas as datas livres</button>`);
            aviso1.querySelector('#pular').addEventListener('click', async () => {
              const r = await api.post('/api/atendimentos', { ...d, ignorar_conflitos: true });
              fecharModal(true); aviso(`${r.length} horário(s) criado(s); os ocupados foram ignorados.`); navegar();
            });
          }
          desenharMapa();
        }
      });
    }
  });
}

function modalBloqueio(data, profs) {
  abrirModal({
    titulo: 'Bloquear horário',
    corpo: `<form id="form-b">
      <div class="linha-campos">
        ${campo('Tipo', selecao('tipo', ['Almoço', 'Reunião', 'Férias', 'Ausência', 'Feriado', 'Outro']))}
        ${campo('Sala', selecao('sala', [['', 'Todas as salas'], ...SALAS.map(x => [x, x])], ''))}
      </div>
      <div class="linha-campos tres">
        ${campo('Data', entrada('data', data, 'date', 'required'))}
        ${campo('Início', entrada('hora_inicio', '12:00', 'time'))}
        ${campo('Fim', entrada('hora_fim', '13:00', 'time'))}
      </div>
      <div class="linha-campos">
        ${campo('Profissional', selecao('profissional_id', [['', 'Toda a clínica'], ...profs.map(p => [p.id, p.nome])], App.sessao.profissional_id || ''))}
        ${campo('Motivo', entrada('motivo'))}
      </div>
    </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="s">Bloquear</button>`,
    aoAbrir: (f) => f.querySelector('#s').addEventListener('click', async () => {
      await api.post('/api/bloqueios', dadosFormulario(f.querySelector('#form-b')));
      fecharModal(true); aviso('Horário bloqueado.'); navegar();
    })
  });
}

async function modalDetalheAtendimento(at) {
  if (!at) return;
  const paciente = await api.get('/api/pacientes/' + at.paciente_id);
  const acoes = [['confirmado', 'Confirmar'], ['realizado', 'Marcar realizado'], ['falta', 'Registrar falta'], ['cancelado', 'Cancelar']];
  abrirModal({
    titulo: `${dataBR(at.data)} · ${at.hora}`,
    corpo: `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div class="avatar grande">${iniciais(paciente.nome)}</div>
        <div><div style="font-weight:600;font-size:17px">${esc(paciente.nome)}</div>
          <div class="td-secundario">${idadeTexto(paciente.idade)} · ${esc(at.tipo)} · ${at.duracao} min</div>
          <div class="td-secundario">${esc(at.profissional?.nome || '')} · <b>${esc(at.sala || 'sala não definida')}</b></div></div>
        <div style="margin-left:auto">${tag(at.status)}</div>
      </div>
      ${at.status === 'realizado' && !at.tem_registro ? `<div class="aviso atencao">Atendimento realizado sem diário registrado.</div>` : ''}
      <div class="rotulo">Alterar situação</div>
      <div class="escolhas" style="margin-bottom:16px">
        ${acoes.map(a => `<div class="escolha ${at.status === a[0] ? 'ativa' : ''}" data-status="${a[0]}">${a[1]}</div>`).join('')}
      </div>
      <div class="linha-campos">
        ${campo('Reagendar para', entrada('nova_data', at.data, 'date', 'id="nova-data"'))}
        ${campo('Novo horário', entrada('nova_hora', at.hora, 'time', 'id="nova-hora"'))}
      </div>`,
    rodape: `
      <div class="esquerda" style="display:flex;gap:6px">
        <button class="btn btn-perigo" id="excluir">${ico('lixeira')}</button>
        ${at.recorrencia_id ? `<button class="btn btn-perigo" id="excluir-serie">Excluir série</button>` : ''}
      </div>
      <button class="btn" id="wpp">${ico('whatsapp')} WhatsApp</button>
      <button class="btn" id="ficha">Abrir ficha</button>
      ${App.permissoes.clinico ? `<button class="btn btn-primario" id="registrar">Registrar atendimento</button>` : ''}`,
    aoAbrir: (f) => {
      f.querySelectorAll('[data-status]').forEach(el => el.addEventListener('click', async () => {
        await api.put('/api/atendimentos/' + at.id, { status: el.dataset.status });
        fecharModal(true); aviso('Situação atualizada.'); navegar();
      }));
      const reag = async () => {
        const data = f.querySelector('#nova-data').value, hora = f.querySelector('#nova-hora').value;
        if (data === at.data && hora === at.hora) return;
        try {
          await api.put('/api/atendimentos/' + at.id, { data, hora, status: 'agendado' });
          fecharModal(true); aviso('Atendimento reagendado.'); navegar();
        } catch (e) { erroAviso(e); }   // horário/sala já ocupados
      };
      f.querySelector('#nova-data').addEventListener('change', reag);
      f.querySelector('#nova-hora').addEventListener('change', reag);
      f.querySelector('#excluir').addEventListener('click', () => confirmar('Excluir este horário?', async () => {
        await api.del('/api/atendimentos/' + at.id); fecharModal(true); navegar();
      }));
      f.querySelector('#excluir-serie')?.addEventListener('click', () => confirmar('Excluir todos os horários futuros desta recorrência?', async () => {
        await api.del('/api/atendimentos/' + at.id + '?serie=1'); fecharModal(true); navegar();
      }));
      f.querySelector('#wpp').addEventListener('click', () => modalWhatsapp(paciente, {
        quando: at.data === hojeISO() ? 'hoje' : at.data === somaDias(hojeISO(), 1) ? 'amanhã' : `dia ${dataBR(at.data)}`,
        horario: at.hora
      }));
      f.querySelector('#ficha').addEventListener('click', () => { fecharModal(true); location.hash = '/paciente/' + at.paciente_id; });
      f.querySelector('#registrar')?.addEventListener('click', () => abrirDiario({ atendimento_id: at.id }));
    }
  });
}

/* ============================== PACIENTES ============================== */
App.paginas.pacientes = async (alvo, rota) => {
  const filtro = rota.query.status || 'Ativo';
  const lista = await api.get('/api/pacientes');
  const filtrada = filtro === 'todos' ? lista : lista.filter(p => p.status === filtro);

  alvo.innerHTML = `<div class="pagina">
    ${cabecalho('Pacientes', `${filtrada.length} registro(s)`,
    `<button class="btn btn-primario" id="novo">${ico('mais')} Novo paciente</button>`)}
    <div class="escolhas" style="margin-bottom:14px">
      ${['Ativo', 'Em avaliação', 'Inativo', 'Alta', 'todos'].map(s => `<div class="escolha ${filtro === s ? 'ativa' : ''}" data-status="${s}">${s === 'todos' ? 'Todos' : s}</div>`).join('')}
    </div>
    <div class="painel"><div class="painel-corpo sem-padding">
      ${tabela(['Paciente', 'Idade', 'Profissional', 'Frequência', 'Próximo', 'Documentação', 'Financeiro', 'Status'],
      filtrada.map(p => `<tr class="clicavel" data-id="${p.id}">
          <td><div class="td-principal">${esc(p.nome)}</div>
              <div class="td-secundario">${esc(p.responsaveis[0]?.nome || 'sem responsável')}</div></td>
          <td class="td-secundario">${idadeTexto(p.idade)}</td>
          <td class="td-secundario">${esc(p.profissional?.nome || '—')}</td>
          <td class="td-secundario">${esc(p.frequencia || '—')}${p.dia_semana !== undefined && p.dia_semana !== '' ? ' · ' + DIAS_CURTO[p.dia_semana] + ' ' + (p.horario || '') : ''}</td>
          <td class="td-secundario">${p.proximo_atendimento ? dataBR(p.proximo_atendimento.data) + ' ' + p.proximo_atendimento.hora : '—'}</td>
          <td>${p.documentacao === 'completa' ? '<span class="tag simples t-pago">Completa</span>' : '<span class="tag simples t-pendente">Pendente</span>'}</td>
          <td>${p.financeiro ? `<span class="tag simples t-${p.financeiro.situacao === 'Em atraso' ? 'em_atraso' : p.financeiro.situacao === 'Pendente' ? 'pendente' : 'pago'}">${p.financeiro.situacao}</span>` : '—'}</td>
          <td><span class="tag simples t-neutro">${esc(p.status)}</span></td>
        </tr>`))}
    </div></div>
  </div>`;

  alvo.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => location.hash = '/paciente/' + tr.dataset.id));
  alvo.querySelectorAll('[data-status]').forEach(el => el.addEventListener('click', () => location.hash = '/pacientes?status=' + encodeURIComponent(el.dataset.status)));
  alvo.querySelector('#novo').addEventListener('click', () => modalPaciente());
};

async function modalPaciente(paciente = null) {
  const profs = await api.get('/api/profissionais');
  const p = paciente || {};
  const resp = p.responsaveis?.length ? p.responsaveis : [{}];
  abrirModal({
    titulo: paciente ? 'Editar paciente' : 'Novo paciente',
    largo: true,
    corpo: `<form id="form-p">
      <fieldset><legend>Dados da criança</legend>
        <div class="linha-campos">
          ${campo('Nome completo *', entrada('nome', p.nome, 'text', 'required'))}
          ${campo('Nome social', entrada('nome_social', p.nome_social))}
        </div>
        <div class="linha-campos tres">
          ${campo('Data de nascimento', entrada('nascimento', p.nascimento, 'date'))}
          ${campo('Sexo', selecao('sexo', ['', 'Feminino', 'Masculino', 'Prefere não informar'], p.sexo))}
          ${campo('CPF (se necessário)', entrada('cpf', p.cpf))}
        </div>
        <div class="linha-campos tres">
          ${campo('Início do acompanhamento', entrada('inicio_acompanhamento', p.inicio_acompanhamento || hojeISO(), 'date'))}
          ${campo('Status', selecao('status', ['Ativo', 'Em avaliação', 'Inativo', 'Alta'], p.status || 'Ativo'))}
          ${campo('Escola / ano', entrada('escola', p.escola))}
        </div>
      </fieldset>

      <fieldset><legend>Responsáveis</legend>
        <div id="lista-resp">${resp.map((r, i) => blocoResponsavel(r, i)).join('')}</div>
        <button type="button" class="btn btn-sutil" id="add-resp">${ico('mais')} Adicionar responsável</button>
        <div style="height:10px"></div>
      </fieldset>

      <fieldset><legend>Organização do atendimento</legend>
        <div class="linha-campos tres">
          ${campo('Profissional responsável', selecao('profissional_id', profs.map(x => [x.id, x.nome]), p.profissional_id || App.sessao.profissional_id))}
          ${campo('Frequência', selecao('frequencia', ['Semanal', 'Quinzenal', 'Duas vezes por semana', 'Mensal', 'Sob demanda'], p.frequencia))}
          ${campo('Dia da semana', selecao('dia_semana', [['', '—'], ...DIAS.map((d, i) => [i, d])], p.dia_semana))}
        </div>
        <div class="linha-campos tres">
          ${campo('Horário', entrada('horario', p.horario, 'time'))}
          ${campo('Sala habitual', selecao('sala', [['', '—'], ...SALAS.map(x => [x, x])], p.sala))}
          ${campo('Valor por sessão', entrada('valor_sessao', p.valor_sessao, 'number', 'step="0.01"'))}
        </div>
        <div class="linha-campos tres">
          ${campo('Forma de pagamento', selecao('forma_pagamento', ['PIX', 'Dinheiro', 'Cartão', 'Transferência', 'Outros'], p.forma_pagamento))}
          ${campo('Dia de vencimento', entrada('dia_vencimento', p.dia_vencimento || 10, 'number', 'min="1" max="28"'))}
          ${campo('Convênio (se houver)', entrada('convenio', p.convenio))}
        </div>
      </fieldset>

      ${App.permissoes.clinico ? `<fieldset><legend>Informações pedagógicas</legend>
        <div class="aviso info">Registre apenas o essencial para conduzir o acompanhamento. Dados sensíveis detalhados devem ficar no diário de atendimento, com acesso restrito.</div>
        ${campo('Queixa principal', area('queixa', p.queixa, 2))}
        ${campo('Objetivo do acompanhamento', area('objetivo', p.objetivo, 2))}
        ${campo('Observações iniciais', area('observacoes_iniciais', p.observacoes_iniciais, 2))}
        <div class="linha-campos tres">
          ${campo('Avaliação inicial', entrada('avaliacao_inicial', p.avaliacao_inicial, 'date'))}
          ${campo('Reavaliação prevista', entrada('reavaliacao_prevista', p.reavaliacao_prevista, 'date'))}
          ${campo('Encaminhamento', entrada('encaminhamento', p.encaminhamento))}
        </div>
        ${campo('Profissionais externos envolvidos', entrada('profissionais_externos', p.profissionais_externos))}
      </fieldset>` : ''}
    </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="salvar">${paciente ? 'Salvar alterações' : 'Cadastrar paciente'}</button>`,
    aoAbrir: (f) => {
      let n = resp.length;
      f.querySelector('#add-resp').addEventListener('click', () => {
        f.querySelector('#lista-resp').insertAdjacentHTML('beforeend', blocoResponsavel({}, n++));
      });
      f.querySelector('#salvar').addEventListener('click', async () => {
        const form = f.querySelector('#form-p');
        if (!form.reportValidity()) return;
        const d = dadosFormulario(form);
        const responsaveis = [];
        f.querySelectorAll('[data-resp]').forEach(bloco => {
          const r = {};
          bloco.querySelectorAll('input,select').forEach(i => r[i.dataset.campo] = i.value);
          if (r.nome) responsaveis.push(r);
        });
        Object.keys(d).forEach(k => { if (k.startsWith('resp_')) delete d[k]; });
        d.responsaveis = responsaveis;
        if (d.dia_semana !== '') d.dia_semana = Number(d.dia_semana);
        d.valor_sessao = Number(d.valor_sessao) || 0;
        try {
          const salvo = paciente ? await api.put('/api/pacientes/' + paciente.id, d) : await api.post('/api/pacientes', d);
          fecharModal(true); aviso('Paciente salvo.');
          if (!paciente) location.hash = '/paciente/' + salvo.id; else navegar();
        } catch (e) { erroAviso(e); }
      });
    }
  });
}

const blocoResponsavel = (r, i) => `
  <div data-resp="${i}" style="border:1px solid var(--linha);border-radius:6px;padding:12px;margin-bottom:10px">
    <div class="linha-campos">
      <div class="campo"><label>Nome do responsável</label><input data-campo="nome" value="${esc(r.nome || '')}"></div>
      <div class="campo"><label>Parentesco</label>
        <select data-campo="parentesco">${['Mãe', 'Pai', 'Avó', 'Avô', 'Tutor(a)', 'Outro'].map(o => `<option ${r.parentesco === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
    </div>
    <div class="linha-campos tres">
      <div class="campo"><label>Telefone</label><input data-campo="telefone" value="${esc(r.telefone || '')}"></div>
      <div class="campo"><label>WhatsApp</label><input data-campo="whatsapp" value="${esc(r.whatsapp || '')}"></div>
      <div class="campo"><label>E-mail</label><input data-campo="email" value="${esc(r.email || '')}"></div>
    </div>
  </div>`;

/* ============================ PERFIL DO PACIENTE ============================ */
App.paginas.paciente = async (alvo, rota) => {
  const id = rota.param;
  const p = await api.get('/api/pacientes/' + id);
  const aba = rota.query.aba || 'resumo';
  const abas = [['resumo', 'Resumo'], ['agenda', 'Agenda'], ['diario', 'Diário de atendimentos'],
  ['evolucao', 'Evolução'], ['documentos', 'Documentos'], ['financeiro', 'Financeiro']]
    .filter(a => (['diario', 'evolucao'].includes(a[0]) ? App.permissoes.clinico : true))
    .filter(a => (a[0] === 'financeiro' ? App.permissoes.financeiro : true));

  alvo.innerHTML = `<div class="pagina">
    <a href="#/pacientes" class="btn btn-sutil" style="margin-bottom:10px">${ico('voltar')} Pacientes</a>
    <div class="painel" style="margin-bottom:16px">
      <div class="painel-corpo" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div class="avatar grande">${iniciais(p.nome)}</div>
        <div>
          <h1 style="font-size:20px">${esc(p.nome)}</h1>
          <div class="td-secundario">${idadeTexto(p.idade)} · ${esc(p.sexo || '')} · nasc. ${dataBR(p.nascimento)}${p.escola ? ' · ' + esc(p.escola) : ''}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="tag simples t-neutro">${esc(p.status)}</span>
            ${p.documentacao === 'completa' ? '<span class="tag simples t-pago">Documentação completa</span>' : '<span class="tag simples t-pendente">Documentação pendente</span>'}
            ${p.financeiro && App.permissoes.financeiro ? `<span class="tag simples t-${p.financeiro.situacao === 'Em atraso' ? 'em_atraso' : p.financeiro.situacao === 'Pendente' ? 'pendente' : 'pago'}">Financeiro: ${p.financeiro.situacao}</span>` : ''}
          </div>
        </div>
        <div class="cabecalho-acoes" style="margin-left:auto">
          <button class="btn" id="wpp">${ico('whatsapp')} WhatsApp</button>
          <button class="btn" id="editar">${ico('editar')} Editar</button>
          ${App.permissoes.clinico ? `<button class="btn btn-primario" id="registrar">${ico('diario')} Registrar atendimento</button>` : ''}
        </div>
      </div>
      <div class="abas">${abas.map(a => `<button class="${aba === a[0] ? 'ativa' : ''}" data-aba="${a[0]}">${a[1]}</button>`).join('')}</div>
    </div>
    <div id="conteudo-aba"><div class="vazio-estado">Carregando…</div></div>
  </div>`;

  alvo.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => location.hash = `/paciente/${id}?aba=${b.dataset.aba}`));
  alvo.querySelector('#editar').addEventListener('click', () => modalPaciente(p));
  alvo.querySelector('#wpp').addEventListener('click', () => modalWhatsapp(p, {
    quando: p.proximo_atendimento ? (p.proximo_atendimento.data === somaDias(hojeISO(), 1) ? 'amanhã' : `dia ${dataBR(p.proximo_atendimento.data)}`) : '',
    horario: p.proximo_atendimento?.hora || ''
  }));
  alvo.querySelector('#registrar')?.addEventListener('click', () => abrirDiario({ paciente_id: p.id }));

  const cont = alvo.querySelector('#conteudo-aba');
  ({ resumo: abaResumo, agenda: abaAgenda, diario: abaDiario, evolucao: abaEvolucao, documentos: abaDocumentos, financeiro: abaFinanceiro }[aba] || abaResumo)(cont, p);
};

async function abaResumo(cont, p) {
  const ultimoRegistro = App.permissoes.clinico
    ? (await api.get('/api/registros', { paciente_id: p.id }))[0] : null;
  cont.innerHTML = `<div class="grade g-agenda">
    <div style="display:grid;gap:16px">
      ${App.permissoes.clinico ? `<section class="painel">
        <div class="painel-titulo"><h2>Antes do atendimento</h2></div>
        <div class="painel-corpo">
          ${p.objetivo ? `<div class="campo"><label>Objetivo do acompanhamento</label><div>${esc(p.objetivo)}</div></div>` : ''}
          ${p.queixa ? `<div class="campo"><label>Queixa principal</label><div>${esc(p.queixa)}</div></div>` : ''}
          ${ultimoRegistro ? `
            <div class="campo"><label>Último atendimento — ${dataBR(ultimoRegistro.data)}</label>
              <div><b>Objetivo:</b> ${esc(ultimoRegistro.objetivo || '—')}</div>
              <div><b>Atividades:</b> ${esc(ultimoRegistro.atividades || '—')}</div>
              <div><b>Evolução:</b> ${esc(ultimoRegistro.evolucao || '—')}</div>
              ${ultimoRegistro.dificuldades ? `<div><b>Dificuldades:</b> ${esc(ultimoRegistro.dificuldades)}</div>` : ''}
              ${ultimoRegistro.orientacoes ? `<div><b>Orientações para casa:</b> ${esc(ultimoRegistro.orientacoes)}</div>` : ''}
            </div>` : '<div class="td-secundario">Nenhum diário registrado ainda.</div>'}
        </div></section>` : ''}

      <section class="painel">
        <div class="painel-titulo"><h2>Responsáveis</h2></div>
        <div class="painel-corpo sem-padding">
          <ul class="lista-limpa">${p.responsaveis.map(r => `<li>
            <div style="flex:1"><div class="td-principal">${esc(r.nome)}</div>
              <div class="td-secundario">${esc(r.parentesco || '')} · ${esc(r.telefone || '')} ${r.email ? '· ' + esc(r.email) : ''}</div></div>
            <button class="btn btn-sutil" data-wpp="${esc(r.whatsapp || r.telefone || '')}">${ico('whatsapp')}</button>
          </li>`).join('') || '<li class="td-secundario">Nenhum responsável cadastrado.</li>'}</ul>
        </div></section>
    </div>

    <div style="display:grid;gap:16px">
      <section class="painel"><div class="painel-titulo"><h2>Acompanhamento</h2></div>
        <div class="painel-corpo" style="display:grid;gap:9px;font-size:13.5px">
          ${linhaInfo('Profissional', p.profissional?.nome)}
          ${linhaInfo('Frequência', `${p.frequencia || '—'}${p.dia_semana !== '' && p.dia_semana !== undefined ? ' · ' + DIAS[p.dia_semana] + ' ' + (p.horario || '') : ''}`)}
          ${linhaInfo('Sala habitual', p.sala)}
          ${linhaInfo('Início', dataBR(p.inicio_acompanhamento))}
          ${linhaInfo('Sessões realizadas', p.total_atendimentos)}
          ${linhaInfo('Próximo atendimento', p.proximo_atendimento ? `${dataBR(p.proximo_atendimento.data)} às ${p.proximo_atendimento.hora}` : '—')}
          ${linhaInfo('Último atendimento', p.ultimo_atendimento ? dataBR(p.ultimo_atendimento.data) : '—')}
          ${linhaInfo('Reavaliação prevista', dataBR(p.reavaliacao_prevista))}
        </div></section>
      ${App.permissoes.financeiro ? `<section class="painel"><div class="painel-titulo"><h2>Situação financeira</h2></div>
        <div class="painel-corpo" style="display:grid;gap:9px;font-size:13.5px">
          ${linhaInfo('Valor por sessão', moeda(p.valor_sessao))}
          ${linhaInfo('Forma de pagamento', p.forma_pagamento)}
          ${linhaInfo('Em aberto', moeda(p.financeiro.aberto))}
          ${linhaInfo('Em atraso', moeda(p.financeiro.atraso))}
          ${linhaInfo('Total pago', moeda(p.financeiro.pago))}
        </div></section>` : ''}
    </div>
  </div>`;
  cont.querySelectorAll('[data-wpp]').forEach(b => b.addEventListener('click', () => modalWhatsapp(p)));
}
const linhaInfo = (r, v) => `<div style="display:flex;justify-content:space-between;gap:12px"><span class="td-secundario">${esc(r)}</span><strong style="font-weight:550;text-align:right">${esc(v ?? '—')}</strong></div>`;

async function abaAgenda(cont, p) {
  const ats = await api.get('/api/atendimentos', { paciente_id: p.id });
  const hoje = hojeISO();
  const futuros = ats.filter(a => a.data >= hoje);
  const passados = ats.filter(a => a.data < hoje).reverse();
  const linha = (a) => `<tr class="clicavel" data-at="${a.id}">
      <td class="td-principal">${dataBR(a.data)}</td><td>${a.hora}</td>
      <td class="td-secundario">${esc(a.tipo)}</td>
      <td>${salaTag(a.sala)}</td>
      <td class="td-secundario">${esc(primeiroNome(a.profissional?.nome))}</td>
      <td>${tag(a.status)}</td>
      <td>${a.status === 'realizado' ? (a.tem_registro ? '<span class="td-secundario">Diário ok</span>' : '<span class="tag simples t-terra">Sem diário</span>') : ''}</td>
    </tr>`;
  cont.innerHTML = `
    <div class="painel" style="margin-bottom:16px">
      <div class="painel-titulo"><h2>Próximos atendimentos</h2>
        <div class="acoes"><button class="btn btn-sutil" id="novo">${ico('mais')} Agendar</button></div></div>
      <div class="painel-corpo sem-padding">${tabela(['Data', 'Hora', 'Tipo', 'Sala', 'Profissional', 'Status', ''], futuros.map(linha), { vazio: 'Nenhum atendimento agendado.' })}</div>
    </div>
    <div class="painel"><div class="painel-titulo"><h2>Histórico (${passados.length})</h2></div>
      <div class="painel-corpo sem-padding">${tabela(['Data', 'Hora', 'Tipo', 'Sala', 'Profissional', 'Status', ''], passados.slice(0, 40).map(linha))}</div></div>`;
  cont.querySelector('#novo').addEventListener('click', () => modalAtendimento({ paciente_id: p.id, data: hoje }));
  cont.querySelectorAll('[data-at]').forEach(tr => tr.addEventListener('click', () => modalDetalheAtendimento(ats.find(a => a.id === Number(tr.dataset.at)))));
}

async function abaDiario(cont, p) {
  const regs = await api.get('/api/registros', { paciente_id: p.id });
  cont.innerHTML = `<div class="painel">
    <div class="painel-titulo"><h2>Diário de atendimentos (${regs.length})</h2>
      <div class="acoes"><button class="btn btn-primario btn-sutil" id="novo">${ico('mais')} Novo registro</button></div></div>
    <div class="painel-corpo sem-padding">
      ${regs.length ? `<ul class="lista-limpa">${regs.map(r => `<li style="flex-direction:column;gap:4px" data-reg="${r.id}">
        <div style="display:flex;gap:10px;width:100%;align-items:center">
          <strong>${dataBR(r.data)}</strong>
          <span class="td-secundario">${esc(r.tipo || '')} · ${esc(primeiroNome(r.profissional?.nome))}</span>
          <button class="btn btn-sutil" style="margin-left:auto" data-editar="${r.id}">${ico('editar')}</button>
        </div>
        <div style="font-size:13.5px"><b>Objetivo:</b> ${esc(r.objetivo || '—')}</div>
        <div style="font-size:13.5px"><b>Atividades:</b> ${esc(r.atividades || '—')}</div>
        ${r.evolucao ? `<div style="font-size:13.5px"><b>Evolução:</b> ${esc(r.evolucao)}</div>` : ''}
        ${r.orientacoes ? `<div style="font-size:13.5px"><b>Orientações:</b> ${esc(r.orientacoes)}</div>` : ''}
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
          ${AREAS.filter(a => r.areas?.[a[0]] && r.areas[a[0]] !== 'nao_trabalhado')
        .map(a => `<span class="tag simples ${r.areas[a[0]] === 'consolidado' ? 't-pago' : r.areas[a[0]] === 'evoluindo' ? 't-confirmado' : 't-neutro'}">${a[1]}: ${nivelRotulo(r.areas[a[0]])}</span>`).join('')}
        </div>
      </li>`).join('')}</ul>` : vazio('Nenhum registro de sessão.')}
    </div></div>`;
  cont.querySelector('#novo').addEventListener('click', () => abrirDiario({ paciente_id: p.id }));
  cont.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () =>
    abrirDiario({ paciente_id: p.id, registro: regs.find(r => r.id === Number(b.dataset.editar)) })));
}

async function abaEvolucao(cont, p) {
  cont.innerHTML = '<div class="vazio-estado">Carregando…</div>';
  const periodo = App.periodoEvolucao || { de: somaDias(hojeISO(), -90), ate: hojeISO() };
  const dados = await api.get('/api/evolucao/' + p.id, periodo);
  cont.innerHTML = conteudoEvolucao(dados, periodo);
  ligarEvolucao(cont, p.id);
}

function conteudoEvolucao(dados, periodo) {
  const comRegistro = dados.indicadores.filter(i => i.sessoes > 0);
  return `
  <div class="painel" style="margin-bottom:16px">
    <div class="painel-titulo"><h2>Período analisado</h2>
      <div class="acoes">
        <div class="escolhas">
          ${[[30, 'Últimos 30 dias'], [90, 'Últimos 3 meses'], [180, 'Últimos 6 meses']].map(([d, r]) =>
    `<div class="escolha ${periodo.de === somaDias(hojeISO(), -d) ? 'ativa' : ''}" data-periodo="${d}">${r}</div>`).join('')}
        </div>
        <input type="date" id="p-de" value="${periodo.de}" style="width:auto">
        <input type="date" id="p-ate" value="${periodo.ate}" style="width:auto">
      </div></div>
    <div class="painel-corpo" style="display:flex;gap:26px;flex-wrap:wrap">
      <div><div class="td-secundario">Sessões com registro</div><strong style="font-size:19px">${dados.linha_do_tempo.length}</strong></div>
      <div><div class="td-secundario">Áreas trabalhadas</div><strong style="font-size:19px">${comRegistro.length}</strong></div>
      <div><div class="td-secundario">Em avanço</div><strong style="font-size:19px">${comRegistro.filter(i => i.tendencia === 'avanco').length}</strong></div>
    </div>
  </div>

  <div class="grade g-agenda">
    <section class="painel">
      <div class="painel-titulo"><h2>Linha do tempo</h2></div>
      <div class="painel-corpo">
        ${dados.linha_do_tempo.length ? `<div class="tempo">${dados.linha_do_tempo.map(r => `
          <div class="tempo-item">
            <div class="data">${dataBR(r.data)} · ${esc(r.tipo || '')}</div>
            <div class="tempo-campo"><b>Objetivo:</b> ${esc(r.objetivo || '—')}</div>
            <div class="tempo-campo"><b>Atividade:</b> ${esc(r.atividades || '—')}</div>
            ${r.comportamento ? `<div class="tempo-campo"><b>Observação:</b> ${esc(r.comportamento)}</div>` : ''}
            ${r.evolucao ? `<div class="tempo-campo"><b>Evolução:</b> ${esc(r.evolucao)}</div>` : ''}
          </div>`).join('')}</div>` : vazio('Nenhum registro no período selecionado.')}
      </div>
    </section>

    <section class="painel">
      <div class="painel-titulo"><h2>Indicadores por área</h2></div>
      <div class="painel-corpo sem-padding">
        ${comRegistro.length ? `<ul class="lista-limpa">${comRegistro.map(i => {
      const nome = (AREAS.find(a => a[0] === i.area) || [, i.area])[1];
      const pct = { nao_trabalhado: 10, em_desenvolvimento: 40, evoluindo: 70, consolidado: 100 }[i.atual];
      return `<li style="flex-direction:column;gap:6px">
            <div style="display:flex;width:100%;gap:8px;align-items:center">
              <span class="td-principal">${nome}</span>
              <span class="td-secundario">${i.sessoes} sessões</span>
              <span style="margin-left:auto" class="tag simples ${i.tendencia === 'avanco' ? 't-pago' : i.tendencia === 'queda' ? 't-em_atraso' : 't-neutro'}">${nivelRotulo(i.atual)}</span>
            </div>
            <div class="barra-progresso" style="width:100%"><i style="width:${pct}%"></i></div>
          </li>`;
    }).join('')}</ul>` : vazio('Sem áreas registradas no período.')}
        <div style="padding:12px 16px;font-size:12px;color:var(--tinta-3);border-top:1px solid var(--linha)">
          Os indicadores refletem exclusivamente o que foi registrado nas sessões. O sistema não interpreta nem gera conteúdo clínico.
        </div>
      </div>
    </section>
  </div>`;
}

function ligarEvolucao(cont, pacienteId) {
  const recarregar = async (periodo) => {
    App.periodoEvolucao = periodo;
    cont.innerHTML = '<div class="vazio-estado">Carregando…</div>';
    const dados = await api.get('/api/evolucao/' + pacienteId, periodo);
    cont.innerHTML = conteudoEvolucao(dados, periodo);
    ligarEvolucao(cont, pacienteId);
  };
  cont.querySelectorAll('[data-periodo]').forEach(el => el.addEventListener('click', () =>
    recarregar({ de: somaDias(hojeISO(), -Number(el.dataset.periodo)), ate: hojeISO() })));
  const de = cont.querySelector('#p-de'), ate = cont.querySelector('#p-ate');
  [de, ate].forEach(i => i?.addEventListener('change', () => recarregar({ de: de.value, ate: ate.value })));
}

/* ====================== DIÁRIO DE ATENDIMENTO (registro) ====================== */
async function abrirDiario({ atendimento_id, paciente_id, registro }) {
  const [pacientes, templates, profs] = await Promise.all([
    api.get('/api/pacientes'), api.get('/api/templates'), api.get('/api/profissionais')
  ]);
  let atendimento = null;
  if (atendimento_id) {
    const lista = await api.get('/api/atendimentos', { de: somaDias(hojeISO(), -400), ate: somaDias(hojeISO(), 400) });
    atendimento = lista.find(a => a.id === atendimento_id);
    paciente_id = atendimento?.paciente_id;
    if (!registro) {
      const regs = await api.get('/api/registros', { paciente_id });
      registro = regs.find(r => r.areas !== undefined && r.atendimento_id === atendimento_id);
    }
  }
  const r = registro || {};
  const areas = r.areas || {};

  const textao = (nome, rotulo, valor, linhas = 2) => `
    <div class="campo"><label>${rotulo}</label><textarea name="${nome}" rows="${linhas}">${esc(valor || '')}</textarea></div>`;

  abrirModal({
    titulo: registro ? 'Editar registro de sessão' : 'Registrar atendimento',
    largo: true,
    corpo: `<form id="form-d">
      <div class="linha-campos">
        ${campo('Paciente *', selecao('paciente_id', [['', 'Selecione…'], ...pacientes.map(p => [p.id, p.nome])], paciente_id || r.paciente_id, 'required ' + (atendimento ? 'disabled' : '')))}
        ${campo('Modelo de registro', selecao('_modelo', [['', 'Sem modelo'], ...templates.map(t => [t.id, t.nome])], ''), 'Preenche os campos automaticamente; tudo pode ser editado.')}
      </div>
      <div class="linha-campos tres">
        ${campo('Data', entrada('data', r.data || atendimento?.data || hojeISO(), 'date', 'required'))}
        ${campo('Horário', entrada('hora', r.hora || atendimento?.hora || new Date().toTimeString().slice(0, 5), 'time'))}
        ${campo('Duração (min)', selecao('duracao', ['30', '45', '50', '60', '90'], String(r.duracao || atendimento?.duracao || 50)))}
      </div>
      <div class="linha-campos">
        ${campo('Profissional', selecao('profissional_id', profs.map(p => [p.id, p.nome]), r.profissional_id || atendimento?.profissional_id || App.sessao.profissional_id))}
        ${campo('Tipo de atendimento', selecao('tipo', ['Psicopedagogia', 'Fonoaudiologia', 'Terapia Ocupacional', 'Avaliação', 'Devolutiva', 'Orientação aos responsáveis'], r.tipo || atendimento?.tipo))}
      </div>

      <fieldset><legend>Áreas trabalhadas na sessão</legend>
        <div class="ajuda" style="margin-bottom:10px">Toque para marcar o nível observado. Áreas não tocadas ficam como "não trabalhado".</div>
        <div id="areas" style="display:grid;gap:8px">
          ${AREAS.map(([chave, nome]) => `
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <span style="min-width:150px;font-size:13.5px">${nome}</span>
              <div class="escolhas" data-area="${chave}">
                ${NIVEIS.map((n, i) => `<div class="escolha n${i + 1} ${(areas[chave] || 'nao_trabalhado') === n[0] ? 'ativa' : ''}" data-nivel="${n[0]}">${n[1]}</div>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </fieldset>

      <fieldset><legend>Registro da sessão</legend>
        ${textao('objetivo', 'Objetivo trabalhado', r.objetivo)}
        ${textao('atividades', 'Atividades realizadas', r.atividades)}
        ${textao('recursos', 'Recursos / materiais utilizados', r.recursos)}
        <div class="linha-campos">
          ${textao('comportamento', 'Comportamento e participação', r.comportamento)}
          ${textao('desempenho', 'Desempenho observado', r.desempenho)}
        </div>
        <div class="linha-campos">
          ${textao('evolucao', 'Evolução percebida', r.evolucao)}
          ${textao('dificuldades', 'Dificuldades encontradas', r.dificuldades)}
        </div>
        <div class="linha-campos">
          ${textao('orientacoes', 'Orientações para casa', r.orientacoes)}
          ${textao('observacoes', 'Observações', r.observacoes)}
        </div>
      </fieldset>
    </form>`,
    rodape: `<div class="esquerda"><button class="btn btn-sutil" id="salvar-modelo">Salvar como modelo</button></div>
      <button class="btn" data-fechar>Cancelar</button>
      <button class="btn btn-primario btn-grande" id="salvar">${ico('checar')} Salvar atendimento</button>`,
    aoAbrir: (f) => {
      f.querySelectorAll('[data-area] .escolha').forEach(el => el.addEventListener('click', () => {
        el.parentElement.querySelectorAll('.escolha').forEach(o => o.classList.remove('ativa'));
        el.classList.add('ativa');
      }));
      f.querySelector('[name=_modelo]').addEventListener('change', (e) => {
        const t = templates.find(x => x.id === Number(e.target.value));
        if (!t) return;
        Object.entries(t.campos || {}).forEach(([k, v]) => {
          const campo = f.querySelector(`[name=${k}]`);
          if (campo && !campo.value) campo.value = v;
        });
        aviso('Modelo aplicado — ajuste o que for necessário.');
      });
      f.querySelector('#salvar-modelo').addEventListener('click', async () => {
        const d = dadosFormulario(f.querySelector('#form-d'));
        const nome = prompt('Nome do modelo:');
        if (!nome) return;
        await api.post('/api/templates', { nome, tipo: d.tipo, campos: { objetivo: d.objetivo, atividades: d.atividades, recursos: d.recursos, orientacoes: d.orientacoes } });
        aviso('Modelo salvo.');
      });
      f.querySelector('#salvar').addEventListener('click', async () => {
        const form = f.querySelector('#form-d');
        if (!form.reportValidity()) return;
        const d = dadosFormulario(form);
        delete d._modelo;
        d.paciente_id = Number(d.paciente_id || paciente_id);
        d.areas = {};
        f.querySelectorAll('[data-area]').forEach(g => {
          d.areas[g.dataset.area] = g.querySelector('.ativa')?.dataset.nivel || 'nao_trabalhado';
        });
        if (atendimento_id) d.atendimento_id = atendimento_id;
        try {
          if (registro?.id) await api.put('/api/registros/' + registro.id, d);
          else await api.post('/api/registros', d);
          fecharModal(true); aviso('Atendimento registrado.'); navegar();
        } catch (e) { erroAviso(e); }
      });
    }
  });
}
