// Royalty High — client
const socket = io();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = null;
let currentUser = null;
let userSettings = { reveal_attacked: false, time_limit: 0 };
let selectedIndices = [];
let logTurns = [[]];
let spectatorEntries = [];
let pendingChallenges = [];
let appliedBodyBg = null;
let turnTimerInterval = null;
let turnTimerToken = null;
let emoteCooling = false;
let endTurnSent = null;

const roomOpts = { no_scoring: false, reveal_attacked: false, time_limit: 0, no_spectators: false };
const chalOpts = { no_scoring: false, reveal_attacked: false, time_limit: 0, no_spectators: false };
let roomTimeValue = 30;
let chalTimeValue = 30;

// ================================================================ SOUND
let audioCtx = null;
let sfxVolume = 0.5;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function playTone(freq, dur, type, vol, detune) {
  try {
    const ctx = getAudioCtx();
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, vol * sfxVolume), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    g.connect(ctx.destination);
    const o = ctx.createOscillator();
    o.type = type || "sine";
    o.frequency.value = freq;
    if (detune) o.detune.value = detune;
    o.connect(g);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + dur);
  } catch (e) {}
}
function playNoise(dur, vol, highpass) {
  try {
    const ctx = getAudioCtx();
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, vol * sfxVolume), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    let node = src;
    if (highpass) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = highpass;
      hp.frequency.exponentialRampToValueAtTime(highpass * 0.4, ctx.currentTime + dur * 0.8);
      src.connect(hp);
      node = hp;
    }
    node.connect(g);
    g.connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + dur);
  } catch (e) {}
}
const later = (ms, fn) => setTimeout(fn, ms);
function sfxTick() { playTone(1200, 0.04, "square", 0.25); playTone(800, 0.05, "sine", 0.15); }
function sfxDeploy() { playNoise(0.12, 0.25); later(80, () => { playTone(120, 0.2, "sine", 0.4); playTone(80, 0.15, "triangle", 0.3); }); }
function sfxAttack() { playNoise(0.25, 0.35, 2000); playTone(300, 0.08, "sawtooth", 0.2); }
function sfxKnightDeath(loud) {
  const v = loud ? 1 : 0.6;
  playTone(800, 0.08, "square", 0.3 * v); playTone(400, 0.15, "sawtooth", 0.25 * v); playNoise(0.15, 0.2 * v);
  later(100, () => playTone(100, 0.25, "sine", 0.35 * v));
}
function sfxKnight10Death() { sfxKnightDeath(true); later(150, () => { playTone(200, 0.3, "sawtooth", 0.4); playNoise(0.2, 0.35); playTone(60, 0.4, "sine", 0.5); }); }
function sfxAceTrap() {
  try {
    const ctx = getAudioCtx();
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1200, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, 0.35 * sfxVolume), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.5);
  } catch (e) {}
  later(200, () => { playTone(150, 0.3, "triangle", 0.25); playTone(300, 0.2, "sine", 0.15, 50); });
}
function sfxJackDeath() { playTone(350, 0.12, "sawtooth", 0.3); playTone(500, 0.08, "square", 0.2); later(80, () => { playTone(200, 0.2, "triangle", 0.25); playNoise(0.1, 0.15); }); }
function sfxQueenDeath() {
  playTone(880, 0.15, "sine", 0.3); later(100, () => playTone(660, 0.15, "sine", 0.25)); later(200, () => playTone(440, 0.2, "sine", 0.2));
  later(300, () => { playTone(330, 0.35, "triangle", 0.25); playNoise(0.15, 0.1); });
}
function sfxKingDeath() {
  playTone(220, 0.1, "sawtooth", 0.3); playTone(165, 0.15, "square", 0.25);
  later(100, () => { playTone(110, 0.3, "sawtooth", 0.35); playNoise(0.2, 0.25); });
  later(200, () => { playTone(80, 0.4, "triangle", 0.3); playTone(55, 0.5, "sine", 0.25); });
}
function sfxEmperorDeath() {
  playTone(440, 0.15, "sine", 0.25); playTone(554, 0.15, "sine", 0.2); playTone(660, 0.15, "sine", 0.2);
  later(120, () => { playTone(330, 0.2, "sawtooth", 0.35); playTone(220, 0.25, "sawtooth", 0.3); playTone(165, 0.3, "square", 0.25); });
  later(250, () => { playTone(55, 0.7, "sine", 0.5); playTone(80, 0.5, "triangle", 0.4); playNoise(0.4, 0.35); });
  later(500, () => { playTone(40, 0.8, "sine", 0.35); playTone(60, 0.6, "triangle", 0.25); playNoise(0.3, 0.2); });
}
function sfxUnitDeath(unit) {
  if (!unit) return;
  if (unit.is_royal) {
    if (unit.rank === "J") sfxJackDeath();
    else if (unit.rank === "Q") sfxQueenDeath();
    else if (unit.rank === "K") sfxKingDeath();
    else if (unit.rank === "E") sfxEmperorDeath();
    else sfxKnightDeath(false);
  } else if (unit.rank === "10") sfxKnight10Death();
  else sfxKnightDeath(false);
}
function setVolume(val) {
  sfxVolume = val / 100;
  $("vol-display").textContent = val + "%";
  try { localStorage.setItem("rh_volume", val); } catch (e) {}
}
function toggleSettings() {
  const p = $("settings-panel");
  p.style.display = p.style.display === "block" ? "none" : "block";
}
(() => {
  let saved = null;
  try { saved = localStorage.getItem("rh_volume"); } catch (e) {}
  if (saved !== null) {
    sfxVolume = saved / 100;
    $("vol-slider").value = saved;
    $("vol-display").textContent = saved + "%";
  }
})();
document.addEventListener("click", (e) => {
  const p = $("settings-panel");
  if (p.style.display === "block" && !p.contains(e.target) && e.target !== $("settings-btn")) p.style.display = "none";
  const dd = $("challenge-dropdown");
  if (dd.style.display === "block" && !dd.contains(e.target) && !$("challenge-bell").contains(e.target)) dd.style.display = "none";
  if (!e.target.closest("#emote-wrap")) toggleEmoteMenu(false);
  if (!e.target.closest("#spectator-wrap")) $("spectator-panel").classList.remove("open");
  if (!e.target.closest("#challenge-username-input") && !e.target.closest("#challenge-search-results")) hideChallengeSearchResults();
  if (!e.target.closest("#spectate-username-input") && !e.target.closest("#spectate-search-results")) hideSpectateSearchResults();
});

// ================================================================ BACKGROUNDS
function setBodyBg(value) {
  if (value === appliedBodyBg) return;
  document.body.style.background = value;
  appliedBodyBg = value;
}
function clearBodyBg() {
  document.body.style.background = "";
  appliedBodyBg = null;
}
function winRateColorRGB(rate) {
  const red = [229, 57, 53], yellow = [253, 216, 53], green = [67, 160, 71];
  const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return rate <= 50 ? lerp(red, yellow, rate / 50) : lerp(yellow, green, (rate - 50) / 50);
}
function winRateColor(rate) {
  const c = winRateColorRGB(rate);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function applyWinrateBg(winrate) {
  const rate = winrate === null || winrate === undefined ? 50 : winrate;
  const base = winRateColorRGB(rate);
  const shade = (f) => `rgb(${Math.round(base[0] * f)},${Math.round(base[1] * f)},${Math.round(base[2] * f)})`;
  setBodyBg(`radial-gradient(ellipse at top, ${shade(0.85)} 0%, ${shade(0.5)} 55%, ${shade(0.28)} 100%)`);
}

// ================================================================ SCREENS
const ROOM_SCREENS = ["friends-mode-screen", "room-screen", "challenge-screen", "spectate-screen", "waiting", "stats-screen", "admin-screen", "leaderboard-screen"];
function hideAll() {
  $("menu").style.display = "none";
  for (const id of ROOM_SCREENS) {
    $(id).classList.remove("visible");
    $(id).style.display = "none";
  }
  $("challenge-dropdown").style.display = "none";
  $("game").style.display = "none";
  $("ingame-help").style.display = "none";
  $("settings-btn").style.display = "none";
  $("settings-panel").style.display = "none";
  document.body.classList.remove("on-menu");
}
function showScreen(id) {
  hideAll();
  const el = $(id);
  el.style.display = "flex";
  el.classList.add("visible");
  clearBodyBg();
}
function backToMenu() {
  hideAll();
  clearBodyBg();
  $("menu").style.display = "flex";
  document.body.classList.add("on-menu");
}
function showToast(msg, type) {
  const t = document.createElement("div");
  t.className = type === "info" ? "error-toast info-toast" : "error-toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================================================================ ACCOUNTS
async function refreshMe() {
  try {
    const d = await (await fetch("/api/me")).json();
    currentUser = d.user;
    if (d.settings) userSettings = d.settings;
  } catch (e) { currentUser = null; }
  updateAccountUI();
  applyDefaultsToRoomOpts();
}
function updateAccountUI() {
  if (currentUser) {
    $("account-name").textContent = currentUser.display_name;
    $("account-logged-in").style.display = "block";
    $("account-logged-out").style.display = "none";
    const isAdmin = currentUser.username === "poumsday";
    $("account-admin-link").style.display = isAdmin ? "" : "none";
    $("account-admin-sep").style.display = isAdmin ? "" : "none";
  } else {
    $("account-logged-in").style.display = "none";
    $("account-logged-out").style.display = "block";
  }
  updateChallengeBell();
}
let authMode = "login";
function openAuth(mode) {
  authMode = mode;
  $("auth-username").value = "";
  $("auth-password").value = "";
  $("auth-error").textContent = "";
  applyAuthMode();
  $("auth-overlay").classList.add("visible");
  $("auth-username").focus();
}
function closeAuth() { $("auth-overlay").classList.remove("visible"); }
function toggleAuthMode() { authMode = authMode === "login" ? "signup" : "login"; applyAuthMode(); }
function applyAuthMode() {
  const login = authMode === "login";
  $("auth-title").textContent = login ? "Log in" : "Sign up";
  $("auth-submit-label").textContent = login ? "Log in" : "Sign up";
  $("auth-toggle-text").textContent = login ? "No account?" : "Have an account?";
  $("auth-toggle-btn").textContent = login ? "Sign up" : "Log in";
  $("auth-password").autocomplete = "off";
}
async function submitAuth() {
  const username = $("auth-username").value.trim();
  // The password box is only for looks: it's cleared and never sent anywhere.
  $("auth-password").value = "";
  if (!username) return ($("auth-error").textContent = "Enter a username.");
  try {
    const r = await fetch(authMode === "login" ? "/api/login" : "/api/signup", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }),
    });
    const d = await r.json();
    if (!r.ok) return ($("auth-error").textContent = d.error || "Something went wrong.");
    location.reload();
  } catch (e) {
    $("auth-error").textContent = "Network error.";
  }
}
async function doLogout() {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
}
$("auth-username").addEventListener("keydown", (e) => { if (e.key === "Enter") $("auth-password").focus(); });

