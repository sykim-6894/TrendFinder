// 트렌드 소스 수집기. 각 소스는 [{ t: 제목, u: 링크, r: 순위, m: 수치 문구, c: 카테고리, img, f: 'new'|'up', news }] 를 돌려준다.
// API 키 없이 공개 페이지만 사용한다. (YT_API_KEY 가 있으면 유튜브 인기 급상승 영상을 추가로 수집)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getText(url, { enc = 'utf-8', headers = {}, method, body, tries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: AbortSignal.timeout(25000),
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', ...headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new TextDecoder(enc).decode(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await sleep(1200 * (i + 1));
    }
  }
  throw lastErr;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) =>
  String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, k) => ENT[k]);
export const text = (html) => decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0;
export const compact = (n) =>
  n >= 1e8 ? `${+(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${+(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}만` : n.toLocaleString('ko-KR');
const rank = (list) => list.map((it, i) => ({ ...it, r: i + 1 }));
const q = encodeURIComponent;

// ── 포털·검색 ────────────────────────────────────────────────
async function google() {
  const xml = await getText('https://trends.google.com/trending/rss?geo=KR');
  const tag = (s, name) => decode(s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '').trim();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, s], i) => {
    const t = tag(s, 'title');
    const raw = tag(s, 'ht:approx_traffic');
    const traffic = num(raw) * (/[mM]/.test(raw) ? 1e6 : /[kK]/.test(raw) ? 1e3 : 1);
    const news = [...s.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].slice(0, 3).map(([, n]) => ({
      t: tag(n, 'ht:news_item_title'),
      u: tag(n, 'ht:news_item_url'),
      s: tag(n, 'ht:news_item_source'),
    }));
    return {
      t,
      u: `https://www.google.com/search?q=${q(t)}`,
      m: traffic ? `검색 ${compact(traffic)}+` : '',
      img: tag(s, 'ht:picture') || undefined,
      news,
      traffic,
      i,
    };
  });
  items.sort((a, b) => b.traffic - a.traffic || a.i - b.i);
  return rank(items.map(({ i, ...it }) => it));
}

async function nate() {
  const j = JSON.parse(await getText('https://www.nate.com/js/data/jsonLiveKeywordDataV1.js', { enc: 'euc-kr' }));
  return j.map(([r, keyword, state]) => ({
    t: keyword,
    u: `https://search.daum.net/nate?q=${q(keyword)}`,
    r: Number(r),
    f: state === 'n' ? 'new' : state === '+' ? 'up' : undefined,
  }));
}

