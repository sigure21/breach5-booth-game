import { HEAT_SIZE, PRODUCTION_TIMING, TOTAL_ENCOUNTERS, TOTAL_LAPS } from '../clock.mjs';

export const DIFFICULTIES = Object.freeze(['BEGINNER', 'ADVANCED']);

export const CIRCUITS = Object.freeze([
  Object.freeze({
    id: 'temple-speed-ring',
    name: 'Temple Speed Ring',
    shortLabel: 'TEMPLE · HIGH SPEED',
    location: 'Italy-inspired high-speed circuit',
    inspiredBy: 'Autodromo Nazionale Monza',
    character: '긴 직선과 강한 제동이 반복되는 초고속 구성',
    officialLengthKm: 5.793,
    officialRaceLaps: 53,
    speedRangeKph: Object.freeze({ min: 85, max: 345 }),
    disclaimer: '서킷 길이와 레이스 랩 수는 영감이 된 실제 서킷의 공개 참고값입니다. 속도와 주행 상태는 교육용 게임 모델이며 실제 FIA/F1 텔레메트리가 아닙니다.',
    lengthKm: 5.793,
    laps: TOTAL_LAPS,
    maxSpeedKph: 345,
    minSpeedKph: 85,
    accent: '#e33b42',
    path: 'M170 112 C330 56 650 58 826 118 C920 150 914 238 822 258 L690 286 C620 302 604 344 690 374 L842 430 C918 458 906 534 810 548 C626 574 330 566 176 520 C84 492 72 408 154 370 L286 318 C346 294 344 250 270 226 L150 188 C66 160 76 132 170 112 Z',
    speedZones: Object.freeze([330, 345, 205, 98, 285, 316, 132, 262, 340, 184, 85, 300]),
  }),
  Object.freeze({
    id: 'harbour-street-loop',
    name: 'Harbour Street Loop',
    shortLabel: 'HARBOUR · STREET',
    location: 'Monaco-inspired harbour circuit',
    inspiredBy: 'Circuit de Monaco',
    character: '저속 헤어핀과 벽 가까운 연속 코너 중심의 도심 구성',
    officialLengthKm: 3.337,
    officialRaceLaps: 78,
    speedRangeKph: Object.freeze({ min: 60, max: 285 }),
    disclaimer: '서킷 길이와 레이스 랩 수는 영감이 된 실제 서킷의 공개 참고값입니다. 속도와 주행 상태는 교육용 게임 모델이며 실제 FIA/F1 텔레메트리가 아닙니다. 추월 기회가 제한된 특성을 단순화해 반영했습니다.',
    lengthKm: 3.337,
    laps: TOTAL_LAPS,
    maxSpeedKph: 285,
    minSpeedKph: 60,
    accent: '#55d8ff',
    path: 'M128 156 C178 74 312 70 354 142 C386 198 330 242 268 222 C210 204 188 252 242 286 L424 392 C474 420 526 394 500 344 L444 240 C416 188 464 128 532 142 L782 192 C890 214 930 306 866 374 C810 434 716 410 704 342 C696 296 650 282 620 320 L522 454 C466 532 322 558 212 510 C110 466 78 364 126 298 C164 246 164 202 128 156 Z',
    speedZones: Object.freeze([214, 285, 124, 72, 60, 138, 232, 280, 164, 94, 188, 252]),
  }),
  Object.freeze({
    id: 'airfield-flow-circuit',
    name: 'Airfield Flow Circuit',
    shortLabel: 'AIRFIELD · FLOW',
    location: 'United Kingdom-inspired airfield circuit',
    inspiredBy: 'Silverstone Circuit',
    character: '고속 방향 전환과 긴 코너 조합으로 리듬을 요구하는 구성',
    officialLengthKm: 5.891,
    officialRaceLaps: 52,
    speedRangeKph: Object.freeze({ min: 90, max: 325 }),
    disclaimer: '서킷 길이와 레이스 랩 수는 영감이 된 실제 서킷의 공개 참고값입니다. 속도와 주행 상태는 교육용 게임 모델이며 실제 FIA/F1 텔레메트리가 아닙니다.',
    lengthKm: 5.891,
    laps: TOTAL_LAPS,
    maxSpeedKph: 325,
    minSpeedKph: 90,
    accent: '#8df0c9',
    path: 'M136 214 C166 104 294 64 390 116 L486 168 C548 202 610 174 654 112 C706 42 836 82 842 178 C846 244 790 280 722 264 L620 238 C574 226 548 262 578 302 L704 470 C746 526 684 574 612 532 L478 454 C420 420 372 442 350 504 C324 574 198 572 146 498 C98 430 126 364 198 338 L294 302 C342 284 344 242 294 226 L204 198 C164 186 146 192 136 214 Z',
    speedZones: Object.freeze([286, 325, 242, 154, 302, 325, 214, 126, 276, 318, 188, 96]),
  }),
]);

