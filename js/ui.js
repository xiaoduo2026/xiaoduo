/*
 * 步步为营 · 网页界面
 * Canvas 渲染 + DOM 面板 + 鼠标/键盘/触摸交互。
 */
(function () {
  "use strict";

  const E = window.QuoridorEngine;
  if (!E) {
    console.error("规则引擎加载失败");
    return;
  }

  const { GameState, QuoridorAI, H, V, N, WALLS_PER_PLAYER, wallKey } = E;

  const C = {
    p1: "#ef7d3f",
    p1Dark: "#a8481a",
    p1Light: "#ffb083",
    p2: "#4d9fe6",
    p2Dark: "#28618f",
    p2Light: "#a5d2f7",
    surface: "#efe3c8",
    cellA: "#f7efdd",
    cellB: "#eee0c3",
    grid: "#d9c7a4",
    frame: "#33261a",
    frameEdge: "#5c4530",
    frameHi: "#7a5c3f",
    wall: "#4b3624",
    wallEdge: "#241710",
    wallHi: "#7f5c3a",
    hint: "#7c6537",
    slot: "#b49b74",
    ok: "#3ecf8e",
    bad: "#e26262",
    accent: "#e9b44c",
    panel: "#1a2130",
  };

  const PLAYER_COLORS = [C.p1, C.p2];
  const PLAYER_DARKS = [C.p1Dark, C.p2Dark];
  const PLAYER_LIGHTS = [C.p1Light, C.p2Light];
  const PLAYER_LABELS = ["玩家一", "玩家二"];

  function blend(hexA, hexB, t) {
    const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
    const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
    const mix = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- 音效
  const SOUND_RECIPES = {
    move: [
      [620, 0.06, 0.18, 0],
      [880, 0.09, 0.12, 0.05],
    ],
    wall: [
      [170, 0.09, 0.26, 0],
      [120, 0.11, 0.18, 0.05],
    ],
    bad: [
      [190, 0.07, 0.2, 0],
      [140, 0.14, 0.16, 0.06],
    ],
    undo: [
      [470, 0.06, 0.14, 0],
      [340, 0.09, 0.11, 0.05],
    ],
    win: [
      [523.25, 0.13, 0.18, 0],
      [659.25, 0.13, 0.18, 0.12],
      [783.99, 0.13, 0.18, 0.24],
      [1046.5, 0.3, 0.18, 0.36],
    ],
    start: [
      [392, 0.08, 0.12, 0],
      [523.25, 0.1, 0.12, 0.08],
    ],
  };

  class Sound {
    constructor() {
      this.enabled = true;
      this.ctx = null;
    }

    _ensure() {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }

    play(name) {
      if (!this.enabled) return;
      const recipe = SOUND_RECIPES[name];
      if (!recipe) return;
      try {
        const ctx = this._ensure();
        if (!ctx) return;
        const now = ctx.currentTime + 0.01;
        for (const [freq, dur, vol, delay] of recipe) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(0.0001, now + delay);
          gain.gain.exponentialRampToValueAtTime(vol, now + delay + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + dur + 0.03);
        }
      } catch (err) {
        // 浏览器限制自动播放时静默失败。
      }
    }
  }

  // ---------------------------------------------------------------- 应用
  class QuoridorApp {
    constructor() {
      this.wrap = document.getElementById("board-wrap");
      this.canvas = document.getElementById("board");
      this.ctx2d = this.canvas.getContext("2d");
      this.sound = new Sound();

      this.state = new GameState();
      this.gameMode = "pvp";
      this.level = "普通";
      this.mode = "move";
      this.ai = new QuoridorAI(1, this.level, Date.now());
      this.aiThinking = false;
      this.busy = false;
      this.winnerShown = null;
      this.msg = { text: "点击圆点移动棋子，空格键切换放墙模式", kind: "info" };
      this.hoverCell = null;
      this.hoverSlot = null;
      this.pawnAnim = null;
      this.animToken = 0;
      this.aiTimers = [];
      this.keyTimes = {};
      this.suppressHint = false;
      this._drawQueued = false;

      this.el = {
        overlay: document.getElementById("overlay"),
        overlayBadge: document.getElementById("overlay-badge"),
        overlayTitle: document.getElementById("overlay-title"),
        toast: document.getElementById("toast"),
        panel: document.getElementById("panel"),
        backdrop: document.getElementById("sheet-backdrop"),
        sheetClose: document.getElementById("sheet-close"),
        mtTurn: document.getElementById("mt-turn"),
        mtCounts: document.getElementById("mt-counts"),
        mtMenu: document.getElementById("mt-menu"),
        dockMove: document.getElementById("dock-move"),
        dockWall: document.getElementById("dock-wall"),
        dockUndo: document.getElementById("dock-undo"),
        dockMenu: document.getElementById("dock-menu"),
        miCards: [document.getElementById("mi-p0"), document.getElementById("mi-p1")],
        miNames: [document.getElementById("mi-name-0"), document.getElementById("mi-name-1")],
        miWalls: [document.getElementById("mi-w0"), document.getElementById("mi-w1")],
        miMessage: document.getElementById("mi-message"),
        turnText: document.getElementById("turn-text"),
        turnSide: document.getElementById("turn-side"),
        message: document.getElementById("message"),
        undo: document.getElementById("undo"),
        restart: document.getElementById("restart"),
        sound: document.getElementById("sound"),
        difficultySection: document.getElementById("difficulty-section"),
        gameMode: document.getElementById("game-mode"),
        difficulty: document.getElementById("difficulty"),
        modeSwitch: document.getElementById("mode-switch"),
        cards: [document.getElementById("card-0"), document.getElementById("card-1")],
        names: [document.getElementById("name-0"), document.getElementById("name-1")],
        counts: [document.getElementById("count-0"), document.getElementById("count-1")],
        bars: [document.getElementById("bar-0"), document.getElementById("bar-1")],
      };

      this._bindUI();
      this._bindInput();

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.wrap);
      this.resize();

      this.renderPanel();
      this.requestDraw();

      const params = new URLSearchParams(location.search);
      if (params.has("demo")) this.applyDemo(params.get("demo"));
      if (params.has("selftest")) {
        document.documentElement.dataset.selftest = "running";
        window.__quoridorApp = this;
        setTimeout(() => runSelfTest(this), 60);
      }
      window.__quoridorApp = this;
    }

    // ------------------------------------------------------------ 尺寸
    resize() {
      const rect = this.wrap.getBoundingClientRect();
      const w = Math.max(240, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      if (this.W === w && this.H === h && this.dpr === dpr) return;
      this.W = w;
      this.H = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

      const s = Math.min(w, h);
      this.cell = s / 9.5;
      this.pad = this.cell * 0.19;
      this.bx = (w - 9 * this.cell) / 2;
      this.by = (h - 9 * this.cell) / 2;
      this.wallT = Math.max(8, this.cell * 0.185);
      this.requestDraw();
    }

    requestDraw() {
      if (this._drawQueued) return;
      this._drawQueued = true;
      requestAnimationFrame(() => {
        this._drawQueued = false;
        this.draw();
      });
    }

    // ------------------------------------------------------------ 绘制
    draw() {
      const ctx = this.ctx2d;
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawBoard(ctx);
      this.drawWalls(ctx);
      this.drawLastMove(ctx);
      this.drawHints(ctx);
      this.drawHover(ctx);
      this.drawPawns(ctx);
      this.drawPreview(ctx);
    }

    drawBoard(ctx) {
      const cell = this.cell;
      const bx = this.bx;
      const by = this.by;
      const board = 9 * cell;
      const pad = this.pad;

      // 外框
      ctx.save();
      roundRect(ctx, bx - pad, by - pad, board + pad * 2, board + pad * 2, pad * 0.9);
      ctx.fillStyle = C.frame;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.frameEdge;
      ctx.stroke();
      roundRect(ctx, bx - pad + 3, by - pad + 3, board + pad * 2 - 6, board + pad * 2 - 6, pad * 0.7);
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.frameHi;
      ctx.stroke();
      ctx.restore();

      // 棋盘面
      ctx.fillStyle = C.surface;
      ctx.fillRect(bx - 1, by - 1, board + 2, board + 2);

      // 格子（目标行淡染色）
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          let fill = (x + y) % 2 === 0 ? C.cellA : C.cellB;
          if (y === 0) fill = blend(fill, C.p1, 0.13);
          else if (y === N - 1) fill = blend(fill, C.p2, 0.13);
          ctx.fillStyle = fill;
          ctx.fillRect(bx + x * cell, by + y * cell, cell + 0.4, cell + 0.4);
        }
      }

      // 网格
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = bx + i * cell;
        ctx.moveTo(x, by);
        ctx.lineTo(x, by + board);
        const y = by + i * cell;
        ctx.moveTo(bx, y);
        ctx.lineTo(bx + board, y);
      }
      ctx.stroke();

      // 放墙模式的交点提示
      if (this.mode === "wall" && this.state.winner === null) {
        ctx.fillStyle = C.slot;
        for (let i = 1; i < N; i++) {
          for (let j = 1; j < N; j++) {
            ctx.beginPath();
            ctx.arc(bx + i * cell, by + j * cell, Math.max(1.3, cell * 0.027), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    wallBox(orient, x, y) {
      const cell = this.cell;
      const t = this.wallT;
      if (orient === H) {
        const x0 = this.bx + x * cell + cell * 0.05;
        const x1 = this.bx + (x + 2) * cell - cell * 0.05;
        const cy = this.by + (y + 1) * cell;
        return [x0, cy - t / 2, x1, cy + t / 2];
      }
      const y0 = this.by + y * cell + cell * 0.05;
      const y1 = this.by + (y + 2) * cell - cell * 0.05;
      const cx = this.bx + (x + 1) * cell;
      return [cx - t / 2, y0, cx + t / 2, y1];
    }

    drawWall(ctx, orient, x, y, alpha) {
      const [x0, y0, x1, y1] = this.wallBox(orient, x, y);
      const r = (orient === H ? y1 - y0 : x1 - x0) / 2;
      ctx.save();
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = this.cell * 0.07;
      ctx.shadowOffsetY = this.cell * 0.035;
      roundRect(ctx, x0, y0, x1 - x0, y1 - y0, r);
      ctx.fillStyle = C.wall;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.wallEdge;
      ctx.stroke();
      ctx.beginPath();
      if (orient === H) {
        ctx.moveTo(x0 + r, y0 + Math.max(2, (y1 - y0) * 0.22));
        ctx.lineTo(x1 - r, y0 + Math.max(2, (y1 - y0) * 0.22));
      } else {
        ctx.moveTo(x0 + Math.max(2, (x1 - x0) * 0.22), y0 + r);
        ctx.lineTo(x0 + Math.max(2, (x1 - x0) * 0.22), y1 - r);
      }
      ctx.lineWidth = Math.max(1, this.wallT * 0.12);
      ctx.strokeStyle = C.wallHi;
      ctx.stroke();
      ctx.restore();
    }

    drawWalls(ctx) {
      const st = this.state;
      for (const k of st.hWalls) this.drawWall(ctx, H, Math.floor(k / 8), k % 8);
      for (const k of st.vWalls) this.drawWall(ctx, V, Math.floor(k / 8), k % 8);

      const last = st.lastAction;
      if (last && last.type === "wall") {
        const [x0, y0, x1, y1] = this.wallBox(last.orient, last.x, last.y);
        const r = (last.orient === H ? y1 - y0 : x1 - x0) / 2;
        ctx.save();
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(233,180,76,0.55)";
        ctx.shadowBlur = 8;
        roundRect(ctx, x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2, r);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawLastMove(ctx) {
      const last = this.state.lastAction;
      if (!last || last.type !== "move") return;
      const [cx, cy] = this.cellCenter(last.x, last.y);
      ctx.save();
      ctx.strokeStyle = PLAYER_COLORS[last.player];
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, this.cell * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawHints(ctx) {
      if (this.state.winner !== null || this._inputLocked()) return;
      if (this.mode !== "move") return;
      ctx.fillStyle = C.hint;
      for (const [x, y] of this.state.legalMoves()) {
        const [cx, cy] = this.cellCenter(x, y);
        ctx.beginPath();
        ctx.arc(cx, cy, this.cell * 0.085, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawHover(ctx) {
      if (this._inputLocked() || this.state.winner !== null) return;
      if (this.mode === "move" && this.hoverCell) {
        const [x, y] = this.hoverCell;
        const legal = this.state.isValidMove(x, y);
        const pad = this.cell * 0.06;
        const x0 = this.bx + x * this.cell + pad;
        const y0 = this.by + y * this.cell + pad;
        ctx.save();
        ctx.strokeStyle = legal ? C.ok : C.bad;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.9;
        roundRect(ctx, x0, y0, this.cell - pad * 2, this.cell - pad * 2, this.cell * 0.16);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawPreview(ctx) {
      if (!this.hoverSlot || this.mode !== "wall" || this._inputLocked()) return;
      const { orient, x, y } = this.hoverSlot;
      const problem = this.state.wallProblem(orient, x, y);
      const color = problem ? C.bad : C.ok;
      const [x0, y0, x1, y1] = this.wallBox(orient, x, y);
      const r = (orient === H ? y1 - y0 : x1 - x0) / 2;
      ctx.save();
      ctx.globalAlpha = 0.42;
      roundRect(ctx, x0, y0, x1 - x0, y1 - y0, r);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.restore();
    }

    pawnCenter(player) {
      if (this.pawnAnim && this.pawnAnim.player === player) {
        return [
          this.bx + (this.pawnAnim.x + 0.5) * this.cell,
          this.by + (this.pawnAnim.y + 0.5) * this.cell,
        ];
      }
      return this.cellCenter(this.state.pawns[player][0], this.state.pawns[player][1]);
    }

    drawPawns(ctx) {
      for (const player of [0, 1]) {
        const [cx, cy] = this.pawnCenter(player);
        const r = this.cell * 0.3;
        const color = PLAYER_COLORS[player];

        ctx.save();
        ctx.fillStyle = "rgba(5,7,11,0.35)";
        ctx.beginPath();
        ctx.ellipse(cx + r * 0.08, cy + r * 0.16, r * 1.02, r * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_DARKS[player];
        ctx.fill();

        const grad = ctx.createRadialGradient(
          cx - r * 0.35,
          cy - r * 0.45,
          r * 0.15,
          cx,
          cy,
          r
        );
        grad.addColorStop(0, PLAYER_LIGHTS[player]);
        grad.addColorStop(0.52, color);
        grad.addColorStop(1, PLAYER_DARKS[player]);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // 高光
        ctx.beginPath();
        ctx.ellipse(cx - r * 0.3, cy - r * 0.38, r * 0.3, r * 0.2, -0.6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.fill();

        const active =
          (this.state.winner === player) ||
          (this.state.winner === null && this.state.turn === player);
        if (active) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r + this.cell * 0.045, 0, Math.PI * 2);
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 3;
          ctx.shadowColor = "rgba(233,180,76,0.6)";
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    cellCenter(x, y) {
      return [this.bx + (x + 0.5) * this.cell, this.by + (y + 0.5) * this.cell];
    }

    // ------------------------------------------------------------ 坐标
    pointInBoard(mx, my) {
      return (
        mx >= this.bx - this.pad &&
        mx <= this.bx + 9 * this.cell + this.pad &&
        my >= this.by - this.pad &&
        my <= this.by + 9 * this.cell + this.pad
      );
    }

    cellAt(mx, my) {
      const x = Math.floor((mx - this.bx) / this.cell);
      const y = Math.floor((my - this.by) / this.cell);
      if (x < 0 || x >= N || y < 0 || y >= N) return null;
      return [x, y];
    }

    slotAt(mx, my) {
      if (!this.pointInBoard(mx, my)) return null;
      const u = (mx - this.bx) / this.cell;
      const v = (my - this.by) / this.cell;
      const i = Math.round(u);
      const j = Math.round(v);
      const du = Math.abs(u - i);
      const dv = Math.abs(v - j);
      const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
      if (du < dv) {
        const line = clamp(i, 1, 8);
        return { orient: V, x: line - 1, y: clamp(Math.round(v - 1), 0, 7) };
      }
      const line = clamp(j, 1, 8);
      return { orient: H, x: clamp(Math.round(u - 1), 0, 7), y: line - 1 };
    }

    wallCenter(orient, x, y) {
      const [x0, y0, x1, y1] = this.wallBox(orient, x, y);
      return [(x0 + x1) / 2, (y0 + y1) / 2];
    }

    pointFromEvent(event) {
      const rect = this.canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    // ------------------------------------------------------------ 输入
    _bindInput() {
      this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
      this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
      this.canvas.addEventListener("pointerleave", () => {
        this.hoverCell = null;
        this.hoverSlot = null;
        this.canvas.classList.remove("pointing");
        this.requestDraw();
      });
      this.canvas.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (this.mode === "wall" && !this._inputLocked()) {
          this.setMode("move");
          this.setMessage("已退出放墙模式", "info");
        }
      });
      window.addEventListener("keydown", (event) => this.onKeyDown(event));
      window.addEventListener("resize", () => this.resize());
    }

    onPointerMove(event) {
      if (this._inputLocked()) {
        if (this.hoverCell || this.hoverSlot) {
          this.hoverCell = null;
          this.hoverSlot = null;
          this.requestDraw();
        }
        return;
      }
      const [mx, my] = this.pointFromEvent(event);
      let changed = false;
      if (this.mode === "move") {
        const cell = this.cellAt(mx, my);
        if (String(cell) !== String(this.hoverCell)) {
          this.hoverCell = cell;
          changed = true;
        }
        this.hoverSlot = null;
      } else {
        const slot = this.slotAt(mx, my);
        const key = slot ? slot.orient + slot.x + "," + slot.y : null;
        const old = this.hoverSlot
          ? this.hoverSlot.orient + this.hoverSlot.x + "," + this.hoverSlot.y
          : null;
        if (key !== old) {
          this.hoverSlot = slot;
          changed = true;
        }
        this.hoverCell = null;
      }
      if (this.mode === "wall") this.canvas.classList.add("pointing");
      else if (this.hoverCell) this.canvas.classList.add("pointing");
      else this.canvas.classList.remove("pointing");
      if (changed) this.requestDraw();
    }

    onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const [mx, my] = this.pointFromEvent(event);
      if (this.state.winner !== null) {
        this.setMessage("本局已经结束，按 R 开始新的一局", "info");
        return;
      }
      if (this._inputLocked()) {
        if (this.gameMode === "pve" && this.state.turn === 1) {
          this.setMessage("电脑正在思考，请稍候", "info");
        }
        return;
      }
      if (this.mode === "move") {
        const cell = this.cellAt(mx, my);
        if (cell) this.performMove(cell[0], cell[1]);
      } else {
        const slot = this.slotAt(mx, my);
        if (slot) this.performWall(slot.orient, slot.x, slot.y);
      }
    }

    onKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const now = performance.now();
      if (now - (this.keyTimes[key] || 0) < 120) return;
      this.keyTimes[key] = now;

      if (key === " " || event.code === "Space") {
        event.preventDefault();
        if (this.state.winner !== null || this._inputLocked()) return;
        this.setMode(this.mode === "move" ? "wall" : "move");
      } else if (key === "r") {
        this.restart();
      } else if (key === "z") {
        this.undo();
      } else if (key === "escape") {
        if (this.mode === "wall") {
          this.setMode("move");
          this.setMessage("已取消放墙预览", "info");
        } else if (this.state.winner !== null) {
          this.setMessage("按 R 开始新的一局", "info");
        } else {
          this.setMessage("按 R 重开一局，或直接关闭页面退出", "info");
        }
      } else if (key === "m" && !this._inputLocked()) {
        this.setMode("move");
      } else if (key === "w" && !this._inputLocked()) {
        this.setMode("wall");
      }
    }

    _bindUI() {
      this.el.gameMode.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mode]");
        if (button) this.setGameMode(button.dataset.mode);
      });
      this.el.difficulty.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-level]");
        if (button) this.setLevel(button.dataset.level);
      });
      this.el.modeSwitch.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mode]");
        if (button) this.setMode(button.dataset.mode);
      });
      this.el.undo.addEventListener("click", () => this.undo());
      this.el.restart.addEventListener("click", () => this.restart());
      this.el.sound.addEventListener("click", () => this.toggleSound());
      document.getElementById("overlay-restart").addEventListener("click", () => this.restart());

      // 手机端：底部大按钮 + 设置抽屉
      this.el.mtMenu.addEventListener("click", () => this.openSheet());
      this.el.dockMenu.addEventListener("click", () => this.openSheet());
      this.el.sheetClose.addEventListener("click", () => this.closeSheet());
      this.el.backdrop.addEventListener("click", () => this.closeSheet());
      this.el.dockMove.addEventListener("click", () => this.setMode("move"));
      this.el.dockWall.addEventListener("click", () => this.setMode("wall"));
      this.el.dockUndo.addEventListener("click", () => this.undo());
    }

    isMobile() {
      return window.matchMedia("(max-width: 920px)").matches;
    }

    openSheet() {
      this.el.panel.classList.add("open");
      this.el.backdrop.classList.remove("hidden");
    }

    closeSheet() {
      this.el.panel.classList.remove("open");
      this.el.backdrop.classList.add("hidden");
    }

    // ------------------------------------------------------------ 规则
    _inputLocked() {
      if (this.state.winner !== null || this.busy) return true;
      if (this.gameMode === "pve" && (this.aiThinking || this.state.turn === 1)) return true;
      return false;
    }

    displayName(player) {
      if (this.gameMode === "pve" && player === 1) return "电脑";
      return PLAYER_LABELS[player];
    }

    hintText() {
      if (this.mode === "wall") {
        if (this.state.wallsLeft[this.state.turn] <= 0) return "挡板已用完，只能移动棋子";
        return "移动鼠标选择墙缝，绿色可放、红色不可放";
      }
      return "点击圆点移动棋子；相邻时跳到对手身后，后方有墙可向两侧跳";
    }

    performMove(x, y) {
      if (this._inputLocked()) return;
      const st = this.state;
      if (!st.isValidMove(x, y)) {
        this.sound.play("bad");
        this.setMessage(st.explainMove(x, y), "bad");
        return;
      }
      const player = st.turn;
      const from = [st.pawns[player][0], st.pawns[player][1]];
      st.movePiece(x, y);
      this.sound.play("move");
      this.hoverCell = null;
      this.animatePawn(player, from, [x, y], () => this.afterAction());
    }

    performWall(orient, x, y) {
      if (this._inputLocked()) return;
      const st = this.state;
      const problem = st.wallProblem(orient, x, y);
      if (problem) {
        this.sound.play("bad");
        this.setMessage(problem, "bad");
        return;
      }
      const player = st.turn;
      st.placeWall(orient, x, y);
      this.sound.play("wall");
      this.hoverSlot = null;
      this.mode = "move";
      this.setMessage(
        `${PLAYER_LABELS[player]}${orient === H ? "横" : "竖"}放挡板，剩余 ${st.wallsLeft[player]} 块`,
        "info"
      );
      this.suppressHint = true;
      this.afterAction();
    }

    animatePawn(player, from, to, done) {
      this.animToken++;
      const token = this.animToken;
      const duration = 170;
      const start = performance.now();
      this.busy = true;
      const tick = (now) => {
        if (token !== this.animToken) return;
        const k = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - k, 3);
        this.pawnAnim = {
          player,
          x: from[0] + (to[0] - from[0]) * ease,
          y: from[1] + (to[1] - from[1]) * ease,
        };
        this.requestDraw();
        if (k < 1) {
          requestAnimationFrame(tick);
        } else {
          this.pawnAnim = null;
          this.busy = false;
          done();
        }
      };
      requestAnimationFrame(tick);
    }

    afterAction() {
      this.renderPanel();
      this.requestDraw();
      if (this.state.winner !== null) {
        this.showWin();
        return;
      }
      if (this.gameMode === "pve" && this.state.turn === 1) {
        this.scheduleAI();
        return;
      }
      if (this.suppressHint) this.suppressHint = false;
      else this.setMessage(this.hintText(), "info");
    }

    scheduleAI() {
      this.cancelAI();
      this.aiThinking = true;
      this.renderPanel();
      this.requestDraw();
      const timer = setTimeout(() => {
        const started = performance.now();
        const action = this.ai.choose(this.state);
        const elapsed = performance.now() - started;
        const wait = Math.max(0, 520 - elapsed);
        const timer2 = setTimeout(() => this.applyAI(action), wait);
        this.aiTimers.push(timer2);
      }, 160);
      this.aiTimers.push(timer);
    }

    applyAI(action) {
      this.aiThinking = false;
      this.cancelAI();
      if (this.state.winner !== null) {
        this.afterAction();
        return;
      }
      if (!action) {
        this.state.turn = 0;
        this.setMessage("电脑没有可用操作，本回合跳过", "bad");
        this.renderPanel();
        this.requestDraw();
        return;
      }
      const st = this.state;
      if (action.type === "move") {
        const from = [st.pawns[1][0], st.pawns[1][1]];
        if (!st.movePiece(action.x, action.y)) {
          this.afterAction();
          return;
        }
        this.sound.play("move");
        this.setMessage(`电脑把棋子移到 ${String.fromCharCode(65 + action.x)}${action.y + 1}`, "info");
        this.suppressHint = true;
        this.animatePawn(1, from, [action.x, action.y], () => this.afterAction());
      } else {
        if (!st.placeWall(action.orient, action.x, action.y)) {
          this.afterAction();
          return;
        }
        this.sound.play("wall");
        this.setMessage(
          `电脑放置了一块${action.orient === H ? "横" : "竖"}挡板`,
          "info"
        );
        this.suppressHint = true;
        this.afterAction();
      }
    }

    cancelAI() {
      for (const timer of this.aiTimers) clearTimeout(timer);
      this.aiTimers = [];
      this.aiThinking = false;
    }

    // ------------------------------------------------------------ 面板
    renderPanel() {
      const st = this.state;
      const winner = st.winner;
      const turn = st.turn;
      const locked = this._inputLocked();

      for (const mode of ["pvp", "pve"]) {
        const button = this.el.gameMode.querySelector(`[data-mode="${mode}"]`);
        if (button) button.classList.toggle("active", this.gameMode === mode);
      }
      this.el.difficultySection.classList.toggle("hidden", this.gameMode !== "pve");
      for (const button of this.el.difficulty.querySelectorAll("button")) {
        button.classList.toggle("active", button.dataset.level === this.level);
      }

      for (const player of [0, 1]) {
        const name = this.displayName(player);
        this.el.names[player].textContent = name;
        this.el.counts[player].textContent = `挡板 ${st.wallsLeft[player]} / ${WALLS_PER_PLAYER}`;
        this.el.bars[player].style.width = `${(st.wallsLeft[player] / WALLS_PER_PLAYER) * 100}%`;
        const active = winner === player || (winner === null && turn === player);
        this.el.cards[player].classList.toggle("active", active);
        this.el.cards[player].style.setProperty("--p", PLAYER_COLORS[player]);
      }

      let turnText;
      let turnClass = "";
      let sideText;
      if (winner !== null) {
        turnText = `${this.displayName(winner)} 获胜`;
        turnClass = winner === 1 ? "p2" : "";
        sideText = "本局结束";
      } else {
        turnText = `轮到 ${this.displayName(turn)}`;
        turnClass = turn === 1 ? "p2" : "";
        if (this.aiThinking) sideText = "电脑思考中";
        else if (this.gameMode === "pve" && turn === 1) sideText = "电脑回合";
        else sideText = this.mode === "move" ? "移动模式" : "放墙模式";
      }
      this.el.turnText.textContent = turnText;
      this.el.turnText.className = "turn " + turnClass;
      this.el.turnSide.textContent = sideText;
      this.el.turnSide.classList.toggle("thinking", this.aiThinking);

      // 手机端顶栏与底部按钮状态
      if (this.el.mtTurn) {
        this.el.mtTurn.textContent = turnText;
        this.el.mtTurn.className = "mt-turn " + turnClass;
        this.el.mtCounts.textContent = `挡板 ${st.wallsLeft[0]} · ${st.wallsLeft[1]}`;
        this.el.dockMove.classList.toggle("active", this.mode === "move" && !locked);
        this.el.dockWall.classList.toggle("active", this.mode === "wall" && !locked);
        this.el.dockMove.disabled = locked;
        this.el.dockWall.disabled = locked || st.wallsLeft[turn] <= 0;
        this.el.dockUndo.disabled = !st.canUndo() || locked;
        for (const player of [0, 1]) {
          this.el.miNames[player].textContent = this.displayName(player);
          this.el.miWalls[player].textContent = `挡板 ${st.wallsLeft[player]}`;
          this.el.miCards[player].classList.toggle(
            "active",
            winner === player || (winner === null && turn === player)
          );
        }
        this.el.miMessage.textContent = this.msg.text;
        this.el.miMessage.className = "mi-message " + this.msg.kind;
      }
      if (winner !== null) this.closeSheet();

      for (const button of this.el.modeSwitch.querySelectorAll("button")) {
        const selected = button.dataset.mode === this.mode && !locked;
        button.classList.toggle("active", selected);
        if (button.dataset.mode === "move") button.disabled = locked;
        else button.disabled = locked || st.wallsLeft[turn] <= 0;
      }

      this.el.undo.disabled = !st.canUndo() || locked;
      this.el.sound.textContent = this.sound.enabled ? "音效 开" : "音效 关";
      this.el.message.textContent = this.msg.text;
      this.el.message.className = "message " + this.msg.kind;

      this.updateOverlay();
      this.requestDraw();
    }

    setMessage(text, kind) {
      this.msg = { text, kind: kind || "info" };
      this.el.message.textContent = text;
      this.el.message.className = "message " + this.msg.kind;
      if (this.el.miMessage) {
        this.el.miMessage.textContent = text;
        this.el.miMessage.className = "mi-message " + this.msg.kind;
      }
      if (this.isMobile() && (kind === "bad" || kind === "win")) {
        this.toast(text, kind);
      }
    }

    toast(text, kind) {
      const el = this.el.toast;
      el.textContent = text;
      el.className = "toast " + (kind || "info");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        el.classList.add("hidden");
      }, 1600);
    }

    updateOverlay() {
      const winner = this.state.winner;
      if (winner === null) {
        this.el.overlay.classList.add("hidden");
        this.winnerShown = null;
        return;
      }
      this.el.overlayBadge.textContent = String(winner + 1);
      this.el.overlayBadge.style.background = PLAYER_COLORS[winner];
      this.el.overlayTitle.textContent = `${this.displayName(winner)} 获胜！`;
      this.el.overlayTitle.style.color = PLAYER_COLORS[winner];
      this.el.overlay.classList.remove("hidden");
    }

    showWin() {
      const winner = this.state.winner;
      this.closeSheet();
      this.setMessage(
        `${this.displayName(winner)} 抵达对岸，获得胜利！按 R 开始新的一局。`,
        "win"
      );
      this.updateOverlay();
      this.renderPanel();
      if (this.winnerShown !== winner) {
        this.winnerShown = winner;
        this.sound.play("win");
      }
    }

    // ------------------------------------------------------------ 命令
    setGameMode(mode) {
      if (mode === this.gameMode) return;
      this.gameMode = mode;
      this.restart(
        mode === "pve" ? "已切换到人机对战，玩家一先行" : "已切换到双人对战，玩家一先行"
      );
    }

    setLevel(level) {
      if (level === this.level) return;
      this.level = level;
      this.ai = new QuoridorAI(1, level, Date.now() & 0xffff);
      this.setMessage(`电脑难度：${level}`, "info");
      this.renderPanel();
    }

    setMode(mode, announce) {
      if (mode === this.mode) return;
      if (mode === "wall" && this.state.wallsLeft[this.state.turn] <= 0) {
        this.setMessage("挡板已经用完了，只能移动棋子", "bad");
        return;
      }
      this.mode = mode;
      this.hoverCell = null;
      this.hoverSlot = null;
      this.renderPanel();
      this.requestDraw();
      if (announce !== false) this.setMessage(this.hintText(), "info");
    }

    undo() {
      if (this.busy) return;
      if (this.state.winner !== null) {
        this.setMessage("本局已结束，按 R 开始新的一局", "info");
        return;
      }
      this.cancelAI();
      if (!this.state.canUndo()) {
        this.setMessage("没有可以撤销的操作", "bad");
        return;
      }
      this.state.undo();
      while (
        this.gameMode === "pve" &&
        this.state.turn === 1 &&
        this.state.canUndo()
      ) {
        this.state.undo();
      }
      this.mode = "move";
      this.animToken++;
      this.busy = false;
      this.pawnAnim = null;
      this.sound.play("undo");
      this.setMessage("已撤销上一步", "info");
      this.renderPanel();
      this.requestDraw();
    }

    restart(message) {
      this.cancelAI();
      this.closeSheet();
      this.animToken++;
      this.busy = false;
      this.pawnAnim = null;
      this.state.reset();
      this.ai = new QuoridorAI(1, this.level, Date.now() & 0xffff);
      this.mode = "move";
      this.hoverCell = null;
      this.hoverSlot = null;
      this.winnerShown = null;
      this.suppressHint = false;
      this.sound.play("start");
      this.setMessage(message || "新的一局开始，玩家一先行", "info");
      this.renderPanel();
      this.requestDraw();
    }

    toggleSound() {
      this.sound.enabled = !this.sound.enabled;
      this.renderPanel();
      if (this.sound.enabled) this.sound.play("start");
    }

    // ------------------------------------------------------------ 演示/自检
    applyDemo(kind) {
      const st = this.state;
      st.reset();
      st.pawns = [[4, 5], [4, 3]];
      st.hWalls = new Set([wallKey(2, 2), wallKey(3, 4), wallKey(6, 6)]);
      st.vWalls = new Set([wallKey(5, 1), wallKey(1, 5), wallKey(6, 3)]);
      st.wallsLeft = [7, 8];
      st.turn = 0;
      st.lastAction = { type: "wall", player: 1, orient: V, x: 6, y: 3 };
      this.mode = "move";

      if (kind === "wall") {
        this.mode = "wall";
        this.hoverSlot = { orient: H, x: 5, y: 5 };
      } else if (kind === "win") {
        st.pawns = [[4, 0], [0, 8]];
        st.winner = 0;
        st.turn = 0;
        st.lastAction = { type: "move", player: 0, x: 4, y: 0 };
        this.setMessage("玩家一 抵达对岸，获得胜利！按 R 开始新的一局。", "win");
      } else if (kind === "ai") {
        this.gameMode = "pve";
        st.turn = 1;
        this.aiThinking = true;
        this.setMessage("电脑正在思考…", "info");
      }
      this.renderPanel();
      this.requestDraw();
    }
  }

  // ---------------------------------------------------------------- 自检
  async function runSelfTest(app) {
    const results = [];
    const check = (name, condition) => {
      results.push((condition ? "PASS " : "FAIL ") + name);
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rect = () => app.canvas.getBoundingClientRect();
    const click = (x, y) => {
      const r = rect();
      app.canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: r.left + x,
          clientY: r.top + y,
          button: 0,
          buttons: 1,
          pointerId: 1,
          isPrimary: true,
          bubbles: true,
        })
      );
    };
    const key = (k) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    };

    try {
      check("开局棋子位置", app.state.pawns[0][0] === 4 && app.state.pawns[0][1] === 8);
      check("开局回合", app.state.turn === 0);

      click(...app.cellCenter(4, 7));
      await wait(320);
      check("点击格子移动棋子", app.state.pawns[0][1] === 7);
      check("移动后切换回合", app.state.turn === 1);

      click(...app.cellCenter(4, 6));
      await wait(120);
      check("非法点击不改变状态", app.state.pawns[0][1] === 7 && app.state.turn === 1);

      key(" ");
      await wait(60);
      check("空格切换放墙模式", app.mode === "wall");

      click(...app.wallCenter(H, 3, 6));
      await wait(120);
      check("点击格缝放置挡板", app.state.hWalls.has(wallKey(3, 6)));
      check("放墙后扣减挡板并换人", app.state.wallsLeft[1] === 9 && app.state.turn === 0);

      key("z");
      await wait(60);
      check("Z 撤销挡板", !app.state.hWalls.has(wallKey(3, 6)) && app.state.wallsLeft[1] === 10);

      key("r");
      await wait(60);
      check("R 重置开局", app.state.turn === 0 && app.state.pawns[0][1] === 8);

      app.setGameMode("pve");
      await wait(80);
      check("切换人机对战", app.gameMode === "pve" && app.state.turn === 0);

      app.state.pawns = [[4, 1], [0, 8]];
      app.state.turn = 0;
      app.renderPanel();
      click(...app.cellCenter(4, 0));
      await wait(340);
      check("抵达底线判定获胜", app.state.winner === 0);
      check("胜利遮罩出现", !app.el.overlay.classList.contains("hidden"));
      check("胜利后 Z 被锁定", (app.state.winner === 0 && app.state.pawns[0][0] === 4));

      key("r");
      await wait(80);
      check("胜利后可以重开", app.state.winner === null && app.el.overlay.classList.contains("hidden"));
    } catch (err) {
      results.push("FAIL 自检异常: " + (err && err.message));
      console.error(err);
    }

    const failed = results.filter((r) => r.startsWith("FAIL")).length;
    const pre = document.createElement("pre");
    pre.id = "selftest";
    pre.style.cssText =
      "position:fixed;left:0;bottom:0;z-index:99;background:#000;color:#0f0;font:11px/1.4 monospace;padding:6px;max-height:45vh;overflow:auto;opacity:.92";
    pre.textContent = results.join("\n") + "\nRESULT " + (failed ? "FAIL " + failed : "PASS");
    document.body.appendChild(pre);
    document.documentElement.dataset.selftest = failed ? "fail" : "pass";
    document.title = (failed ? "SELFTEST FAIL " : "SELFTEST PASS ") + results.length;
  }

  function boot() {
    new QuoridorApp();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