// --- user settings
function applyRevealToggleUI() {
  const b = $("set-reveal-attacked");
  b.textContent = userSettings.reveal_attacked ? "On" : "Off";
  b.classList.toggle("active", !!userSettings.reveal_attacked);
}
function applyTimeLimitToggleUI() {
  const b = $("set-time-limit");
  const on = userSettings.time_limit > 0;
  b.textContent = on ? "On" : "Off";
  b.classList.toggle("active", on);
  $("set-time-limit-slider").style.display = on ? "block" : "none";
  if (on) {
    $("set-tl-range").value = userSettings.time_limit;
    $("set-time-limit-value").textContent = userSettings.time_limit + "s";
  }
}
function openUserSettings() {
  $("user-settings-error").textContent = "";
  applyRevealToggleUI();
  applyTimeLimitToggleUI();
  $("user-settings-overlay").classList.add("visible");
}
function closeUserSettings() { $("user-settings-overlay").classList.remove("visible"); }
async function saveUserSettings(patch) {
  try {
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error();
    userSettings = await r.json();
    applyDefaultsToRoomOpts();
  } catch (e) {
    $("user-settings-error").textContent = "Could not save settings.";
  }
}
function toggleUserReveal() {
  userSettings.reveal_attacked = !userSettings.reveal_attacked;
  applyRevealToggleUI();
  saveUserSettings({ reveal_attacked: userSettings.reveal_attacked });
}
function toggleUserTimeLimit() {
  userSettings.time_limit = userSettings.time_limit > 0 ? 0 : 30;
  applyTimeLimitToggleUI();
  saveUserSettings({ time_limit: userSettings.time_limit });
}
function setUserTimeLimit(v) { $("set-time-limit-value").textContent = v + "s"; }
function commitUserTimeLimit(v) {
  userSettings.time_limit = +v;
  saveUserSettings({ time_limit: +v });
}
$("user-settings-overlay").addEventListener("click", (e) => { if (e.target.id === "user-settings-overlay") closeUserSettings(); });
$("auth-overlay").addEventListener("click", (e) => { if (e.target.id === "auth-overlay") closeAuth(); });

// ================================================================ CHALLENGES
function updateChallengeBell() {
  const bell = $("challenge-bell");
  const badge = $("challenge-badge");
  if (!currentUser) {
    bell.style.display = "none";
    $("challenge-dropdown").style.display = "none";
    pendingChallenges = [];
    return;
  }
  bell.style.display = "block";
  if (pendingChallenges.length > 0) {
    badge.style.display = "block";
    badge.textContent = pendingChallenges.length;
  } else {
    badge.style.display = "none";
    $("challenge-dropdown").style.display = "none";
  }
  renderChallengeDropdown();
}
function renderChallengeDropdown() {
  const list = $("challenge-list");
  if (!pendingChallenges.length) {
    list.innerHTML = '<div style="opacity:0.6;font-size:0.8rem;">No pending challenges.</div>';
    return;
  }
  list.innerHTML = pendingChallenges.map((c) => `
    <div class="challenge-row">
      <div style="margin-bottom:6px;"><strong>${esc(c.from_display_name)}</strong> challenged you</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" style="flex:1;" onclick="respondChallenge('${c.id}', true)">Accept</button>
        <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="respondChallenge('${c.id}', false)">Decline</button>
      </div>
    </div>`).join("");
}
function toggleChallengeDropdown() {
  const dd = $("challenge-dropdown");
  const open = dd.style.display !== "block";
  dd.style.display = open ? "block" : "none";
  if (open) {
    dd.classList.remove("just-opened");
    void dd.offsetWidth;
    dd.classList.add("just-opened");
  }
}
function respondChallenge(id, accept) {
  socket.emit("respond_challenge", { id, accept });
  pendingChallenges = pendingChallenges.filter((c) => c.id !== id);
  updateChallengeBell();
}
socket.on("challenges_update", (d) => {
  const before = pendingChallenges.length;
  pendingChallenges = d.challenges || [];
  updateChallengeBell();
  if (pendingChallenges.length > before) {
    playTone(660, 0.12, "sine", 0.3);
    later(120, () => playTone(880, 0.16, "sine", 0.3));
  }
});
socket.on("challenge_sent", (data) => {
  const msg = $("challenge-sent-msg");
  msg.style.display = "block";
  msg.textContent = "Challenge sent to " + data.display_name + "!";
  loadChallengeContacts();
});
socket.on("challenge_declined", (data) => showToast(data.display_name + " declined your challenge."));
socket.on("challenge_error", (data) => { $("challenge-error").textContent = data.msg; });

function showFriendsModeScreen() { showScreen("friends-mode-screen"); }
function showChallengeScreen() {
  if (!currentUser) return openAuth("login");
  showScreen("challenge-screen");
  $("challenge-error").textContent = "";
  $("challenge-sent-msg").style.display = "none";
  $("challenge-username-input").value = "";
  applyOptUI("chal");
  loadChallengeContacts();
}
function toggleChallengeOpt(k) { chalOpts[k] = !chalOpts[k]; applyOptUI("chal"); }
function toggleChallengeTimeLimit() { chalOpts.time_limit = chalOpts.time_limit ? 0 : chalTimeValue; applyOptUI("chal"); }
function setChallengeTimeLimit(v) { chalTimeValue = +v; chalOpts.time_limit = +v; $("chal-time-limit-value").textContent = v + "s"; }
async function loadChallengeContacts() {
  const sel = $("challenge-recent-select");
  try {
    const d = await (await fetch("/api/challenge_contacts")).json();
    sel.innerHTML = '<option value="">Recently challenged…</option>' + (d.contacts || []).map((c) => `<option value="${esc(c.username)}">${esc(c.display_name)}</option>`).join("");
  } catch (e) {}
}
function sendChallenge() {
  $("challenge-error").textContent = "";
  $("challenge-sent-msg").style.display = "none";
  const username = $("challenge-username-input").value.trim();
  if (!username) return ($("challenge-error").textContent = "Enter a username.");
  hideChallengeSearchResults();
  socket.emit("send_challenge", withPrank({ username, options: { ...chalOpts } }));
}
let chalSearchTimer = null;
function onChallengeSearchInput(v) {
  clearTimeout(chalSearchTimer);
  if (v.trim().length < 3) return hideChallengeSearchResults();
  chalSearchTimer = setTimeout(() => runChallengeSearch(v.trim()), 200);
}
async function runChallengeSearch(q) {
  const box = $("challenge-search-results");
  try {
    const d = await (await fetch("/api/search_players?q=" + encodeURIComponent(q))).json();
    const players = d.players || [];
    box.innerHTML = players.length
      ? players.map((p) => `<div class="search-result-row" onclick="pickChallengeSearchResult('${esc(p.username)}')"><span>${esc(p.display_name)}</span><span class="srr-games">${p.games} game${p.games === 1 ? "" : "s"}</span></div>`).join("")
      : '<div class="hist-empty" style="padding:8px;">No players found.</div>';
    box.style.display = "block";
  } catch (e) {}
}
function pickChallengeSearchResult(u) { $("challenge-username-input").value = u; hideChallengeSearchResults(); }
function hideChallengeSearchResults() { $("challenge-search-results").style.display = "none"; }

// ================================================================ SPECTATE
function showSpectateScreen() {
  showScreen("spectate-screen");
  $("spectate-error").textContent = "";
  $("spectate-username-input").value = "";
  loadOngoingGames();
}
async function loadOngoingGames() {
  const list = $("spectate-games-list");
  list.innerHTML = '<div class="hist-empty">Loading…</div>';
  let games = [];
  try { games = (await (await fetch("/api/ongoing_games")).json()).games || []; }
  catch (e) { list.innerHTML = '<div class="hist-empty">Could not load.</div>'; return; }
  list.innerHTML = games.length
    ? games.map((g) => `<div class="hist-row search-result-row" style="cursor:pointer;" onclick="spectateGame('${g.game_id}')"><span>${esc(g.p1_name)} vs ${esc(g.p2_name)}</span></div>`).join("")
    : '<div class="hist-empty">No games in progress right now.</div>';
}
function spectateGame(id) { socket.emit("spectate_game", { game_id: id }); }
let specSearchTimer = null;
function onSpectateSearchInput(v) {
  clearTimeout(specSearchTimer);
  if (v.trim().length < 3) return hideSpectateSearchResults();
  specSearchTimer = setTimeout(() => runSpectateSearch(v.trim()), 200);
}
async function runSpectateSearch(q) {
  const box = $("spectate-search-results");
  try {
    const d = await (await fetch("/api/search_players?q=" + encodeURIComponent(q))).json();
    const players = d.players || [];
    box.innerHTML = players.length
      ? players.map((p) => `<div class="search-result-row" onclick="pickSpectateSearchResult('${esc(p.username)}')"><span>${esc(p.display_name)}</span><span class="srr-games">${p.games} game${p.games === 1 ? "" : "s"}</span></div>`).join("")
      : '<div class="hist-empty" style="padding:8px;">No players found.</div>';
    box.style.display = "block";
  } catch (e) {}
}
function pickSpectateSearchResult(u) { $("spectate-username-input").value = u; hideSpectateSearchResults(); }
function hideSpectateSearchResults() { $("spectate-search-results").style.display = "none"; }
function spectateUserByName() {
  const u = $("spectate-username-input").value.trim();
  $("spectate-error").textContent = "";
  if (!u) return ($("spectate-error").textContent = "Enter a username.");
  hideSpectateSearchResults();
  socket.emit("spectate_user", { username: u });
}
socket.on("spectate_error", (d) => { $("spectate-error").textContent = d.msg; });
socket.on("kicked_from_game", () => { alert("You were removed from this game."); location.reload(); });

// ================================================================ ROOMS
function applyDefaultsToRoomOpts() {
  roomOpts.reveal_attacked = !!userSettings.reveal_attacked;
  roomOpts.time_limit = userSettings.time_limit || 0;
  if (userSettings.time_limit) roomTimeValue = userSettings.time_limit;
  applyOptUI("room");
}
function applyOptUI(which) {
  const o = which === "room" ? roomOpts : chalOpts;
  const p = which === "room" ? "opt-" : "chal-opt-";
  $(p + "no-scoring").classList.toggle("active", o.no_scoring);
  $(p + "reveal-attacked").classList.toggle("active", o.reveal_attacked);
  $(p + "time-limit").classList.toggle("active", o.time_limit > 0);
  $(p + "no-spectators").classList.toggle("active", o.no_spectators);
  const slider = $(which === "room" ? "time-limit-slider" : "chal-time-limit-slider");
  slider.style.display = o.time_limit > 0 ? "block" : "none";
  const val = which === "room" ? roomTimeValue : chalTimeValue;
  $(which === "room" ? "tl-range" : "chal-tl-range").value = o.time_limit || val;
  $(which === "room" ? "time-limit-value" : "chal-time-limit-value").textContent = (o.time_limit || val) + "s";
}
function showRoomScreen() {
  showScreen("room-screen");
  $("join-error").textContent = "";
  applyOptUI("room");
}
function toggleOpt(k) { roomOpts[k] = !roomOpts[k]; applyOptUI("room"); }
function toggleTimeLimit() { roomOpts.time_limit = roomOpts.time_limit ? 0 : roomTimeValue; applyOptUI("room"); }
function setTimeLimit(v) { roomTimeValue = +v; roomOpts.time_limit = +v; $("time-limit-value").textContent = v + "s"; }
function createRoom() { socket.emit("create_room", withPrank({ ...roomOpts })); }
function joinRoom() {
  const code = $("join-code-input").value.trim().toUpperCase();
  if (!code) return ($("join-error").textContent = "Enter a room code.");
  socket.emit("join_room_code", withPrank({ room_code: code }));
}
function startBot() { hideAll(); socket.emit("join_bot"); }
socket.on("room_created", (data) => {
  showScreen("waiting");
  clearBodyBg();
  $("room-code-display").textContent = data.room_code;
});
socket.on("join_error", (data) => { $("join-error").textContent = data.msg; });
socket.on("opponent_left", () => { alert("Opponent disconnected."); location.reload(); });
socket.on("action_error", (d) => showToast(d.msg));