// ── 뉴스 ────────────────────────────────────────────────────
async function navernews() {
  const html = await getText('https://news.naver.com/main/ranking/popularDay.naver', { enc: 'euc-kr' });
  const out = [];
  for (const box of html.split('class="rankingnews_box"').slice(1)) {
    const press = text(box.match(/rankingnews_name">([\s\S]*?)<\/strong>/)?.[1]);
    for (const li of box.split('<li>').slice(1, 6)) {
      const r = num(li.match(/list_ranking_num">(\d+)/)?.[1]);
      const a = li.match(/<a href="([^"]+)" class="list_title[^>]*>([\s\S]*?)<\/a>/);
      if (!a || !r) continue;
      out.push({ t: text(a[2]), u: decode(a[1]), m: press, pr: r, img: decode(li.match(/<img src="([^"]+)"/)?.[1] ?? '') || undefined });
    }
  }
  // 언론사를 넘나드는 순위가 없어, 각 언론사의 1위 → 2위 … 순으로 섞는다
  out.sort((a, b) => a.pr - b.pr);
  return rank(out.slice(0, 60).map(({ pr, ...it }) => it));
}

// ── SNS·영상 ─────────────────────────────────────────────────
async function x() {
  const html = await getText('https://trends24.in/korea/');
  const cards = [...html.matchAll(/<ol class=["']?trend-card__list["']?>([\s\S]*?)<\/ol>/g)].slice(0, 24).map(([, ol]) =>
    [...ol.matchAll(/<a href="[^"]*"[^>]*class=["']?trend-link["']?>([\s\S]*?)<\/a>(?:<span class=["']?tweet-count["']? data-count=["']?(\d*)["']?)?/g)].map(
      (m) => ({ t: text(m[1]), n: num(m[2]) }),
    ),
  );
  if (!cards.length || !cards[0].length) throw new Error('목록을 찾지 못함');
  const hours = new Map();
  for (const c of cards) for (const it of new Set(c.map((v) => v.t))) hours.set(it, (hours.get(it) ?? 0) + 1);
  return rank(
    cards[0].slice(0, 30).map((it) => ({
      t: it.t,
      u: `https://x.com/search?q=${q(it.t)}`,
      m: it.n ? `게시물 ${compact(it.n)}` : hours.get(it.t) > 1 ? `${hours.get(it.t)}시간째 트렌드` : '',
    })),
  );
}

async function ytmusic() {
  const body = JSON.stringify({
    context: { client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: '2.0', hl: 'ko', gl: 'KR' } },
    browseId: 'FEmusic_analytics_charts_home',
    query: 'perspective=CHART_DETAILS&chart_params_country_code=kr&chart_params_chart_type=TRENDING_VIDEOS&chart_params_period_type=DAILY',
  });
  const j = JSON.parse(
    await getText('https://charts.youtube.com/youtubei/v1/browse?alt=json', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', Origin: 'https://charts.youtube.com', Referer: 'https://charts.youtube.com/' },
    }),
  );
  let list;
  (function find(o) {
    if (list || !o || typeof o !== 'object') return;
    if (Array.isArray(o.videoViews)) return void (list = o.videoViews);
    for (const k in o) find(o[k]);
  })(j);
  if (!list?.length) throw new Error('차트를 찾지 못함');
  return list.slice(0, 30).map((v, i) => ({
    t: `${(v.artists ?? []).map((a) => a.name).join(', ') || v.channelName || ''} - ${v.title}`.replace(/^ - /, ''),
    u: `https://www.youtube.com/watch?v=${v.id}`,
    r: v.chartEntryMetadata?.currentPosition ?? i + 1,
    img: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    c: '연예·방송',
  }));
}

const YT_CATS = { 1: '연예·방송', 2: '생활·쇼핑', 10: '연예·방송', 17: '스포츠', 20: '게임', 23: '유머·커뮤니티', 24: '연예·방송', 25: '사회', 26: '생활·쇼핑', 28: 'IT·과학' };
async function youtube() {
  const key = process.env.YT_API_KEY;
  if (!key) return null; // 키가 없으면 건너뜀
  const j = JSON.parse(
    await getText(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=KR&hl=ko&maxResults=40&key=${key}`,
    ),
  );
  return j.items.map((v, i) => ({
    t: v.snippet.title,
    u: `https://www.youtube.com/watch?v=${v.id}`,
    r: i + 1,
    m: `${v.snippet.channelTitle} · 조회 ${compact(Number(v.statistics?.viewCount ?? 0))}`,
    img: v.snippet.thumbnails?.medium?.url,
    c: YT_CATS[v.snippet.categoryId],
  }));
}

// ── 커뮤니티 ─────────────────────────────────────────────────
const byViews = (list, n = 30) => rank(list.sort((a, b) => b.v - a.v).slice(0, n).map(({ v, ...it }) => it));

async function theqoo() {
  const html = await getText('https://theqoo.net/hot');
  const out = [];
  for (const tr of html.split(/<tr>\s*<td class="no">/).slice(1)) {
    const a = tr.match(/<td class="title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!a) continue;
    const v = num(tr.match(/class="m_no">([\d,]+)/)?.[1]);
    out.push({ t: text(a[2]), u: `https://theqoo.net${a[1]}`, m: `조회 ${compact(v)}`, v, nc: text(tr.match(/class="cate">([\s\S]*?)<\/td>/)?.[1]) });
  }
  return byViews(out);
}

async function dcbest() {
  const html = await getText('https://gall.dcinside.com/board/lists/?id=dcbest');
  const out = [];
  for (const tr of html.split('class="ub-content us-post').slice(1)) {
    if (/data-type="icon_notice"/.test(tr.slice(0, 200))) continue;
    const a = tr.match(/<a\s+href="(\/board\/view\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const v = num(tr.match(/class="gall_count">([\d,]+)/)?.[1]);
    const rec = num(tr.match(/class="gall_recommend">([\d,]+)/)?.[1]);
    const title = text(a[2].replace(/<div class="thumimg">[\s\S]*?<\/div>/, '')).replace(/^\[[^\]]+\]\s*/, '');
    out.push({ t: title, u: `https://gall.dcinside.com${decode(a[1])}`, m: `조회 ${compact(v)} · 추천 ${compact(rec)}`, v });
  }
  return byViews(out);
}

async function fmkorea() {
  const html = await getText('https://www.fmkorea.com/best');
  const out = [];
  for (const li of html.split(/class="li\s+li_best2_pop/).slice(1)) {
    const a = li.match(/<h3 class="title"[^>]*>\s*<a href="([^"]+)"[^>]*>\s*<span class="ellipsis-target">([\s\S]*?)<\/span>/);
    if (!a) continue;
    const v = num(li.match(/class="count">([\d,]+)/)?.[1]);
    const srl = decode(a[1]).match(/document_srl=(\d+)/)?.[1];
    out.push({
      t: text(a[2]),
      u: srl ? `https://www.fmkorea.com/${srl}` : `https://www.fmkorea.com${decode(a[1])}`,
      m: `추천 ${compact(v)}`,
      v,
      nc: text(li.match(/class="category">([\s\S]*?)<\/span>/)?.[1]).replace(/\s*\/\s*$/, ''),
    });
  }
  return byViews(out);
}

async function ruliweb() {
  const html = await getText('https://bbs.ruliweb.com/best/humor_only');
  const out = [];
  const seen = new Set();
  for (const tr of html.split('class="table_body').slice(1)) {
    const a = tr.match(/class="subject_link[^"]*" href="([^"]+)"[\s\S]*?<(?:strong|span) class="text_over">([\s\S]*?)<\/(?:strong|span)>/);
    if (!a || seen.has(a[1])) continue;
    seen.add(a[1]);
    const v = num(tr.match(/class="hit">\s*([\d,]+)/)?.[1]);
    const rec = num(tr.match(/class="recomd">\s*([\d,]+)/)?.[1]);
    out.push({ t: text(a[2]), u: `https://bbs.ruliweb.com${decode(a[1])}`, m: `조회 ${compact(v)} · 추천 ${compact(rec)}`, v });
  }
  return byViews(out);
}

async function instiz() {
  const html = await getText('https://www.instiz.net/pt?srt=3');
  const out = [];
  for (const tr of html.split('<tr id="detour"').slice(1)) {
    const a = tr.match(/listsubject"><a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!a) continue;
    const cells = [...tr.matchAll(/<td class="listno"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    const v = num(cells[1]);
    out.push({
      t: text(a[2].replace(/<span class="cmt\d*"[\s\S]*?<\/span>/g, '')),
      u: decode(a[1]).split('?')[0],
      m: `조회 ${compact(v)}`,
      v,
      nc: text(tr.match(/class="list_category">([\s\S]*?)<\/span>/)?.[1]),
    });
  }
  return byViews(out);
}

async function pann() {
  const html = await getText('https://pann.nate.com/talk/ranking');
  const out = [];
  for (const li of html.split('<div class="rankNum">').slice(1)) {
    const a = li.match(/<h2><a href="([^"]+)"[^>]*title="([^"]*)"/);
    if (!a) continue;
    const v = num(li.match(/class="count">조회\s*([\d,]+)/)?.[1]);
    const rec = num(li.match(/class="rcm">추천\s*([\d,]+)/)?.[1]);
    out.push({ t: decode(a[2]).trim(), u: `https://pann.nate.com${a[1]}`, m: `조회 ${compact(v)} · 추천 ${compact(rec)}` });
  }
  return rank(out.slice(0, 30));
}

// kind: 'kw' = 검색어·키워드형(통합 이슈의 뼈대), 'post' = 글·영상·기사 제목형
export const SOURCES = [
  { id: 'google', name: '구글 트렌드', group: '포털·검색', kind: 'kw', w: 1.2, home: 'https://trends.google.com/trending?geo=KR', run: google },
  { id: 'nate', name: '네이트 실시간 이슈', group: '포털·검색', kind: 'kw', w: 1.0, home: 'https://www.nate.com/', run: nate },
  { id: 'navernews', name: '네이버 많이 본 뉴스', group: '뉴스', kind: 'post', w: 0.6, home: 'https://news.naver.com/main/ranking/popularDay.naver', run: navernews },
  { id: 'x', name: 'X(트위터) 트렌드', group: 'SNS·영상', kind: 'kw', w: 0.9, home: 'https://x.com/explore/tabs/trending', run: x },
  { id: 'youtube', name: '유튜브 인기 급상승', group: 'SNS·영상', kind: 'post', w: 0.7, home: 'https://www.youtube.com/', run: youtube },
  { id: 'ytmusic', name: '유튜브 인기 뮤직비디오', group: 'SNS·영상', kind: 'post', w: 0.4, home: 'https://charts.youtube.com/charts/TrendingVideos/kr/RightNow', run: ytmusic },
  { id: 'theqoo', name: '더쿠 HOT', group: '커뮤니티', kind: 'post', w: 0.5, home: 'https://theqoo.net/hot', run: theqoo },
  { id: 'dcbest', name: '디시 실시간 베스트', group: '커뮤니티', kind: 'post', w: 0.5, home: 'https://gall.dcinside.com/board/lists/?id=dcbest', run: dcbest },
  { id: 'fmkorea', name: '에펨코리아 포텐', group: '커뮤니티', kind: 'post', w: 0.5, home: 'https://www.fmkorea.com/best', run: fmkorea },
  { id: 'ruliweb', name: '루리웹 베스트', group: '커뮤니티', kind: 'post', w: 0.5, home: 'https://bbs.ruliweb.com/best/humor_only', run: ruliweb },
  { id: 'instiz', name: '인스티즈 인기글', group: '커뮤니티', kind: 'post', w: 0.5, home: 'https://www.instiz.net/pt', run: instiz },
  { id: 'pann', name: '네이트판 톡커들의 선택', group: '커뮤니티', kind: 'post', w: 0.5, home: 'https://pann.nate.com/talk/ranking', run: pann },
];

// ── 연령대별: 네이버 데이터랩 쇼핑인사이트 인기 검색어 ─────────────
export const AGES = ['10', '20', '30', '40', '50', '60'];
export const AGE_CATS = [
  ['50000000', '패션의류'],
  ['50000002', '화장품·미용'],
  ['50000003', '디지털·가전'],
  ['50000006', '식품'],
  ['50000007', '스포츠·레저'],
  ['50000008', '생활·건강'],
];
export async function datalab({ cid, start, end, age }) {
  const body = `cid=${cid}&timeUnit=date&startDate=${start}&endDate=${end}&age=${age}&gender=&device=&page=1&count=20`;
  const j = JSON.parse(
    await getText('https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver', {
      method: 'POST',
      body,
      tries: 2,
      headers: {
        Referer: 'https://datalab.naver.com/shoppingInsight/sCategory.naver',
        Origin: 'https://datalab.naver.com',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }),
  );
  return (j.ranks ?? []).map((k) => k.keyword);
}
