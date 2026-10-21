// Royalty High — server (Express + Socket.IO).
// Everyone who opens the site is automatically logged in as "poumsday"
// unless they log out or log in as someone else.

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { Game } = require("./game");
const { botStep } = require("./bot");

const PORT = process.env.PORT || 3000;
const DEFAULT_USER = process.env.DEFAULT_USER || "poumsday";
const ADMIN = "poumsday";
const DB_FILE = path.join(__dirname, "data", "db.json");
const MIN_GAMES = { alltime: 15, monthly: 10 };

// ------------------------------------------------------------------ database
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (d = new Date()) => d.toLocaleString("en-US", { month: "long", year: "numeric" });
const defaultSettings = () => ({ reveal_attacked: false, time_limit: 0 });

function seedDb() {
  // Numbers taken from the live leaderboard (all-time and October 2026).
  const players = [
    ["poumsday", "poumsday", [348, 232, 209], [46, 26, 26]],
    ["royaltyhigh", "RoyaltyHigh", [235, 155, 159], [53, 43, 19]],
    ["ace", "Ace", [13, 11, 5], null],
    ["kevinyw", "kevinyw", [15, 18, 14], null],
    ["hannahiscute", "hannahiscute", [165, 211, 182], [10, 16, 16]],
    ["bbmodred123", "Bbmodred123", [48, 93, 35], [11, 32, 7]],
    ["poum", "poum", [5, 20, 10], null],
    ["bbmodred", "Bbmodred", [18, 79, 8], null],
  ];
  const db = { users: {}, seed: { alltime: {}, monthly: { month: "2026-10", data: {} } }, games: [] };
  for (const [u, name, all, mon] of players) {
    db.users[u] = { username: u, display_name: name, created: Date.now(), settings: defaultSettings() };
    db.seed.alltime[u] = { w: all[0], l: all[1], t: all[2] };
    if (mon) db.seed.monthly.data[u] = { w: mon[0], l: mon[1], t: mon[2] };
  }
  return db;
}
// Prank settings travel with the request that creates/joins the next game (from the secret panel)
// and are used for that one game only — nothing is stored in cookies or on the server.
function cleanPrank(p) {
  if (!p || typeof p !== "object") return null;
  const fail = Math.round(Number(p.fail));
  const cap = p.royal_cap === undefined || p.royal_cap === null ? 7 : Math.round(Number(p.royal_cap));
  return {
    failN: fail < 0 ? Infinity : Math.max(0, Math.min(50, fail || 0)),
    margin: p.margin === "max" ? "max" : Math.max(1, Math.min(50, Math.round(Number(p.margin) || 1))),
    royalCap: !Number.isFinite(cap) ? 7 : cap < 0 ? -1 : Math.min(14, cap), // -1 = no limit
  };
}

let db;
try {
  db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
} catch {
  db = seedDb();
  saveDb();
}
function saveDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
}

const norm = (s) => String(s || "").trim().toLowerCase();
const validName = (s) => /^[A-Za-z0-9_.-]{2,20}$/.test(String(s || "").trim());
const displayName = (u) => db.users[u]?.display_name || u;

function ensureUser(username) {
  const u = norm(username);
  if (!db.users[u]) {
    db.users[u] = { username: u, display_name: String(username).trim(), created: Date.now(), settings: defaultSettings() };
    saveDb();
  }
  return db.users[u];
}

