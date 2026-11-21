/*
 * 步步为营 · Quoridor 规则引擎（浏览器 / Node 通用）
 *
 * 与 Python 版 quoridor/board.py + game.py + ai.py 一一对应：
 *   - 9×9 棋盘，每人 10 块挡板，一面挡板跨两条格缝
 *   - 走法、跳子、挡板重叠/交叉、BFS 连通性校验
 *   - 简单 / 普通 / 困难三档电脑对手
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.QuoridorEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const N = 9;
  const WALLS_PER_PLAYER = 10;
  const H = "h";
  const V = "v";
  const START = [[4, 8], [4, 0]];
  const GOAL_ROW = [0, 8];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const INVALID_DIST = 1e6;
  const INF = 1e9;

  const key = (x, y) => x * 8 + y;
  const onBoard = (x, y) => x >= 0 && x < N && y >= 0 && y < N;
  const wallOnBoard = (x, y) => x >= 0 && x < N - 1 && y >= 0 && y < N - 1;
  const hasWall = (set, x, y) => wallOnBoard(x, y) && set.has(key(x, y));

  function stepBlocked(hWalls, vWalls, ax, ay, bx, by) {
    if (ax === bx) {
      const y = Math.min(ay, by);
      return hasWall(hWalls, ax, y) || hasWall(hWalls, ax - 1, y);
    }
    const x = Math.min(ax, bx);
    return hasWall(vWalls, x, ay) || hasWall(vWalls, x, ay - 1);
  }

  function wallConflicts(hWalls, vWalls, orient, x, y) {
    if (orient === H) {
      if (hasWall(hWalls, x, y) || hasWall(hWalls, x - 1, y) || hasWall(hWalls, x + 1, y)) {
        return true;
      }
      return hasWall(vWalls, x, y);
    }
    if (hasWall(vWalls, x, y) || hasWall(vWalls, x, y - 1) || hasWall(vWalls, x, y + 1)) {
      return true;
    }
    return hasWall(hWalls, x, y);
  }

  function reachable(hWalls, vWalls, startX, startY, goalRow) {
    if (startY === goalRow) return true;
    const seen = new Uint8Array(N * N);
    seen[startY * N + startX] = 1;
    const queue = [startX, startY];
    for (let head = 0; head < queue.length; head += 2) {
      const x = queue[head];
      const y = queue[head + 1];
      for (let i = 0; i < 4; i++) {
        const nx = x + DIRS[i][0];
        const ny = y + DIRS[i][1];
        if (!onBoard(nx, ny)) continue;
        const idx = ny * N + nx;
        if (seen[idx]) continue;
        if (stepBlocked(hWalls, vWalls, x, y, nx, ny)) continue;
        if (ny === goalRow) return true;
        seen[idx] = 1;
        queue.push(nx, ny);
      }
    }
    return false;
  }

  function pathCells(hWalls, vWalls, startX, startY, goalRow) {
    if (startY === goalRow) return [[startX, startY]];
    const prev = new Int16Array(N * N).fill(-1);
    const seen = new Uint8Array(N * N);
    const startIdx = startY * N + startX;
    seen[startIdx] = 1;
    const queue = [startX, startY];
    let found = -1;
    for (let head = 0; head < queue.length && found < 0; head += 2) {
      const x = queue[head];
      const y = queue[head + 1];
      for (let i = 0; i < 4; i++) {
        const nx = x + DIRS[i][0];
        const ny = y + DIRS[i][1];
        if (!onBoard(nx, ny)) continue;
        const idx = ny * N + nx;
        if (seen[idx]) continue;
        if (stepBlocked(hWalls, vWalls, x, y, nx, ny)) continue;
        seen[idx] = 1;
        prev[idx] = y * N + x;
        if (ny === goalRow) {
          found = idx;
          break;
        }
        queue.push(nx, ny);
      }
    }
    if (found < 0) return [];
    const cells = [];
    let node = found;
    while (node !== startIdx && node >= 0) {
      cells.push([node % N, Math.floor(node / N)]);
      node = prev[node];
    }
    cells.push([startX, startY]);
    cells.reverse();
    return cells;
  }

  function shortestDistance(hWalls, vWalls, startX, startY, goalRow) {    if (startY === goalRow) return 0;
    const dist = new Uint16Array(N * N);
    const seen = new Uint8Array(N * N);
    seen[startY * N + startX] = 1;
    const queue = [startX, startY];
    for (let head = 0; head < queue.length; head += 2) {
      const x = queue[head];
      const y = queue[head + 1];
      const d = dist[y * N + x];
      for (let i = 0; i < 4; i++) {
        const nx = x + DIRS[i][0];
        const ny = y + DIRS[i][1];
        if (!onBoard(nx, ny)) continue;
        const idx = ny * N + nx;
        if (seen[idx]) continue;
        if (stepBlocked(hWalls, vWalls, x, y, nx, ny)) continue;
        if (ny === goalRow) return d + 1;
        seen[idx] = 1;
        dist[idx] = d + 1;
        queue.push(nx, ny);
      }
    }
    return INVALID_DIST;
  }

  class GameState {
    constructor() {
      this.reset();
    }

    reset() {
      this.pawns = [[START[0][0], START[0][1]], [START[1][0], START[1][1]]];
      this.hWalls = new Set();
      this.vWalls = new Set();
      this.wallsLeft = [WALLS_PER_PLAYER, WALLS_PER_PLAYER];
      this.turn = 0;
      this.winner = null;
      this.lastAction = null;
      this.turnCount = 0;
      this.history = [];
    }

    clone() {
      const copy = Object.create(GameState.prototype);
      copy.pawns = [[this.pawns[0][0], this.pawns[0][1]], [this.pawns[1][0], this.pawns[1][1]]];
      copy.hWalls = new Set(this.hWalls);
      copy.vWalls = new Set(this.vWalls);
      copy.wallsLeft = [this.wallsLeft[0], this.wallsLeft[1]];
      copy.turn = this.turn;
      copy.winner = this.winner;
      copy.lastAction = this.lastAction;
      copy.turnCount = this.turnCount;
      copy.history = [];
      return copy;
    }

    legalMoves(player) {
      if (player === undefined) player = this.turn;
      const [px, py] = this.pawns[player];
      const [ox, oy] = this.pawns[1 - player];
      const moves = [];

      for (let i = 0; i < 4; i++) {
        const dx = DIRS[i][0];
        const dy = DIRS[i][1];
        const nx = px + dx;
        const ny = py + dy;
        if (!onBoard(nx, ny)) continue;
        if (stepBlocked(this.hWalls, this.vWalls, px, py, nx, ny)) continue;

        if (nx !== ox || ny !== oy) {
          moves.push([nx, ny]);
          continue;
        }

        // 与对手相邻：直跳。
        const bx = nx + dx;
        const by = ny + dy;
        if (onBoard(bx, by) && !stepBlocked(this.hWalls, this.vWalls, nx, ny, bx, by)) {
          moves.push([bx, by]);
          continue;
        }

        // 对手身后有墙（或棋盘边）：向两侧跳。
        const sideDirs = dx !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
        for (let s = 0; s < 2; s++) {
          const tx = nx + sideDirs[s][0];
          const ty = ny + sideDirs[s][1];
          if (!onBoard(tx, ty)) continue;
          if (tx === px && ty === py) continue;
          if (stepBlocked(this.hWalls, this.vWalls, nx, ny, tx, ty)) continue;
          moves.push([tx, ty]);
        }
      }

      const unique = [];
      const seen = new Set();
      for (const move of moves) {
        const k = move[0] * 9 + move[1];
        if (!seen.has(k)) {
          seen.add(k);
          unique.push(move);
        }
      }
      return unique;
    }

    isValidMove(x, y, player) {
      if (player === undefined) player = this.turn;
      return this.legalMoves(player).some((m) => m[0] === x && m[1] === y);
    }

    explainMove(x, y, player) {
      if (player === undefined) player = this.turn;
      if (this.isValidMove(x, y, player)) return "";
      const [px, py] = this.pawns[player];
      if (x === px && y === py) return "这是你棋子所在的格子";
      if (!onBoard(x, y)) return "点击位置在棋盘之外";
      const [ox, oy] = this.pawns[1 - player];
      if (x === ox && y === oy) return "不能停在对手的棋子上，相邻时可以跳过去";
      if (Math.abs(x - px) + Math.abs(y - py) > 1) {
        return "只能上下左右走一格，或按跳子规则落到对手身后/两侧";
      }
      if (stepBlocked(this.hWalls, this.vWalls, px, py, x, y)) return "这里有挡板挡住，过不去";
      return "这一步不合法";
    }

    wallProblem(orient, x, y, player) {
      if (player === undefined) player = this.turn;
      if (orient !== H && orient !== V) return "挡板方向无效";
      if (!wallOnBoard(x, y)) return "挡板必须放在棋盘内部的格缝上";
      if (this.wallsLeft[player] <= 0) return "这个玩家的挡板已经用完了";
      if (wallConflicts(this.hWalls, this.vWalls, orient, x, y)) {
        return "这里已经有挡板了（挡板不能重叠或交叉）";
      }

      const set = orient === H ? this.hWalls : this.vWalls;
      set.add(key(x, y));
      let ok = true;
      for (let p = 0; p < 2; p++) {
        if (!reachable(this.hWalls, this.vWalls, this.pawns[p][0], this.pawns[p][1], GOAL_ROW[p])) {
          ok = false;
          break;
        }
      }
      set.delete(key(x, y));
      return ok ? "" : "这面墙会封死一方的通路，不能放置";
    }

    isValidWall(orient, x, y, player) {
      return this.wallProblem(orient, x, y, player) === "";
    }

    _pushHistory() {
      this.history.push({
        pawns: [[this.pawns[0][0], this.pawns[0][1]], [this.pawns[1][0], this.pawns[1][1]]],
        hWalls: new Set(this.hWalls),
        vWalls: new Set(this.vWalls),
        wallsLeft: [this.wallsLeft[0], this.wallsLeft[1]],
        turn: this.turn,
        winner: this.winner,
        lastAction: this.lastAction,
        turnCount: this.turnCount,
      });
    }

    movePiece(x, y, record) {
      if (record === undefined) record = true;
      if (this.winner !== null) return false;
      const player = this.turn;
      if (!this.isValidMove(x, y, player)) return false;
      if (record) this._pushHistory();
      this.pawns[player] = [x, y];
      this.lastAction = { type: "move", player, x, y };
      this.turnCount++;
      if (y === GOAL_ROW[player]) {
        this.winner = player;
      } else {
        this.turn = 1 - player;
      }
      return true;
    }

    placeWall(orient, x, y, record) {
      if (record === undefined) record = true;
      if (this.winner !== null) return false;
      const player = this.turn;
      if (this.wallProblem(orient, x, y, player) !== "") return false;
      if (record) this._pushHistory();
      (orient === H ? this.hWalls : this.vWalls).add(key(x, y));
      this.wallsLeft[player]--;
      this.lastAction = { type: "wall", player, orient, x, y };
      this.turnCount++;
      this.turn = 1 - player;
      return true;
    }

    apply(action, record) {
      if (!action) return false;
      if (action.type === "move") return this.movePiece(action.x, action.y, record);
      return this.placeWall(action.orient, action.x, action.y, record);
    }

    canUndo() {
      return this.history.length > 0;
    }

    undo() {
      if (!this.history.length) return false;
      const snap = this.history.pop();
      this.pawns = [[snap.pawns[0][0], snap.pawns[0][1]], [snap.pawns[1][0], snap.pawns[1][1]]];
      this.hWalls = new Set(snap.hWalls);
      this.vWalls = new Set(snap.vWalls);
      this.wallsLeft = [snap.wallsLeft[0], snap.wallsLeft[1]];
      this.turn = snap.turn;
      this.winner = snap.winner;
      this.lastAction = snap.lastAction;
      this.turnCount = snap.turnCount;
      return true;
    }

    distanceToGoal(player) {
      return shortestDistance(
        this.hWalls,
        this.vWalls,
        this.pawns[player][0],
        this.pawns[player][1],
        GOAL_ROW[player]
      );
    }
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class QuoridorAI {
    constructor(player, level, seed) {
      this.player = player === undefined ? 1 : player;
      this.level = ["简单", "普通", "困难"].includes(level) ? level : "普通";
      this.rand = mulberry32(seed === undefined ? 20261121 : seed);
      this.depth = 2; // 困难：电脑一步 + 玩家反击
    }

    choose(state) {
      if (state.winner !== null) return null;
      if (state.turn !== this.player) return null;

      // 能一步到终点时必须直接赢，避免搜索里被平局打平。
      const goalRow = GOAL_ROW[this.player];
      for (const move of state.legalMoves(this.player)) {
        if (move[1] === goalRow) return { type: "move", x: move[0], y: move[1] };
      }

      const actions = this._candidates(state, 26, 3, this.player);
      if (!actions.length) return null;

      if (this.level === "困难") return this._minimaxChoice(state, actions);

      const scored = [];
      for (const action of actions) {
        const child = state.clone();
        if (!child.apply(action, false)) continue;
        scored.push([this._greedyScore(child, action), action]);
      }
      if (!scored.length) return null;
      scored.sort((a, b) => b[0] - a[0]);
      return this._pickNearBest(scored);
    }

    _nearPawns(x, y, pawns, radius) {
      for (const pawn of pawns) {
        if (Math.abs(x - pawn[0]) + Math.abs(y - pawn[1]) <= radius) return true;
      }
      return false;
    }

    _candidates(state, wallLimit, radius, player) {
      if (player === undefined) player = state.turn;
      const actions = state.legalMoves(player).map((move) => ({
        type: "move",
        x: move[0],
        y: move[1],
      }));

      if (state.wallsLeft[player] > 0) {
        const opponent = 1 - player;
        // 关键：候选墙不只取“离棋子近”的，还要覆盖对手最短路径两侧，
        // 否则会漏掉封住致胜一步的墙，搜索就会误判自己已经赢了。
        const oppPath = pathCells(
          state.hWalls,
          state.vWalls,
          state.pawns[opponent][0],
          state.pawns[opponent][1],
          GOAL_ROW[opponent]
        );
        const slots = [];
        for (let x = 0; x < 8; x++) {
          for (let y = 0; y < 8; y++) {
            let pathDist = 99;
            for (const cell of oppPath) {
              const d = Math.abs(x - cell[0]) + Math.abs(y - cell[1]);
              if (d < pathDist) pathDist = d;
            }
            if (pathDist > 1 && !this._nearPawns(x, y, state.pawns, radius)) continue;
            const score = pathDist * 2 + this._slotScore(state, x, y) * 0.1;
            slots.push([H, x, y, score]);
            slots.push([V, x, y, score]);
          }
        }
        // 确定性排序：同一局面每次搜索的候选集一致，避免决策忽好忽坏。
        slots.sort(
          (a, b) =>
            a[3] - b[3] ||
            (((a[1] * 73856093) ^ (a[2] * 19349663)) >>> 0) -
              (((b[1] * 73856093) ^ (b[2] * 19349663)) >>> 0) ||
            (a[0] === H ? 0 : 1) - (b[0] === H ? 0 : 1)
        );

        let found = 0;
        for (const slot of slots) {
          if (state.wallProblem(slot[0], slot[1], slot[2], player) !== "") continue;
          actions.push({ type: "wall", orient: slot[0], x: slot[1], y: slot[2] });
          found++;
          if (found >= wallLimit) break;
        }
      }
      return actions;
    }

    _slotScore(state, x, y) {
      let best = 99;
      for (const pawn of state.pawns) {
        const d = Math.abs(x - pawn[0]) + Math.abs(y - pawn[1]);
        if (d < best) best = d;
      }
      return best;
    }

    _greedyScore(child, action) {
      const me = this.player;
      if (child.winner === me) return INF;
      if (child.winner !== null) return -INF;
      const dMe = child.distanceToGoal(me);
      const dOp = child.distanceToGoal(1 - me);

      let score;
      if (this.level === "简单") {
        score = -10 * dMe;
        if (action.type === "move" && dMe <= 2) score += 4;
      } else {
        score = 10 * (dOp - dMe);
        if (action.type === "wall") score -= 0.5; // 挡板要花掉一回合，轻微成本避免无脑刷墙
        if (dMe <= 2) score += action.type === "move" ? 7 : -4;
        if (action.type === "move" && child.turnCount <= 6) score += 1;
      }
      score += this.rand() * 1.2;
      return score;
    }

    _pickNearBest(scored) {
      const best = scored[0][0];
      const top = [];
      for (const item of scored) {
        if (item[0] >= best - 0.45 && top.length < 3) top.push(item[1]);
      }
      return top[Math.floor(this.rand() * top.length)];
    }

    _evaluate(state) {
      if (state.winner !== null) {
        return state.winner === this.player ? 9000 : -9000;
      }
      const dMe = state.distanceToGoal(this.player);
      const dOp = state.distanceToGoal(1 - this.player);
      // 自己绕远路的代价要高于拖慢对手的收益，否则会把自己堵死。
      let score = 10 * dOp - 14 * dMe;
      score += 0.8 * (state.wallsLeft[this.player] - state.wallsLeft[1 - this.player]);
      if (dMe <= 2) score += 5;
      return score;
    }

    _search(state, depth, alpha, beta) {
      if (state.winner !== null || depth <= 0) return this._evaluate(state);

      const maximizing = state.turn === this.player;
      const actions = this._candidates(state, 12, 2, state.turn);
      if (!actions.length) return this._evaluate(state);
      actions.sort((a, b) => (a.type === "move" ? 0 : 1) - (b.type === "move" ? 0 : 1));

      if (maximizing) {
        let value = -INF;
        for (const action of actions) {
          const child = state.clone();
          if (!child.apply(action, false)) continue;
          value = Math.max(value, this._search(child, depth - 1, alpha, beta));
          alpha = Math.max(alpha, value);
          if (alpha >= beta) break;
        }
        return value;
      }

      let value = INF;
      for (const action of actions) {
        const child = state.clone();
        if (!child.apply(action, false)) continue;
        value = Math.min(value, this._search(child, depth - 1, alpha, beta));
        beta = Math.min(beta, value);
        if (alpha >= beta) break;
      }
      return value;
    }

    _minimaxChoice(state, actions) {
      const current = state.distanceToGoal(this.player);
      const scored = [];
      let alpha = -INF;
      for (const action of actions) {
        const child = state.clone();
        if (!child.apply(action, false)) continue;
        const value = this._search(child, this.depth - 1, alpha, INF);
        alpha = Math.max(alpha, value);
        // 标记这步是否让自己离终点更远；仅作为同分时的偏好，不替代搜索。
        const selfHarm = child.distanceToGoal(this.player) > current;
        scored.push({ value, action, selfHarm });
      }
      if (!scored.length) return actions[0];
      scored.sort((a, b) => b.value - a.value);
      const best = scored[0].value;
      const top = scored.filter((item) => item.value >= best - 0.45).slice(0, 3);
      const safe = top.filter((item) => !item.selfHarm);
      const pool = safe.length ? safe : top;
      return pool[Math.floor(this.rand() * pool.length)].action;
    }
  }

  return {
    N,
    WALLS_PER_PLAYER,
    H,
    V,
    START,
    GOAL_ROW,
    GameState,
    QuoridorAI,
    wallKey: key,
    stepBlocked,
    wallConflicts,
    reachable,
    shortestDistance,
  };
});