// ================================================================ LEADERBOARD
let leaderboardPeriod = "all";
function showLeaderboard() { showScreen("leaderboard-screen"); setLeaderboardPeriod("all"); }
function setLeaderboardPeriod(p) {
  leaderboardPeriod = p;
  $("lb-tab-all").classList.toggle("active", p === "all");
  $("lb-tab-monthly").classList.toggle("active", p === "monthly");
  loadLeaderboard();
}
async function loadLeaderboard() {
  const list = $("lb-winrate-list");
  const monthly = leaderboardPeriod === "monthly";
  $("lb-caption").textContent = monthly ? "Ranked by win rate — requires 10+ games played this month" : "Ranked by win rate — requires 15+ games played";
  list.innerHTML = '<div class="hist-empty">Loading…</div>';
  let players = [];
  try { players = (await (await fetch("/api/leaderboard" + (monthly ? "?period=monthly" : ""))).json()).players || []; }
  catch (e) { list.innerHTML = '<div class="hist-empty">Could not load.</div>'; return; }
  const emptyMsg = monthly ? "No players with 10+ games this month yet." : "No players with 15+ games yet.";
  list.innerHTML = players.length
    ? players.map((p, i) => `
      <div class="hist-row"><div class="hist-head">
        <span>#${i + 1} ${esc(p.display_name)}</span>
        <span class="hist-result">${p.winrate}% <span style="opacity:0.6;font-weight:400;">(${p.wins}-${p.losses}${p.ties ? "-" + p.ties : ""})</span></span>
      </div></div>`).join("")
    : `<div class="hist-empty">${emptyMsg}</div>`;
}