// ------------------------------------------------------------------ stats
function gamesIn(period) {
  const real = db.games.filter((g) => !g.vs_bot);
  if (period !== "monthly") return real;
  const m = monthKey();
  return real.filter((g) => monthKey(new Date(g.finished_at)) === m);
}
function seedFor(u, period) {
  if (period === "monthly") return db.seed.monthly.month === monthKey() ? db.seed.monthly.data[u] : null;
  return db.seed.alltime[u];
}
function resultFor(g, u) {
  const me = g.p1 === u ? 1 : g.p2 === u ? 2 : 0;
  if (!me) return null;
  return g.winner === 0 ? "T" : g.winner === me ? "W" : "L";
}
function statsFor(u, period, opponent = null) {
  const s = { wins: 0, losses: 0, ties: 0, total: 0 };
  if (!opponent) {
    const seed = seedFor(u, period);
    if (seed) { s.wins += seed.w; s.losses += seed.l; s.ties += seed.t; }
  } else if (period !== "monthly") {
    const h = h2hSeed(u, opponent);
    if (h) { s.wins += h.w; s.losses += h.l; s.ties += h.t; }
  }
  for (const g of gamesIn(period)) {
    if (opponent && g.p1 !== opponent && g.p2 !== opponent) continue;
    const r = resultFor(g, u);
    if (r === "W") s.wins++;
    else if (r === "L") s.losses++;
    else if (r === "T") s.ties++;
  }
  s.total = s.wins + s.losses + s.ties;
  s.winrate = s.total ? Math.round(((s.wins + s.ties / 2) / s.total) * 1000) / 10 : null;
  return s;
}
// Optional head-to-head records (set from the prank panel) so the in-game
// background tint matches the real site, which tints by your record vs that opponent.
function h2hSeed(u, opp) {
  const h = db.seed.h2h || {};
  if (h[u] && h[u][opp]) return h[u][opp];
  if (h[opp] && h[opp][u]) { const r = h[opp][u]; return { w: r.l, l: r.w, t: r.t }; }
  return null;
}
function historyFor(u, period, opponent = null) {
  let games = db.games.filter((g) => g.p1 === u || g.p2 === u);
  if (period === "monthly") games = games.filter((g) => monthKey(new Date(g.finished_at)) === monthKey());
  if (opponent) games = games.filter((g) => g.p1 === opponent || g.p2 === opponent);
  return games.slice(-50).reverse().map((g) => {
    const mine = g.p1 === u ? 1 : 2;
    return {
      finished_at: g.finished_at,
      vs_bot: !!g.vs_bot,
      opp_name: displayName(mine === 1 ? g.p2 : g.p1),
      you_score: mine === 1 ? g.p1_score : g.p2_score,
      opp_score: mine === 1 ? g.p2_score : g.p1_score,
      you_board: (mine === 1 ? g.p1_board : g.p2_board) || [],
      opp_board: (mine === 1 ? g.p2_board : g.p1_board) || [],
    };
  });
}
function gameCount(u) {
  const seed = db.seed.alltime[u];
  return (seed ? seed.w + seed.l + seed.t : 0) + db.games.filter((g) => !g.vs_bot && (g.p1 === u || g.p2 === u)).length;
}

function recordGame(room) {
  const g = room.game;
  const [a, b] = room.players;
  const vsBot = a.bot || b.bot;
  if (g.options.noScoring || room.uncounted) return;
  if (!a.user && !a.bot) return;
  if (!b.user && !b.bot) return;
  if (!vsBot && a.user === b.user) return;
  db.games.push({
    id: `g${Date.now().toString(36)}`,
    finished_at: new Date().toISOString(),
    p1: a.bot ? "__bot__" : a.user,
    p2: b.bot ? "__bot__" : b.user,
    vs_bot: vsBot,
    p1_score: g.result.scores[0],
    p2_score: g.result.scores[1],
    winner: g.result.winner,
    p1_board: g.result.boards[0],
    p2_board: g.result.boards[1],
    spectators: [...room.everSpectated],
  });
  saveDb();
}

// ------------------------------------------------------------------ http
const app = express();
app.use(express.json());

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function userFromCookieHeader(header) {
  const c = parseCookies(header);
  if (!("rh_user" in c)) return DEFAULT_USER; // auto-login
  if (c.rh_user === "__guest__") return null;
  return db.users[c.rh_user] ? c.rh_user : null;
}
const setUserCookie = (res, v) => res.cookie("rh_user", v, { maxAge: 365 * 24 * 3600 * 1000, sameSite: "lax" });

app.use((req, res, next) => {
  if (!("rh_user" in parseCookies(req.headers.cookie))) {
    ensureUser(DEFAULT_USER);
    setUserCookie(res, DEFAULT_USER);
  }
  req.user = userFromCookieHeader(req.headers.cookie);
  next();
});
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Log in first." }));
const needAdmin = (req, res, next) => (req.user === ADMIN ? next() : res.status(403).json({ error: "Not authorized." }));

