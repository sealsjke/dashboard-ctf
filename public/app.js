const $ = id => document.getElementById(id);
const colors = ['#59dff0','#e75bd8','#a78afb','#f3c15b','#6294f4','#a9d94f','#f47785','#5cddb0'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt = value => Number(value || 0).toLocaleString('ru-RU');
const ourTeamName = 'smd';
let state = null;
let tab = 'live';
let service = 'all';
let windowRounds = 10;
let defenseWindowRounds = 30;
let search = '';
let trackedTeamId = null;
let trackedOptionsSignature = '';

document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => {
  tab = button.dataset.tab;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b === button));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `${tab}-view`));
  $('page-title').textContent = {live:'Пульс соревнования',attacks:'Аналитика атак',defense:'Защита сервисов',ours:'smd',tracking:'Отслеживание',teams:'Таблица команд'}[tab];
  render();
}));
$('window-filters').addEventListener('click', event => {
  const button = event.target.closest('button[data-window]');
  if (!button) return;
  windowRounds = Number(button.dataset.window);
  document.querySelectorAll('#window-filters button').forEach(b => b.classList.toggle('active', b === button));
  renderAttacks();
});
$('service-filters').addEventListener('click', event => {
  const button = event.target.closest('button[data-service]');
  if (!button) return;
  service = button.dataset.service;
  renderAttacks();
});
$('defense-window-filters').addEventListener('click', event => {
  const button = event.target.closest('button[data-window]');
  if (!button) return;
  defenseWindowRounds = Number(button.dataset.window);
  document.querySelectorAll('#defense-window-filters button').forEach(b => b.classList.toggle('active', b === button));
  renderDefense();
});
$('team-search').addEventListener('input', event => { search = event.target.value.toLocaleLowerCase('ru'); renderTeams(); });
$('track-team-select').addEventListener('change', event => {
  trackedTeamId = event.target.value;
  $('track-orbit-balls').replaceChildren();
  $('track-team-orbit-balls').replaceChildren();
  renderTracking();
});
$('logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.assign('/login'); });

function kpi(value,label,hint,color) {
  return `<article class="kpi" style="--kpi-color:${color}"><div class="value" title="${esc(value)}">${esc(value)}</div><div class="label">${esc(label)}</div><div class="hint">${esc(hint)}</div></article>`;
}
function attacksIn(rounds, selectedService = 'all') {
  const round = state.scoreboard.game.real_round;
  return state.attacks.filter(a => a.round > round - rounds && (selectedService === 'all' || String(a.task_id) === selectedService));
}
function total(list) { return list.reduce((sum,a) => sum + (a.flags || 0), 0); }
function group(list, key) {
  const out = new Map();
  for (const a of list) out.set(a[key], (out.get(a[key]) || 0) + (a.flags || 0));
  return [...out.entries()].sort((a,b) => b[1] - a[1]);
}
function meter(value,max,color) { return `<div class="meter-track"><div class="meter-fill" style="width:${max ? value/max*100 : 0}%;background:${color}"></div></div>`; }
function renderExploits(board) {
  const tasks = board.tasks;
  const latestRound = board.game.real_round;
  const cells = new Map();
  for (const attack of state.attacks) {
    const key = `${attack.attacker_id}:${attack.task_id}`;
    if (!cells.has(key)) cells.set(key, { flags: 0, lastRound: 0, victims: new Set() });
    const cell = cells.get(key);
    cell.flags += attack.flags || 0;
    cell.lastRound = Math.max(cell.lastRound, attack.round || 0);
    cell.victims.add(attack.victim_id);
  }
  const teams = [...board.teams].sort((a, b) =>
    tasks.reduce((sum, task) => sum + (cells.get(`${b.id}:${task.id}`)?.flags || 0) - (cells.get(`${a.id}:${task.id}`)?.flags || 0), 0)
  );
  $('exploits').innerHTML = `<div class="exploits-table" style="--service-count:${tasks.length}">
    <div class="exploits-heading"><span>#</span><span>КОМАНДА</span>${tasks.map((task, i) => `<span class="exploit-service" style="--cell-color:${colors[i % colors.length]}" title="${esc(task.name)}">${esc(task.name)}</span>`).join('')}<span>АКТИВНО</span></div>
    ${teams.map((team, index) => {
      const active = tasks.filter(task => (cells.get(`${team.id}:${task.id}`)?.lastRound || 0) >= latestRound - 2).length;
      return `<div class="exploits-row${index === 0 ? ' leading' : ''}"><span class="exploit-rank">${index + 1}</span><span class="exploit-team" title="${esc(team.name)}">${esc(team.name)}</span>${tasks.map((task, i) => {
        const cell = cells.get(`${team.id}:${task.id}`);
        if (!cell) return '<span class="exploit-cell empty-cell">·</span>';
        const isActive = cell.lastRound >= latestRound - 2;
        return `<span class="exploit-cell${isActive ? ' is-active' : ''}" style="--cell-color:${colors[i % colors.length]}" title="${esc(team.name)} · ${esc(task.name)}: ${fmt(cell.flags)} флагов, ${cell.victims.size} жертв, последний раунд R${cell.lastRound}"><strong>${fmt(cell.flags)}</strong><small>посл. R${cell.lastRound}</small><em>${cell.victims.size} жертв</em></span>`;
      }).join('')}<span class="exploit-active">${active}<small>/${tasks.length}</small></span></div>`;
    }).join('')}
  </div>`;
}
function renderLive() {
  const board = state.scoreboard;
  const round = board.game.real_round;
  const recent = attacksIn(10);
  const current = attacksIn(1);
  const attackers = group(recent,'attacker_id');
  const victims = group(recent,'victim_id');
  const leader = board.teams[0];
  const teams = new Map(board.teams.map(t => [t.id,t]));
  $('live-kpis').innerHTML = [
    kpi(`R${round}`,'Текущий раунд', `${board.game.round_count || '—'} всего`, '#59dff0'),
    kpi(fmt(total(current)),'Флаги в раунде','по данным атак','#ed5bdb'),
    kpi(fmt(total(recent)),'За 10 раундов','украдено флагов','#a891fa'),
    kpi(leader?.name || '—','Лидер',`${fmt(leader?.score)} очков`,'#f5c461'),
    kpi(fmt(board.teams.length),'Команды','в зачёте','#58df9a'),
    kpi(fmt(board.tasks.length),'Сервисы','под наблюдением','#6294f4')
  ].join('');
  const feed = [...state.attacks].sort((a,b) => Date.parse(b.last_at) - Date.parse(a.last_at)).slice(0,80);
  $('feed-count').textContent = `${feed.length} последних записей`;
  $('feed').innerHTML = feed.length ? feed.map(a => `<div class="feed-item"><time>${esc(new Date(a.last_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time><div><strong>${esc(a.attacker)}</strong><span class="arrow">→</span><strong>${esc(a.victim)}</strong></div><span class="tag">${esc(a.task)} · ${fmt(a.flags)}</span></div>`).join('') : '<div class="empty">Атак пока нет</div>';

  const top = attackers.slice(0,8), max = top[0]?.[1] || 1;
  $('top-attackers').innerHTML = `<div class="rank-list">${top.map(([id,n],i) => `<div class="rank-row"><span class="rank-num">${String(i+1).padStart(2,'0')}</span><span class="rank-name" title="${esc(teams.get(id)?.name || id)}">${esc(teams.get(id)?.name || id)}</span>${meter(n,max,colors[i])}<span class="rank-value">${fmt(n)}</span></div>`).join('') || '<div class="empty">Атак пока нет</div>'}</div>`;

  const topIds = group(state.attacks,'attacker_id').slice(0,6).map(([id]) => id);
  const start = Math.max(1,round - 29);
  const rounds = Array.from({length:round-start+1},(_,i)=>start+i);
  const byRound = new Map(rounds.map(r => [r,new Map()]));
  for (const a of state.attacks) if (byRound.has(a.round)) {
    const id = topIds.includes(a.attacker_id) ? a.attacker_id : 'other';
    const map = byRound.get(a.round); map.set(id,(map.get(id)||0)+a.flags);
  }
  const ymax = Math.max(1,...[...byRound.values()].map(m => [...m.values()].reduce((x,y)=>x+y,0)));
  const tick = Math.ceil(ymax/4/5)*5 || 1;
  $('round-chart').innerHTML = `<div class="y-axis"><span>${fmt(tick*4)}</span><span>${fmt(tick*3)}</span><span>${fmt(tick*2)}</span><span>${fmt(tick)}</span><span>0</span></div><div class="chart-bars">${rounds.map((r,i) => {const map=byRound.get(r);const value=[...map.values()].reduce((x,y)=>x+y,0);const segments=[...topIds,'other'].map((id,j)=>`<div class="bar-seg" style="height:${(map.get(id)||0)/Math.max(value,1)*100}%;background:${colors[j]}"></div>`).join('');return `<div class="bar-slot" title="Раунд ${r}: ${value} флагов" data-round="${i%3===0||i===rounds.length-1?'R'+r:''}"><div class="bar-stack" style="height:${value/(tick*4)*100}%">${segments}</div></div>`;}).join('')}</div>`;
  $('chart-legend').innerHTML = [...topIds,'other'].map((id,i)=>`<span class="legend-item"><i style="background:${colors[i]}"></i>${esc(id==='other'?'Другие':teams.get(id)?.name || id)}</span>`).join('');

  const statusColors = {101:'#58df9a',102:'#6294f4',103:'#f5c461',104:'#ff687f',110:'#ff687f','-1':'#a891fa'};
  $('health').innerHTML = `<div class="health-list">${board.tasks.map(task => {const counts = new Map();for(const team of board.teams){const code=team.tasks.find(t=>t.task_id===task.id)?.status ?? -1;counts.set(code,(counts.get(code)||0)+1)}const pieces=[101,102,103,104,110,-1].map(code=>{const n=counts.get(code)||0;return n?`<span title="${code}: ${n}" style="width:${n/board.teams.length*100}%;background:${statusColors[code]}">${n>1?n:''}</span>`:''}).join('');return `<div class="health-row"><span class="name" title="${esc(task.name)}">${esc(task.name)}</span><div class="stacked-meter">${pieces}</div><span class="health-total">${board.teams.length}</span></div>`}).join('')}</div><div class="health-key"><span><i style="background:#58df9a"></i>UP</span><span><i style="background:#f5c461"></i>MUMBLE</span><span><i style="background:#ff687f"></i>DOWN / ERR</span></div>`;
  const byService = group(recent,'task_id');const smax=byService[0]?.[1]||1;
  $('services').innerHTML = `<div class="service-list">${byService.map(([id,n],i)=>{const task=board.tasks.find(t=>t.id===id);const name=esc(task?.name||id);const label=task?.name==='Казна'?`<a href="https://board-academy.ad.omctf.ru/arena/treasury/visual/" target="_blank" rel="noreferrer" title="Открыть визуализацию «Казны»">${name} ↗</a>`:name;return `<div class="service-row"><span class="name">${label}</span>${meter(n,smax,colors[i])}<span class="rank-value">${fmt(n)}</span></div>`}).join('') || '<div class="empty">Атак пока нет</div>'}</div>`;
  renderCircle(recent, board.teams);
}
function renderCircle(recent, teams) {
  const sum = total(recent);
  const names = new Map(teams.map(team => [team.id, team.name]));
  const ranked = group(recent, 'attacker_id');
  const shown = ranked.slice(0, 7).map(([id, flags]) => ({name: names.get(id) || String(id), flags}));
  const other = ranked.slice(7).reduce((value, [, flags]) => value + flags, 0);
  if (other) shown.push({name: 'Другие', flags: other});
  const polar = (angle, radius) => ({x: 170 + radius * Math.cos((angle - 90) * Math.PI / 180), y: 170 + radius * Math.sin((angle - 90) * Math.PI / 180)});
  const arc = (from, to) => {
    const start = polar(from, 128), end = polar(to, 128), innerEnd = polar(to, 83), innerStart = polar(from, 83);
    const large = to - from > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A 128 128 0 ${large} 1 ${end.x} ${end.y} L ${innerEnd.x} ${innerEnd.y} A 83 83 0 ${large} 0 ${innerStart.x} ${innerStart.y} Z`;
  };
  let angle = 0;
  const slices = shown.map((item, i) => {
    const part = item.flags / sum * 360;
    const from = angle + 0.8, to = Math.min(359.999, angle + part - 0.8);
    angle += part;
    if (to <= from) return '';
    return `<path class="circle-slice" d="${arc(from, to)}" fill="${colors[i]}" data-index="${i}" tabindex="0" aria-label="${esc(item.name)}: ${fmt(item.flags)} флагов"></path>`;
  }).join('');
  $('attack-circle').innerHTML = `<div class="circle-content"><div class="circle-visual"><svg viewBox="0 0 340 340" role="img" aria-label="Доля украденных флагов по командам"><circle cx="170" cy="170" r="146" fill="none" stroke="#28405a" stroke-width="1" stroke-dasharray="3 7"/><circle cx="170" cy="170" r="128" fill="none" stroke="#1d2d46" stroke-width="45"/>${slices}<circle cx="170" cy="170" r="72" fill="#0d172b" stroke="#344966" stroke-width="1"/></svg><div class="circle-center"><strong id="circle-value">${fmt(sum)}</strong><span id="circle-label">ФЛАГОВ</span></div></div><div class="circle-details"><div class="circle-caption">АТАКУЮЩИЕ КОМАНДЫ <span>R${Math.max(1, state.scoreboard.game.real_round - 9)}–R${state.scoreboard.game.real_round}</span></div>${shown.map((item,i) => `<div class="circle-legend-row" data-index="${i}"><i style="background:${colors[i]}"></i><span class="circle-team" title="${esc(item.name)}">${esc(item.name)}</span><b>${fmt(item.flags)}</b><small>${sum ? (item.flags/sum*100).toFixed(1) : '0.0'}%</small></div>`).join('') || '<div class="empty">Атак пока нет</div>'}</div></div>`;
  const highlight = index => {
    const item = shown[index];
    $('circle-value').textContent = item ? fmt(item.flags) : fmt(sum);
    $('circle-label').textContent = item ? item.name : 'ФЛАГОВ';
    $('attack-circle').querySelectorAll('[data-index]').forEach(el => el.classList.toggle('selected', item && Number(el.dataset.index) === index));
  };
  $('attack-circle').querySelectorAll('[data-index]').forEach(el => {
    el.addEventListener('mouseenter', () => highlight(Number(el.dataset.index)));
    el.addEventListener('mouseleave', () => highlight(-1));
    el.addEventListener('focus', () => highlight(Number(el.dataset.index)));
    el.addEventListener('blur', () => highlight(-1));
  });
}
function renderAttacks() {
  if (!state?.scoreboard) return;
  const board=state.scoreboard;
  renderExploits(board);
  $('service-filters').innerHTML = `<button data-service="all" class="${service==='all'?'active':''}">Все</button>${board.tasks.map(t=>`<button data-service="${t.id}" class="${service===String(t.id)?'active':''}">${esc(t.name)}</button>`).join('')}`;
  const list=attacksIn(windowRounds,service), count=total(list);
  const attackers=group(list,'attacker_id'),victims=group(list,'victim_id'),services=group(list,'task_id');
  const names=new Map(board.teams.map(t=>[t.id,t.name]));
  $('attack-kpis').innerHTML = [
    kpi(fmt(count),'Флаги',`за ${windowRounds} раундов`,'#59dff0'),
    kpi((count/windowRounds).toFixed(1),'Флагов / раунд','среднее','#a891fa'),
    kpi(names.get(attackers[0]?.[0])||'—','Лидер атак',`${fmt(attackers[0]?.[1])} флагов`,'#f5c461'),
    kpi(names.get(victims[0]?.[0])||'—','Главная жертва',`${fmt(victims[0]?.[1])} флагов`,'#ff687f'),
    kpi(board.tasks.find(t=>t.id===services[0]?.[0])?.name||'—','Целевой сервис',`${fmt(services[0]?.[1])} флагов`,'#ed5bdb'),
    kpi(fmt(list.length),'Активные пары','раунд × атакующий × жертва','#58df9a')
  ].join('');
  const ids=board.teams.map(t=>t.id), matrix=new Map();
  for(const a of list){const key=`${a.attacker_id}:${a.victim_id}`;matrix.set(key,(matrix.get(key)||0)+a.flags)}
  const max=Math.max(1,...matrix.values());
  $('matrix').innerHTML=`<table class="matrix"><thead><tr><th>КОМАНДА</th>${ids.map(id=>`<th title="${esc(names.get(id))}">${esc(names.get(id)?.slice(0,8))}</th>`).join('')}</tr></thead><tbody>${ids.map(row=>`<tr><th title="${esc(names.get(row))}">${esc(names.get(row))}</th>${ids.map(col=>{const n=matrix.get(`${row}:${col}`)||0;const alpha=n?0.25+0.75*Math.sqrt(n/max):0;return `<td class="${n?'':'zero'}" style="${n?`background:rgba(79,211,239,${alpha.toFixed(2)})`:''}" title="${esc(names.get(row))} → ${esc(names.get(col))}: ${n}">${n||'·'}</td>`}).join('')}</tr>`).join('')}</tbody></table>`;
  const flows=[...matrix.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);const fmax=flows[0]?.[1]||1;
  $('flows').innerHTML=`<div class="flows-list">${flows.map(([key,n])=>{const [a,v]=key.split(':').map(Number);return `<div class="flow-row"><div class="flow-names"><b>${esc(names.get(a))}</b><span>→</span>${esc(names.get(v))}</div>${meter(n,fmax,'#a891fa')}<span class="flow-count">${fmt(n)}</span></div>`}).join('')||'<div class="empty">Атак за выбранный период нет</div>'}</div>`;
}
function renderDefense() {
  if (!state?.scoreboard) return;
  const board = state.scoreboard;
  const names = new Map(board.teams.map(team => [String(team.id), team.name]));
  const cells = new Map();
  for (const attack of state.attacks) {
    const key = `${attack.victim_id}:${attack.task_id}`;
    if (!cells.has(key)) cells.set(key, { lastRound: 0, rounds: new Map(), attackers: new Map() });
    const cell = cells.get(key);
    const attackerId = String(attack.attacker_id);
    const attacker = cell.attackers.get(attackerId) || { flags: 0, lastRound: 0 };
    cell.rounds.set(attack.round, (cell.rounds.get(attack.round) || 0) + (attack.flags || 0));
    cell.lastRound = Math.max(cell.lastRound, attack.round || 0);
    attacker.flags += attack.flags || 0;
    attacker.lastRound = Math.max(attacker.lastRound, attack.round || 0);
    cell.attackers.set(attackerId, attacker);
  }
  const latestRound = board.game.real_round;
  const activeFrom = latestRound - 9;
  const firstRound = Math.max(1, latestRound - defenseWindowRounds + 1);
  const rounds = Array.from({ length: latestRound - firstRound + 1 }, (_, index) => firstRound + index);
  const windowFlags = cell => cell ? [...cell.rounds].reduce((sum, [round, flags]) => sum + (round >= firstRound && round <= latestRound ? flags : 0), 0) : 0;
  const totals = new Map(board.teams.map(team => [team.id, board.tasks.reduce((sum, task) => sum + windowFlags(cells.get(`${team.id}:${task.id}`)), 0)]));
  const teams = [...board.teams].sort((a, b) => totals.get(b.id) - totals.get(a.id));
  $('defense-body').innerHTML = `<div class="exploits-table defense-grid" style="--service-count:${board.tasks.length}">
    <div class="exploits-heading"><span>#</span><span>КОМАНДА</span>${board.tasks.map((task, index) => `<span class="exploit-service" style="--cell-color:${colors[index % colors.length]}" title="${esc(task.name)}">${esc(task.name)}</span>`).join('')}<span>УКРАДЕНО</span></div>
    ${teams.map((team, rank) => {
      return `<div class="exploits-row${rank === 0 ? ' leading' : ''}"><span class="exploit-rank">${rank + 1}</span><span class="exploit-team" title="${esc(team.name)}">${esc(team.name)}</span>${board.tasks.map((task, index) => {
        const cell = cells.get(`${team.id}:${task.id}`);
        if (!cell) return '<span class="exploit-cell empty-cell">·</span>';
        const attackers = [...cell.attackers.entries()].sort((a, b) => b[1].flags - a[1].flags);
        const attackerNames = attackers.map(([id]) => names.get(id) || id);
        const recent = cell.lastRound >= activeFrom;
        const shown = attackerNames.slice(0, 2).join(', ') + (attackerNames.length > 2 ? ` +${attackerNames.length - 2}` : '');
        const maximum = Math.max(1, ...rounds.map(round => cell.rounds.get(round) || 0));
        const history = rounds.map(round => {
          const flags = cell.rounds.get(round) || 0;
          return `<i class="${flags ? 'has-flags' : ''}" title="R${round}: ${fmt(flags)} флагов" style="height:${flags ? Math.max(14, flags / maximum * 100) : 10}%"></i>`;
        }).join('');
        return `<span class="exploit-cell defense-cell${recent ? ' is-active' : ' is-fixed'}" style="--cell-color:${colors[index % colors.length]};--history-count:${rounds.length}" title="${esc(team.name)} · ${esc(task.name)}: в R${latestRound} украдено ${fmt(cell.rounds.get(latestRound) || 0)}; за ${defenseWindowRounds} раундов — ${fmt(windowFlags(cell))}; атакующие: ${esc(attackers.map(([id, data]) => `${names.get(id) || id} (${fmt(data.flags)})`).join(', '))}">${recent ? '' : '<span class="defense-check">✓</span>'}<strong>−${fmt(cell.rounds.get(latestRound) || 0)}</strong><small>R${latestRound} · ${esc(shown)}</small><span class="defense-round-strip">${history}</span></span>`;
      }).join('')}<span class="defense-total" title="За выбранные ${defenseWindowRounds} раундов">${fmt(totals.get(team.id))}</span></div>`;
    }).join('')}
  </div>`;
}
function findOurTeam(board) {
  return board.teams.find(team => team.name.toLocaleLowerCase('ru') === ourTeamName);
}
function renderOurs() {
  if (!state?.scoreboard) return;
  const team = findOurTeam(state.scoreboard);
  if (!team) {
    $('our-name').textContent = ourTeamName;
    $('our-kpis').innerHTML = '<div class="empty">Команда не найдена в таблице</div>';
    return;
  }
  renderTeamPage('our', team);
}
function renderTracking() {
  if (!state?.scoreboard) return;
  const teams = state.scoreboard.teams.filter(team => team.name.toLocaleLowerCase('ru') !== ourTeamName);
  const signature = JSON.stringify(teams.map(team => [team.id, team.name]));
  const select = $('track-team-select');
  if (signature !== trackedOptionsSignature) {
    select.innerHTML = teams.map(team => `<option value="${esc(team.id)}">${esc(team.name)}</option>`).join('');
    trackedOptionsSignature = signature;
  }
  if (!teams.some(team => String(team.id) === trackedTeamId)) trackedTeamId = teams.length ? String(teams[0].id) : null;
  if (!trackedTeamId) {
    $('track-name').textContent = 'Нет других команд';
    $('track-kpis').innerHTML = '<div class="empty">Нет команд для отслеживания</div>';
    return;
  }
  select.value = trackedTeamId;
  renderTeamPage('track', teams.find(team => String(team.id) === trackedTeamId));
}
function renderTeamPage(prefix, team) {
  const board = state.scoreboard;
  const get = name => $(`${prefix}-${name}`);
  const round = board.game.real_round;
  const ourId = String(team.id);
  const names = new Map(board.teams.map(item => [String(item.id), item.name]));
  const tasks = new Map(board.tasks.map(item => [String(item.id), item]));
  const recent = attacksIn(30);
  const outgoing = recent.filter(attack => String(attack.attacker_id) === ourId);
  const incoming = recent.filter(attack => String(attack.victim_id) === ourId);
  const stolen = team.tasks.reduce((sum, task) => sum + (task.stolen || 0), 0);
  const lost = team.tasks.reduce((sum, task) => sum + (task.lost || 0), 0);
  const rank = board.teams.findIndex(item => String(item.id) === ourId) + 1;
  get('name').textContent = team.name;
  get('rank').textContent = `Место ${rank} из ${board.teams.length} · R${round}`;
  get('orbit-core-name').textContent = team.name;
  get('team-orbit-core-name').textContent = team.name;
  get('orbit-round').textContent = `R${round}`;
  get('kpis').innerHTML = [
    kpi(fmt(team.score?.toFixed(2)),'Очки','по борде','#f5c461'),
    kpi(`#${rank}`,'Место',`из ${board.teams.length} команд`,'#a891fa'),
    kpi(fmt(stolen),'Украдено','всего по борде','#59dff0'),
    kpi(fmt(lost),'Потеряно','всего по борде','#ff687f'),
    kpi(`${stolen - lost >= 0 ? '+' : ''}${fmt(stolen - lost)}`,'Баланс флагов','украли − потеряли','#58df9a'),
    kpi(`${fmt(total(outgoing.filter(a => a.round === round)))} / ${fmt(total(incoming.filter(a => a.round === round)))}`,'Этот раунд','атака / защита','#ed5bdb')
  ].join('');
  get('orbit-services').innerHTML = board.tasks.map((task, index) => {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / Math.max(1, board.tasks.length);
    const x = 50 + 37 * Math.cos(angle), y = 50 + 37 * Math.sin(angle);
    const out = total(outgoing.filter(attack => String(attack.task_id) === String(task.id) && attack.round === round));
    const received = total(incoming.filter(attack => String(attack.task_id) === String(task.id) && attack.round === round));
    return `<div class="orbit-service" data-task-id="${esc(task.id)}" style="left:${x}%;top:${y}%;--orbit-color:${colors[index % colors.length]}" title="${esc(task.name)} · R${round}: украли ${fmt(out)}, потеряли ${fmt(received)}"><strong>${esc(task.name)}</strong><small>↑${fmt(out)} ↓${fmt(received)}</small></div>`;
  }).join('');
  get('team-orbit-round').textContent = `R${round}`;
  const otherTeams = board.teams.filter(item => String(item.id) !== ourId);
  get('orbit-teams').innerHTML = otherTeams.map((other, index) => {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / Math.max(1, otherTeams.length);
    const x = 50 + 42 * Math.cos(angle), y = 50 + 42 * Math.sin(angle);
    const out = total(outgoing.filter(attack => String(attack.victim_id) === String(other.id) && attack.round === round));
    const received = total(incoming.filter(attack => String(attack.attacker_id) === String(other.id) && attack.round === round));
    return `<div class="orbit-service orbit-team" data-team-id="${esc(other.id)}" style="left:${x}%;top:${y}%;--orbit-color:${colors[index % colors.length]}" title="${esc(other.name)} · R${round}: украдено ${fmt(out)}, потеряно ${fmt(received)}"><strong>${esc(other.name)}</strong><small>↑${fmt(out)} ↓${fmt(received)}</small></div>`;
  }).join('');
  get('services').innerHTML = board.tasks.map((task, index) => {
    const own = team.tasks.find(item => String(item.task_id) === String(task.id));
    const out = total(outgoing.filter(attack => String(attack.task_id) === String(task.id)));
    const received = total(incoming.filter(attack => String(attack.task_id) === String(task.id)));
    return `<article class="our-service-card" style="--service-color:${colors[index % colors.length]}"><div class="our-service-title"><strong>${esc(task.name)}</strong><span>${esc(own?.status_name || '—')}</span></div><div class="our-service-numbers"><div><small>УКРАДЕНО</small><b>${fmt(own?.stolen || 0)}</b><em>за 30 раундов: ${fmt(out)}</em></div><div><small>ПОТЕРЯНО</small><b>${fmt(own?.lost || 0)}</b><em>за 30 раундов: ${fmt(received)}</em></div></div></article>`;
  }).join('');
  const opponents = (attacks, key) => {
    const ranked = group(attacks, key).slice(0, 8);
    return ranked.length ? ranked.map(([id, flags], index) => `<div class="our-opponent"><span>${index + 1}</span><strong title="${esc(names.get(String(id)) || id)}">${esc(names.get(String(id)) || id)}</strong><b>${fmt(flags)}</b></div>`).join('') : '<div class="empty">Атак за 30 раундов нет</div>';
  };
  get('targets').innerHTML = opponents(outgoing, 'victim_id');
  get('attackers').innerHTML = opponents(incoming, 'attacker_id');
  const events = recent.filter(attack => String(attack.attacker_id) === ourId || String(attack.victim_id) === ourId)
    .sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at));
  get('events').innerHTML = events.length ? events.map(attack => {
    const out = String(attack.attacker_id) === ourId;
    const opponent = names.get(String(out ? attack.victim_id : attack.attacker_id)) || '—';
    const taskName = tasks.get(String(attack.task_id))?.name || attack.task || attack.task_id;
    return `<div class="our-event ${out ? 'out' : 'in'}"><span>R${attack.round}</span><strong>${out ? 'Атаковали' : 'Потеряли'}</strong><span title="${esc(opponent)}">${esc(opponent)}</span><span>${esc(taskName)}</span><b>${out ? '+' : '−'}${fmt(attack.flags)}</b></div>`;
  }).join('') : '<div class="empty">Событий за 30 раундов нет</div>';
}
function attackDeltas(previous, next, teamId) {
  if (!previous?.scoreboard || !next?.scoreboard) return [];
  const totals = attacks => {
    const map = new Map();
    for (const attack of attacks) {
      const key = `${attack.round}:${attack.attacker_id}:${attack.victim_id}:${attack.task_id}`;
      map.set(key, (map.get(key) || 0) + (attack.flags || 0));
    }
    return map;
  };
  const before = totals(previous.attacks);
  const after = totals(next.attacks);
  const grouped = new Map();
  const seen = new Set();
  for (const attack of next.attacks) {
    if (String(attack.attacker_id) !== teamId && String(attack.victim_id) !== teamId) continue;
    const key = `${attack.round}:${attack.attacker_id}:${attack.victim_id}:${attack.task_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const delta = Math.max(0, (after.get(key) || 0) - (before.get(key) || 0));
    if (!delta) continue;
    const direction = String(attack.attacker_id) === teamId ? 'out' : 'in';
    const opponentId = String(direction === 'out' ? attack.victim_id : attack.attacker_id);
    const groupKey = `${direction}:${attack.task_id}:${opponentId}`;
    const item = grouped.get(groupKey) || {direction, taskId:String(attack.task_id), opponentId, flags:0};
    item.flags += delta;
    grouped.set(groupKey, item);
  }
  return [...grouped.values()];
}
function animateOurAttacks(events, prefix = 'our') {
  const fly = (orbitId, layerId, selector, dataKey, targetId, event) => {
    const orbit = $(orbitId);
    const core = orbit.querySelector('.orbit-core');
    const layer = $(layerId);
    const target = [...orbit.querySelectorAll(selector)].find(node => node.dataset[dataKey] === targetId);
    if (!target) return;
    const bounds = orbit.getBoundingClientRect();
    const point = element => { const rect = element.getBoundingClientRect(); return {x:rect.left + rect.width / 2 - bounds.left, y:rect.top + rect.height / 2 - bounds.top}; };
    const start = point(event.direction === 'out' ? core : target);
    const end = point(event.direction === 'out' ? target : core);
    const ball = document.createElement('span');
    ball.className = `orbit-ball ${event.direction}`;
    ball.textContent = `${event.direction === 'out' ? '+' : '−'}${fmt(event.flags)}`;
    ball.style.left = `${start.x}px`;
    ball.style.top = `${start.y}px`;
    layer.append(ball);
    const animation = ball.animate([
      {transform:'translate(-50%,-50%) scale(.5)', left:`${start.x}px`, top:`${start.y}px`, opacity:0},
      {transform:'translate(-50%,-50%) scale(1)', opacity:1, offset:.2},
      {transform:'translate(-50%,-50%) scale(1)', left:`${end.x}px`, top:`${end.y}px`, opacity:1, offset:.82},
      {transform:'translate(-50%,-50%) scale(.3)', left:`${end.x}px`, top:`${end.y}px`, opacity:0}
    ], {duration:1100, easing:'ease-in-out'});
    animation.onfinish = () => ball.remove();
  };
  for (const event of events) {
    fly(`${prefix}-orbit`, `${prefix}-orbit-balls`, '.orbit-service', 'taskId', event.taskId, event);
    fly(`${prefix}-team-orbit`, `${prefix}-team-orbit-balls`, '.orbit-team', 'teamId', event.opponentId, event);
  }
}
function renderTeams() {
  if (!state?.scoreboard) return;
  const board=state.scoreboard;
  const filtered=board.teams.filter(t=>t.name.toLocaleLowerCase('ru').includes(search));
  $('teams-count').textContent=`${filtered.length} / ${board.teams.length} команд`;
  $('teams-body').innerHTML=filtered.map(t=>{const rank=board.teams.indexOf(t)+1;return `<tr><td>${rank}</td><td class="team-name">${esc(t.name)}</td><td class="score">${fmt(t.score.toFixed(2))}</td><td class="positive">+${fmt(t.tasks.reduce((s,x)=>s+x.stolen,0))}</td><td class="negative">−${fmt(t.tasks.reduce((s,x)=>s+x.lost,0))}</td><td>${t.tasks.map(task=>`<span class="status-dot" style="background:${esc(task.color||'#71809b')}" title="${esc(board.tasks.find(x=>x.id===task.task_id)?.name)}: ${esc(task.status_name)}"></span>`).join('')}</td></tr>`}).join('')||'<tr><td colspan="6" class="empty">Команды не найдены</td></tr>';
}
function render() {
  if (!state?.scoreboard) return;
  const board=state.scoreboard;
  $('game-name').textContent=board.game.name;
  $('header-round').textContent=board.game.real_round;
  $('updated').textContent=`Обновлено ${new Date(state.updatedAt).toLocaleTimeString('ru-RU')}`;
  if(tab==='live')renderLive();else if(tab==='attacks')renderAttacks();else if(tab==='defense')renderDefense();else if(tab==='ours')renderOurs();else if(tab==='tracking')renderTracking();else renderTeams();
  updateTimer();
}
function updateTimer(){
  const end=state?.scoreboard?.game?.round_ends_at;
  if(!end)return;
  const seconds=Math.max(0,Math.floor((Date.parse(end)-Date.now())/1000));
  $('timer').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}
function receive(data){
  const previous = state;
  state=data;
  $('connection').textContent=data.error?'Источник недоступен':'LIVE';
  $('connection').classList.toggle('offline',!!data.error);
  $('notice').hidden=!data.error;
  $('notice').textContent=data.error ? `Нет свежих данных: ${data.error}. ${data.scoreboard?'Показан последний полученный срез.':''}` : '';
  render();
  if (tab === 'ours' && previous?.scoreboard && data.scoreboard) {
    const team = findOurTeam(data.scoreboard);
    if (team) animateOurAttacks(attackDeltas(previous, data, String(team.id)));
  }
  if (tab === 'tracking' && previous?.scoreboard && data.scoreboard && trackedTeamId) {
    animateOurAttacks(attackDeltas(previous, data, trackedTeamId), 'track');
  }
}
const stream=new EventSource('/api/stream');
stream.onmessage=event=>{try{receive(JSON.parse(event.data))}catch(error){console.error(error)}};
stream.onerror=async()=>{$('connection').textContent='Нет соединения';$('connection').classList.add('offline');try{if((await fetch('/api/state')).status===401)location.assign('/login')}catch{}};
setInterval(updateTimer,1000);
