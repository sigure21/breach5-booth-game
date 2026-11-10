const phaseLabel = document.querySelector('#phase-label');
const phaseClock = document.querySelector('#phase-clock');
const clock = document.querySelector('#clock');
const laneBoard = document.querySelector('#lane-board');
const banner = document.querySelector('#event-banner');
const joinUrl = document.querySelector('#join-url');
const joinMode = document.querySelector('#join-mode');
const nextGrid = document.querySelector('#next-grid');
const activeCount = document.querySelector('#active-count');
const finishCount = document.querySelector('#finish-count');
const poleCount = document.querySelector('#pole-count');
let crewNames = new Map();

const PHASE_LABELS = {
  JOIN: 'GARAGE', LAUNCH: 'LAUNCH', SECTOR_1: 'SECTOR 1', PIT_STOP: 'PIT STOP',
  SECTOR_2: 'SECTOR 2', SPRINT: 'FINAL SPRINT', RESULT: 'CHEQUERED FLAG',
  COMPLETE: 'RACE COMPLETE', IDLE: 'GRID IDLE',
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil((Number(milliseconds) || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function laneCounts(lane) {
  const counts = lane.difficultyCounts ?? lane.counts?.difficulties ?? {};
  const beginner = Number(counts.BEGINNER ?? 0);
  const advanced = Number(counts.ADVANCED ?? 0);
  const total = Number(lane.total ?? lane.round?.counts?.total ?? beginner + advanced);
  return { beginner, advanced, total };
}

function leaderboardRows(lane) {
  const rows = Array.isArray(lane.leaderboard) ? lane.leaderboard : [];
  return rows.slice(0, 5).map((entry, index) => ({
    rank: entry.rank ?? index + 1,
    callsign: entry.callsign ?? entry.player ?? entry.name ?? 'ANONYMOUS',
    crew: entry.crewName ?? crewNames.get(entry.crewId) ?? entry.crew ?? entry.crewId ?? '',
    correct: Number(entry.correct ?? entry.score ?? 0),
    possible: Number(entry.possible ?? 7),
  }));
}

function laneCard(lane, index) {
  const track = lane.track ?? lane;
  const round = lane.round ?? {};
  const phase = round.phase ?? lane.phase ?? 'IDLE';
  const counts = laneCounts(lane);
  const card = element('article', `lane-card ${!['IDLE', 'COMPLETE'].includes(phase) ? 'active' : ''}`);
  const head = element('div', 'lane-head');
  const title = element('div', 'lane-title');
  title.append(element('span', '', track.shortLabel ?? `CIRCUIT ${index + 1}`), element('h2', '', track.name ?? track.title ?? track.id ?? 'SECURITY CIRCUIT'));
  head.append(title, element('div', 'lane-phase', PHASE_LABELS[phase] ?? phase));
  card.append(head);

  const meta = element('div', 'lane-meta');
  meta.append(element('span', '', `GUIDED ${counts.beginner}`), element('span', '', `ANALYST ${counts.advanced}`), element('span', '', `TOTAL ${counts.total}`));
  card.append(meta);

  const leaders = element('div', 'leaderboard');
  const rows = leaderboardRows(lane);
  if (rows.length === 0) {
    const empty = element('div', 'leader-row');
    empty.append(element('span', '', '—'), element('b', '', phase === 'IDLE' ? '다음 드라이버 대기 중' : '출발 준비 중'), element('strong', '', '0/7'));
    leaders.append(empty);
  } else {
    for (const row of rows) {
      const item = element('div', 'leader-row');
      item.append(element('span', '', String(row.rank).padStart(2, '0')), element('b', '', `${row.callsign}${row.crew ? ` · ${row.crew}` : ''}`), element('strong', '', `${row.correct}/${row.possible}`));
      leaders.append(item);
    }
  }
  card.append(leaders);
  const foot = element('div', 'lane-foot');
  const summary = lane.result?.finishBand ? `RESULT · ${lane.result.finishBand.replaceAll('_', ' ')}` : track.subtitle ?? '보안 기초 인카운터';
  foot.append(element('span', '', summary), element('b', '', formatTime(round.remainingMs ?? round.phaseRemainingMs ?? 0)));
  card.append(foot);
  return card;
}

function renderLanes(lanes) {
  laneBoard.replaceChildren();
  if (!Array.isArray(lanes) || lanes.length === 0) {
    laneBoard.append(element('div', 'lane-card', '활성 서킷이 없습니다. 서버 연결을 확인하고 있습니다.'));
    return;
  }
  lanes.forEach((lane, index) => laneBoard.append(laneCard(lane, index)));
}

function maximumRemaining(lanes) {
  return Math.max(0, ...lanes.map((lane) => Number(lane.round?.remainingMs ?? lane.round?.phaseRemainingMs ?? lane.remainingMs ?? 0)));
}

function totalDrivers(lanes) {
  return lanes.reduce((sum, lane) => sum + laneCounts(lane).total, 0);
}

async function refresh() {
  try {
    const response = await fetch('/api/screen-state', { cache: 'no-store' });
    if (!response.ok) throw new Error('screen state failed');
    const state = await response.json();
    crewNames = new Map((state.catalogs?.crews ?? []).map((crew) => [crew.id, crew.name]));
    const lanes = Array.isArray(state.lanes) ? state.lanes : [];
    renderLanes(lanes);

    const active = totalDrivers(lanes);
    const remaining = Number(state.round?.remainingMs) || maximumRemaining(lanes);
    const activeLanes = lanes.filter((lane) => !['IDLE', 'COMPLETE'].includes(lane.round?.phase ?? lane.phase)).length;
    phaseLabel.textContent = `${lanes.length}개 서킷 · ${activeLanes}개 레이스 운영 중`;
    phaseClock.textContent = '최대 05:00 · 정확도가 성능을 결정합니다';
    clock.textContent = formatTime(remaining || 300_000);

    activeCount.textContent = String(state.stats?.activePlayers ?? state.stats?.active ?? active);
    finishCount.textContent = String(state.stats?.finishes ?? state.stats?.rounds ?? 0);
    poleCount.textContent = String(state.stats?.perfectLaps ?? state.stats?.polePositions ?? state.stats?.poles ?? 0);
    joinUrl.textContent = state.joinUrl ?? '';

    const waiting = Number(state.nextRound?.total ?? state.waiting ?? 0);
    if (state.joinMode === 'CURRENT') joinMode.textContent = '지금 스캔하면 현재 그리드 출발 준비';
    else if (state.joinMode === 'NEXT') joinMode.textContent = `중간 난입 없이 다음 그리드 예약 · ${waiting}명`;
    else joinMode.textContent = '현재 그리드 마감 · 다음 출발 대기';
    nextGrid.textContent = waiting > 0 ? `NEXT GRID · ${waiting}명 대기` : 'SCAN · CHOOSE · RACE';

    const leaders = lanes.flatMap(leaderboardRows);
    const top = leaders.sort((a, b) => b.correct - a.correct || a.rank - b.rank)[0];
    banner.textContent = top
      ? `현재 선두 ${top.callsign} · ${top.correct}/${top.possible} 정답. 선택 속도보다 증거 기반 정확도가 우선입니다.`
      : 'QR을 스캔하고 팀·드라이버·난이도를 골라 7개의 보안 인카운터에 도전하세요.';
  } catch {
    phaseLabel.textContent = 'Race Control 재연결 중';
    phaseClock.textContent = '상태를 다시 요청하고 있습니다.';
    banner.textContent = '게임 서버와의 연결을 복구하고 있습니다.';
  }
}

refresh();
setInterval(refresh, 750);