app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = ensureUser(req.user);
  res.json({ user: { username: u.username, display_name: u.display_name }, settings: u.settings });
});
// Note: the client never sends a password. Accounts are username-only on this copy.
app.post("/api/login", (req, res) => {
  const name = req.body?.username;
  if (!name) return res.status(400).json({ error: "Enter a username." });
  if (!db.users[norm(name)]) return res.status(404).json({ error: "Invalid username or password." });
  setUserCookie(res, norm(name));
  res.json({ ok: true });
});
app.post("/api/signup", (req, res) => {
  const name = req.body?.username;
  if (!validName(name)) return res.status(400).json({ error: "Username must be 2–20 letters, numbers, . _ or -" });
  if (db.users[norm(name)]) return res.status(409).json({ error: "Username already taken." });
  ensureUser(name);
  setUserCookie(res, norm(name));
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  setUserCookie(res, "__guest__");
  res.json({ ok: true });
});
app.get("/api/settings", needUser, (req, res) => res.json(db.users[req.user].settings));
app.post("/api/settings", needUser, (req, res) => {
  const s = db.users[req.user].settings;
  if ("reveal_attacked" in req.body) s.reveal_attacked = !!req.body.reveal_attacked;
  if ("time_limit" in req.body) s.time_limit = clampTime(req.body.time_limit);
  saveDb();
  res.json(s);
});
function clampTime(v) {
  const n = Math.round(Number(v) || 0);
  return n <= 0 ? 0 : Math.max(15, Math.min(120, n));
}
app.get("/api/players", needUser, (req, res) => {
  const opps = new Set();
  for (const g of db.games) {
    if (g.vs_bot) continue;
    if (g.p1 === req.user) opps.add(g.p2);
    if (g.p2 === req.user) opps.add(g.p1);
  }
  const players = Object.values(db.users)
    .filter((u) => u.username !== req.user && (opps.has(u.username) || db.seed.alltime[u.username]))
    .map((u) => ({ username: u.username, display_name: u.display_name }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  res.json({ players });
});
app.get("/api/search_players", (req, res) => {
  const q = norm(req.query.q);
  if (q.length < 3) return res.json({ players: [] });
  const players = Object.values(db.users)
    .filter((u) => u.username !== req.user && (u.username.includes(q) || norm(u.display_name).includes(q)))
    .slice(0, 10)
    .map((u) => ({ username: u.username, display_name: u.display_name, games: gameCount(u.username) }));
  res.json({ players });
});
app.get("/api/leaderboard", (req, res) => {
  const period = req.query.period === "monthly" ? "monthly" : "alltime";
  const players = Object.values(db.users)
    .map((u) => ({ username: u.username, display_name: u.display_name, ...statsFor(u.username, period) }))
    .filter((p) => p.total >= MIN_GAMES[period])
    .sort((a, b) => b.winrate - a.winrate || b.total - a.total);
  res.json({ players });
});
app.get("/api/overall", needUser, (req, res) => {
  const period = req.query.period === "monthly" ? "monthly" : "alltime";
  res.json({ stats: statsFor(req.user, period), history: historyFor(req.user, period), month_label: monthLabel() });
});
app.get("/api/headtohead", needUser, (req, res) => {
  const opp = norm(req.query.opponent);
  if (!db.users[opp]) return res.status(404).json({ error: "Unknown player." });
  const period = req.query.period === "monthly" ? "monthly" : "alltime";
  res.json({
    opponent: { username: opp, display_name: displayName(opp) },
    stats: statsFor(req.user, period, opp),
    history: historyFor(req.user, period, opp),
    month_label: monthLabel(),
  });
});
app.get("/api/challenge_contacts", needUser, (req, res) => {
  const list = [...(db.users[req.user].recent_challenges || [])].reverse();
  res.json({ contacts: list.slice(0, 10).map((u) => ({ username: u, display_name: displayName(u) })) });
});
app.get("/api/ongoing_games", (req, res) => {
  const games = [...rooms.values()]
    .filter((r) => r.game && r.game.phase !== "game_over" && !r.game.options.noSpectators)
    .map((r) => ({ game_id: r.code, p1_name: r.players[0].name, p2_name: r.players[1].name }));
  res.json({ games });
});

// --- admin (poumsday only, like the original)
app.get("/api/admin/players", needAdmin, (req, res) => {
  const players = Object.values(db.users)
    .map((u) => ({ username: u.username, display_name: u.display_name, games: gameCount(u.username) }))
    .sort((a, b) => b.games - a.games);
  res.json({ players });
});
app.get("/api/admin/games", needAdmin, (req, res) => {
  const games = [...db.games].reverse().slice(0, 100).map((g) => ({
    p1_name: displayName(g.p1),
    p2_name: g.vs_bot ? "Bot" : displayName(g.p2),
    p1_score: g.p1_score ?? "–",
    p2_score: g.p2_score ?? "–",
    winner: g.winner,
    vs_bot: !!g.vs_bot,
    finished_at: g.finished_at,
    spectators: g.spectators || [],
  }));
  res.json({ games });
});
app.post("/api/admin/log_game", needAdmin, (req, res) => {
  const p1 = norm(req.body?.p1), p2 = norm(req.body?.p2), result = req.body?.result;
  if (!db.users[p1] || !db.users[p2]) return res.status(400).json({ error: "Pick two existing players." });
  if (p1 === p2) return res.status(400).json({ error: "Players must be different." });
  if (!["p1", "p2", "tie"].includes(result)) return res.status(400).json({ error: "Pick a result." });
  const winner = result === "p1" ? 1 : result === "p2" ? 2 : 0;
  db.games.push({
    id: `g${Date.now().toString(36)}`, finished_at: new Date().toISOString(), p1, p2, vs_bot: false,
    p1_score: winner === 1 ? 1 : 0, p2_score: winner === 2 ? 1 : 0, winner, p1_board: [], p2_board: [], spectators: [], logged: true,
  });
  saveDb();
  res.json({ ok: true });
});

// Head-to-head records for the logged-in player, so the in-game background tint matches the real site.
app.get("/api/prank/h2h", needUser, (req, res) => {
  const mine = (db.seed.h2h || {})[req.user] || {};
  res.json({ records: Object.entries(mine).map(([u, r]) => ({ username: u, display_name: displayName(u), ...r })) });
});
app.post("/api/prank/h2h", needUser, (req, res) => {
  const me = req.user;
  const opp = norm(req.body?.opponent);
  if (!db.users[opp] || opp === me) return res.status(400).json({ error: "Unknown player." });
  const n = (k) => Math.max(0, Math.round(Number(req.body?.[k]) || 0));
  db.seed.h2h = db.seed.h2h || {};
  db.seed.h2h[me] = db.seed.h2h[me] || {};
  if (db.seed.h2h[opp]) delete db.seed.h2h[opp][me];
  db.seed.h2h[me][opp] = { w: n("w"), l: n("l"), t: n("t") };
  saveDb();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------------------------------ sockets
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map(); // code -> room
const online = new Map(); // username -> Set(socket ids)
const challenges = new Map(); // id -> challenge

function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  while (rooms.has(c));
  return c;
}
function roomOfSocket(sid) {
  for (const r of rooms.values()) {
    const i = r.players.findIndex((p) => p.sid === sid);
    if (i !== -1) return { room: r, seat: i };
    if (r.spectators.has(sid)) return { room: r, seat: -1 };
  }
  return null;
}
function userRoom(username) {
  for (const r of rooms.values()) if (r.game && r.game.phase !== "game_over" && r.players.some((p) => p.user === username)) return r;
  return null;
}
function cleanOptions(o = {}) {
  return {
    noScoring: !!(o.no_scoring ?? o.noScoring),
    reveal: !!(o.reveal_attacked ?? o.reveal),
    timeLimit: clampTime(o.time_limit ?? o.timeLimit),
    noSpectators: !!(o.no_spectators ?? o.noSpectators),
  };
}
const nameOf = (socket) => (socket.data.user ? displayName(socket.data.user) : "Guest");

function makeRoom(options) {
  const room = { code: newCode(), options: cleanOptions(options), players: [], spectators: new Map(), everSpectated: new Set(), game: null };
  rooms.set(room.code, room);
  return room;
}
function seatPlayer(room, socket) {
  room.players.push({ user: socket.data.user, name: nameOf(socket), sid: socket.id, bot: false });
  socket.join(room.code);
}

function startGame(room) {
  const opts = { ...room.options };
  // The prank: armed from the secret panel by whoever created/joined/challenged, for this game only.
  if (room.prank) {
    const { seat, cfg } = room.prank;
    // Always prefer Kings over Emperors, and record the game in stats like any other.
    opts.prank = { seat, failN: cfg.failN, margin: cfg.margin, royalCap: cfg.royalCap, avoidEmperors: true };
  }
  room.game = new Game(room.players.map((p) => p.name), opts);
  broadcast(room);
}

// In-game background tint: your head-to-head win rate vs this opponent (null = neutral).
function bgWinrate(user, opp) {
  if (!user || !opp) return null;
  return statsFor(user, "alltime", opp).winrate;
}

function broadcast(room) {
  const g = room.game;
  if (!g) return;
  const events = g.drainEvents();
  const extra = {};
  const logs = events.filter((e) => e.type === "log").map((e) => e.msg);
  if (logs.length) extra.event_logs = logs;
  const atk = events.filter((e) => e.type === "attack").pop();
  if (atk) extra.attack_anim = atk.anim;
  const dep = events.filter((e) => e.type === "deploy").pop();
  if (dep) extra.deploy_anim = { player: dep.player, side: dep.side, card_count: dep.card_count };
  const dis = events.filter((e) => e.type === "discard").pop();
  if (dis) extra.discard_anim = dis.pair;
  const specs = [...room.spectators.entries()].map(([sid, s]) => ({ sid, name: s.name }));

  const users = room.players.map((p) => (p.bot ? null : p.user));
  room.players.forEach((p, i) => {
    if (p.sid) io.to(p.sid).emit("game_state", { ...g.viewFor(i, extra), spectator_names: specs, bg_winrate: bgWinrate(users[i], users[1 - i]), board_bg: "bg-classic" });
  });
  for (const [sid, s] of room.spectators) {
    const v = { ...g.viewFor(-1, extra), bg_winrate: bgWinrate(users[0], users[1]), board_bg: "bg-classic" };
    if (s.user === ADMIN) v.spectator_names = specs; // the admin can see who else is watching
    io.to(sid).emit("game_state", v);
  }
  if (g.phase === "game_over" && !room.recorded) {
    room.recorded = true;
    clearTimeout(room.timer);
    recordGame(room);
  }
  scheduleTimers(room);
}

function scheduleTimers(room) {
  const g = room.game;
  if (g.phase !== "play") {
    clearTimeout(room.timer);
    room.timerKey = null;
    scheduleBot(room);
    return;
  }
  // Per-turn clock.
  const key = `${g.turnToken}:${g.mustDiscardExcess}`;
  if (g.options.timeLimit && key !== room.timerKey) {
    room.timerKey = key;
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (room.game !== g || g.phase !== "play") return;
      g.timeout();
      broadcast(room);
    }, g.options.timeLimit * 1000 + 300);
  }
  // Safety net: clients send end_turn after the "END TURN" flash; do it ourselves if they don't.
  clearTimeout(room.endTimer);
  if (g.turnOver) {
    const tok = g.turnToken;
    room.endTimer = setTimeout(() => {
      if (room.game === g && g.turnOver && g.turnToken === tok) {
        g.endTurn(g.turn);
        broadcast(room);
      }
    }, 2500);
  }
  scheduleBot(room);
}

function scheduleBot(room) {
  const g = room.game;
  if (!g || room.botTimer) return;
  const seat = room.players.findIndex((p, i) => p.bot && ((g.phase === "mulligan" && !g.players[i].mulliganDone) || (g.phase === "play" && g.turn === i)));
  if (seat === -1) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.game !== g) return;
    if (botStep(g, seat)) broadcast(room);
  }, g.phase === "mulligan" ? 600 : g.turnOver ? 600 : 900 + Math.random() * 600);
}