// ================================================================ STATS
let statsPeriod = "all";
let statsMonthLabel = "";
let statsView = "__overall__";
async function showStats() {
  if (!currentUser) return openAuth("login");
  showScreen("stats-screen");
  const sel = $("stats-player-select");
  let players = [];
  try { players = (await (await fetch("/api/players")).json()).players || []; } catch (e) {}
  sel.innerHTML = '<option value="__overall__">Overall</option>' + players.map((p) => `<option value="${esc(p.username)}">vs ${esc(p.display_name)}</option>`).join("");
  sel.value = "__overall__";
  setStatsPeriod("all");
}
function setStatsPeriod(p) {
  statsPeriod = p;
  $("stats-period-all").classList.toggle("active", p === "all");
  $("stats-period-month").classList.toggle("active", p === "monthly");
  loadStatsView($("stats-player-select").value || "__overall__");
}
function loadStatsView(v) {
  statsView = v;
  if (v === "__overall__") loadOverall();
  else loadHeadToHead(v);
}
function renderSummary(s) {
  const wEl = $("stats-winrate");
  if (statsPeriod === "monthly") {
    const diff = s.wins - s.losses;
    const shade = 50 + Math.max(-10, Math.min(10, diff)) * 5;
    const text = s.total === 0 ? "—" : diff > 0 ? "+" + diff : diff < 0 ? "−" + Math.abs(diff) : "±0";
    const color = s.total === 0 ? "" : `color:${winRateColor(shade)}`;
    wEl.innerHTML = `<div class="winrate-big" style="${color};${s.total === 0 ? "opacity:0.35" : ""}">${text}</div><div class="winrate-label">${esc(statsMonthLabel || "This month")}</div>`;
  } else if (s.total > 0) {
    const rate = ((s.wins + 0.5 * s.ties) / s.total) * 100;
    wEl.innerHTML = `<div class="winrate-big" style="color:${winRateColor(rate)}">${Math.round(rate)}%</div><div class="winrate-label">Win rate</div>`;
  } else {
    wEl.innerHTML = '<div class="winrate-big" style="opacity:0.35">—</div><div class="winrate-label">Win rate</div>';
  }
  $("stats-summary").innerHTML = `
    <div class="stat-pill"><div class="num">${s.wins}</div><div class="lbl">Wins</div></div>
    <div class="stat-pill"><div class="num">${s.ties}</div><div class="lbl">Ties</div></div>
    <div class="stat-pill"><div class="num">${s.losses}</div><div class="lbl">Losses</div></div>
    <div class="stat-pill"><div class="num">${s.total}</div><div class="lbl">Played</div></div>`;
}
function renderFinalBoard(units) {
  if (!units || !units.length) return '<span style="opacity:0.4;font-size:0.85rem;">— empty board —</span>';
  return units.map((u) => {
    const cards = (u.cards || []).map((c) => cardHTML(c)).join("");
    const scored = u.points > 0;
    const badge = scored ? `<div class="pts-badge">+${u.points}</div>` : "";
    return `<div class="go-unit ${scored ? "scored" : ""}">${cards}${badge}</div>`;
  }).join("");
}
function toggleFinalBoard(btn) {
  const open = btn.nextElementSibling.classList.toggle("open");
  btn.textContent = open ? "Hide final board" : "See final board";
}
function renderHistory(history, fixedOpp) {
  return history.map((g) => {
    const win = g.you_score > g.opp_score, tie = g.you_score === g.opp_score;
    const cls = win ? "hist-win" : tie ? "hist-tie" : "hist-loss";
    const word = win ? "WON" : tie ? "TIE" : "LOST";
    const date = new Date(g.finished_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const opp = esc(fixedOpp || (g.vs_bot ? "Bot" : g.opp_name));
    return `<div class="hist-row">
      <div class="hist-head"><span class="hist-result ${cls}">${word} ${g.you_score}–${g.opp_score}</span><span class="hist-date">${date}</span></div>
      <div class="hist-vs">vs ${opp}</div>
      <button class="hist-toggle" onclick="toggleFinalBoard(this)">See final board</button>
      <div class="hist-final">
        <div class="hf-side"><div class="hf-label">${esc(currentUser.display_name)}'s board</div><div class="go-units">${renderFinalBoard(g.you_board)}</div><div class="hf-score">Score: ${g.you_score}</div></div>
        <div class="hf-side"><div class="hf-label">${opp}'s board</div><div class="go-units">${renderFinalBoard(g.opp_board)}</div><div class="hf-score">Score: ${g.opp_score}</div></div>
      </div>
    </div>`;
  }).join("");
}
async function loadOverall() {
  $("stats-name").textContent = "Overall";
  $("stats-winrate").innerHTML = "";
  $("stats-summary").innerHTML = '<span style="opacity:0.5;">Loading…</span>';
  $("stats-history").innerHTML = "";
  try {
    const r = await fetch("/api/overall" + (statsPeriod === "monthly" ? "?period=monthly" : ""));
    const d = await r.json();
    if (!r.ok) { $("stats-summary").innerHTML = '<span style="opacity:0.5;">Could not load stats.</span>'; return; }
    statsMonthLabel = d.month_label || "";
    renderSummary(d.stats);
    const hist = d.history || [];
    $("stats-history").innerHTML = hist.length ? renderHistory(hist, null)
      : `<div class="hist-empty">${statsPeriod === "monthly" ? "No games this month yet." : "No games yet — play one!"}</div>`;
  } catch (e) {
    $("stats-summary").innerHTML = '<span style="opacity:0.5;">Network error.</span>';
  }
}
async function loadHeadToHead(username) {
  $("stats-winrate").innerHTML = "";
  $("stats-summary").innerHTML = '<span style="opacity:0.5;">Loading…</span>';
  $("stats-history").innerHTML = "";
  try {
    const r = await fetch("/api/headtohead?opponent=" + encodeURIComponent(username) + (statsPeriod === "monthly" ? "&period=monthly" : ""));
    const d = await r.json();
    if (!r.ok) { $("stats-summary").innerHTML = '<span style="opacity:0.5;">Could not load stats.</span>'; return; }
    const oppName = d.opponent.display_name;
    $("stats-name").textContent = "vs " + oppName;
    statsMonthLabel = d.month_label || "";
    renderSummary(d.stats);
    const hist = d.history || [];
    $("stats-history").innerHTML = hist.length ? renderHistory(hist, oppName)
      : `<div class="hist-empty">No games against ${esc(oppName)} ${statsPeriod === "monthly" ? "this month" : "yet"}.</div>`;
  } catch (e) {
    $("stats-summary").innerHTML = '<span style="opacity:0.5;">Network error.</span>';
  }
}

// ================================================================ ADMIN
let adminLogResult = null;
let adminLogPicks = { 1: null, 2: null };
function showAdmin() { showScreen("admin-screen"); showAdminTab("players"); }
function showAdminTab(tab) {
  $("admin-tab-players").classList.toggle("active", tab === "players");
  $("admin-tab-games").classList.toggle("active", tab === "games");
  $("admin-tab-log").classList.toggle("active", tab === "log");
  $("admin-list").style.display = tab === "players" ? "" : "none";
  $("admin-games-list").style.display = tab === "games" ? "" : "none";
  $("admin-log-panel").style.display = tab === "log" ? "block" : "none";
  if (tab === "players") loadAdminPlayers();
  if (tab === "games") loadAdminGames();
  if (tab === "log") resetAdminLogPanel();
}
async function loadAdminPlayers() {
  const list = $("admin-list");
  list.innerHTML = '<div class="hist-empty">Loading…</div>';
  let players = [];
  try {
    const r = await fetch("/api/admin/players");
    if (!r.ok) { list.innerHTML = '<div class="hist-empty">Not authorized.</div>'; return; }
    players = (await r.json()).players || [];
  } catch (e) { list.innerHTML = '<div class="hist-empty">Could not load.</div>'; return; }
  if (!players.length) { list.innerHTML = '<div class="hist-empty">No players yet.</div>'; return; }
  list.innerHTML = players.map((p) => `
    <div class="hist-row"><div class="hist-head"><span>${esc(p.display_name)}</span><span class="hist-result">${p.games} game${p.games === 1 ? "" : "s"}</span></div></div>`).join("");
}
async function loadAdminGames() {
  const list = $("admin-games-list");
  list.innerHTML = '<div class="hist-empty">Loading…</div>';
  let games = [];
  try {
    const r = await fetch("/api/admin/games");
    if (!r.ok) { list.innerHTML = '<div class="hist-empty">Not authorized.</div>'; return; }
    games = (await r.json()).games || [];
  } catch (e) { list.innerHTML = '<div class="hist-empty">Could not load.</div>'; return; }
  if (!games.length) { list.innerHTML = '<div class="hist-empty">No games yet.</div>'; return; }
  list.innerHTML = games.map((g, i) => {
    const p2 = g.vs_bot ? "Bot" : g.p2_name;
    const winner = g.winner === 1 ? g.p1_name : g.winner === 2 ? p2 : null;
    const cls = g.winner === 1 ? "hist-win" : g.winner === 2 ? "hist-loss" : "hist-tie";
    const date = new Date(g.finished_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const specs = g.spectators || [];
    return `<div class="hist-row">
      <div class="hist-head"><span>${esc(g.p1_name)} <strong>${g.p1_score}</strong> – <strong>${g.p2_score}</strong> ${esc(p2)}</span><span class="hist-date">${date}</span></div>
      <div class="hist-vs ${cls}" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span>${winner ? esc(winner) + " won" : "Tie"}</span>
        <button class="hist-toggle admin-spec-toggle" style="margin:0;" onclick="toggleAdminSpectators(${i})">👁 ${specs.length}</button>
      </div>
      <div class="hist-final admin-spec-panel" id="admin-spec-${i}">
        ${specs.length ? specs.map((n) => `<div class="sp-name">${esc(n)}</div>`).join("") : '<div class="sp-empty">No spectators</div>'}
      </div>
    </div>`;
  }).join("");
}
function toggleAdminSpectators(i) { $(`admin-spec-${i}`).classList.toggle("open"); }
function resetAdminLogPanel() {
  adminLogResult = null;
  adminLogPicks = { 1: null, 2: null };
  $("log-p1-input").value = "";
  $("log-p2-input").value = "";
  $("admin-log-error").textContent = "";
  ["p1", "tie", "p2"].forEach((r) => $("log-result-" + r).classList.remove("active"));
}
function setAdminLogResult(r) {
  adminLogResult = r;
  ["p1", "tie", "p2"].forEach((x) => $("log-result-" + x).classList.toggle("active", x === r));
}
let adminSearchTimer = null;
function onAdminLogSearchInput(v, n) {
  adminLogPicks[n] = null;
  clearTimeout(adminSearchTimer);
  if (v.trim().length < 3) return hideAdminLogResults(n);
  adminSearchTimer = setTimeout(() => runAdminLogSearch(v.trim(), n), 200);
}
async function runAdminLogSearch(q, n) {
  const box = $(`log-p${n}-results`);
  try {
    const d = await (await fetch("/api/search_players?q=" + encodeURIComponent(q))).json();
    let players = d.players || [];
    if (currentUser && currentUser.username.includes(q.toLowerCase())) players = [{ username: currentUser.username, display_name: currentUser.display_name, games: "" }, ...players];
    box.innerHTML = players.length
      ? players.map((p) => `<div class="search-result-row" onclick="pickAdminLogResult(${n},'${esc(p.username)}','${esc(p.display_name)}')"><span>${esc(p.display_name)}</span><span class="srr-games">${p.games === "" ? "" : p.games + " games"}</span></div>`).join("")
      : '<div class="hist-empty" style="padding:8px;">No players found.</div>';
    box.style.display = "block";
  } catch (e) {}
}
function pickAdminLogResult(n, username, name) {
  adminLogPicks[n] = username;
  $(`log-p${n}-input`).value = name;
  hideAdminLogResults(n);
}
function hideAdminLogResults(n) { $(`log-p${n}-results`).style.display = "none"; }
async function submitAdminLogGame() {
  const err = $("admin-log-error");
  err.textContent = "";
  const p1 = adminLogPicks[1] || $("log-p1-input").value.trim();
  const p2 = adminLogPicks[2] || $("log-p2-input").value.trim();
  if (!p1 || !p2) return (err.textContent = "Pick both players.");
  if (!adminLogResult) return (err.textContent = "Pick a result.");
  const r = await fetch("/api/admin/log_game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p1, p2, result: adminLogResult }) });
  const d = await r.json();
  if (!r.ok) return (err.textContent = d.error || "Could not log game.");
  showToast("Game logged.", "info");
  resetAdminLogPanel();
}

// ================================================================ CARDS
const ROYAL_ICONS = {
  J: { icon: "⚔️", title: "Jack", bg: "⚔" },
  Q: { icon: "♛", title: "Queen", bg: "♛" },
  K: { icon: "♚", title: "King", bg: "♚" },
  E: { icon: "👑", title: "Emperor", bg: "♛" },
};
function cardHTML(card, cls) {
  const r = card.rank;
  const extra = cls || "";
  if (r === "W") {
    return `<div class="card card-joker ${extra}"><div class="corner corner-tl">🃏</div><div class="card-icon">🃏</div><div class="rank">🃏</div><div class="joker-label">Joker</div><div class="corner corner-br">🃏</div></div>`;
  }
  if (r === "A") {
    return `<div class="card card-ace ${extra}"><div class="corner corner-tl">A</div><div class="card-icon">⚠</div><div class="rank">A</div><div class="ace-label">Trap</div><div class="corner corner-br">A</div></div>`;
  }
  if (ROYAL_ICONS[r]) {
    const info = ROYAL_ICONS[r];
    const pts = { J: 1, Q: 2, K: 3, E: 4 }[r];
    const sc = "rs-" + (card.style || (r === "E" ? "imperial" : "crimson"));
    return `<div class="card card-royal ${extra} ${sc}"><div class="corner corner-tl">${r}</div><div class="royal-bg-icon">${info.bg}</div><div class="royal-icon">${info.icon}</div><div class="royal-rank">${info.title}</div><div class="royal-title">${pts} pt${pts > 1 ? "s" : ""}</div><div class="corner corner-br">${r}</div></div>`;
  }
  return `<div class="card card-knight ${extra}"><div class="corner corner-tl">${r}</div><div class="card-icon">⚔</div><div class="rank">${r}</div><div class="knight-label">Knight</div><div class="corner corner-br">${r}</div></div>`;
}
function cardBackHTML(cls) { return `<div class="card card-back ${cls || ""}"></div>`; }
function smallCardHTML(card) { return cardHTML(card).replace('class="card ', 'class="card sm-card '); }

// ================================================================ GAME
socket.on("game_state", (s) => {
  pendingPrank = null; // next game only
  prankState.enabled = false;
  const wasMulligan = state && state.phase === "mulligan";
  if (wasMulligan && s.phase !== "mulligan" && s.phase !== "game_over") {
    let label;
    let firstIsP1;
    if (s.is_spectator) {
      const n = s.spectator_current_turn === 1 ? s.p1_name : s.spectator_current_turn === 2 ? s.p2_name : "Someone";
      label = n + " goes first!";
      firstIsP1 = s.spectator_current_turn === 1;
    } else {
      label = s.your_turn ? "You go first!" : "Opponent goes first!";
      firstIsP1 = s.your_turn ? s.player_number === 1 : s.player_number === 2;
    }
    playCoinFlip(label, !firstIsP1);
  }
  if (s.attack_anim) playAttackAnimation(s.attack_anim, s);
  if (s.deploy_anim) playDeployFlash(s.deploy_anim, s);
  if (s.event_logs) s.event_logs.forEach((m) => addLog(esc(m)));
  applyState(s);
  if (s.discard_anim) playDiscardAnimation(s.discard_anim);
});

function applyState(s) {
  if (state && s.phase !== "mulligan" && s.phase !== "game_over" && state.your_turn !== s.your_turn && !s.is_spectator) {
    addTurnSeparator(s.your_turn ? "Your turn" : "Opponent's turn");
  }
  state = s;
  hideAll();
  $("game").style.display = "block";
  applyWinrateBg(state.bg_winrate);
  let b = "";
  if (state.no_scoring) b += '<span class="mode-badge">No scoring</span>';
  if (state.reveal_attacked) b += '<span class="mode-badge">Reveal attacked</span>';
  $("mode-badges").innerHTML = b;
  updateTurnTimer(state);
  $("ingame-help").style.display = "block";
  $("settings-btn").style.display = "block";
  selectedIndices = [];
  if (state.phase === "mulligan" && !state.is_spectator) showMulligan();
  else $("mulligan-overlay").classList.remove("visible");
  render();
  if (state.phase === "game_over") playEndgameAnimation();
}

function render() {
  if (!state) return;
  const isSpec = state.is_spectator;
  $("emote-wrap").classList.toggle("visible", !isSpec && !["waiting", "mulligan", "game_over"].includes(state.phase));
  renderSpectatorNames("spectator_names" in state ? state.spectator_names : spectatorEntries);
  const t = $("turn-text");
  if (state.phase === "game_over") { t.textContent = "Game Over"; t.style.color = "#fff"; }
  else if (isSpec) {
    const n = state.spectator_current_turn === 1 ? state.p1_name || "Player 1" : state.spectator_current_turn === 2 ? state.p2_name || "Player 2" : "?";
    t.textContent = "Spectating — " + n + "'s turn";
    t.style.color = "#ffd54f";
  } else {
    t.textContent = state.your_turn ? "Your Turn" : "Opponent's Turn";
    t.style.color = state.your_turn ? "#66bb6a" : "#ef9a9a";
  }
  $("phase-badge").textContent = { action: "Take Action", deploy: "Deploying", discard_for_b: "Discard 2", forced_attack: "Must Attack", turn_over: "End Turn", discard_excess: "Discard Excess", game_over: "Game Over", mulligan: "Mulligan" }[state.phase] || "";
  $("actions-badge").textContent = !isSpec && state.your_turn && state.phase === "action" ? "Actions: " + state.actions_remaining : "";

  const labels = document.querySelectorAll("#game .section-label");
  if (isSpec) {
    const p1 = esc(state.p1_name || "Player 1"), p2 = esc(state.p2_name || "Player 2");
    labels[0].innerHTML = `${p2}'s hand (<span id="opp-hand-count">${state.opponent_hand_count}</span>)`;
    labels[1].textContent = `${state.p2_name}'s board`;
    labels[2].textContent = `${state.p1_name}'s board`;
    labels[3].innerHTML = `${p1}'s hand (<span id="your-hand-count">${state.your_hand_count || 0}</span>)`;
  } else {
    labels[0].innerHTML = `Opponent's hand (<span id="opp-hand-count">0</span>)`;
    labels[1].textContent = "Opponent's board";
    labels[2].textContent = "Your board";
    labels[3].textContent = "Your hand";
  }
  $("opp-hand-count").textContent = state.opponent_hand_count;
  const oh = $("opp-hand");
  if (isSpec && state.opponent_hand) oh.innerHTML = state.opponent_hand.map((c) => cardHTML(c)).join("");
  else oh.innerHTML = Array.from({ length: state.opponent_hand_count }, () => cardBackHTML("opp-hand-card")).join("");

  renderBoard("opp-board", state.opponent_board, true);
  const deckEl = $("deck-card");
  deckEl.style.display = state.deck_count > 0 ? "inline-flex" : "none";
  deckEl.classList.toggle("deck-low", state.deck_count <= 5 && state.deck_count > 0);
  $("deck-count").textContent = state.deck_count;
  $("discard-card").innerHTML = state.discard_top ? cardHTML(state.discard_top) : '<div class="card empty-pile"></div>';
  $("discard-count").textContent = state.discard_count;
  renderBoard("your-board", state.board, false);
  updateBoardWidth();
  renderHand();
  renderActions();
}

function renderBoard(id, data, isOpp) {
  const el = $(id);
  el.innerHTML = "";
  if (!data || !data.length) { el.innerHTML = '<span style="opacity:0.3;font-size:0.8rem;">No units</span>'; return; }
  data.forEach((u) => {
    const g = document.createElement("div");
    g.className = isOpp && !u.revealed ? "unit-group unit-group-hidden" : "unit-group";
    if (u.revealed_by_attack) g.className += " unit-exposed";
    g.style.position = "relative";
    if (isOpp && !u.revealed) g.innerHTML = Array.from({ length: u.card_count }, () => cardBackHTML()).join("");
    else {
      g.innerHTML = (u.cards || []).map((c) => cardHTML(c)).join("");
      if (u.absorbed) g.innerHTML += '<div class="trapped-tag">TRAPPED</div>';
    }
    el.appendChild(g);
  });
}
function updateBoardWidth() {
  const yourCount = (state.board || []).reduce((s, u) => s + (u.cards ? u.cards.length : u.card_count), 0);
  const oppCount = (state.opponent_board || []).reduce((s, u) => s + (u.cards ? u.cards.length : u.card_count), 0);
  $("your-board-row").classList.toggle("board-wide", yourCount >= 8);
  $("opp-board-row").classList.toggle("board-wide", oppCount >= 8);
}

function renderHand() {
  const el = $("your-hand");
  el.innerHTML = "";
  const hand = state.hand || [];
  if (state.is_spectator) { el.innerHTML = hand.map((c) => cardHTML(c)).join(""); return; }
  const canSel = state.your_turn && ["action", "deploy", "forced_attack", "discard_for_b", "discard_excess"].includes(state.phase);
  const overLimit = hand.length > 10;
  hand.forEach((card, i) => {
    const sel = selectedIndices.includes(i);
    const dim = state.phase === "discard_for_b" && selectedIndices.length >= 2 && !sel;
    const wrap = document.createElement("div");
    wrap.innerHTML = cardHTML(card, `hand-card${sel ? " selected" : ""}${dim ? " dimmed" : ""}${overLimit ? " over-limit" : ""}`);
    const div = wrap.firstElementChild;
    if (canSel && !dim) {
      div.onclick = () => {
        const x = selectedIndices.indexOf(i);
        x >= 0 ? selectedIndices.splice(x, 1) : selectedIndices.push(i);
        renderHand();
        renderActions();
      };
      div.draggable = true;
      div.ondragstart = (e) => {
        if (!selectedIndices.includes(i)) { selectedIndices.push(i); renderHand(); renderActions(); }
        e.dataTransfer.setData("text/plain", "cards");
        e.dataTransfer.effectAllowed = "move";
      };
    }
    el.appendChild(div);
  });
}

function addBtn(parent, text, cls, fn, disabled) {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.onclick = fn;
  if (disabled) b.disabled = true;
  parent.appendChild(b);
}
function hideAllDropZones() { document.querySelectorAll(".drop-zone").forEach((z) => z.classList.remove("visible", "drag-over")); }

function renderActions() {
  const el = $("actions");
  el.innerHTML = "";
  hideAllDropZones();
  if (!state || state.phase === "mulligan" || state.phase === "game_over") return;
  if (state.is_spectator) { el.innerHTML = '<div class="action-label" style="opacity:0.6;color:#ffd54f;">SPECTATING</div>'; return; }
  if (!state.your_turn) { el.innerHTML = '<div class="action-label" style="opacity:0.5">Waiting for opponent...</div>'; return; }
  const av = state.available_actions || [];
  const hs = selectedIndices.length > 0;

  if (av.includes("end_turn")) {
    if (endTurnSent === state.turn_token) return;
    endTurnSent = state.turn_token;
    const flash = document.createElement("div");
    flash.className = "auto-end-flash";
    flash.textContent = "END TURN";
    document.body.appendChild(flash);
    setTimeout(() => { flash.remove(); socket.emit("end_turn"); }, 550);
    return;
  }
  if (av.includes("discard")) {
    el.innerHTML = `<div class="action-label">Select 2 cards to discard (${selectedIndices.length}/2)</div>`;
    addBtn(el, "Discard Selected", "btn btn-danger", () => socket.emit("discard_cards", { indices: selectedIndices }), selectedIndices.length !== 2);
    if (av.includes("cancel_path_b")) addBtn(el, "Undo", "btn btn-secondary", () => socket.emit("cancel_path_b"));
    return;
  }
  if (av.includes("discard_excess")) {
    const excess = state.hand.length - 10;
    el.innerHTML = `<div class="action-label">Hand over 10 — discard ${excess} card${excess > 1 ? "s" : ""} (${selectedIndices.length}/${excess} selected)</div>`;
    addBtn(el, "Discard Selected", "btn btn-danger", () => socket.emit("discard_excess", { indices: selectedIndices }), selectedIndices.length < 1);
    return;
  }
  const forced = state.phase === "forced_attack", deploying = state.phase === "deploy";
  if (forced) el.innerHTML = '<div class="action-label">Deck empty — attack or discard all</div>';
  else if (deploying) el.innerHTML = '<div class="action-label">Deploy more units or finish</div>';
  else el.innerHTML = `<div class="action-label">Take an action (${state.actions_remaining} left)</div>`;

  if (hs && av.includes("deploy")) { $("dz-dep-left").classList.add("visible"); $("dz-dep-right").classList.add("visible"); }
  if (hs && av.includes("attack")) { $("dz-atk-left").classList.add("visible"); $("dz-atk-right").classList.add("visible"); }
  if (!hs && (av.includes("deploy") || av.includes("attack"))) {
    const h = document.createElement("div");
    h.style.cssText = "font-size:0.8rem;opacity:0.5;width:100%;text-align:center;";
    h.textContent = "Select cards, then drag or click a zone on the board";
    el.appendChild(h);
  }
  if (av.includes("finish_deploy")) addBtn(el, "Done Deploying", "btn btn-secondary", () => socket.emit("finish_deploy"));
  if (av.includes("pass")) addBtn(el, "Pass", "btn btn-secondary", () => socket.emit("pass_action"));
  if (av.includes("pass_discard_all")) addBtn(el, "Pass & Discard All", "btn btn-danger", () => socket.emit("pass_discard_all"));
  if (av.includes("switch_path_b")) addBtn(el, "Discard 2, Put 2", "btn btn-sm btn-secondary", () => socket.emit("switch_to_path_b"), !state.can_path_b);
}

function validateSameRank() {
  if (!selectedIndices.length) return false;
  const hand = state.hand;
  const real = selectedIndices.filter((i) => hand[i].rank !== "W");
  if (real.length && !real.every((i) => hand[i].rank === hand[real[0]].rank)) {
    showToast("Selected cards must be the same rank!");
    return false;
  }
  return true;
}
function doAction(type, side) {
  if (!validateSameRank()) return;
  socket.emit(type, { card_indices: selectedIndices, side });
}
function setupDropZones() {
  [["dz-dep-left", "deploy", "left"], ["dz-dep-right", "deploy", "right"], ["dz-atk-left", "attack", "left"], ["dz-atk-right", "attack", "right"]].forEach(([id, action, side]) => {
    const el = $(id);
    el.onclick = () => { if (el.classList.contains("visible")) doAction(action, side); };
    el.ondragover = (e) => { e.preventDefault(); el.classList.add("drag-over"); };
    el.ondragleave = () => el.classList.remove("drag-over");
    el.ondrop = (e) => { e.preventDefault(); el.classList.remove("drag-over"); if (el.classList.contains("visible")) doAction(action, side); };
  });
}
setupDropZones();

function updateTurnTimer(s) {
  const el = $("turn-timer");
  const active = s.time_limit && !["game_over", "mulligan"].includes(s.phase);
  if (!active) {
    el.textContent = "";
    if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
    turnTimerToken = null;
    return;
  }
  if (s.turn_token !== turnTimerToken) {
    turnTimerToken = s.turn_token;
    if (turnTimerInterval) clearInterval(turnTimerInterval);
    let remaining = s.time_limit;
    const draw = () => {
      el.textContent = "⏱ " + remaining + "s";
      el.style.color = remaining <= 5 ? "#ef5350" : "";
    };
    draw();
    turnTimerInterval = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      draw();
      if (s.your_turn && remaining >= 1 && remaining <= 5) sfxTick();
      if (remaining <= 0) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
    }, 1000);
  }
}

// --- mulligan
function showMulligan() {
  $("mulligan-overlay").classList.add("visible");
  $("mulligan-hand").innerHTML = (state.hand || []).map((c) => cardHTML(c)).join("");
  const decided = state.mulligan_waiting;
  $("mulligan-buttons").style.display = decided ? "none" : "flex";
  $("mulligan-wait").style.display = decided ? "block" : "none";
}
function doMulligan(m) { socket.emit("mulligan", { mulligan: m }); }

// --- spectators
function toggleSpectatorPanel() { $("spectator-panel").classList.toggle("open"); }
function renderSpectatorNames(entries) {
  spectatorEntries = entries || [];
  const isSpec = !!(state && state.is_spectator);
  const isAdmin = currentUser && currentUser.username === "poumsday";
  const canSee = !isSpec || isAdmin;
  const inPlay = state && state.phase !== "waiting" && state.phase !== "game_over";
  $("spectator-wrap").classList.toggle("visible", !!(canSee && inPlay));
  if (!canSee) return;
  const canKick = !isSpec;
  const count = $("spectator-count");
  count.textContent = spectatorEntries.length;
  count.style.display = spectatorEntries.length ? "block" : "none";
  $("spectator-list").innerHTML = spectatorEntries.length
    ? spectatorEntries.map((s) => `<div class="sp-row"><span class="sp-name">${esc(s.name)}</span>${canKick ? `<button class="sp-kick" onclick="kickSpectator('${s.sid}')" aria-label="Remove ${esc(s.name)}">✕</button>` : ""}</div>`).join("")
    : '<div class="sp-empty">No one yet</div>';
}
function kickSpectator(sid) {
  const entry = spectatorEntries.find((s) => s.sid === sid);
  if (!confirm(`Remove ${entry ? entry.name : "this spectator"} from the game?`)) return;
  socket.emit("kick_spectator", { sid });
}

// --- emotes
const EMOTE_CONTENT = { laugh: "😂", angry: "😡", think: "🤔", thanks: "Thank you", toast: "TOAST", sketch: "SKETCH" };
function toggleEmoteMenu(force) {
  const menu = $("emote-menu");
  menu.classList.toggle("open", force === undefined ? !menu.classList.contains("open") : force);
}
function sendEmote(type) {
  toggleEmoteMenu(false);
  if (emoteCooling) return;
  emoteCooling = true;
  $("emote-btn").classList.add("cooling");
  setTimeout(() => { emoteCooling = false; $("emote-btn").classList.remove("cooling"); }, 1500);
  socket.emit("emote", { type });
}
socket.on("emote", (e) => {
  if (!EMOTE_CONTENT[e.type]) return;
  const row = $(e.side === "you" ? "your-board-row" : "opp-board-row");
  if (!row) return;
  document.querySelectorAll(`.emote-bubble.from-${e.side}`).forEach((b) => b.remove());
  const rect = row.getBoundingClientRect();
  const bubble = document.createElement("div");
  bubble.className = `emote-bubble ${e.type} from-${e.side}`;
  bubble.textContent = EMOTE_CONTENT[e.type];
  bubble.style.left = rect.left + rect.width / 2 + "px";
  if (e.side === "you") bubble.style.bottom = window.innerHeight - rect.top + 8 + "px";
  else bubble.style.top = rect.bottom + 8 + "px";
  document.body.appendChild(bubble);
  setTimeout(() => bubble.remove(), 3300);
});

// --- event log
function addLog(msg) {
  logTurns[logTurns.length - 1].push(msg);
  renderLog();
}
function addTurnSeparator(label) {
  logTurns.push([]);
  if (logTurns.length > 4) logTurns.splice(0, logTurns.length - 4);
  logTurns[logTurns.length - 1].push({ sep: label });
  renderLog();
}
function renderLog() {
  const el = $("event-log");
  let html = "";
  for (const turn of logTurns.slice(-3)) for (const m of turn) html += m && m.sep ? `<div class="log-turn-sep">${m.sep}</div>` : `<div>${m}</div>`;
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

// --- animations
function playCoinFlip(text, landBack) {
  const ov = $("coinflip-overlay"), inner = $("coin-inner"), result = $("coin-result");
  inner.classList.remove("land-p2");
  result.style.animation = "none";
  result.textContent = "";
  void inner.offsetWidth;
  inner.style.animation = "none";
  void inner.offsetWidth;
  inner.style.animation = "";
  if (landBack) inner.classList.add("land-p2");
  result.style.animation = "";
  result.textContent = text;
  ov.classList.add("visible");
  setTimeout(() => ov.classList.remove("visible"), 1500);
}
function playDiscardAnimation(pair) {
  const dc = $("discard-card"), countEl = $("discard-count");
  if (!pair || pair.length < 2) return;
  const finalHTML = dc.innerHTML, finalCount = countEl.textContent;
  dc.innerHTML = cardHTML(pair[0]);
  countEl.textContent = String(Math.max(0, parseInt(finalCount, 10) - 1));
  setTimeout(() => { dc.innerHTML = finalHTML; countEl.textContent = finalCount; }, 1000);
}
function playDeployFlash(deploy, s) {
  sfxDeploy();
  const isMe = s.is_spectator ? deploy.player === 1 : deploy.player === s.player_number;
  const boardEl = $(isMe ? "your-board" : "opp-board");
  const handEl = $(isMe ? "your-hand" : "opp-hand");
  if ($("game").style.display === "none") return;
  const boardRect = boardEl.getBoundingClientRect();
  const handRect = handEl.getBoundingClientRect();
  const fly = document.createElement("div");
  fly.className = "card card-back deploy-anim-card";
  fly.style.width = "68px";
  fly.style.height = "98px";
  fly.style.left = handRect.left + handRect.width / 2 - 34 + "px";
  fly.style.top = (isMe ? handRect.top : handRect.bottom) + "px";
  fly.style.transform = "scale(0.6)";
  fly.style.opacity = "0.8";
  document.body.appendChild(fly);
  const tx = deploy.side === "left" ? boardRect.left + 20 : boardRect.right - 88;
  const ty = boardRect.top + boardRect.height / 2 - 49;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fly.style.left = tx + "px";
    fly.style.top = ty + "px";
    fly.style.transform = "scale(1)";
    fly.style.opacity = "1";
  }));
  setTimeout(() => {
    fly.remove();
    const glow = document.createElement("div");
    glow.className = "deploy-landed-glow";
    glow.style.width = "100px";
    glow.style.height = "100px";
    glow.style.top = "5px";
    if (deploy.side === "left") glow.style.left = "10px";
    else glow.style.right = "10px";
    boardEl.parentElement.appendChild(glow);
    setTimeout(() => glow.remove(), 800);
  }, 520);
}
function atkLabel(u) { if (u.is_royal) return u.rank; const n = u.cards.length; return n > 1 ? `${u.rank}x${n} (${u.power})` : `${u.rank}`; }
function defLabel(u) { if (u.is_royal) return u.rank + " (Royal)"; const n = u.cards.length; return n > 1 ? `${u.rank}x${n} (${u.power})` : `${u.rank}`; }
function finishAnimation() { document.querySelectorAll(".attack-flash").forEach((e) => e.remove()); }
function playAttackAnimation(anim, s) {
  finishAnimation();
  const steps = anim.steps.filter((x) => x.defender);
  const isMeAttacking = s.is_spectator ? anim.attacker_player === 1 : anim.attacker_player === s.player_number;
  const defBoardEl = $(isMeAttacking ? "opp-board" : "your-board");
  const STEP_MS = 1800;
  const atkName = atkLabel(anim.attacker);
  sfxAttack();
  if (!steps.length) { addLog(`${atkName} attacks ${anim.side} — no target`); return; }
  let i = 0;
  function showStep() {
    finishAnimation();
    if (i >= steps.length) return;
    const step = steps[i];
    const dName = defLabel(step.defender);
    if (step.outcome === "destroyed") { addLog(`${atkName} destroys ${dName}` + (step.remaining_power > 0 ? ` (${step.remaining_power} carries)` : "")); sfxUnitDeath(step.defender); }
    else if (step.outcome === "blocked") { addLog(`${atkName} blocked by ${dName}`); sfxUnitDeath(anim.attacker); }
    else if (step.outcome === "both_destroyed") { addLog(`${atkName} and ${dName} both destroyed`); sfxUnitDeath(step.defender); setTimeout(() => sfxUnitDeath(anim.attacker), 200); }
    else if (step.outcome === "absorbed") { addLog(`Ace traps ${atkName}!`); sfxAceTrap(); }
    const flash = document.createElement("div");
    flash.className = "attack-flash";
    flash.innerHTML = anim.attacker.cards.map(smallCardHTML).join("") + '<div class="vs-label">VS</div>' + step.defender.cards.map(smallCardHTML).join("");
    const out = document.createElement("div");
    out.className = "outcome-label";
    if (step.outcome === "destroyed") { out.className += " outcome-destroyed"; out.textContent = step.remaining_power > 0 ? `DESTROYED (+${step.remaining_power} carry)` : "DESTROYED"; }
    else if (step.outcome === "blocked") { out.className += " outcome-blocked"; out.textContent = "BLOCKED"; }
    else if (step.outcome === "both_destroyed") { out.className += " outcome-both"; out.textContent = "MUTUAL DESTRUCTION"; }
    else if (step.outcome === "absorbed") { out.className += " outcome-absorbed"; out.textContent = "TRAPPED BY ACE"; }
    flash.appendChild(out);
    if (anim.side === "left") flash.style.left = "0";
    else flash.style.right = "0";
    flash.style.top = "50%";
    flash.style.transform = "translateY(-50%)";
    defBoardEl.parentElement.appendChild(flash);
    if (step.outcome === "absorbed") {
      const fx = document.createElement("div");
      fx.className = "ace-trap-effect";
      const tx = document.createElement("div");
      tx.className = "ace-trap-text";
      tx.textContent = "ACE TRAP";
      defBoardEl.parentElement.appendChild(fx);
      defBoardEl.parentElement.appendChild(tx);
      setTimeout(() => { fx.remove(); tx.remove(); }, 1200);
    }
    i++;
    setTimeout(i < steps.length ? showStep : finishAnimation, STEP_MS);
  }
  showStep();
}

