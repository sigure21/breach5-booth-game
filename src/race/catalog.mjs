export const DIFFICULTIES = Object.freeze(['BEGINNER', 'ADVANCED']);

export const TRACKS = Object.freeze([
  Object.freeze({
    id: 'human-firewall',
    name: 'Human Firewall Circuit',
    shortLabel: 'HUMAN FIREWALL',
    subtitle: '계정, 피싱, 사고 대응 중심의 도심 서킷',
    accent: '#ff4d8d',
  }),
  Object.freeze({
    id: 'secure-builder',
    name: 'Secure Builder Circuit',
    shortLabel: 'SECURE BUILDER',
    subtitle: '웹, 클라우드, 공급망 중심의 테크니컬 서킷',
    accent: '#69f0c5',
  }),
]);

export const CREWS = Object.freeze([
  Object.freeze({
    id: 'red-bull-racing', name: 'RED BULL RACING', color: '#3155ff', accent: '#ff334f',
    trait: '공격적인 레이스 운영', asset: '/assets/cars/red-bull-racing.svg',
  }),
  Object.freeze({
    id: 'ferrari', name: 'FERRARI', color: '#ef1a2d', accent: '#ffd54a',
    trait: '정교한 피트 전략', asset: '/assets/cars/ferrari.svg',
  }),
  Object.freeze({
    id: 'mercedes', name: 'MERCEDES', color: '#00d2be', accent: '#d8f5f2',
    trait: '데이터 기반 판단', asset: '/assets/cars/mercedes.svg',
  }),
  Object.freeze({
    id: 'mclaren', name: 'MCLAREN', color: '#ff8700', accent: '#57d5ff',
    trait: '민첩한 구간 대응', asset: '/assets/cars/mclaren.svg',
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

export function getTrack(value) { return fromCatalog(TRACKS, value, 'invalid_track'); }
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

export function publicRaceCatalog() {
  return { tracks: TRACKS, crews: CREWS, drivers: DRIVERS, difficulties: DIFFICULTIES };
}