export const CREWS = Object.freeze([
  Object.freeze({
    id: 'red-bull-racing', name: 'RED BULL RACING', color: '#3155ff', accent: '#ff334f',
    trait: '공격적인 레이스 운영', model: 'RB22', asset: '/assets/cars/red-bull-racing.svg',
    photoAsset: '/assets/team-cars/red-bull-rb22-2026.webp',
  }),
  Object.freeze({
    id: 'ferrari', name: 'FERRARI', color: '#ef1a2d', accent: '#ffd54a',
    trait: '정교한 피트 전략', model: 'SF-26', asset: '/assets/cars/ferrari.svg',
    photoAsset: '/assets/team-cars/ferrari-sf26-2026.webp',
  }),
  Object.freeze({
    id: 'mercedes', name: 'MERCEDES', color: '#00d2be', accent: '#d8f5f2',
    trait: '데이터 기반 판단', model: 'W17', asset: '/assets/cars/mercedes.svg',
    photoAsset: '/assets/team-cars/mercedes-w17-2026.webp',
  }),
  Object.freeze({
    id: 'mclaren', name: 'MCLAREN', color: '#ff8700', accent: '#57d5ff',
    trait: '민첩한 구간 대응', model: 'MCL40', asset: '/assets/cars/mclaren.svg',
    photoAsset: '/assets/team-cars/mclaren-mcl40-2026.webp',
  }),
]);

export const DRIVERS = Object.freeze([
  Object.freeze({
    id: 'max-verstappen', name: 'Max Verstappen', crewId: 'red-bull-racing', number: 3, country: 'NED',
    role: 'Red Bull Racing · #3', media: '/assets/driver-panels/max-verstappen.webp',
    sourceUrl: 'https://giphy.com/gifs/redbullracing-f1-red-bull-racing-Irb20yXtA2QStkUnrE',
  }),
  Object.freeze({
    id: 'isack-hadjar', name: 'Isack Hadjar', crewId: 'red-bull-racing', number: 6, country: 'FRA',
    role: 'Red Bull Racing · #6', media: '/assets/driver-panels/isack-hadjar.webp',
    sourceUrl: 'https://giphy.com/gifs/f1-formula-1-formel-MI89BswFFetH9CbUwH',
  }),
  Object.freeze({
    id: 'charles-leclerc', name: 'Charles Leclerc', crewId: 'ferrari', number: 16, country: 'MON',
    role: 'Ferrari · #16', media: '/assets/driver-panels/charles-leclerc.webp',
    sourceUrl: 'https://giphy.com/gifs/f1-ferrari-leclerc-charles-M9BLGQ8f2MvWVQZtTR',
  }),
  Object.freeze({
    id: 'lewis-hamilton', name: 'Lewis Hamilton', crewId: 'ferrari', number: 44, country: 'GBR',
    role: 'Ferrari · #44', media: '/assets/driver-panels/lewis-hamilton.webp',
    sourceUrl: 'https://giphy.com/gifs/f1-ferrari-meme-CSoa7JDs8We3wrZcxZ',
  }),
  Object.freeze({
    id: 'george-russell', name: 'George Russell', crewId: 'mercedes', number: 63, country: 'GBR',
    role: 'Mercedes · #63', media: '/assets/driver-panels/george-russell.webp',
    sourceUrl: 'https://giphy.com/gifs/f1-formula-1-formel-BvcNdKvRPwzv09HJVI',
  }),
  Object.freeze({
    id: 'kimi-antonelli', name: 'Kimi Antonelli', crewId: 'mercedes', number: 12, country: 'ITA',
    role: 'Mercedes · #12', media: '/assets/driver-panels/kimi-antonelli.webp',
    sourceUrl: 'https://giphy.com/gifs/f1-formula1-kimiantonellimercedes-kTCZt1IIMXYmHVoNFj',
  }),
  Object.freeze({
    id: 'lando-norris', name: 'Lando Norris', crewId: 'mclaren', number: 1, country: 'GBR',
    role: 'McLaren · #1', media: '/assets/driver-panels/lando-norris.webp',
    sourceUrl: 'https://giphy.com/gifs/f1-formula-1-aishi-YDUaNBTTy1GdNSZZRe',
  }),
  Object.freeze({
    id: 'oscar-piastri', name: 'Oscar Piastri', crewId: 'mclaren', number: 81, country: 'AUS',
    role: 'McLaren · #81', media: '/assets/driver-panels/oscar-piastri.webp',
    sourceUrl: 'https://giphy.com/gifs/f1-formula-1-formel-xhTa2oPQNeJ2596Z9t',
  }),
]);

function fromCatalog(catalog, value, code) {
  const entry = catalog.find(({ id }) => id === value);
  if (!entry) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return entry;
}

export function getCircuit(value) { return fromCatalog(CIRCUITS, value, 'invalid_circuit'); }
export function getCrew(value) { return fromCatalog(CREWS, value, 'invalid_crew'); }
export function getDriver(value) { return fromCatalog(DRIVERS, value, 'invalid_driver'); }

export function validateDifficulty(value) {
  if (!DIFFICULTIES.includes(value)) {
    const error = new Error('invalid_difficulty');
    error.code = 'invalid_difficulty';
    throw error;
  }
  return value;
}

export function publicRaceCatalog(timing = PRODUCTION_TIMING) {
  return {
    circuits: CIRCUITS,
    crews: CREWS,
    drivers: DRIVERS,
    difficulties: DIFFICULTIES,
    match: {
      seats: HEAT_SIZE,
      minWaitMs: timing.minWaitMs,
      maxWaitMs: timing.maxWaitMs,
      gridMs: timing.gridMs,
      encounterMs: timing.encounterMs,
      minimumExposureMs: timing.minimumExposureMs,
      resultMs: timing.resultMs,
      totalEncounters: TOTAL_ENCOUNTERS,
      totalLaps: TOTAL_LAPS,
    },
  };
}
