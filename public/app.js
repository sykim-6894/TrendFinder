// TrendFinder 화면. data/trends.json 하나만 읽어 그린다.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safe = (u) => (/^https?:\/\//i.test(u ?? '') ? esc(u) : '#');
const link = (u, label) => `<a href="${safe(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;

const COLORS = {
  google: '#4285f4', nate: '#ff4d4d', navernews: '#03c75a', x: '#9aa4b1', youtube: '#ff3b30', ytmusic: '#ff3b30',
  theqoo: '#7aa2ff', dcbest: '#4b62d1', fmkorea: '#5f8dff', ruliweb: '#3aa0ff', instiz: '#35c5a0', pann: '#ff7eb6',
};
const TABS = ['all', 'rising', 'cat', 'site', 'age'];
const PERIOD_LABEL = { day: '일간', week: '주간', month: '월간' };
const AGE_LABEL = { 10: '10대', 20: '20대', 30: '30대', 40: '40대', 50: '50대', 60: '60대 이상' };

const state = { tab: 'all', period: 'day', cat: '전체', group: '전체', age: '20' };
let data;
let srcById = {};

const srcChip = (id) => `<span class="src" style="--c:${COLORS[id] ?? '#888'}"><i></i>${esc(srcById[id]?.name ?? id)}</span>`;
function delta(d, f) {
  if (d === 'new' || f === 'new') return '<span class="badge new">NEW</span>';
  if (d > 0) return `<span class="badge up">▲${d}</span>`;
  if (f === 'up') return '<span class="badge up">▲</span>';
  if (d < 0) return `<span class="badge down">▼${-d}</span>`;
  return '';
}

function topicCard(t, i, { showWhy } = {}) {
  const extra = t.items.filter((it) => it.t !== t.t || it.s !== t.items[0].s);
  const news = t.news ?? [];
  const rel = [
    ...extra.map((it) => `<li>${srcChip(it.s)}<span>${link(it.u, it.t)} <span class="m">${esc(it.m ?? '')}</span></span></li>`),
    ...news.map((n) => `<li><span class="src"><i></i>${esc(n.s || '뉴스')}</span><span>${link(n.u, n.t)}</span></li>`),
  ];
  return `<li class="topic">
    <span class="rk">${i + 1}</span>
    <div class="body">
      <div class="tt">${link(t.u, t.t)}${delta(t.d)}</div>
      <div class="meta">
        ${t.srcs.map(srcChip).join('')}
        <span class="cat">${esc(t.c)}</span>
        ${showWhy && t.why?.length ? `<span class="why">${esc(t.why.join(' · '))}</span>` : ''}
      </div>
      ${rel.length ? `<details><summary>관련 글·기사 ${rel.length}개</summary><ul class="rel">${rel.join('')}</ul></details>` : ''}
    </div>
    ${t.img ? `<img class="thumb" src="${safe(t.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
  </li>`;
}

const itemRow = (it, withSrc) => `<li>
  <span class="n">${it.r}</span>
  <span class="t">${link(it.u, it.t)}${delta(it.d, it.f)}
    <span class="m">${withSrc ? `${esc(srcById[withSrc]?.name ?? '')}${it.m ? ' · ' : ''}` : ''}${esc(it.m ?? '')}</span></span>
</li>`;

function historyNote(p) {
  if (state.period === 'day') return '';
  const want = state.period === 'week' ? 7 : 30;
  return p.days < want
    ? `<p class="note">${PERIOD_LABEL[state.period]} 순위는 매일 쌓이는 기록으로 집계합니다. 지금은 <b>${p.days}일치</b>만 쌓여 있어, ${want}일이 채워질 때까지는 그만큼만 반영됩니다.</p>`
    : '';
}

