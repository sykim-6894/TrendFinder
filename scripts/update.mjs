// 트렌드를 수집해 public/data/trends.json 을 만든다. (하루 1~2회 실행, API 키 불필요)
// 사용: node scripts/update.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, AGES, AGE_CATS, datalab, sleep } from './sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'trends.json');
const HISTORY = join(ROOT, 'data', 'history.json');
const HISTORY_DAYS = 35;
const PERIODS = { day: 1, week: 7, month: 30 };
const LIST_MAX = 30;

const kst = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 - offsetDays * 86400e3).toISOString().slice(0, 10);
const TODAY = kst();
const readJSON = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

// ── 카테고리 분류 (제목의 단어로 어림) ───────────────────────────
export const CATEGORIES = ['연예·방송', '스포츠', '정치', '경제', '사회', 'IT·과학', '게임', '생활·쇼핑', '유머·커뮤니티', '기타'];
const RULES = [
  ['스포츠', /야구|축구|농구|배구|골프|테니스|KBO|MLB|NBA|EPL|K리그|프리미어리그|챔피언스리그|손흥민|이강인|김민재|오타니|이정후|선수|연승|연패|우승|결승|올림픽|월드컵|홈런|득점|감독 경질|국가대표|국대|UFC|한화 이글스|LG 트윈스|KIA|롯데 자이언츠|두산 베어스|삼성 라이온즈|토트넘|맨유|리버풀|FA 계약|트레이드|이적/i],
  ['게임', /게임|롤드컵|LCK|T1|페이커|스팀|닌텐도|플스|PS5|엑스박스|메이플|로스트아크|던파|배그|발로란트|오버워치|원신|포켓몬|GTA|RTX|그래픽카드|넥슨|엔씨|넷마블|크래프톤|e스포츠/i],
  ['연예·방송', /아이돌|컴백|앨범|콘서트|뮤직비디오|MV|배우|가수|드라마|예능|영화|시사회|넷플릭스|디즈니\+?|티빙|열애|결혼 발표|이혼|소속사|팬미팅|음원|차트|BTS|방탄|블랙핑크|뉴진스|아이브|에스파|세븐틴|NCT|스트레이 키즈|르세라핌|ILLIT|아일릿|유튜버|방송인|개그맨|MC|시청률|출연|데뷔|티저|OST|걸그룹|보이그룹|트로트|커밍아웃|나는 솔로|환승연애/i],
  ['정치', /대통령|국회|의원|여당|야당|민주당|국민의힘|개혁신당|조국혁신당|총리|장관|탄핵|특검|청문회|선거|공천|정부|외교|정상회담|북한|김정은|트럼프|시진핑|푸틴|국감|국정감사|법안|대통령실|검찰총장|당대표|원내대표/],
  ['경제', /주가|주식|코스피|코스닥|나스닥|환율|금리|부동산|집값|전세|월세|아파트값|비트코인|이더리움|코인|가상자산|삼성전자|SK하이닉스|현대차|실적|상장|공모주|물가|인상|인하|관세|수출|대출|연봉|세금|연말정산|한국은행|연준|엔비디아 주|테슬라 주|금값|유가/],
  ['IT·과학', /AI|인공지능|챗GPT|ChatGPT|GPT|제미나이|Gemini|클로드|아이폰|갤럭시|애플|구글|메타|엔비디아|반도체|로봇|우주|누리호|스페이스X|해킹|개인정보 유출|앱|업데이트|카카오톡|네이버|쿠팡|통신사|SKT|KT|LG유플러스|자율주행|전기차|배터리|테슬라/i],
  ['사회', /사고|화재|사망|숨져|숨진|경찰|검찰|구속|체포|기소|재판|판결|징역|살인|폭행|사기|실종|지진|태풍|폭설|한파|폭우|날씨|미세먼지|수능|교사|학교|학폭|의사|병원|파업|집회|시위|범죄|음주운전|교통|버스|지하철|중경상|부상|피해자|방화|법원/],
  ['생활·쇼핑', /맛집|레시피|요리|다이어트|건강|여행|항공권|호텔|할인|세일|블랙프라이데이|빼빼로|패딩|후리스|코트|운동화|화장품|인테리어|육아|반려|강아지|고양이|편의점|신메뉴|출시|스타벅스|카페|결혼|남친|여친|시댁|시어머니|직장|회사|퇴사|신입|연애/],
];
const SOURCE_DEFAULT = { navernews: '사회', pann: '생활·쇼핑', ytmusic: '연예·방송', theqoo: '유머·커뮤니티', dcbest: '유머·커뮤니티', fmkorea: '유머·커뮤니티', ruliweb: '유머·커뮤니티', instiz: '유머·커뮤니티' };
const byRule = (s) => RULES.find(([, re]) => re.test(s))?.[0];
const classify = (it, src) => it.c ?? byRule(it.t) ?? byRule((it.news ?? []).map((n) => n.t).join(' ')) ?? byRule(it.nc ?? '') ?? SOURCE_DEFAULT[src] ?? '기타';