let endgamePlayed = false;
async function playEndgameAnimation() {
  if (endgamePlayed) return;
  endgamePlayed = true;
  await sleep(300);
  const ov = $("gameover-overlay");
  const yourBoard = $("go-your-board"), oppBoard = $("go-opp-board");
  yourBoard.innerHTML = "";
  oppBoard.innerHTML = "";
  const yourReveal = state.your_board_reveal || [];
  const oppReveal = state.opp_board_reveal || [];
  const spec = state.is_spectator;
  const h3 = document.querySelectorAll("#gameover-box h3");
  h3[0].textContent = spec ? `${state.p1_name}'s board` : "Your board";
  h3[1].textContent = spec ? `${state.p2_name}'s board` : "Opponent's board";
  const yourLbl = spec ? `${state.p1_name}'s score: ` : "Your score: ";
  const oppLbl = spec ? `${state.p2_name}'s score: ` : "Opponent's score: ";
  const build = (data, container) => data.map((u) => {
    const el = document.createElement("div");
    el.className = "go-unit";
    el.innerHTML = u.cards.map(() => '<div class="card card-back" style="width:55px;height:80px;"></div>').join("");
    const badge = document.createElement("div");
    badge.className = "pts-badge";
    el.appendChild(badge);
    container.appendChild(el);
    return { el, badge };
  });
  const reveal = (o, d) => { o.el.innerHTML = d.cards.map(smallCardHTML).join(""); o.el.appendChild(o.badge); };
  const yourUnits = build(yourReveal, yourBoard), oppUnits = build(oppReveal, oppBoard);
  $("go-title").textContent = "Revealing boards...";
  $("go-your-score").textContent = "";
  $("go-opp-score").textContent = "";
  ov.classList.add("visible");
  await sleep(400);
  for (let i = 0; i < yourUnits.length; i++) { reveal(yourUnits[i], yourReveal[i]); await sleep(300); }
  await sleep(200);
  for (let i = 0; i < oppUnits.length; i++) { reveal(oppUnits[i], oppReveal[i]); await sleep(300); }
  await sleep(300);
  $("go-title").textContent = "Scoring royals...";
  await sleep(250);
  const score = async (units, data, id, label) => {
    let total = 0;
    for (let i = 0; i < units.length; i++) {
      const pts = data[i].points;
      if (pts > 0) {
        units[i].el.classList.add("scoring");
        await sleep(150);
        units[i].el.classList.add("scored");
        units[i].badge.textContent = "+" + pts;
        units[i].badge.classList.add("anim-pop");
        total += pts;
        $(id).textContent = label + total;
        await sleep(350);
      }
    }
    if (total === 0) $(id).textContent = label + "0";
    return total;
  };
  const yourTotal = await score(yourUnits, yourReveal, "go-your-score", yourLbl);
  const oppTotal = await score(oppUnits, oppReveal, "go-opp-score", oppLbl);
  await sleep(400);
  let title;
  if (spec) title = yourTotal > oppTotal ? `${state.p1_name} Wins!` : oppTotal > yourTotal ? `${state.p2_name} Wins!` : "It's a Tie!";
  else title = yourTotal > oppTotal ? "You Win!" : oppTotal > yourTotal ? "You Lose" : "It's a Tie!";
  $("go-title").textContent = title;
  $("go-title").classList.add("anim-pop");
}