// ── 탭별 화면 ────────────────────────────────────────────────
function viewAll(p) {
  const top = p.unified.slice(0, 40);
  return `<h1>${PERIOD_LABEL[state.period]} 통합 트렌드</h1>
    <p class="lead">검색어·SNS·커뮤니티·뉴스를 한데 묶어, 여러 곳에서 높은 순위에 오른 이슈일수록 위에 놓았습니다.</p>
    ${historyNote(p)}
    <ol class="topics">${top.map((t, i) => topicCard(t, i)).join('')}</ol>`;
}

function viewRising() {
  const list = data.rising ?? [];
  return `<h1>급상승 이슈</h1>
    <p class="lead">직전 수집 때보다 새로 올라왔거나 순위가 크게 뛴 이슈, 여러 사이트에 동시에 등장한 이슈입니다.</p>
    ${list.length ? `<ol class="topics">${list.map((t, i) => topicCard(t, i, { showWhy: true })).join('')}</ol>` : '<p class="empty">지금은 급상승한 이슈가 없습니다.</p>'}`;
}

function viewCat(p) {
  const posts = Object.entries(p.bySource).flatMap(([id, list]) => list.map((it) => ({ ...it, s: id })));
  const count = (c) => p.unified.filter((t) => t.c === c).length + posts.filter((it) => it.c === c).length;
  const cats = data.categories.filter((c) => count(c));
  if (!cats.includes(state.cat)) state.cat = cats[0];
  const topics = p.unified.filter((t) => t.c === state.cat).slice(0, 30);
  const items = posts.filter((it) => it.c === state.cat && srcById[it.s]?.kind === 'post').sort((a, b) => a.r - b.r).slice(0, 40);
  return `<h1>${PERIOD_LABEL[state.period]} 카테고리별 트렌드</h1>
    <p class="lead">제목에 들어 있는 단어로 분류한 것이라 일부는 다른 카테고리에 들어갈 수 있습니다.</p>
    <div class="chips">${cats.map((c) => `<button class="chip ${c === state.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}<span class="n">${count(c)}</span></button>`).join('')}</div>
    ${historyNote(p)}
    <div class="cols">
      <section><h2>이슈</h2>${topics.length ? `<ol class="topics">${topics.map((t, i) => topicCard(t, i)).join('')}</ol>` : '<p class="empty">이 카테고리의 이슈가 없습니다.</p>'}</section>
      <section class="panel"><h2>인기 글·영상·기사</h2>${items.length ? `<ol class="list">${items.map((it) => itemRow(it, it.s)).join('')}</ol>` : '<p class="empty">해당 글이 없습니다.</p>'}</section>
    </div>`;
}

function viewSite(p) {
  const groups = ['전체', ...new Set(data.sources.map((s) => s.group))];
  const list = data.sources.filter((s) => (state.group === '전체' || s.group === state.group) && p.bySource[s.id]?.length);
  return `<h1>${PERIOD_LABEL[state.period]} 사이트별 트렌드</h1>
    <p class="lead">사이트마다 지금 가장 주목받는 검색어·글·영상입니다.</p>
    <div class="chips">${groups.map((g) => `<button class="chip ${g === state.group ? 'on' : ''}" data-group="${esc(g)}">${esc(g)}</button>`).join('')}</div>
    ${historyNote(p)}
    <div class="grid">${list
      .map((s) => {
        const items = p.bySource[s.id];
        return `<section class="card">
          <div class="card-head"><h2 style="--c:${COLORS[s.id] ?? '#888'}"><i></i>${link(s.home, s.name)}</h2><span class="g">${esc(s.group)}</span></div>
          <ol class="list short">${items.map((it) => itemRow(it)).join('')}</ol>
          ${items.length > 10 ? `<button class="more" data-more>더 보기 (${items.length}개)</button>` : ''}
        </section>`;
      })
      .join('')}</div>`;
}

function viewAge() {
  const ages = data.ages?.[state.period];
  const head = `<h1>${PERIOD_LABEL[state.period]} 연령대별 관심사</h1>
    <p class="lead">네이버 쇼핑에서 각 연령대가 많이 찾은 검색어입니다. <span class="uniq" style="margin:0">특징</span> 표시는 다른 연령대 상위권에는 없는 검색어입니다.</p>
    <p class="note">SNS·포털·커뮤니티는 이용자 연령을 공개하지 않습니다. 연령대가 실제로 집계되어 공개되는 자료는 네이버 데이터랩 쇼핑인사이트뿐이라, 이 탭은 그 자료만 사용합니다.</p>`;
  if (!ages) return `${head}<p class="empty">연령대별 자료를 아직 받지 못했습니다.</p>`;
  const cards = ages[state.age] ?? [];
  return `${head}
    <div class="chips">${Object.keys(AGE_LABEL).map((a) => `<button class="chip ${a === state.age ? 'on' : ''}" data-age="${a}">${AGE_LABEL[a]}</button>`).join('')}</div>
    ${cards.length ? '' : '<p class="empty">이 기간의 자료가 없습니다.</p>'}
    <div class="grid">${cards
      .map(
        (c) => `<section class="card"><div class="card-head"><h2>${esc(c.cat)}</h2></div>
          <ol class="list">${c.kws
            .map((k, i) => `<li><span class="n">${i + 1}</span><span class="t">${link(`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(k.k)}`, k.k)}${k.uniq ? '<span class="uniq">특징</span>' : ''}</span></li>`)
            .join('')}</ol></section>`,
      )
      .join('')}</div>`;
}

function render() {
  const p = data.periods[state.period];
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === state.tab));
  document.querySelectorAll('#period button').forEach((b) => b.classList.toggle('on', b.dataset.period === state.period));
  $('#period').classList.toggle('off', state.tab === 'rising');
  $('#main').innerHTML = { all: viewAll, rising: viewRising, cat: viewCat, site: viewSite, age: viewAge }[state.tab](p);
}

function readHash() {
  const [tab, period] = location.hash.slice(1).split('/');
  if (TABS.includes(tab)) state.tab = tab;
  if (PERIOD_LABEL[period]) state.period = period;
}
const writeHash = () => history.replaceState(null, '', `#${state.tab}/${state.period}`);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tab],[data-period],[data-cat],[data-group],[data-age],[data-more]');
  if (!el || !data) return;
  if (el.dataset.more !== undefined) {
    el.previousElementSibling.classList.remove('short');
    return el.remove();
  }
  e.preventDefault();
  for (const k of ['tab', 'period', 'cat', 'group', 'age']) if (el.dataset[k] !== undefined) state[k] = el.dataset[k];
  writeHash();
  render();
  if (el.dataset.tab) scrollTo(0, 0);
});
addEventListener('hashchange', () => {
  readHash();
  if (data) render();
});

(async () => {
  try {
    data = await (await fetch(`data/trends.json?t=${Math.floor(Date.now() / 6e5)}`)).json();
  } catch {
    $('#main').innerHTML = '<p class="empty pad">데이터를 불러오지 못했습니다. <code>node scripts/update.mjs</code> 를 먼저 실행해 주세요.</p>';
    return;
  }
  srcById = Object.fromEntries(data.sources.map((s) => [s.id, s]));
  const when = new Date(data.updated);
  $('#updated').textContent = `${when.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 갱신`;
  const failed = data.sources.filter((s) => s.status !== 'ok').map((s) => s.name);
  $('#foot').innerHTML = `<b>수집처</b> ${data.sources.map((s) => esc(s.name)).join(' · ')} · 네이버 데이터랩 쇼핑인사이트<br>
    ${failed.length ? `이번 갱신에서 받지 못한 곳: ${failed.map(esc).join(', ')}<br>` : ''}
    하루 두 번(오전 7시·오후 7시) 자동 갱신됩니다. 각 사이트의 공개 순위를 모아 보여 주는 비공식 페이지이며, 제목과 링크의 저작권은 원 게시처에 있습니다.`;
  readHash();
  render();
})();
