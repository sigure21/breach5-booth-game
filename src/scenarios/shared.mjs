export const DIFFICULTIES = Object.freeze(['BEGINNER', 'ADVANCED']);

export function publicTaskFrom(tasks, taskId, { difficulty, selected = null } = {}) {
  const task = tasks[taskId];
  if (!task) throw new Error(`unknown task ${taskId}`);
  const advanced = difficulty === 'ADVANCED';
  const selectedOption = task.options.find((option) => option.id === selected) ?? null;
  return {
    id: taskId,
    phase: task.phase,
    team: task.team,
    prompt: task.prompt,
    criterion: advanced ? task.criterion.advanced : task.criterion.beginner,
    evidence: task.evidence.map((item) => ({
      id: item.id,
      source: item.source,
      kind: item.kind,
      label: item.label,
      value: item.value,
      annotation: advanced ? null : item.annotation,
    })),
    selected,
    selectedObservation: selectedOption
      ? (advanced ? selectedOption.observation.advanced : selectedOption.observation.beginner)
      : null,
    options: task.options.map((option) => ({
      id: option.id,
      label: option.label,
      technical: option.technical,
      detail: advanced ? null : option.detail,
    })),
  };
}

export function validateTaskChoice(tasks, taskId, choice) {
  return typeof choice === 'string'
    && tasks[taskId]?.options.some((option) => option.id === choice) === true;
}

export function taskIdsForPhaseTeam(tasks, phase, team) {
  return Object.entries(tasks)
    .filter(([, task]) => task.phase === phase && task.team === team)
    .map(([id]) => id);
}

export function aggregateTaskChoices(tasks, actions) {
  const result = Object.fromEntries(Object.keys(tasks).map((taskId) => [taskId, null]));
  const byTask = new Map();
  for (const action of actions.values()) {
    if (!tasks[action.task]) continue;
    if (!byTask.has(action.task)) byTask.set(action.task, []);
    byTask.get(action.task).push(action);
  }
  for (const [taskId, candidates] of byTask) {
    const counts = new Map();
    for (const entry of candidates) {
      const current = counts.get(entry.choice) ?? { count: 0, firstAt: entry.at };
      current.count += 1;
      current.firstAt = Math.min(current.firstAt, entry.at);
      counts.set(entry.choice, current);
    }
    result[taskId] = [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[1].firstAt - b[1].firstAt || a[0].localeCompare(b[0]))[0][0];
  }
  return result;
}

export function scoreChoices(correct, choices, teamTasks) {
  let score = 0;
  let possible = 0;
  for (const taskId of teamTasks) {
    possible += 1;
    const expected = Array.isArray(correct[taskId]) ? correct[taskId] : [correct[taskId]];
    if (expected.includes(choices[taskId])) score += 1;
  }
  return { score, possible };
}