function closeRoom(room, leaverSid) {
  clearTimeout(room.timer);
  clearTimeout(room.endTimer);
  clearTimeout(room.botTimer);
  const inProgress = room.game && room.game.phase !== "game_over";
  for (const p of room.players) {
    if (!p.sid || p.sid === leaverSid) continue;
    if (inProgress) io.to(p.sid).emit("opponent_left");
    io.sockets.sockets.get(p.sid)?.leave(room.code);
  }
  for (const sid of room.spectators.keys()) {
    if (sid === leaverSid) continue;
    if (inProgress) io.to(sid).emit("opponent_left");
    io.sockets.sockets.get(sid)?.leave(room.code);
  }
  rooms.delete(room.code);
}

function leaveEverything(socket) {
  const f = roomOfSocket(socket.id);
  if (!f) return;
  if (f.seat === -1) {
    f.room.spectators.delete(socket.id);
    socket.leave(f.room.code);
    if (f.room.game) broadcast(f.room);
    return;
  }
  closeRoom(f.room, socket.id);
}

function pushChallenges(username) {
  const list = [...challenges.values()].filter((c) => c.to === username).map((c) => ({ id: c.id, from: c.from, from_display_name: displayName(c.from) }));
  for (const sid of online.get(username) || []) io.to(sid).emit("challenges_update", { challenges: list });
}