// ================================================================ HELP
function showHelp() {
  $("help-overlay").classList.add("visible");
  setupExampleDemos();
  setupScoreDemos();
}
function hideHelp() { $("help-overlay").classList.remove("visible"); }
const R = (rank, style) => (style ? { rank, style } : { rank });
const EXAMPLES = {
  "knight-wins": { atk: [R("7")], board: [[R("5")], [R("7")], [R("Q")], [R("10")]],
    steps: [{ idx: 0, kind: "destroyed", text: "7 beats 5 — 2 power carries on" }, { idx: 1, kind: "blocked", text: "2 can't beat 7 — blocked!" }] },
  "carry-through": { atk: [R("9"), R("9")], board: [[R("7")], [R("10")], [R("K")], [R("A")]],
    steps: [{ idx: 0, kind: "destroyed", text: "18 beats 7 — 11 carries on" }, { idx: 1, kind: "destroyed", text: "11 beats 10 — 1 carries on" }, { idx: 2, kind: "tie", text: "Knight meets King — both destroyed" }] },
  "knight-blocked": { atk: [R("5")], board: [[R("8")], [R("Q")], [R("3")]],
    steps: [{ idx: 0, kind: "blocked", text: "5 can't beat 8 — blocked!" }] },
  mutual: { atk: [R("7")], board: [[R("7")], [R("K")], [R("4")]],
    steps: [{ idx: 0, kind: "tie", text: "7 vs 7 — both destroyed" }] },
  "royal-single": { atk: [R("K")], board: [[R("9")], [R("6")], [R("J")]],
    steps: [{ idx: 0, kind: "royal_kill", text: "King removes the 9 — then falls" }] },
  "royal-stack": { atk: [R("K")], board: [[R("8"), R("8")], [R("6")], [R("J")]],
    steps: [{ idx: 0, kind: "royal_kill", text: "King wipes the whole 8+8 unit" }] },
  "knight-hits-royal": { atk: [R("10")], board: [[R("Q")], [R("5")], [R("3")]],
    steps: [{ idx: 0, kind: "tie", text: "10 hits the Queen — both destroyed" }] },
  "ace-trap-knight": { atk: [R("8")], board: [[R("A")], [R("K")], [R("4")]],
    steps: [{ idx: 0, kind: "trap", text: "Ace trap! The 8 changes sides" }] },
  "ace-trap-royal": { atk: [R("K")], board: [[R("A")], [R("Q")], [R("6")]],
    steps: [{ idx: 0, kind: "trap", text: "Ace trap! The King now scores for them" }] },
};
const SCORE_SCENARIOS = {
  s1: { units: [[R("8")], [R("K")], [R("J")], [R("4")], [R("Q"), R("W")]], calc: "King 3 + Jack 1 + Queen with Joker (2 + 2) = 8 points" },
  s2: { units: [[R("W")], [R("7"), R("W")], [R("A")], [R("E")]], calc: "Joker alone 2 + Joker with a 7 = 2 + Emperor 4 = 8 points" },
};
function setupScoreDemos() {
  document.querySelectorAll(".score-demo").forEach((demo) => {
    if (demo.dataset.initialized) return;
    demo.dataset.initialized = "1";
    const sc = SCORE_SCENARIOS[demo.dataset.scenario];
    if (!sc) return;
    demo.querySelector(".score-board").innerHTML = sc.units.map((u) => `<div class="unit-group">${u.map((c) => cardHTML(c, "sm-card")).join("")}</div>`).join("");
    demo.querySelector(".score-calc").textContent = sc.calc;
  });
}
function setupExampleDemos() {
  document.querySelectorAll(".example-demo").forEach((demo) => {
    if (demo.dataset.initialized) return;
    demo.dataset.initialized = "1";
    const ex = EXAMPLES[demo.dataset.example];
    if (!ex) return;
    renderExampleStage(demo, ex);
    demo.querySelector(".demo-play-btn").onclick = () => playExampleDemo(demo, ex);
  });
}
function renderExampleStage(demo, ex) {
  const stage = demo.querySelector(".demo-stage");
  const labels = [...stage.querySelectorAll(".demo-side-label")];
  stage.innerHTML = "";
  labels.forEach((l) => stage.appendChild(l));
  const atkSlot = document.createElement("div");
  atkSlot.className = "demo-card-slot demo-attacker-slot";
  atkSlot.innerHTML = `<div class="demo-attacker-group">${ex.atk.map((c) => cardHTML(c, "sm-card")).join("")}</div>`;
  stage.appendChild(atkSlot);
  const board = document.createElement("div");
  board.className = "demo-board";
  ex.board.forEach((unit, i) => {
    const slot = document.createElement("div");
    slot.className = "demo-card-slot demo-defender-slot";
    slot.dataset.idx = i;
    slot.innerHTML = `<div class="demo-attacker-group">${unit.map((c) => cardHTML(c, "sm-card")).join("")}</div>`;
    board.appendChild(slot);
  });
  stage.appendChild(board);
  const result = document.createElement("div");
  result.className = "demo-result";
  stage.appendChild(result);
}
function playExampleDemo(demo, ex) {
  renderExampleStage(demo, ex);
  const stage = demo.querySelector(".demo-stage");
  const atkSlot = stage.querySelector(".demo-attacker-slot");
  const defSlots = [...stage.querySelectorAll(".demo-defender-slot")];
  const result = stage.querySelector(".demo-result");
  let stepIdx = 0;
  function runStep() {
    if (stepIdx >= ex.steps.length) return;
    const step = ex.steps[stepIdx];
    const defSlot = defSlots[step.idx];
    defSlots.forEach((s) => s.classList.remove("targeted"));
    defSlot.classList.add("targeted");
    setTimeout(() => atkSlot.classList.add("lunging"), 250);
    setTimeout(() => {
      atkSlot.classList.remove("lunging");
      defSlot.classList.remove("targeted");
      result.classList.remove("show", "win", "loss", "tie", "trap");
      if (step.kind === "destroyed") { defSlot.classList.add("dying"); result.classList.add("show", "win"); sfxKnightDeath(false); }
      else if (step.kind === "blocked") { atkSlot.classList.add("dying"); result.classList.add("show", "loss"); sfxKnightDeath(false); }
      else if (step.kind === "tie") { defSlot.classList.add("dying"); atkSlot.classList.add("dying"); result.classList.add("show", "tie"); sfxKnightDeath(false); }
      else if (step.kind === "royal_kill") { defSlot.classList.add("dying"); setTimeout(() => atkSlot.classList.add("dying"), 400); result.classList.add("show", "win"); sfxKingDeath(); }
      else if (step.kind === "trap") {
        defSlot.classList.add("dying");
        result.classList.add("show", "trap");
        sfxAceTrap();
        setTimeout(() => {
          atkSlot.classList.add("dying");
          defSlot.innerHTML = `<div class="demo-attacker-group">${ex.atk.map((c) => cardHTML(c, "sm-card")).join("")}</div>`;
          defSlot.classList.remove("dying");
          defSlot.style.boxShadow = "0 0 16px 4px rgba(156,39,176,0.7)";
          defSlot.style.borderRadius = "8px";
          defSlot.style.transform = "scale(1.15)";
          setTimeout(() => (defSlot.style.transform = "scale(1)"), 250);
        }, 600);
      }
      result.textContent = step.text;
      stepIdx++;
      if (stepIdx < ex.steps.length) setTimeout(runStep, 1700);
    }, 700);
  }
  setTimeout(runStep, 200);
}