// ── 텍스트 매칭 ──────────────────────────────────────────────
const STOP = new Set(['오늘', '어제', '내일', '관련', '근황', '영상', '사진', '공식', '속보', '단독', '종합', '현재', '진짜', '이유', '논란', '발표', '공개', 'jpg', 'gif', 'mp4', 'the', 'and', 'feat', '싱글벙글', '오싹오싹', '훌쩍훌쩍', '난리난', '난리', '요즘', '실시간', '레전드', '충격', '반응', '모음', '결국', '최근', '이번', '역대급', '후기', '정리', '사람', '사람들', '하는', '있는', '없는', '한국', '일본', '미국', '중국']);
const norm = (s) => s.toLowerCase().replace(/[^가-힣a-z0-9]+/g, '');
const words = (s) => s.toLowerCase().replace(/[^가-힣a-z0-9]+/g, ' ').split(' ').filter(Boolean);
const toks = (s) => [...new Set(words(s).filter((w) => w.length >= 2 && !STOP.has(w)))];
export const keyOf = (t) => norm(t).slice(0, 60);
// 키워드(tokens)가 글 제목(target)에 들어 있는가
function hit(tokens, target) {
  if (!tokens.length) return false;
  if (tokens.length === 1) {
    const [w] = tokens;
    return w.length >= 3 ? target.n.includes(w) : target.w.some((v) => v.startsWith(w));
  }
  const n = tokens.filter((w) => target.n.includes(w)).length;
  return tokens.length === 2 ? n === 2 : n >= Math.max(2, Math.ceil(tokens.length * 0.5));
}
const pts = (r) => Math.max(1, LIST_MAX + 1 - r);

// ── 통합 이슈 만들기 ─────────────────────────────────────────
// 통합·급상승에서 빼는 잡음: X 의 기능 안내성 트렌드, 한국어가 전혀 없는 구글 검색어
const X_NOISE = /gif|저장법|동영상|링크|붙여넣기|다운로드|테스트|복사|팔로우|맞팔|트친소/i;
const hangul = (s) => /[가-힣]/.test(s ?? '');
const isNoise = (src, it) =>
  (src === 'x' && X_NOISE.test(it.t)) || (src === 'google' && !hangul(it.t) && !(it.news ?? []).some((n) => hangul(n.t)));

// 두 글 제목이 같은 사건을 다루는가 (겹치는 단어 수로 어림)
function samePost(a, b) {
  const shared = (x, y) => x.tk.filter((w) => y.n.includes(w));
  const s1 = shared(a, b);
  const s2 = shared(b, a);
  const s = s1.length >= s2.length ? s1 : s2;
  if (s.length < 2 || !s.some((w) => w.length >= 3)) return false;
  return s.length >= 3 || s.length / Math.min(a.tk.length, b.tk.length) >= 0.6;
}

