export const HOME_MODULES = [
  { id: "plan", region: "main", titleKey: "dailyPlan" },
  { id: "priority", region: "main", titleKey: "priorities" },
  { id: "schedule", region: "main", titleKey: "schedule" },
  { id: "planned", region: "main", titleKey: "plannedTodos" },
  { id: "lessons", region: "main", titleKey: "todayLessons" },
  { id: "carry", region: "main", titleKey: "carryBacklog" },
  { id: "due", region: "main", titleKey: "deadlineWatch" },
  { id: "previous", region: "main", titleKey: "earlierRecurring" },
  { id: "done", region: "main", titleKey: "done" },
  { id: "inbox", region: "main", titleKey: "inbox" },
  { id: "timer", region: "support", titleKey: "focus" },
  { id: "habits", region: "support", titleKey: "todayHabits" },
  { id: "weekly", region: "support", titleKey: "weeklyHabits" },
  { id: "upcoming", region: "support", titleKey: "upcoming" },
];
export const HOME_MODULE_IDS = HOME_MODULES.map((x) => x.id);
export function homeModules(settings, region) {
  const home = settings?.homeModules || {};
  const hidden = new Set(home.hidden || []);
  const order = home.order || [];
  const rank = (id) => {
    const i = order.indexOf(id);
    if (i >= 0) return i;
    const fallback = HOME_MODULES.findIndex((m) => m.id === id);
    return 100 + (fallback < 0 ? HOME_MODULES.length : fallback);
  };
  return HOME_MODULES.filter(
    (x) => x.region === region && !hidden.has(x.id),
  ).sort((a, b) => rank(a.id) - rank(b.id));
}
export function isFolded(settings, id) {
  return (settings?.homeModules?.folded || []).includes(id);
}

export function reorderHomeRegion(settings, region, ids) {
  const expected = HOME_MODULES.filter((x) => x.region === region).map(
    (x) => x.id,
  );
  if (
    ids.length !== expected.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !expected.includes(id))
  )
    throw Error("模块顺序不属于该区域");
  const all = {
    ...settings,
    homeModules: { ...settings.homeModules, hidden: [] },
  };
  const other = region === "main" ? "support" : "main";
  const preserved = homeModules(all, other).map((x) => x.id);
  return region === "main" ? [...ids, ...preserved] : [...preserved, ...ids];
}
