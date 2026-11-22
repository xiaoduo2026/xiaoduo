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

  const DEFAULT_SETTINGS = {
    music: true,
    musicVolume: 30,
    sfx: true,
    sfxVolume: 70,
  };

  class Sound {
    constructor(settings) {
      this.ctx = null;
      this.musicTimer = null;
      this.musicStep = 0;
      this.apply(settings);
    }

    apply(settings) {
      settings = settings || DEFAULT_SETTINGS;
      this.musicEnabled = !!settings.music;
      this.musicVolume = Math.max(0, Math.min(1, settings.musicVolume / 100));
      this.sfxEnabled = !!settings.sfx;
      this.sfxVolume = Math.max(0, Math.min(1, settings.sfxVolume / 100));
      if (!this.musicEnabled) this.stopMusic();
      else if (this.ctx) this.startMusic();
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

    unlock() {
      const ctx = this._ensure();
      if (ctx && this.musicEnabled) this.startMusic();
    }

    play(name) {
      if (!this.sfxEnabled || this.sfxVolume <= 0) return;
      const recipe = SOUND_RECIPES[name];
      if (!recipe) return;
      try {
        const ctx = this._ensure();
        if (!ctx) return;
        const now = ctx.currentTime + 0.01;
        for (const [freq, dur, vol, delay] of recipe) {
          this._tone(freq, dur, vol * this.sfxVolume, now + delay, "sine");
        }
      } catch (err) {
        // 浏览器限制自动播放时静默失败。
      }
    }

    _tone(freq, duration, volume, startAt, type) {
      const ctx = this.ctx;
      if (!ctx || volume <= 0) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.05);
    }

    startMusic() {
      if (!this.musicEnabled) return;
      const ctx = this._ensure();
      if (!ctx) return;
      if (this.musicTimer) return;
      const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
      const tick = () => {
        if (!this.musicEnabled) {
          this.musicTimer = null;
          return;
        }
        const now = ctx.currentTime + 0.05;
        const freq = scale[this.musicStep % scale.length];
        this._tone(freq, 1.8, 0.05 * this.musicVolume, now, "sine");
        if (this.musicStep % 4 === 0) {
          this._tone(freq / 2, 3.4, 0.035 * this.musicVolume, now, "triangle");
        }
        this.musicStep += 1;
        this.musicTimer = setTimeout(tick, 1900);
      };
      tick();
    }

    stopMusic() {
      if (this.musicTimer) {
        clearTimeout(this.musicTimer);
        this.musicTimer = null;
      }
    }
  }

  // ---------------------------------------------------------------- 应用
  class QuoridorApp {
    constructor() {
      this.wrap = document.getElementById("board-wrap");
      this.canvas = document.getElementById("board");
      this.ctx2d = this.canvas.getContext("2d");
      this.settings = this.loadSettings();
      this.sound = new Sound(this.settings);
      this.playerName = this.loadPlayerName();

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

      // 联机与比分
      this.onlineSession = null;
      this.onlineRole = null; // 'host' | 'guest'
      this.myPlayer = 0;
      this.onlineReady = false;
      this.opponentName = "对手";
      this.onlineCode = "";
      this.onlineStatusText = "未连接";
      this.onlineModalShown = false;
      this.scores = [0, 0];
      this.targetScore = 3;
      this.matchOver = false;
      this.rematch = { pending: false, requestSent: false };
      this.pendingMode = null;

      this.el = {
        overlay: document.getElementById("overlay"),
        overlayBadge: document.getElementById("overlay-badge"),
        overlayTitle: document.getElementById("overlay-title"),
        overlaySub: document.getElementById("overlay-sub"),
        overlayRestart: document.getElementById("overlay-restart"),
        toast: document.getElementById("toast"),
        panel: document.getElementById("panel"),
        backdrop: document.getElementById("sheet-backdrop"),
        sheetClose: document.getElementById("sheet-close"),
        settingsBtn: document.getElementById("settings-btn"),
        settingsBtnMobile: document.getElementById("settings-btn-mobile"),
        settingsModal: document.getElementById("settings-modal"),
        settingsClose: document.getElementById("settings-close"),
        settingMusic: document.getElementById("setting-music"),
        musicVolume: document.getElementById("music-volume"),
        musicVolumeLabel: document.getElementById("music-volume-label"),
        settingSfx: document.getElementById("setting-sfx"),
        sfxVolume: document.getElementById("sfx-volume"),
        sfxVolumeLabel: document.getElementById("sfx-volume-label"),
        settingsReset: document.getElementById("settings-reset"),
        leaveModal: document.getElementById("leave-modal"),
        leaveText: document.getElementById("leave-text"),
        leaveCancel: document.getElementById("leave-cancel"),
        leaveConfirm: document.getElementById("leave-confirm"),
        rematchModal: document.getElementById("rematch-modal"),
        rematchText: document.getElementById("rematch-text"),
        rematchAccept: document.getElementById("rematch-accept"),
        rematchDecline: document.getElementById("rematch-decline"),
        onlineModal: document.getElementById("online-modal"),
        onlineModalTitle: document.getElementById("online-modal-title"),
        onlineModalText: document.getElementById("online-modal-text"),
        onlineModalClose: document.getElementById("online-modal-close"),
        onlineSection: document.getElementById("online-section"),
        onlineSetup: document.getElementById("online-setup"),
        onlineRoom: document.getElementById("online-room"),
        onlineName: document.getElementById("online-name"),
        onlineHost: document.getElementById("online-host"),
        onlineJoinToggle: document.getElementById("online-join-toggle"),
        onlineJoinBox: document.getElementById("online-join-box"),
        onlineCodeInput: document.getElementById("online-code-input"),
        onlineJoin: document.getElementById("online-join"),
        onlineCodeBox: document.getElementById("online-code-box"),
        onlineCode: document.getElementById("online-code"),
        onlineCopy: document.getElementById("online-copy"),
        onlineTargetRow: document.getElementById("online-target-row"),
        onlineStatus: document.getElementById("online-status"),
        onlineOpponent: document.getElementById("online-opponent"),
        onlineLeave: document.getElementById("online-leave"),
        matchScore: document.getElementById("match-score"),
        match0: document.getElementById("match-0"),
        match1: document.getElementById("match-1"),
        matchTarget: document.getElementById("match-target"),
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

      this.el.onlineName.value = this.playerName;
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

    // ------------------------------------------------------------ 设置
    loadSettings() {
      const base = Object.assign({}, DEFAULT_SETTINGS);
      try {
        const raw = localStorage.getItem("quoridor.settings");
        if (raw) Object.assign(base, JSON.parse(raw));
      } catch (error) {
        // 忽略本地存储异常
      }
      return base;
    }

    saveSettings() {
      try {
        localStorage.setItem("quoridor.settings", JSON.stringify(this.settings));
      } catch (error) {
        // 忽略本地存储异常
      }
    }

    loadPlayerName() {
      try {
        return (localStorage.getItem("quoridor.name") || "我").slice(0, 8);
      } catch (error) {
        return "我";
      }
    }

    savePlayerName() {
      try {
        localStorage.setItem("quoridor.name", this.playerName);
      } catch (error) {
        // 忽略本地存储异常
      }
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
      this.sound.unlock();
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
      this.sound.unlock();
      if (event.key === "Escape") {
        if (!this.el.settingsModal.classList.contains("hidden")) {
          this.closeSettings();
          return;
        }
        if (!this.el.leaveModal.classList.contains("hidden")) {
          this.cancelLeaveOnline();
          return;
        }
      }
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
        if (this.gameMode === "online") {
          this.setMessage("联机模式请用面板里的“断开联机”退出", "info");
          return;
        }
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
        if (button) this.requestGameMode(button.dataset.mode);
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
      this.el.overlayRestart.addEventListener("click", () => this._overlayAction());

      // 设置
      this.el.settingsBtn.addEventListener("click", () => this.openSettings());
      this.el.settingsBtnMobile.addEventListener("click", () => this.openSettings());
      this.el.settingsClose.addEventListener("click", () => this.closeSettings());
      const applySettings = () => {
        this.settings.music = this.el.settingMusic.checked;
        this.settings.musicVolume = Number(this.el.musicVolume.value);
        this.settings.sfx = this.el.settingSfx.checked;
        this.settings.sfxVolume = Number(this.el.sfxVolume.value);
        this.el.musicVolumeLabel.textContent = `${this.settings.musicVolume}%`;
        this.el.sfxVolumeLabel.textContent = `${this.settings.sfxVolume}%`;
        this.sound.apply(this.settings);
        this.saveSettings();
        this.renderPanel();
      };
      this.el.settingMusic.addEventListener("change", applySettings);
      this.el.musicVolume.addEventListener("input", applySettings);
      this.el.settingSfx.addEventListener("change", applySettings);
      this.el.sfxVolume.addEventListener("input", applySettings);
      this.el.settingsReset.addEventListener("click", () => this.resetSettings());
      this.el.settingsModal.addEventListener("click", (event) => {
        if (event.target === this.el.settingsModal) this.closeSettings();
      });

      // 联机
      this.el.onlineName.addEventListener("input", () => {
        this.playerName = (this.el.onlineName.value || "").trim().slice(0, 8);
        this.savePlayerName();
      });
      this.el.onlineHost.addEventListener("click", () => this.createOnlineRoom());
      this.el.onlineJoinToggle.addEventListener("click", () => {
        this.el.onlineJoinBox.classList.toggle("hidden");
        if (!this.el.onlineJoinBox.classList.contains("hidden")) {
          this.el.onlineCodeInput.focus();
        }
      });
      this.el.onlineJoin.addEventListener("click", () => this.joinOnlineRoom());
      this.el.onlineCodeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.joinOnlineRoom();
      });
      this.el.onlineCopy.addEventListener("click", () => this.copyInviteCode());
      this.el.onlineLeave.addEventListener("click", () => this.requestLeaveOnline());
      this.el.leaveCancel.addEventListener("click", () => this.cancelLeaveOnline());
      this.el.leaveConfirm.addEventListener("click", () => this.confirmLeaveOnline());
      this.el.onlineTargetRow.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-target]");
        if (!button || this.onlineRole === "guest") return;
        this.targetScore = Number(button.dataset.target);
        this.renderPanel();
      });
      this.el.onlineModalClose.addEventListener("click", () => {
        this.el.onlineModal.classList.add("hidden");
      });
      this.el.rematchAccept.addEventListener("click", () => this.acceptRematch());
      this.el.rematchDecline.addEventListener("click", () => this.declineRematch());

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.sound.stopMusic();
        } else {
          if (this.settings.music) this.sound.startMusic();
          this.requestDraw();
        }
      });

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
      if (this.gameMode === "online") {
        if (!this.onlineReady || this.matchOver) return true;
        if (this.rematch.pending) return true;
        return this.state.turn !== this.myPlayer;
      }
      if (this.gameMode === "pve" && (this.aiThinking || this.state.turn === 1)) return true;
      return false;
    }

    displayName(player) {
      if (this.gameMode === "online") {
        if (player === this.myPlayer) return this.playerName || "我";
        return this.opponentName || "对手";
      }
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
      if (this.gameMode === "online" && this.myPlayer === 1) {
        this.requestOnlineAction({ type: "move", x, y });
        return;
      }
      const player = st.turn;
      const from = [st.pawns[player][0], st.pawns[player][1]];
      st.movePiece(x, y);
      this.sound.play("move");
      this.hoverCell = null;
      if (this.gameMode === "online") {
        this.afterAction();
        return;
      }
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
      if (this.gameMode === "online" && this.myPlayer === 1) {
        this.requestOnlineAction({ type: "wall", orient, x, y });
        return;
      }
      const player = st.turn;
      st.placeWall(orient, x, y);
      this.sound.play("wall");
      this.hoverSlot = null;
      this.mode = "move";
      this.setMessage(
        `${this.displayName(player)}${orient === H ? "横" : "竖"}放挡板，剩余 ${st.wallsLeft[player]} 块`,
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
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(fallback);
        this.pawnAnim = null;
        this.busy = false;
        done();
      };
      // 后台标签页可能暂停 rAF，用定时器兜底，避免一直卡在“动画中”。
      const fallback = setTimeout(finish, duration + 80);
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
          finish();
        }
      };
      requestAnimationFrame(tick);
    }

    afterAction() {
      this.renderPanel();
      this.requestDraw();
      if (this.gameMode === "online") {
        if (this.myPlayer === 0 && this.state.winner !== null) {
          this.updateOnlineScores(this.state.winner);
        }
        if (this.state.winner !== null) {
          if (this.myPlayer === 0) this.broadcastOnlineState();
          this.showWin();
          return;
        }
        if (this.myPlayer === 0) this.broadcastOnlineState();
        this.setMessage(
          this.state.turn === this.myPlayer ? "轮到你走，请选择移动或放墙" : "已发送，等待对方…",
          "info"
        );
        return;
      }
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

      for (const mode of ["pvp", "online", "pve"]) {
        const button = this.el.gameMode.querySelector(`[data-mode="${mode}"]`);
        if (button) button.classList.toggle("active", this.gameMode === mode);
      }
      this.el.difficultySection.classList.toggle("hidden", this.gameMode !== "pve");
      for (const button of this.el.difficulty.querySelectorAll("button")) {
        button.classList.toggle("active", button.dataset.level === this.level);
      }
      this.renderOnlinePanel();

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
      if (this.gameMode === "online" && !this.onlineReady) {
        turnText = "联机对战";
        sideText = this.onlineStatusText || "未连接";
      } else if (winner !== null) {
        turnText = `${this.displayName(winner)} 获胜`;
        turnClass = winner === 1 ? "p2" : "";
        sideText = this.matchOver ? "比赛结束" : "本局结束";
      } else {
        turnText = `轮到 ${this.displayName(turn)}`;
        turnClass = turn === 1 ? "p2" : "";
        if (this.gameMode === "online") {
          sideText = turn === this.myPlayer ? "你的回合" : "等待对方";
        } else if (this.aiThinking) sideText = "电脑思考中";
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
        this.el.mtCounts.textContent =
          this.gameMode === "online"
            ? `比分 ${this.scores[0]}:${this.scores[1]} · 挡板 ${st.wallsLeft[0]}:${st.wallsLeft[1]}`
            : `挡板 ${st.wallsLeft[0]} · ${st.wallsLeft[1]}`;
        this.el.dockMove.classList.toggle("active", this.mode === "move" && !locked);
        this.el.dockWall.classList.toggle("active", this.mode === "wall" && !locked);
        this.el.dockMove.disabled = locked;
        this.el.dockWall.disabled = locked || st.wallsLeft[turn] <= 0;
        this.el.dockUndo.disabled = this.gameMode === "online" || !st.canUndo() || locked;
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

      this.el.undo.disabled = this.gameMode === "online" || !st.canUndo() || locked;
      this.el.restart.disabled = this.gameMode === "online" && this.matchOver;
      this.el.sound.textContent = this.settings.sfx ? "音效 开" : "音效 关";
      this.el.matchScore.classList.toggle("hidden", this.gameMode !== "online");
      this.el.match0.textContent = String(this.scores[0]);
      this.el.match1.textContent = String(this.scores[1]);
      this.el.matchTarget.textContent = `先到 ${this.targetScore} 分`;
      this.el.message.textContent = this.msg.text;
      this.el.message.className = "message " + this.msg.kind;

      this.updateOverlay();
      this.requestDraw();
    }

    renderOnlinePanel() {
      const online = this.gameMode === "online";
      this.el.onlineSection.classList.toggle("hidden", !online);
      if (!online) return;

      const connected = this.onlineReady;
      this.el.onlineSetup.classList.toggle("hidden", connected);
      this.el.onlineRoom.classList.toggle("hidden", !connected);
      this.el.onlineCodeBox.classList.toggle("hidden", !this.onlineCode || connected);
      this.el.onlineCode.textContent = this.onlineCode || "------";
      this.el.onlineStatus.textContent = this.onlineStatusText || "未连接";
      for (const button of this.el.onlineTargetRow.querySelectorAll("button")) {
        button.classList.toggle("active", Number(button.dataset.target) === this.targetScore);
        button.disabled = this.onlineRole === "guest" || connected;
      }
      if (connected) {
        this.el.onlineOpponent.textContent = this.opponentName || "对手";
      }
    }

    openSettings() {
      this.el.settingMusic.checked = this.settings.music;
      this.el.musicVolume.value = String(this.settings.musicVolume);
      this.el.musicVolumeLabel.textContent = `${this.settings.musicVolume}%`;
      this.el.settingSfx.checked = this.settings.sfx;
      this.el.sfxVolume.value = String(this.settings.sfxVolume);
      this.el.sfxVolumeLabel.textContent = `${this.settings.sfxVolume}%`;
      this.el.settingsModal.classList.remove("hidden");
      this.sound.unlock();
    }

    closeSettings() {
      this.el.settingsModal.classList.add("hidden");
    }

    resetSettings() {
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
      this.sound.apply(this.settings);
      this.saveSettings();
      this.openSettings();
      this.renderPanel();
    }

    // ------------------------------------------------------------ 联机
    _ensureOnlineSession() {
      if (!window.QuoridorOnline) return null;
      if (this.onlineSession) this.onlineSession.close();
      this.onlineSession = new window.QuoridorOnline.OnlineSession({
        onOpen: () => this._onOnlineOpen(),
        onMessage: (message) => this._onOnlineMessage(message),
        onClose: () => this._onOnlineClose(),
        onStatus: (status) => this._onOnlineStatus(status),
      });
      return this.onlineSession;
    }

    async createOnlineRoom() {
      if (this.gameMode !== "online") this.setGameMode("online");
      if (!window.Peer) {
        this._showOnlineModal("联机不可用", "联机组件没有加载成功，请刷新页面或换一个网络。");
        return;
      }
      this.playerName = (this.el.onlineName.value || "").trim().slice(0, 8) || "我";
      this.el.onlineName.value = this.playerName;
      this.savePlayerName();
      this.onlineRole = "host";
      this.myPlayer = 0;
      this.onlineReady = false;
      this.opponentName = "对手";
      this.onlineCode = "";
      this.scores = [0, 0];
      this.matchOver = false;
      this.state.reset();
      this.mode = "move";
      this.winnerShown = null;
      this.updateOverlay();
      this.onlineStatusText = "正在创建邀请码…";
      this.renderPanel();
      const session = this._ensureOnlineSession();
      if (!session) return;
      try {
        const code = await session.host();
        if (this.gameMode !== "online" || this.onlineSession !== session) return;
        this.onlineCode = code;
        this.onlineStatusText = "等待对方加入…";
        this.setMessage("邀请码已生成，复制发给好友", "info");
      } catch (error) {
        if (this.onlineSession !== session) return;
        this.onlineStatusText = error.message || "创建失败";
        this._showOnlineModal("创建房间失败", this.onlineStatusText);
      }
      this.renderPanel();
    }

    async joinOnlineRoom() {
      const code = String(this.el.onlineCodeInput.value || "").trim().toLowerCase();
      if (!code) {
        this.setMessage("请先粘贴邀请码", "bad");
        return;
      }
      if (this.gameMode !== "online") this.setGameMode("online");
      this.playerName = (this.el.onlineName.value || "").trim().slice(0, 8) || "我";
      this.el.onlineName.value = this.playerName;
      this.savePlayerName();
      this.onlineRole = "guest";
      this.myPlayer = 1;
      this.onlineReady = false;
      this.opponentName = "房主";
      this.onlineCode = "";
      this.scores = [0, 0];
      this.matchOver = false;
      this.state.reset();
      this.mode = "move";
      this.winnerShown = null;
      this.updateOverlay();
      this.onlineStatusText = "正在加入房间…";
      this.renderPanel();
      const session = this._ensureOnlineSession();
      if (!session) return;
      try {
        await session.join(code);
        if (this.gameMode !== "online" || this.onlineSession !== session) return;
        this.onlineStatusText = "已连接，等待房主开始…";
      } catch (error) {
        if (this.onlineSession !== session) return;
        this.onlineStatusText = error.message || "加入失败";
        this._showOnlineModal("加入失败", this.onlineStatusText);
      }
      this.renderPanel();
    }

    _onOnlineOpen() {
      if (this.onlineRole === "guest") {
        this.onlineStatusText = "已连接，等待房主开始…";
        if (this.onlineSession) {
          this.onlineSession.send({ t: "hello", name: this.playerName });
        }
      } else {
        this.onlineStatusText = "对方已连接，等待握手…";
      }
      this.renderPanel();
    }

    _onOnlineStatus(status) {
      if (!status) return;
      this.onlineStatusText = status.text || this.onlineStatusText;
      if (status.type === "waiting" && status.code) this.onlineCode = status.code;
      if (status.type === "error") {
        this._showOnlineModal("联机错误", status.text || "联机发生错误");
      }
      this.renderPanel();
    }

    _onOnlineClose() {
      if (this.gameMode !== "online") return;
      this.onlineReady = false;
      this.busy = false;
      this.onlineStatusText = "连接已断开";
      this._showOnlineModal("连接已断开", "对方已经离开，或网络中断。可以断开联机后重新创建房间。");
      this.renderPanel();
    }

    _showOnlineModal(title, text) {
      this.el.onlineModalTitle.textContent = title;
      this.el.onlineModalText.textContent = text;
      this.el.onlineModal.classList.remove("hidden");
    }

    copyInviteCode() {
      const code = this.onlineCode;
      if (!code) return;
      const done = () => {
        this.setMessage("邀请码已复制，发给好友即可", "ok");
        this.toast("邀请码已复制", "ok");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(() => this._fallbackCopy(code, done));
      } else {
        this._fallbackCopy(code, done);
      }
    }

    _fallbackCopy(text, done) {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
        done();
      } catch (error) {
        this.setMessage("复制失败，请手动选择邀请码", "bad");
      }
      document.body.removeChild(input);
    }

    requestLeaveOnline() {
      if (this.gameMode !== "online") return;
      this.pendingMode = null;
      this.el.leaveText.textContent =
        "离开后当前比分和棋局不会保留，需要重新创建邀请码。";
      this.el.leaveModal.classList.remove("hidden");
    }

    cancelLeaveOnline() {
      this.pendingMode = null;
      this.el.leaveModal.classList.add("hidden");
    }

    confirmLeaveOnline() {
      const pending = this.pendingMode;
      this.pendingMode = null;
      this.el.leaveModal.classList.add("hidden");
      this.leaveOnline(false);
      if (pending && pending !== "pvp") this.setGameMode(pending);
    }

    leaveOnline(silent) {
      if (this.onlineSession) {
        this.onlineSession.close();
        this.onlineSession = null;
      }
      if (this.onlineRequestTimer) {
        clearTimeout(this.onlineRequestTimer);
        this.onlineRequestTimer = null;
      }
      this.onlineRole = null;
      this.myPlayer = 0;
      this.onlineReady = false;
      this.onlineCode = "";
      this.opponentName = "对手";
      this.onlineStatusText = "未连接";
      this.scores = [0, 0];
      this.matchOver = false;
      this.busy = false;
      this.rematch = { pending: false, requestSent: false };
      this.pendingMode = null;
      this.state.reset();
      this.el.rematchModal.classList.add("hidden");
      this.el.onlineModal.classList.add("hidden");
      this.el.leaveModal.classList.add("hidden");
      if (!silent) {
        this.gameMode = "pvp";
        this.setMessage("已断开联机，回到本机双人对战", "info");
      }
      this.renderPanel();
      this.requestDraw();
    }

    _onOnlineMessage(message) {
      if (!message || typeof message.t !== "string") return;
      switch (message.t) {
        case "hello":
          this._startAsHost(message);
          break;
        case "welcome":
          this._onWelcome(message);
          break;
        case "state":
          this._applyOnlineState(message);
          break;
        case "request":
          this._handleGuestAction(message.action);
          break;
        case "reject":
          this.busy = false;
          if (this.onlineRequestTimer) clearTimeout(this.onlineRequestTimer);
          this.setMessage(message.text || "动作没有通过校验", "bad");
          this.renderPanel();
          break;
        case "rematch-request":
          this._onRematchRequest();
          break;
        case "rematch-accept":
          if (this.onlineRole === "host" && this.rematch.pending) {
            this._resetRoundAndBroadcast();
          }
          break;
        case "rematch-decline":
          this.rematch = { pending: false, requestSent: false };
          this.setMessage("对方拒绝了重开请求", "info");
          this.renderPanel();
          break;
        case "leave":
          this._onOnlineClose();
          break;
        default:
          break;
      }
    }

    _startAsHost(message) {
      if (this.onlineRole !== "host" || this.onlineReady || !this.onlineSession) return;
      this.onlineReady = true;
      const guestName =
        message && typeof message.name === "string"
          ? message.name.trim().slice(0, 8)
          : "";
      this.opponentName = guestName || "对手";
      this.scores = [0, 0];
      this.matchOver = false;
      this.state.reset();
      this.mode = "move";
      this.busy = false;
      this.winnerShown = null;
      this.onlineStatusText = "已连接";
      this.onlineSession.send({
        t: "welcome",
        targetScore: this.targetScore,
        opponent: this.playerName || "房主",
        state: this.serializeState(this.state),
        scores: this.scores,
      });
      this.updateOverlay();
      this.setMessage("已连接，你先走", "info");
      this.renderPanel();
      this.requestDraw();
    }

    _onWelcome(message) {
      if (this.onlineRole !== "guest") return;
      this.targetScore = Number(message.targetScore) || 3;
      this.opponentName = message.opponent || "房主";
      this.myPlayer = 1;
      this.onlineReady = true;
      this.scores = Array.isArray(message.scores) ? message.scores.slice(0, 2) : [0, 0];
      this.matchOver = false;
      this.busy = false;
      this.winnerShown = null;
      this.state = this.deserializeState(message.state);
      this.onlineStatusText = "已连接";
      this.setMessage("已连接，等待房主走棋", "info");
      this.updateOverlay();
      this.renderPanel();
      this.requestDraw();
    }

    _handleGuestAction(action) {
      if (this.myPlayer !== 0 || !this.onlineReady || !action) return;
      const st = this.state;
      if (st.winner !== null || st.turn !== 1) {
        this.onlineSession.send({ t: "reject", text: "还没轮到你" });
        return;
      }
      if (action.type === "move") {
        if (!st.isValidMove(action.x, action.y)) {
          this.onlineSession.send({ t: "reject", text: "走法不合法" });
          return;
        }
        st.movePiece(action.x, action.y);
        this.sound.play("move");
        this.hoverCell = null;
        this.afterAction();
      } else if (action.type === "wall") {
        if (st.wallProblem(action.orient, action.x, action.y)) {
          this.onlineSession.send({ t: "reject", text: "放墙位置不合法" });
          return;
        }
        st.placeWall(action.orient, action.x, action.y);
        this.sound.play("wall");
        this.suppressHint = true;
        this.afterAction();
      }
    }

    requestOnlineAction(action) {
      if (!this.onlineSession || !this.onlineReady) return;
      this.busy = true;
      this.setMessage("已发送，等待房主确认…", "info");
      this.renderPanel();
      this.onlineSession.send({ t: "request", action });
      if (this.onlineRequestTimer) clearTimeout(this.onlineRequestTimer);
      this.onlineRequestTimer = setTimeout(() => {
        if (this.busy) {
          this.busy = false;
          this.setMessage("对方没有响应，请重试", "bad");
          this.renderPanel();
        }
      }, 10000);
    }

    serializeState(st) {
      return {
        pawns: [[st.pawns[0][0], st.pawns[0][1]], [st.pawns[1][0], st.pawns[1][1]]],
        h: Array.from(st.hWalls),
        v: Array.from(st.vWalls),
        left: [st.wallsLeft[0], st.wallsLeft[1]],
        turn: st.turn,
        winner: st.winner,
        last: st.lastAction,
        count: st.turnCount,
      };
    }

    deserializeState(data) {
      const st = new GameState();
      st.pawns = [[data.pawns[0][0], data.pawns[0][1]], [data.pawns[1][0], data.pawns[1][1]]];
      st.hWalls = new Set(data.h || []);
      st.vWalls = new Set(data.v || []);
      st.wallsLeft = [data.left[0], data.left[1]];
      st.turn = data.turn;
      st.winner = data.winner;
      st.lastAction = data.last || null;
      st.turnCount = data.count || 0;
      st.history = [];
      return st;
    }

    broadcastOnlineState(extra) {
      if (!this.onlineSession || this.myPlayer !== 0 || !this.onlineReady) return;
      const last = this.state.lastAction;
      this.onlineSession.send(
        Object.assign(
          {
            t: "state",
            state: this.serializeState(this.state),
            scores: this.scores.slice(),
            targetScore: this.targetScore,
            matchOver: this.matchOver,
            sound: last ? last.type : null,
          },
          extra || {}
        )
      );
    }

    _applyOnlineState(message) {
      if (this.myPlayer !== 1) return;
      const previous = this.state;
      this.state = this.deserializeState(message.state);
      this.scores = Array.isArray(message.scores) ? message.scores.slice(0, 2) : this.scores;
      this.targetScore = Number(message.targetScore) || this.targetScore;
      this.matchOver = !!message.matchOver;
      this.busy = false;
      if (this.onlineRequestTimer) {
        clearTimeout(this.onlineRequestTimer);
        this.onlineRequestTimer = null;
      }
      this.rematch = { pending: false, requestSent: false };
      this.el.rematchModal.classList.add("hidden");
      this.animToken++;
      this.pawnAnim = null;
      this.hoverCell = null;
      this.hoverSlot = null;
      this.winnerShown = null;
      this.updateOverlay();
      this.requestDraw();
      this.renderPanel();
      if (this.state.winner !== null) {
        this.showWin();
      } else {
        if (message.sound === "move" || message.sound === "wall") {
          this.sound.play(message.sound);
        }
        this.setMessage(
          this.state.turn === this.myPlayer ? "轮到你走" : "等待对方走棋",
          "info"
        );
      }
    }

    updateOnlineScores(winner) {
      if (this.matchOver) return;
      this.scores[winner] += 1;
      if (this.scores[winner] >= this.targetScore) this.matchOver = true;
    }

    requestRematch() {
      if (this.gameMode !== "online" || !this.onlineReady || this.matchOver) return;
      if (this.rematch.pending) return;
      this.rematch.pending = true;
      this.rematch.requestSent = true;
      this.onlineSession.send({ t: "rematch-request" });
      this.setMessage("已请求重开，等待对方同意…", "info");
      this.renderPanel();
    }

    _onRematchRequest() {
      if (!this.onlineReady) return;
      if (this.rematch.requestSent) {
        this.acceptRematch();
        return;
      }
      this.rematch.pending = true;
      this.el.rematchText.textContent = "对方请求重新开始本局，是否同意？";
      this.el.rematchModal.classList.remove("hidden");
      this.renderPanel();
    }

    acceptRematch() {
      this.el.rematchModal.classList.add("hidden");
      if (!this.onlineSession) return;
      this.onlineSession.send({ t: "rematch-accept" });
      this.rematch = { pending: false, requestSent: false };
      if (this.onlineRole === "host") {
        this._resetRoundAndBroadcast();
      } else {
        this.setMessage("已同意，等待房主开始…", "info");
        this.renderPanel();
      }
    }

    declineRematch() {
      this.el.rematchModal.classList.add("hidden");
      this.rematch = { pending: false, requestSent: false };
      if (this.onlineSession) this.onlineSession.send({ t: "rematch-decline" });
      this.setMessage("已拒绝重开", "info");
      this.renderPanel();
    }

    _resetRoundAndBroadcast() {
      this.state.reset();
      this.matchOver = false;
      this.winnerShown = null;
      this.busy = false;
      this.mode = "move";
      this.rematch = { pending: false, requestSent: false };
      this.el.rematchModal.classList.add("hidden");
      this.updateOverlay();
      this.broadcastOnlineState({ reset: true });
      this.setMessage("新的一局开始，你先走", "info");
      this.renderPanel();
      this.requestDraw();
    }

    _overlayAction() {
      if (this.gameMode === "online") {
        if (!this.matchOver) this.requestRematch();
        return;
      }
      this.restart();
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
      this.el.overlayTitle.style.color = PLAYER_COLORS[winner];
      if (this.gameMode === "online") {
        this.el.overlayTitle.textContent = this.matchOver
          ? `${this.displayName(winner)} 赢得比赛！`
          : `${this.displayName(winner)} 本局获胜！`;
        this.el.overlaySub.textContent = this.matchOver
          ? `最终比分 ${this.scores[0]} : ${this.scores[1]}`
          : `比分 ${this.scores[0]} : ${this.scores[1]} · 先到 ${this.targetScore} 分`;
        this.el.overlayRestart.textContent = this.matchOver ? "比赛结束" : "下一局（需双方同意）";
        this.el.overlayRestart.disabled = this.matchOver || !this.onlineReady;
      } else {
        this.el.overlayTitle.textContent = `${this.displayName(winner)} 获胜！`;
        this.el.overlaySub.textContent = "率先抵达对岸底线";
        this.el.overlayRestart.textContent = "再来一局 R";
        this.el.overlayRestart.disabled = false;
      }
      this.el.overlay.classList.remove("hidden");
    }

    showWin() {
      const winner = this.state.winner;
      this.closeSheet();
      if (this.gameMode === "online") {
        this.setMessage(
          this.matchOver
            ? `${this.displayName(winner)} 赢得比赛，比分 ${this.scores[0]} : ${this.scores[1]}。`
            : `${this.displayName(winner)} 赢下本局，比分 ${this.scores[0]} : ${this.scores[1]}。`,
          "win"
        );
      } else {
        this.setMessage(
          `${this.displayName(winner)} 抵达对岸，获得胜利！按 R 开始新的一局。`,
          "win"
        );
      }
      this.updateOverlay();
      this.renderPanel();
      if (this.winnerShown !== winner) {
        this.winnerShown = winner;
        this.sound.play("win");
      }
    }

    // ------------------------------------------------------------ 命令
    requestGameMode(mode) {
      if (mode === this.gameMode) return;
      if (
        this.gameMode === "online" &&
        mode !== "online" &&
        (this.onlineReady || this.onlineRole)
      ) {
        this.pendingMode = mode;
        this.el.leaveText.textContent =
          mode === "pve"
            ? "离开联机会结束当前对局，并切换到人机对战。"
            : "离开联机会结束当前对局，并回到本机双人对战。";
        this.el.leaveModal.classList.remove("hidden");
        return;
      }
      this.setGameMode(mode);
    }

    setGameMode(mode) {
      if (mode === this.gameMode) return;
      if (this.gameMode === "online") this.leaveOnline(true);
      this.gameMode = mode;
      this.cancelAI();
      this.animToken++;
      this.busy = false;
      this.pawnAnim = null;
      this.scores = [0, 0];
      this.matchOver = false;
      this.onlineReady = false;
      this.rematch = { pending: false, requestSent: false };
      this.state.reset();
      this.mode = "move";
      this.winnerShown = null;
      this.el.onlineModal.classList.add("hidden");
      this.updateOverlay();
      this.closeSheet();

      if (mode === "online") {
        this.onlineRole = null;
        this.onlineCode = "";
        this.onlineStatusText = "未连接";
        this.setMessage("创建邀请码，或输入好友的邀请码加入", "info");
        this.renderPanel();
        this.requestDraw();
        return;
      }

      this.ai = new QuoridorAI(1, this.level, Date.now() & 0xffff);
      this.setMessage(
        mode === "pve" ? "已切换到人机对战，玩家一先行" : "已切换到双人对战，玩家一先行",
        "info"
      );
      this.renderPanel();
      this.requestDraw();
    }

    setLevel(level) {
      if (level === this.level || this.gameMode === "online") return;
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
      if (this.gameMode === "online") {
        this.setMessage("联机模式不允许悔棋", "bad");
        return;
      }
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
      if (this.gameMode === "online") {
        if (this.matchOver) return;
        this.requestRematch();
        return;
      }
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
      this.settings.sfx = !this.settings.sfx;
      this.sound.apply(this.settings);
      this.saveSettings();
      this.renderPanel();
      if (this.settings.sfx) this.sound.play("start");
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
      } else if (kind === "online") {
        this.gameMode = "online";
        this.onlineRole = null;
        this.onlineReady = false;
        this.onlineStatusText = "未连接";
        this.onlineCode = "";
        this.scores = [0, 0];
        this.matchOver = false;
        this.setMessage("创建邀请码，或输入好友的邀请码加入", "info");
      } else if (kind === "room") {
        this.gameMode = "online";
        this.onlineRole = "host";
        this.myPlayer = 0;
        this.onlineReady = true;
        this.opponentName = "好友";
        this.onlineCode = "q9-demo88";
        this.onlineStatusText = "已连接";
        this.scores = [1, 0];
        this.targetScore = 3;
        this.matchOver = false;
        this.setMessage("轮到你走，请选择移动或放墙", "info");
      } else if (kind === "settings") {
        this.openSettings();
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

      click(...app.wallCenter(H, 3, 5));
      await wait(120);
      check("点击格缝放置挡板", app.state.hWalls.has(wallKey(3, 5)));
      check("放墙后扣减挡板并换人", app.state.wallsLeft[1] === 9 && app.state.turn === 0);

      key("z");
      await wait(60);
      check("Z 撤销挡板", !app.state.hWalls.has(wallKey(3, 5)) && app.state.wallsLeft[1] === 10);

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