// ================================================================ SAMPLE GAME (scripted walkthrough)
// Units: {c:[cards]} face-up, {h:n} face-down. Cards use R(rank).
const U = (...ranks) => ({ c: ranks.map((r) => R(r)) });
const UO = (...ranks) => ({ c: ranks.map((r) => R(r, ["J", "Q", "K"].includes(r) ? "midnight" : undefined)) });
const H = (n = 1) => ({ h: n });
const WALKTHROUGH_FRAMES = [
  { note: "Here's a quick sample game showing how the rules fit together.", turn: "Game starting…", phase: "Setup", you: [], opp: 0, yb: [], ob: [], deck: 54, disc: 0, ms: 2500 },
  { note: "<strong>Coin flip!</strong> A coin decides who goes first. This time it's you.", turn: "Coin flip…", phase: "Setup", you: [], opp: 0, yb: [], ob: [], deck: 54, disc: 0, ms: 2200 },
  { note: "Each player is dealt <strong>5 cards</strong>. You could mulligan once for a fresh 5, but this hand looks good — a Jack and some solid knights.", turn: "Your starting hand", phase: "Mulligan", you: ["8", "J", "10", "2", "6"], opp: 5, yb: [], ob: [], deck: 44, disc: 0, ms: 4200 },
  { note: "It's your first turn, so <strong>no draw</strong>. Your board is empty, which means the <strong>deploy bonus</strong> is on: you can keep placing units until you have 3.", turn: "Your turn", tc: "you", phase: "Take Action", act: "Actions: 1", you: ["8", "J", "10", "2", "6"], opp: 5, yb: [], ob: [], deck: 44, disc: 0, ms: 4200 },
  { note: "You put the <strong>8</strong> on the left and the <strong>Jack</strong> beside it. Units go down face-down — your opponent can't see them.", turn: "Your turn", tc: "you", phase: "Deploying", act: "2/3 placed", you: ["10", "2", "6"], opp: 5, yb: [U("8"), U("J")], ob: [], deck: 44, disc: 0, ms: 4000 },
  { note: "The <strong>10</strong> goes on the right. That's 3 units, so the deploy action is finished and your turn ends. The Jack is guarded by a knight on each side.", turn: "Your turn", tc: "you", phase: "End Turn", you: ["2", "6"], opp: 5, yb: [U("8"), U("J"), U("10")], ob: [], deck: 44, disc: 0, ms: 4200 },
  { note: "Your opponent's first turn — no draw for them either. They use the bonus to put down <strong>3 face-down units</strong>.", turn: "Opponent's turn", tc: "opp", phase: "Deploying", you: ["2", "6"], opp: 2, yb: [U("8"), U("J"), U("10")], ob: [H(), H(), H()], deck: 44, disc: 0, ms: 4000 },
  { note: "Your second turn: you <strong>draw a 6</strong>. Now you hold a pair of 6s — together they'd make one unit with <strong>12 power</strong>.", turn: "Your turn", tc: "you", phase: "Take Action", act: "Actions: 1", you: ["2", "6", "6"], opp: 2, yb: [U("8"), U("J"), U("10")], ob: [H(), H(), H()], deck: 43, disc: 0, ms: 4200 },
  { note: "You test the water with the lonely <strong>2</strong>, attacking the right end. It runs into a <strong>5</strong> — 2 can't beat 5, so it's <strong>blocked</strong> and lost. Attacking ends your turn.", turn: "Your turn", tc: "you", phase: "End Turn", you: ["6", "6"], opp: 2, yb: [U("8"), U("J"), U("10")], ob: [H(), H(), H()], deck: 43, disc: 1, discTop: "2",
    atk: { side: "right", on: "opp", a: ["2"], d: ["5"], out: "blocked" }, ms: 4600 },
  { note: "Your opponent draws and attacks your left end with a <strong>King</strong>. Royals ignore power: the King takes out your <strong>8</strong> and dies too.", turn: "Opponent's turn", tc: "opp", phase: "End Turn", you: ["6", "6"], opp: 2, yb: [U("J"), U("10")], ob: [H(), H(), H()], deck: 42, disc: 3, discTop: "8",
    atk: { side: "left", on: "you", a: ["K"], d: ["8"], out: "both" }, ms: 4800 },
  { note: "Your Jack is now exposed on the left. You <strong>draw an Ace</strong> — perfect timing. You're down to 2 units, so the <strong>deploy bonus</strong> is back on.", turn: "Your turn", tc: "you", phase: "Take Action", act: "Actions: 1", you: ["6", "6", "A"], opp: 2, yb: [U("J"), U("10")], ob: [H(), H(), H()], deck: 41, disc: 3, discTop: "8", ms: 4600 },
  { note: "You put the <strong>Ace</strong> on the left, right in front of the Jack. On defense an Ace is a <strong>trap</strong>. That's 3 units, so the action is used up.", turn: "Your turn", tc: "you", phase: "End Turn", you: ["6", "6"], opp: 2, yb: [U("A"), U("J"), U("10")], ob: [H(), H(), H()], deck: 41, disc: 3, discTop: "8", ms: 4600 },
  { note: "Your opponent swings a <strong>9</strong> at your left end… straight into the <strong>Ace</strong>! The Ace is spent and the 9 now sits on <strong>your</strong> board.", turn: "Opponent's turn", tc: "opp", phase: "End Turn", you: ["6", "6"], opp: 2, yb: [U("9"), U("J"), U("10")], ob: [H(), H(), H()], deck: 40, disc: 4, discTop: "A",
    atk: { side: "left", on: "you", a: ["9"], d: ["A"], out: "absorbed" }, trapped: 0, ms: 5200 },
  { note: "You draw again and deploy both 6s together as <strong>one unit with 12 power</strong> on the right. (Want two deploys in one turn? Choose <strong>Discard 2, Put 2</strong> — but that turn you can't attack.)", turn: "Your turn", tc: "you", phase: "End Turn", you: ["3"], opp: 2, yb: [U("9"), U("J"), U("10"), U("6", "6")], ob: [H(), H(), H()], deck: 39, disc: 4, discTop: "A", ms: 5000 },
  { note: "Fast-forward: the deck runs out and the <strong>Forced Attack</strong> phase begins. Each turn you must attack or press <strong>Pass &amp; Discard All</strong>.", turn: "Your turn", tc: "you", phase: "Must Attack", you: ["3"], opp: 1, yb: [U("9"), U("J"), U("10"), U("6", "6")], ob: [H(), UO("Q"), H()], deck: 0, disc: 40, discTop: "7", ms: 4600 },
  { note: "Nobody has cards left, so every unit is <strong>flipped</strong>. Only Royals and Jokers still on the board score: your Jack gives you <strong>1 point</strong>, their Queen gives them <strong>2</strong>. So close!", turn: "Game Over", phase: "Game Over", you: [], opp: 0, yb: [U("9"), U("J"), U("10"), U("6", "6")], ob: [U("7"), UO("Q"), U("5")], deck: 0, disc: 44, discTop: "3", ms: 5200 },
  { note: "That's the whole game: <strong>protect your Royals</strong>, use Royals to delete big threats, and watch out for <strong>Aces</strong>. Good luck!", turn: "Game Over", phase: "Game Over", you: [], opp: 0, yb: [U("9"), U("J"), U("10"), U("6", "6")], ob: [U("7"), UO("Q"), U("5")], deck: 0, disc: 44, discTop: "3", ms: 5000 },
];
let wtIndex = 0, wtPaused = false, wtTimer = null;
function openWalkthrough() {
  hideHelp();
  $("walkthrough-overlay").classList.add("visible");
  wtIndex = 0;
  wtPaused = false;
  $("wt-pause-btn").textContent = "⏸ Pause";
  showWalkthroughFrame();
}
function closeWalkthrough() {
  clearTimeout(wtTimer);
  $("walkthrough-overlay").classList.remove("visible");
  document.querySelectorAll("#walkthrough-overlay .attack-flash").forEach((e) => e.remove());
}
function walkthroughTogglePause() {
  wtPaused = !wtPaused;
  $("wt-pause-btn").textContent = wtPaused ? "▶ Play" : "⏸ Pause";
  if (wtPaused) clearTimeout(wtTimer);
  else scheduleNextWalkthroughFrame();
}
function walkthroughNext() { if (wtIndex < WALKTHROUGH_FRAMES.length - 1) { wtIndex++; showWalkthroughFrame(); } }
function walkthroughPrev() { if (wtIndex > 0) { wtIndex--; showWalkthroughFrame(); } }
function scheduleNextWalkthroughFrame() {
  clearTimeout(wtTimer);
  if (wtPaused || wtIndex >= WALKTHROUGH_FRAMES.length - 1) return;
  wtTimer = setTimeout(() => { wtIndex++; showWalkthroughFrame(); }, WALKTHROUGH_FRAMES[wtIndex].ms);
}
function renderWtBoard(id, units, trappedIdx) {
  const el = $(id);
  if (!units.length) { el.innerHTML = '<span style="opacity:0.3;font-size:0.8rem;">No units</span>'; return; }
  el.innerHTML = units.map((u, i) => {
    if (u.h) return `<div class="unit-group unit-group-hidden">${Array.from({ length: u.h }, () => cardBackHTML()).join("")}</div>`;
    return `<div class="unit-group" style="position:relative;">${u.c.map((c) => cardHTML(c)).join("")}${i === trappedIdx ? '<div class="trapped-tag">TRAPPED</div>' : ""}</div>`;
  }).join("");
}
function showWalkthroughFrame() {
  clearTimeout(wtTimer);
  const f = WALKTHROUGH_FRAMES[wtIndex];
  document.querySelectorAll("#walkthrough-overlay .attack-flash").forEach((e) => e.remove());
  $("wt-progress-bar").style.width = ((wtIndex + 1) / WALKTHROUGH_FRAMES.length) * 100 + "%";
  const t = $("wt-turn-text");
  t.textContent = f.turn;
  t.className = "turn-indicator" + (f.tc ? " " + f.tc : "");
  $("wt-phase-badge").textContent = f.phase || "";
  $("wt-actions-badge").textContent = f.act || "";
  $("wt-opp-hand-count").textContent = f.opp;
  $("wt-opp-hand").innerHTML = Array.from({ length: f.opp }, () => cardBackHTML("opp-hand-card")).join("");
  renderWtBoard("wt-opp-board", f.ob);
  renderWtBoard("wt-your-board", f.yb, f.trapped);
  $("wt-your-hand").innerHTML = f.you.map((r) => cardHTML(R(r))).join("");
  $("wt-deck-count").textContent = f.deck;
  $("wt-discard-count").textContent = f.disc;
  $("wt-discard-card").innerHTML = f.discTop ? cardHTML(R(f.discTop)) : '<div class="card empty-pile"></div>';
  $("wt-annotation").innerHTML = f.note;
  $("wt-prev-btn").disabled = wtIndex === 0;
  $("wt-next-btn").disabled = wtIndex === WALKTHROUGH_FRAMES.length - 1;
  if (f.atk) {
    const target = $(f.atk.on === "opp" ? "wt-opp-board" : "wt-your-board").parentElement;
    const flash = document.createElement("div");
    flash.className = "attack-flash";
    const style = (r) => (f.atk.on === "you" && ["J", "Q", "K"].includes(r) ? "midnight" : undefined);
    flash.innerHTML = f.atk.a.map((r) => smallCardHTML(R(r, style(r)))).join("") + '<div class="vs-label">VS</div>' + f.atk.d.map((r) => smallCardHTML(R(r))).join("");
    const out = document.createElement("div");
    const map = { blocked: ["outcome-blocked", "BLOCKED"], both: ["outcome-both", "MUTUAL DESTRUCTION"], absorbed: ["outcome-absorbed", "TRAPPED BY ACE"], destroyed: ["outcome-destroyed", "DESTROYED"] }[f.atk.out];
    out.className = "outcome-label " + map[0];
    out.textContent = map[1];
    flash.appendChild(out);
    if (f.atk.side === "left") flash.style.left = "0";
    else flash.style.right = "0";
    flash.style.top = "50%";
    flash.style.transform = "translateY(-50%)";
    target.appendChild(flash);
    if (f.atk.out === "absorbed") sfxAceTrap();
    else sfxAttack();
  }
  scheduleNextWalkthroughFrame();
}