io.on("connection", (socket) => {
  const user = userFromCookieHeader(socket.handshake.headers.cookie);
  socket.data.user = user;
  if (user) {
    if (!online.has(user)) online.set(user, new Set());
    online.get(user).add(socket.id);
    pushChallenges(user);
  }
  const inGame = () => {
    const f = roomOfSocket(socket.id);
    return f && f.seat !== -1 && f.room.game ? f : null;
  };
  const act = (fn) => (payload) => {
    const f = inGame();
    if (!f) return;
    const r = fn(f.room.game, f.seat, payload || {});
    if (r && r.error) socket.emit("action_error", { msg: r.error });
    broadcast(f.room);
  };

  socket.on("create_room", (data = {}) => {
    leaveEverything(socket);
    const room = makeRoom(data);
    seatPlayer(room, socket);
    const cfg = cleanPrank(data.prank);
    if (cfg) room.prank = { seat: 0, cfg };
    socket.emit("room_created", { room_code: room.code });
  });
  socket.on("join_room_code", (data = {}) => {
    const code = String(data.room_code || data.code || (typeof data === "string" ? data : "")).trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || room.game) return socket.emit("join_error", { msg: room ? "Room is full." : "Room not found." });
    if (room.players.some((p) => p.sid === socket.id)) return;
    if (user && room.players.some((p) => p.user === user)) return socket.emit("join_error", { msg: "You can't join your own room." });
    leaveEverything(socket);
    seatPlayer(room, socket);
    const cfg = cleanPrank(data.prank);
    if (cfg && !room.prank) room.prank = { seat: 1, cfg };
    startGame(room);
  });
  // Not reachable from the menu (same as the original) — call startBot() in the console.
  socket.on("join_bot", (data = {}) => {
    leaveEverything(socket);
    const room = makeRoom(data);
    seatPlayer(room, socket);
    room.players.push({ user: null, name: "Bot", sid: null, bot: true });
    startGame(room);
  });

  // --- challenges
  socket.on("send_challenge", (data = {}) => {
    if (!user) return socket.emit("challenge_error", { msg: "Log in to challenge players." });
    const to = norm(data.username || data.to);
    if (!to) return socket.emit("challenge_error", { msg: "Enter a username." });
    if (!db.users[to]) return socket.emit("challenge_error", { msg: "Player not found." });
    if (to === user) return socket.emit("challenge_error", { msg: "You can't challenge yourself." });
    if (!online.has(to)) return socket.emit("challenge_error", { msg: `${displayName(to)} is not online.` });
    if (userRoom(to)) return socket.emit("challenge_error", { msg: `${displayName(to)} is in a game.` });
    const id = `ch${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    challenges.set(id, { id, from: user, to, options: data.options || data, fromSid: socket.id, prank: cleanPrank(data.prank) });
    const rc = (db.users[user].recent_challenges = (db.users[user].recent_challenges || []).filter((x) => x !== to));
    rc.push(to);
    saveDb();
    socket.emit("challenge_sent", { display_name: displayName(to) });
    pushChallenges(to);
  });
  socket.on("respond_challenge", (data = {}) => {
    const c = challenges.get(data.id);
    if (!c || c.to !== user) return;
    challenges.delete(c.id);
    pushChallenges(user);
    const fromSock = io.sockets.sockets.get(c.fromSid) || [...(online.get(c.from) || [])].map((s) => io.sockets.sockets.get(s)).find(Boolean);
    if (!data.accept) {
      if (fromSock) fromSock.emit("challenge_declined", { display_name: displayName(user) });
      return;
    }
    if (!fromSock) return socket.emit("challenge_error", { msg: "That player went offline." });
    leaveEverything(fromSock);
    leaveEverything(socket);
    const room = makeRoom(c.options);
    if (c.prank) room.prank = { seat: 0, cfg: c.prank };
    seatPlayer(room, fromSock);
    seatPlayer(room, socket);
    startGame(room);
  });

  // --- spectating
  const spectate = (room) => {
    if (!room || !room.game || room.game.phase === "game_over") return socket.emit("spectate_error", { msg: "Game not found." });
    if (room.game.options.noSpectators && user !== ADMIN) return socket.emit("spectate_error", { msg: "This game doesn't allow spectators." });
    if (room.players.some((p) => p.sid === socket.id)) return;
    leaveEverything(socket);
    const name = nameOf(socket);
    room.spectators.set(socket.id, { name, user });
    room.everSpectated.add(name);
    socket.join(room.code);
    broadcast(room);
  };
  socket.on("spectate_game", (data = {}) => spectate(rooms.get(String(data.game_id || data.code || "").toUpperCase())));
  socket.on("spectate_user", (data = {}) => {
    const r = userRoom(norm(data.username));
    if (!r) return socket.emit("spectate_error", { msg: "That player isn't in a game right now." });
    spectate(r);
  });
  socket.on("kick_spectator", (data = {}) => {
    const f = inGame();
    if (!f || !f.room.spectators.has(data.sid)) return;
    f.room.spectators.delete(data.sid);
    io.to(data.sid).emit("kicked_from_game");
    io.sockets.sockets.get(data.sid)?.leave(f.room.code);
    broadcast(f.room);
  });

  socket.on("emote", (data = {}) => {
    const f = inGame();
    if (!f) return;
    const type = String(data.type || "");
    if (!["laugh", "angry", "think", "thanks", "toast", "sketch"].includes(type)) return;
    f.room.players.forEach((p, i) => p.sid && io.to(p.sid).emit("emote", { type, side: i === f.seat ? "you" : "opp" }));
    for (const sid of f.room.spectators.keys()) io.to(sid).emit("emote", { type, side: f.seat === 0 ? "you" : "opp" });
  });

  // --- game actions (payloads match the original client)
  socket.on("mulligan", act((g, s, d) => g.mulligan(s, !!d.mulligan)));
  socket.on("deploy", act((g, s, d) => g.deploy(s, d.card_indices, d.side)));
  socket.on("attack", act((g, s, d) => g.attack(s, d.card_indices, d.side)));
  socket.on("end_turn", act((g, s) => (g.turnOver ? g.endTurn(s) : null)));
  socket.on("finish_deploy", act((g, s) => g.finishDeploy(s)));
  socket.on("pass_action", act((g, s) => g.passAction(s)));
  socket.on("pass_discard_all", act((g, s) => g.passDiscardAll(s)));
  socket.on("switch_to_path_b", act((g, s) => g.switchToPathB(s)));
  socket.on("cancel_path_b", act((g, s) => g.cancelPathB(s)));
  socket.on("discard_cards", act((g, s, d) => g.discardCards(s, d.indices)));
  socket.on("discard_excess", act((g, s, d) => g.discardExcess(s, d.indices)));

  socket.on("disconnect", () => {
    if (user) {
      online.get(user)?.delete(socket.id);
      if (!online.get(user)?.size) online.delete(user);
    }
    for (const [id, c] of challenges) if (c.fromSid === socket.id && !online.has(c.from)) { challenges.delete(id); pushChallenges(c.to); }
    leaveEverything(socket);
  });
});

server.listen(PORT, () => {
  ensureUser(DEFAULT_USER);
  console.log(`Royalty High running on http://localhost:${PORT}  (auto-login: ${DEFAULT_USER})`);
});