function unify(lists) {
  const topics = [];
  const kws = [];
  const posts = [];
  for (const src of SOURCES) {
    for (const it of lists[src.id] ?? []) {
      if (isNoise(src.id, it)) continue;
      const e = { ...it, s: src.id, w: src.w, p: (it.p ?? pts(it.r)) / (it.pmax ?? LIST_MAX), tk: toks(it.t), n: norm(it.t), wd: words(it.t) };
      (src.kind === 'kw' ? kws : posts).push(e);
    }
  }
  kws.sort((a, b) => b.w * b.p - a.w * a.p);
  for (const k of kws) {
    const target = { n: k.n, w: k.wd };
    const found = topics.find((t) => t.kw.some((m) => m.n === k.n || hit(m.tk, target) || hit(k.tk, { n: m.n, w: m.wd })));
    if (found) found.kw.push(k);
    else topics.push({ kw: [k], posts: [] });
  }
  const rest = [];
  for (const p of posts) {
    const target = { n: p.n, w: p.wd };
    const t = topics.find((tp) => tp.kw.some((m) => hit(m.tk, target)));
    if (t) t.posts.push(p);
    else rest.push(p);
  }
  // 키워드와 안 묶인 글·기사는 같은 사건끼리 서로 묶는다. 혼자 남은 글은 소스별 상위 5개만 단독 이슈로
  rest.sort((a, b) => b.w * b.p - a.w * a.p);
  const groups = [];
  for (const p of rest) {
    const g = groups.find((g) => samePost(g[0], p));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const solo = {};
  for (const g of groups) {
    if (g.length === 1 && (solo[g[0].s] = (solo[g[0].s] ?? 0) + 1) > 5) continue;
    topics.push({ kw: [], posts: g, solo: true });
  }
  return topics
    .map((t) => {
      const members = [...t.kw, ...t.posts];
      const srcs = [...new Set(members.map((m) => m.s))];
      const head = members[0];
      // 글은 상위 4개까지만 점수에 반영 (같은 사건 기사가 수십 개여도 끝없이 오르지 않게)
      const postScore = t.posts.slice(0, 4).reduce((a, m, i) => a + m.w * m.p * (t.solo ? (i ? 0.5 : 0.8) : 0.4), 0);
      let base = t.kw.reduce((a, m) => a + m.w * m.p, 0) + postScore;
      // 다른 곳에서 전혀 확인되지 않은 검색어는 낮춘다. 한 단어짜리는 더 낮춘다
      if (t.kw.length && members.length === 1) base *= (head.tk.length <= 1 ? 0.55 : 0.8) * (head.s === 'x' ? 0.75 : 1);
      const kwSrcs = new Set(t.kw.map((m) => m.s)).size;
      const rise = members.reduce((a, m) => a + (m.rise ?? 0) * m.w, 0) + Math.max(0, kwSrcs - 1) * 12;
      const why = [];
      if (t.kw.some((m) => m.d === 'new' || m.f === 'new')) why.push('신규 진입');
      else if (t.kw.some((m) => m.d > 0 || m.f === 'up')) why.push('순위 상승');
      if (srcs.length > 1) why.push(srcs.length + '개 사이트 동시');
      const news = members.find((m) => m.news?.length)?.news;
      // 검색어만으로는 왜 떴는지 알 수 없으니 관련 기사·글 제목 하나를 설명으로 붙인다
      const desc = t.kw.length ? (news?.[0]?.t ?? (t.posts.find((m) => m.s === 'navernews') ?? t.posts[0])?.t) : undefined;
      return {
        t: head.t,
        u: head.u,
        desc,
        score: Math.round(base * (1 + 0.35 * (srcs.length - 1)) * 100) / 10,
        c: byRule(head.t) ?? byRule(desc ?? '') ?? members.map((m) => m.c).find((c) => c && c !== '기타') ?? head.c ?? '기타',
        srcs,
        img: members.find((m) => m.img)?.img,
        d: head.d,
        rise: Math.round(rise * 10) / 10,
        why,
        items: members.slice(0, 8).map((m) => ({ s: m.s, t: m.t, u: m.u, r: m.r, m: m.m })),
        news,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ── 수집 ────────────────────────────────────────────────────
const history = await readJSON(HISTORY, { days: {}, last: null });
const prevOut = await readJSON(OUT, null);
const earlier = history.days[TODAY] ?? {};
const status = {};
const fresh = {};

await Promise.all(
  SOURCES.map(async (src) => {
    try {
      const list = await src.run();
      if (list === null) return void (status[src.id] = 'skip');
      if (!list.length) throw new Error('빈 목록');
      const seen = new Set();
      fresh[src.id] = list
        .filter((it) => it.t && !seen.has(keyOf(it.t)) && seen.add(keyOf(it.t)))
        .slice(0, 60)
        .map((it, i) => ({ ...it, r: i + 1 }));
      status[src.id] = 'ok';
      console.log(`✓ ${src.name}: ${list.length}건`);
    } catch (e) {
      status[src.id] = earlier[src.id] ? 'stale' : 'fail';
      console.warn(`✗ ${src.name}: ${e.message}`);
    }
  }),
);

// 오늘 스냅숏: 방금 받은 목록 + 같은 날 앞선 실행에만 있던 항목(뒤에 붙임)
const today = {};
for (const src of SOURCES) {
  const now = fresh[src.id];
  const old = earlier[src.id] ?? [];
  if (!now) {
    if (old.length) today[src.id] = old;
    continue;
  }
  const keys = new Set(now.map((it) => keyOf(it.t)));
  const rest = old.filter((it) => !keys.has(keyOf(it.t)));
  today[src.id] = [...now, ...rest.map((it, i) => ({ ...it, r: now.length + i + 1, f: undefined }))]
    .slice(0, 60)
    .map((it) => ({ ...it, c: classify(it, src.id), nc: undefined, traffic: undefined, tr: it.traffic }));
}

// 직전 실행·최근 7일과 비교해 순위 변동과 급상승 점수를 매긴다
const yesterday = history.days[kst(1)] ?? {};
const lastRun = history.last && history.last.ts !== undefined ? history.last.src : {};
const weekKeys = {};
for (let i = 1; i <= 7; i++) {
  for (const [id, list] of Object.entries(history.days[kst(i)] ?? {})) {
    (weekKeys[id] ??= new Set()), list.forEach((it) => weekKeys[id].add(keyOf(it.t)));
  }
}
for (const src of SOURCES) {
  const prev = lastRun[src.id] ?? (yesterday[src.id] ? Object.fromEntries(yesterday[src.id].map((it) => [keyOf(it.t), it.r])) : null);
  for (const it of today[src.id] ?? []) {
    const k = keyOf(it.t);
    if (prev) it.d = k in prev ? prev[k] - it.r : 'new';
    let rise = 0;
    if (src.kind === 'kw') {
      if (it.d === 'new') rise += (weekKeys[src.id]?.has(k) ? 0.5 : 1) * pts(it.r);
      else if (it.d > 0) rise += it.d * 2;
      rise += it.f === 'new' ? 15 : it.f === 'up' ? 8 : 0;
      if (src.id === 'google') rise += 4 + 3 * Math.log10((it.tr ?? 0) + 1);
    } else if (it.d === 'new' && it.r <= 5) rise += 5;
    it.rise = rise;
  }
}

// 기록 저장
history.days[TODAY] = Object.fromEntries(
  Object.entries(today).map(([id, list]) => [id, list.map(({ t, u, r, m, c, img, news }) => ({ t, u, r, m, c, img, news }))]),
);
for (const d of Object.keys(history.days).sort().slice(0, -HISTORY_DAYS)) delete history.days[d];
history.last = { ts: Date.now(), src: Object.fromEntries(Object.entries(fresh).map(([id, list]) => [id, Object.fromEntries(list.map((it) => [keyOf(it.t), it.r]))])) };
await mkdir(dirname(HISTORY), { recursive: true });
await writeFile(HISTORY, JSON.stringify(history));

// ── 기간별 집계 ──────────────────────────────────────────────
const dayKeys = Object.keys(history.days).sort();
function aggregate(nDays) {
  const window = dayKeys.filter((d) => d > kst(nDays));
  const out = {};
  for (const src of SOURCES) {
    const acc = new Map();
    for (const d of window) {
      for (const it of history.days[d][src.id] ?? []) {
        if (it.r > LIST_MAX) continue;
        const k = keyOf(it.t);
        const a = acc.get(k) ?? { ...it, p: 0, days: 0, best: it.r };
        Object.assign(a, { t: it.t, u: it.u, m: it.m, img: it.img ?? a.img, news: it.news ?? a.news, c: it.c });
        a.p += pts(it.r);
        a.days += 1;
        a.best = Math.min(a.best, it.r);
        acc.set(k, a);
      }
    }
    const list = [...acc.values()].sort((a, b) => b.p - a.p || a.best - b.best).slice(0, LIST_MAX);
    const pmax = list[0]?.p ?? 1;
    if (list.length) out[src.id] = list.map((it, i) => ({ ...it, r: i + 1, pmax, m: it.days > 1 ? `${it.days}일 순위권 · 최고 ${it.best}위` : it.m }));
  }
  return { lists: out, days: window.length };
}

const strip = (lists) =>
  Object.fromEntries(Object.entries(lists).map(([id, list]) => [id, list.slice(0, LIST_MAX).map(({ t, u, r, m, c, img, d, f }) => ({ t, u, r, m, c, img, d, f }))]));
const periods = {};
for (const [key, n] of Object.entries(PERIODS)) {
  const { lists, days } = key === 'day' ? { lists: today, days: 1 } : aggregate(n);
  const topics = unify(lists);
  periods[key] = {
    days,
    unified: topics.slice(0, 60).map(({ rise, why, ...t }) => (key === 'day' ? { ...t, why } : { ...t, d: undefined })),
    bySource: strip(lists),
  };
  if (key === 'day') periods.rising = topics.filter((t) => t.rise > 0 && !(t.srcs.length === 1 && t.items.length === 1 && t.rise < 6)).sort((a, b) => b.rise - a.rise).slice(0, 30);
}
const { rising, ...periodOut } = periods;

// ── 연령대별 (네이버 쇼핑 검색어) ──────────────────────────────
async function collectAges() {
  const ranges = { day: [kst(1), kst(1)], week: [kst(7), kst(1)], month: [kst(30), kst(1)] };
  const out = {};
  for (const [period, [start, end]] of Object.entries(ranges)) {
    out[period] = Object.fromEntries(AGES.map((a) => [a, []]));
    for (const [cid, cat] of AGE_CATS) {
      const lists = {};
      for (const age of AGES) {
        await sleep(700); // 요청이 몰리면 429 가 난다
        lists[age] = await datalab({ cid, start, end, age });
      }
      // 다른 연령대 상위 10위에는 없는 검색어 = 그 연령대의 특징
      for (const age of AGES) {
        const others = new Set(AGES.filter((a) => a !== age).flatMap((a) => lists[a].slice(0, 10)));
        if (lists[age].length) out[period][age].push({ cat, kws: lists[age].slice(0, 10).map((k) => ({ k, uniq: !others.has(k) || undefined })) });
      }
    }
  }
  return out;
}
let ages = prevOut?.ages ?? null;
try {
  if (process.env.SKIP_AGES) throw new Error('SKIP_AGES 로 건너뜀');
  const got = await collectAges();
  if (Object.values(got.week).some((v) => v.length)) ages = got;
  status.datalab = 'ok';
  console.log('✓ 네이버 데이터랩(연령대별)');
} catch (e) {
  status.datalab = ages ? 'stale' : 'fail';
  console.warn(`✗ 네이버 데이터랩: ${e.message}`);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({
    updated: new Date().toISOString(),
    date: TODAY,
    historyDays: dayKeys.length,
    categories: CATEGORIES,
    sources: SOURCES.filter((s) => status[s.id] !== 'skip').map(({ id, name, group, kind, home }) => ({ id, name, group, kind, home, status: status[id] })),
    status,
    periods: periodOut,
    rising,
    ages,
  }),
);
const ok = Object.values(status).filter((s) => s === 'ok').length;
console.log(`완료: ${ok}/${Object.keys(status).length} 소스 성공, 통합 이슈 ${periodOut.day.unified.length}건, 급상승 ${rising.length}건`);
if (!Object.keys(fresh).length) process.exit(1);
