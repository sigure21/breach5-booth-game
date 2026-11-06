const phaseLabel = document.querySelector('#phase-label');
const phaseClock = document.querySelector('#phase-clock');
const clock = document.querySelector('#clock');
const laneBoard = document.querySelector('#lane-board');
const banner = document.querySelector('#event-banner');
const joinUrl = document.querySelector('#join-url');
const joinMode = document.querySelector('#join-mode');
const nextRoundText = document.querySelector('#next-round-text');
const beginnerCount = document.querySelector('#beginner-count');
const advancedCount = document.querySelector('#advanced-count');
const beginnerMeter = document.querySelector('#beginner-meter');
const advancedMeter = document.querySelector('#advanced-meter');

const PHASE_LABELS = {
  JOIN: '참가자 집결', BRIEF: '사건 브리핑', DISCOVER: '증거 분석', BUILD: '요청 조립',
  EXECUTE: '격리 실행', DUEL: '패치 선택', REVERIFY: '회귀 검증', RESULT: '결과 공개',
  COMPLETE: '종료', IDLE: '대기 없음',
};
const FLOW_LABELS = ['증거', '조립', '실행', '패치'];
const RESULT_LABELS = {
  BREACHED_THEN_CONTAINED: '침해 후 봉쇄', BREACHED: '침해 재현', BLOCKED: '공격 차단',
  STALEMATE: '판정 미완료', INCOMPLETE: '분석 미완료', ENGINE_ERROR: '엔진 점검',
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

function phaseStep(phase) {
  if (phase === 'DISCOVER' || phase === 'BRIEF' || phase === 'JOIN') return 0;
  if (phase === 'BUILD') return 1;
  if (phase === 'EXECUTE') return 2;
  if (phase === 'DUEL' || phase === 'REVERIFY' || phase === 'RESULT' || phase === 'COMPLETE') return 3;
  return -1;
}

function laneCounts(lane) {
  const difficulties = lane.difficultyCounts ?? lane.counts?.difficulties ?? lane.counts ?? {};
  const beginner = Number(difficulties.BEGINNER ?? lane.beginner ?? 0);
  const advanced = Number(difficulties.ADVANCED ?? lane.advanced ?? 0);
  const red = Number(lane.counts?.RED ?? lane.red ?? 0);
  const blue = Number(lane.counts?.BLUE ?? lane.blue ?? 0);
  const reportedTotal = lane.total ?? lane.counts?.total;
  const total = Number(reportedTotal ?? ((beginner + advanced) || (red + blue)));
  return { beginner, advanced, red, blue, total };
}

function normalizeLanes(state) {
  if (Array.isArray(state.lanes)) return state.lanes;
  if (state.scenario && state.round) {
    return [{
      scenario: state.scenario,
      round: state.round,
      counts: state.round.counts,
      progress: state.progress,
      result: state.result,
      execution: state.execution,
    }];
  }
  return [];
}

function laneCard(lane, index) {
  const scenario = lane.scenario ?? lane;
  const round = lane.round ?? {};
  const phase = round.phase ?? lane.phase ?? 'JOIN';
  const counts = laneCounts(lane);
  const card = element('article', `lane-card ${!['COMPLETE', 'RESULT', 'IDLE'].includes(phase) ? 'active' : ''}`);
  const head = element('div', 'lane-head');
  const title = element('div');
  title.append(element('span', '', scenario.shortLabel ?? `INCIDENT ${index + 1}`), element('h2', '', scenario.title ?? scenario.id ?? '사건 lane'));
  head.append(title, element('div', 'lane-phase', PHASE_LABELS[phase] ?? phase));
  card.append(head, element('p', 'lane-brief', scenario.briefing ?? scenario.subtitle ?? '격리된 교육용 시나리오'));

  const difficulty = element('div', 'difficulty-counts');
  difficulty.append(element('span', '', `초급 ${counts.beginner}`), element('span', '', `고급 ${counts.advanced}`));
  if (counts.beginner + counts.advanced === 0 && counts.red + counts.blue > 0) {
    difficulty.replaceChildren(element('span', '', `RED ${counts.red}`), element('span', '', `BLUE ${counts.blue}`));
  }
  card.append(difficulty);

  const flow = element('div', 'lane-flow');
  const active = phaseStep(phase);
  FLOW_LABELS.forEach((label, step) => {
    flow.append(element('div', `lane-step ${step < active ? 'done' : step === active ? 'active' : ''}`, label));
  });
  card.append(flow);

  const foot = element('div', 'lane-foot');
  const result = lane.result;
  const resultText = result
    ? `${RESULT_LABELS[result.outcome] ?? result.outcome} · RED ${result.redScore ?? 0}/${result.redPossible ?? '?'} · BLUE ${result.blueScore ?? 0}/${result.bluePossible ?? '?'}`
    : `${counts.total}명 · ${round.mode ?? lane.mode ?? '배정 대기'}`;
  foot.append(element('span', result ? 'lane-result' : '', resultText), element('strong', '', formatTime(round.phaseRemainingMs ?? lane.phaseRemainingMs)));
  card.append(foot);
  return card;
}

function updateMeters(beginner, advanced) {
  const total = Math.max(1, beginner + advanced);
  beginnerCount.textContent = String(beginner);
  advancedCount.textContent = String(advanced);
  const update = (node, ratio) => {
    for (let index = 0; index <= 10; index += 1) node.classList.remove(`meter-${index}`);
    node.classList.add(`meter-${Math.round(ratio * 10)}`);
  };
  update(beginnerMeter, beginner / total);
  update(advancedMeter, advanced / total);
}

function renderLanes(lanes) {
  laneBoard.replaceChildren();
  if (lanes.length === 0) {
    laneBoard.append(element('div', 'lane-empty', '현재 활성 사건 lane이 없습니다.'));
    return;
  }
  lanes.forEach((lane, index) => laneBoard.append(laneCard(lane, index)));
}

function totalWaiting(state) {
  if (Number.isFinite(state.nextRound?.total)) return state.nextRound.total;
  if (Array.isArray(state.nextRound?.lanes)) return state.nextRound.lanes.reduce((sum, lane) => sum + Number(lane.total ?? 0), 0);
  return 0;
}

async function refresh() {
  try {
    const response = await fetch('/api/screen-state', { cache: 'no-store' });
    if (!response.ok) throw new Error('screen state failed');
    const state = await response.json();
    const lanes = normalizeLanes(state);
    renderLanes(lanes);

    const allCounts = lanes.reduce((sum, lane) => {
      const counts = laneCounts(lane);
      sum.beginner += counts.beginner;
      sum.advanced += counts.advanced;
      return sum;
    }, { beginner: 0, advanced: 0 });
    updateMeters(allCounts.beginner, allCounts.advanced);

    const remaining = Number(state.round?.remainingMs)
      || Math.max(0, ...lanes.map((lane) => Number(lane.round?.remainingMs ?? lane.remainingMs ?? 0)));
    const activeCount = lanes.filter((lane) => !['RESULT', 'COMPLETE', 'IDLE'].includes(lane.round?.phase ?? lane.phase)).length;
    phaseLabel.textContent = `${lanes.length}개 사건 lane · ${activeCount}개 진행 중`;
    phaseClock.textContent = '최대 03:00 · 필수 응답 완료 시 조기 진행';
    clock.textContent = formatTime(remaining);

    const results = lanes.filter((lane) => lane.result).length;
    banner.textContent = results > 0
      ? `${results}개 lane의 기술 판정이 공개되었습니다. 휴대폰에서 회귀 행렬을 확인하세요.`
      : 'Raw HTTP, 로그, 코드 diff를 근거로 선택하세요. 전광판에는 비밀값을 표시하지 않습니다.';
    document.querySelector('#red-wins').textContent = String(state.stats?.redWins ?? 0);
    document.querySelector('#contained').textContent = String(state.stats?.contained ?? 0);
    document.querySelector('#blue-wins').textContent = String(state.stats?.blueWins ?? 0);

    const waiting = totalWaiting(state);
    joinMode.textContent = state.joinMode === 'CURRENT'
      ? '지금 입장하면 선택한 사건의 현재 판 참가'
      : state.joinMode === 'NEXT'
        ? `중간 난입 없이 다음 판 예약 · ${waiting}명`
        : '다음 판 마감 · 결과 관전 가능';
    const startsIn = state.nextRound?.startsInMs ?? remaining;
    nextRoundText.textContent = `${waiting}명 대기 · 최대 ${formatTime(startsIn)} 후 시작`;
    joinUrl.textContent = state.joinUrl ?? '';
    document.body.classList.toggle('breached', lanes.some((lane) => lane.execution?.proofReached === true || lane.result?.baseline?.proofReached === true));
  } catch {
    phaseLabel.textContent = '연결 복구 중';
    phaseClock.textContent = '상태를 다시 요청하고 있습니다.';
    banner.textContent = '게임 서버 연결을 다시 시도하고 있습니다.';
  }
}

refresh();
setInterval(refresh, 750);
