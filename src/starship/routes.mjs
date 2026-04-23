/**
 * Find a forward crossing with lexicographic cost: avoided fields, hits, steps, entry bias.
 * Cells use their top-left coordinates. The returned route contains original cells.
 * Forward is right by default, or left for direction=-1. Vertical moves are
 * allowed; missing calendar cells are not traversable.
 * The optional avoid set contains top-left coordinate keys; use another lane when
 * possible, but permit unavoidable intersections. Discovery may supply weighted clones.
 */
export function findLeastResistanceRoute(cells, entryY, { avoid = new Set(), direction = 1 } = {}) {
  const left = Math.min(...cells.map((cell) => cell.x));
  const right = Math.max(...cells.map((cell) => cell.x));
  const entrance = direction === 1 ? left : right;
  const exit = direction === 1 ? right : left;
  const middle = (Math.min(...cells.map((cell) => cell.y)) + Math.max(...cells.map((cell) => cell.y))) / 2;
  const key = (cell) => `${cell.x},${cell.y}`;
  const nodes = new Map(cells.map((cell) => [key(cell), { cell, avoided: Infinity, resistance: Infinity, steps: Infinity, entryBias: Infinity, previous: null }]));
  const pending = new Set(nodes.values());
  const compare = (a, b) => a.avoided - b.avoided || a.resistance - b.resistance || a.steps - b.steps || a.entryBias - b.entryBias;
  const entry = entryY === undefined ? undefined : cells.filter((cell) => cell.x === entrance).sort((a, b) => Math.abs(a.y - entryY) - Math.abs(b.y - entryY))[0];
  for (const node of pending) if (node.cell.x === entrance && (!entry || node.cell === entry)) {
    node.avoided = Number(avoid.has(key(node.cell)));
    node.resistance = node.cell.level;
    node.steps = 1;
    node.entryBias = Math.abs(node.cell.y - middle);
  }

  while (pending.size) {
    let current;
    for (const node of pending) if (!current || compare(node, current) < 0) current = node;
    if (!Number.isFinite(current.resistance)) break;
    pending.delete(current);
    if (current.cell.x === exit) {
      const route = [];
      for (let node = current; node; node = node.previous) route.unshift(node.cell);
      return { route, resistance: current.resistance };
    }
    // Avoid reserved lanes first when supplied, then minimize real hits and steps.
    for (const [dx, dy] of [[16 * direction, 0], [0, -16], [0, 16]]) {
      const next = nodes.get(`${current.cell.x + dx},${current.cell.y + dy}`);
      if (!next || !pending.has(next)) continue;
      const candidate = { avoided: current.avoided + Number(avoid.has(key(next.cell))),
        resistance: current.resistance + next.cell.level, steps: current.steps + 1, entryBias: current.entryBias };
      if (compare(candidate, next) < 0) Object.assign(next, candidate, { previous: current });
    }
  }
  throw new Error('No forward route crosses the contribution calendar.');
}

/**
 * Connect one densest target per column, preferring cells outside Starflight’s route.
 * Equal levels prefer contribution count, then vertical distance from the current cell.
 */
export function findHighDensityRoute(cells, scoutRoute = [], entryY) {
  return findColumnRoute(cells, scoutRoute, entryY, (candidates, current, preferredEntry) => [...candidates].sort((a, b) => b.level - a.level || b.count - a.count || (current
    ? Math.abs(a.y - current.y) - Math.abs(b.y - current.y)
    : Math.abs(a.y - preferredEntry) - Math.abs(b.y - preferredEntry)))[0]);
}

/**
 * Connect seeded, randomly selected active targets while progressing right.
 * The same cells and seed reproduce the same route. Empty columns use the nearest row.
 */
export function findRandomDensityRoute(cells, entryY, seed = 1, otherRoutes = []) {
  let state = seed >>> 0;
  return findColumnRoute(cells, otherRoutes, entryY, (candidates, current, preferredEntry) => {
    const active = candidates.filter((cell) => cell.level > 0);
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return active.length ? active[state % active.length] : [...candidates].sort((a, b) => Math.abs(a.y - (current?.y ?? preferredEntry)) - Math.abs(b.y - (current?.y ?? preferredEntry)))[0];
  });
}

/**
 * Build an orthogonal route through targets chosen by the supplied column policy.
 * Partial weeks align through real cells in the previous column before advancing.
 */
function findColumnRoute(cells, scoutRoute, entryY, selectTarget) {
  const reserved = new Set(scoutRoute.map((cell) => `${cell.x},${cell.y}`));
  const columns = [...Map.groupBy(cells, (cell) => cell.x)].sort(([a], [b]) => a - b);
  const middle = (Math.min(...cells.map((cell) => cell.y)) + Math.max(...cells.map((cell) => cell.y))) / 2;
  const preferredEntry = entryY ?? (scoutRoute.length ? middle + (scoutRoute[0].y > middle ? -16 : 16) : middle);
  const route = [];
  const targets = [];
  let current;
  const append = (cell) => {
    if (current === cell) return;
    route.push(cell);
    current = cell;
  };
  const vertical = (column, y) => {
    while (current.y !== y) append(column.find((cell) => cell.y === current.y + Math.sign(y - current.y) * 16));
  };
  for (const [index, [, column]] of columns.entries()) {
    const unreserved = column.filter((cell) => !reserved.has(`${cell.x},${cell.y}`));
    const candidates = unreserved.length ? unreserved : column;
    const target = selectTarget(candidates, current, preferredEntry);
    targets.push(target);
    if (!current) {
      append([...column].sort((a, b) => Math.abs(a.y - preferredEntry) - Math.abs(b.y - preferredEntry))[0]);
      vertical(column, target.y);
    }
    else {
      const entry = [...column].sort((a, b) => Math.abs(a.y - current.y) - Math.abs(b.y - current.y))[0];
      vertical(columns[index - 1][1], entry.y);
      append(entry);
      vertical(column, target.y);
    }
  }
  return { route, targets };
}
