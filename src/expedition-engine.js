export const DEFAULT_GOALS = Object.freeze([
  { type: 'meters', target: 500, label: 'Projdi dnes 500 metrů' },
  { type: 'cells', target: 3, label: 'Odkryj 3 nové dílky' },
  { type: 'none', label: 'Bez cíle' },
]);

export function normalizeGoal(goal) {
  if (!goal || typeof goal !== 'object') {
    return { ...DEFAULT_GOALS[0] };
  }
  if (goal.type === 'cells') {
    const target = Math.max(1, Number(goal.target) || 3);
    return { type: 'cells', target, label: `Odkryj ${target} nové dílky` };
  }
  if (goal.type === 'place') {
    if (!goal.placeId || typeof goal.placeId !== 'string') return { ...DEFAULT_GOALS[0] };
    return {
      type: 'place',
      placeId: goal.placeId,
      label: typeof goal.label === 'string' && goal.label ? goal.label : 'Navštiv zvolené místo',
    };
  }
  if (goal.type === 'none') {
    return { type: 'none', label: 'Bez cíle' };
  }
  const target = Math.max(50, Number(goal.target) || 500);
  return { type: 'meters', target, label: `Projdi dnes ${target} metrů` };
}

export function createExpedition({ progress, goal = null, now = Date.now() }) {
  const cellsCount = Array.isArray(progress?.cells) ? progress.cells.length : 0;
  const metersCount = Number(progress?.meters) || 0;
  const discCount = Array.isArray(progress?.discoveries) ? progress.discoveries.length : 0;

  const id = `exp_${now}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    state: 'active',
    startedAt: new Date(now).toISOString(),
    endedAt: null,
    startMeters: metersCount,
    startCells: cellsCount,
    startDiscoveries: discCount,
    goal: normalizeGoal(goal),
    visitedInSession: [],
    categories: [],
  };
}

export function pauseExpedition(expedition) {
  if (!expedition || typeof expedition !== 'object') return null;
  if (expedition.state === 'ended') return expedition;
  return {
    ...expedition,
    state: 'paused',
  };
}

export function resumeExpedition(expedition) {
  if (!expedition || typeof expedition !== 'object') return null;
  if (expedition.state === 'ended') return expedition;
  return {
    ...expedition,
    state: 'active',
  };
}

export function updateExpeditionGoal(expedition, newGoal) {
  if (!expedition || typeof expedition !== 'object') return null;
  return {
    ...expedition,
    goal: normalizeGoal(newGoal),
  };
}

export function isGoalAchieved(expedition, currentProgress) {
  if (!expedition || !expedition.goal) return false;
  const goal = expedition.goal;
  const curCells = Array.isArray(currentProgress?.cells) ? currentProgress.cells.length : 0;
  const curMeters = Number(currentProgress?.meters) || 0;

  if (goal.type === 'meters') {
    const gained = Math.max(0, curMeters - (Number(expedition.startMeters) || 0));
    return gained >= goal.target;
  }
  if (goal.type === 'cells') {
    const gained = Math.max(0, curCells - (Number(expedition.startCells) || 0));
    return gained >= goal.target;
  }
  if (goal.type === 'place') {
    return Array.isArray(expedition.visitedInSession) && expedition.visitedInSession.includes(goal.placeId);
  }
  return false;
}

export function recordExpeditionVisit(expedition, place) {
  if (!expedition || !place || !place.id) return expedition;
  const placeId = String(place.id);
  const already = Array.isArray(expedition.visitedInSession) && expedition.visitedInSession.includes(placeId);
  if (already) return expedition;

  const nextVisited = [...(expedition.visitedInSession || []), placeId];
  const nextCategories = [...(expedition.categories || [])];
  if (place.kind && typeof place.kind === 'string' && !nextCategories.includes(place.kind)) {
    nextCategories.push(place.kind);
  }

  return {
    ...expedition,
    visitedInSession: nextVisited,
    categories: nextCategories,
  };
}

export function endExpedition({ expedition, currentProgress, pointsEarned = 0, avatarId = 'liska', now = Date.now() }) {
  if (!expedition) return null;
  const curCells = Array.isArray(currentProgress?.cells) ? currentProgress.cells.length : 0;
  const curMeters = Number(currentProgress?.meters) || 0;
  const curStamps = Array.isArray(currentProgress?.discoveries) ? currentProgress.discoveries.length : 0;

  const distanceMeters = Math.max(0, curMeters - (Number(expedition.startMeters) || 0));
  const newCellsCount = Math.max(0, curCells - (Number(expedition.startCells) || 0));
  const newStampsCount = Math.max(0, curStamps - (Number(expedition.startDiscoveries) || 0));
  const achieved = isGoalAchieved(expedition, currentProgress);

  const summary = {
    id: expedition.id,
    startedAt: expedition.startedAt,
    endedAt: new Date(now).toISOString(),
    distanceMeters,
    newCellsCount,
    newStampsCount,
    pointsEarned: Math.max(0, Number(pointsEarned) || 0),
    goal: expedition.goal,
    goalAchieved: achieved,
    visitedInSession: [...(expedition.visitedInSession || [])],
    categories: [...(expedition.categories || [])],
    avatarId: typeof avatarId === 'string' && avatarId ? avatarId : 'liska',
    templateVersion: 1,
  };

  const endedExpedition = {
    ...expedition,
    state: 'ended',
    endedAt: summary.endedAt,
  };

  return {
    endedExpedition,
    summary,
  };
}