// ================================================================ PRANK PANEL
// Secret: tap the "Create / Join Room" or "Direct Challenge" title 5 times.
// Settings live only in this tab's memory and go out with the next room you create/join
// or the next challenge you send. Once that game starts they're cleared.
const PRANK_FAIL_STEPS = [0, 1, 2, 3, 4, 5, 7, 9, 19, -1]; // n in "n out of n+1"; -1 = every attack
const PRANK_MARGIN_STEPS = [1, 2, 3, 4, 5, 8, 12, 20, "max"];
const PRANK_CAP_MAX = 15; // the last slider step means "no cap"
const PRANK_DEFAULTS = { enabled: false, fail: -1, margin: 1, royal_cap: 7 };
let prankState = { ...PRANK_DEFAULTS };
let pendingPrank = null; // what the next game will use
function failLabel(n) { return n === 0 ? "Never" : n < 0 ? "Every attack" : `${n} out of ${n + 1}`; }
function capLabel(c) { return c < 0 || c >= PRANK_CAP_MAX ? "No limit" : c === 0 ? "None" : `${c} Royal${c === 1 ? "" : "s"}`; }
function marginLabel(m) { return m === "max" ? "Every hidden card → Emperor" : m === 1 ? "Just enough (by 1)" : `By ${m} points`; }
function renderPrankLabels() {
  $("prank-fail-label").textContent = failLabel(PRANK_FAIL_STEPS[+$("prank-fail").value]);
  $("prank-margin-label").textContent = marginLabel(PRANK_MARGIN_STEPS[+$("prank-margin").value]);
  $("prank-cap-label").textContent = capLabel(+$("prank-cap").value);
}
function renderPrankToggles() {
  for (const [id, key] of [["prank-enabled", "enabled"]]) {
    $(id).textContent = prankState[key] ? "On" : "Off";
    $(id).classList.toggle("active", !!prankState[key]);
  }
}
function togglePrankEnabled() { prankState.enabled = !prankState.enabled; renderPrankToggles(); }
function prankStatus() {
  if (!pendingPrank) return "Prank mode is off for the next game.";
  const p = pendingPrank;
  const f = p.fail === 0 ? "their attacks play out normally" : p.fail < 0 ? "every attack of theirs falls short" : `${p.fail} out of ${p.fail + 1} of their attacks fall short`;
  const m = p.margin === "max" ? "every hidden card becomes an Emperor at the end" : `you win by ${p.margin === 1 ? "just enough" : p.margin + "+"}`;
  const c = p.royal_cap < 0 ? "no Royal limit" : `they draw at most ${p.royal_cap} Royal${p.royal_cap === 1 ? "" : "s"}`;
  return `Armed for your next game: ${f}, ${m}, ${c}.`;
}
function openPrank() {
  prankState = pendingPrank ? { ...pendingPrank, enabled: true } : { ...prankState, enabled: prankState.enabled && !!pendingPrank };
  const fi = PRANK_FAIL_STEPS.indexOf(prankState.fail);
  $("prank-fail").value = fi === -1 ? PRANK_FAIL_STEPS.length - 1 : fi;
  const mi = PRANK_MARGIN_STEPS.indexOf(prankState.margin);
  $("prank-margin").value = mi === -1 ? 0 : mi;
  $("prank-cap").value = prankState.royal_cap < 0 ? PRANK_CAP_MAX : prankState.royal_cap ?? 7;
  renderPrankLabels();
  renderPrankToggles();
  $("prank-status").textContent = prankStatus();
  $("prank-panel").classList.add("visible");
  if (currentUser) loadH2H();
  else $("h2h-list").textContent = "";
}
function savePrank() {
  prankState.fail = PRANK_FAIL_STEPS[+$("prank-fail").value];
  prankState.margin = PRANK_MARGIN_STEPS[+$("prank-margin").value];
  prankState.royal_cap = +$("prank-cap").value >= PRANK_CAP_MAX ? -1 : +$("prank-cap").value;
  pendingPrank = prankState.enabled
    ? { fail: prankState.fail, margin: prankState.margin, royal_cap: prankState.royal_cap }
    : null;
  $("prank-status").textContent = "Saved. " + prankStatus();
}
function closePrank() { $("prank-panel").classList.remove("visible"); }
// Attach the armed prank (if any) to a create/join/challenge request.
function withPrank(payload) { return pendingPrank ? { ...payload, prank: pendingPrank } : payload; }
// The secret gesture: 5 quick taps on the screen title.
function secretTaps(el) {
  let taps = 0, timer = null;
  el.addEventListener("click", () => {
    taps++;
    clearTimeout(timer);
    timer = setTimeout(() => (taps = 0), 1500);
    if (taps >= 5) { taps = 0; openPrank(); }
  });
}
secretTaps(document.querySelector("#room-screen h2"));
secretTaps(document.querySelector("#challenge-screen h2"));
$("prank-panel").addEventListener("click", (e) => { if (e.target.id === "prank-panel") closePrank(); });
async function loadH2H() {
  const d = await (await fetch("/api/prank/h2h")).json();
  $("h2h-list").innerHTML = (d.records || []).map((r) => `vs ${esc(r.display_name)}: ${r.w}-${r.l}-${r.t}`).join(" · ") || "None set.";
}
async function saveH2H() {
  const body = { opponent: $("h2h-user").value.trim(), w: $("h2h-w").value, l: $("h2h-l").value, t: $("h2h-t").value };
  const r = await fetch("/api/prank/h2h", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  $("prank-status").textContent = r.ok ? "Head-to-head record saved." : d.error || "Could not save.";
  if (r.ok) ["h2h-user", "h2h-w", "h2h-l", "h2h-t"].forEach((id) => ($(id).value = ""));
  loadH2H();
}

// ================================================================ BOOT
refreshMe();
backToMenu();
