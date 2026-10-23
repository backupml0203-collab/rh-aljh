// A simple Royalty High bot. It only uses information a real player would have:
// its own hand and board, the size of enemy units, and anything revealed.

const { unitInfo, knightValue, HAND_LIMIT } = require("./game");

const ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "E", "W"];
const isRoyalRank = (r) => ["J", "Q", "K", "E"].includes(r);
const RV = { J: 1, Q: 2, K: 3, E: 4 };

// Indices into the hand, grouped by rank (jokers separate).
function groups(hand) {
  const g = {};
  hand.forEach((c, i) => { if (c.rank !== "W") (g[c.rank] = g[c.rank] || []).push(i); });
  return g;
}
const jokers = (hand) => hand.map((c, i) => (c.rank === "W" ? i : -1)).filter((i) => i >= 0);
const lowest = (hand, n) => hand.map((c, i) => [ORDER.indexOf(c.rank), i]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);

function deploySide(board, royal) {
  let l = 0;
  while (l < board.length && !unitInfo(board[l].cards).royal) l++;
  let r = 0;
  while (r < board.length && !unitInfo(board[board.length - 1 - r].cards).royal) r++;
  if (royal) return l >= r ? "left" : "right";
  return l <= r ? "left" : "right";
}

function pickDeploy(hand, board) {
  const g = groups(hand);
  const j = jokers(hand);
  const royals = Object.keys(g).filter(isRoyalRank).sort((a, b) => RV[b] - RV[a]);
  const royalsOnBoard = board.filter((u) => unitInfo(u.cards).royal).length;
  const shields = board.length - royalsOnBoard;
  if (royals.length && (shields >= royalsOnBoard || board.length < 2)) {
    const r = royals[0];
    if (!(r === "J" && royalsOnBoard >= 2)) return { idx: [...g[r], ...(j.length && r !== "J" ? [j[0]] : [])], royal: true };
  }
  if (g.A && Math.random() < 0.7) return { idx: [g.A[0]], royal: false };
  const knights = Object.keys(g).filter((r) => !isRoyalRank(r) && r !== "A");
  if (knights.length) {
    knights.sort((a, b) => knightValue(b) * g[b].length - knightValue(a) * g[a].length);
    return { idx: g[knights[0]], royal: false };
  }
  if (royals.length) return { idx: g[royals[royals.length - 1]], royal: true };
  if (g.A) return { idx: g.A, royal: false };
  if (j.length) return { idx: [j[0]], royal: true };
  return null;
}

function edge(board, side) { return side === "left" ? board[0] : board[board.length - 1]; }
const knownAce = (u) => u.revealed && unitInfo(u.cards).ace;

function pickAttack(game, pi) {
  const me = game.players[pi];
  const opp = game.players[1 - pi];
  if (!opp.board.length) return null;
  const g = groups(me.hand);
  if (g.J && me.board.length >= 3) {
    let best = null;
    for (const s of ["left", "right"]) {
      const u = edge(opp.board, s);
      if (knownAce(u)) continue;
      const k = u.revealed ? unitInfo(u.cards) : null;
      const score = u.cards.length + (k && k.royal ? 3 : 0);
      if (!best || score > best.score) best = { side: s, score };
    }
    if (best && best.score >= 2) return { idx: [g.J[0]], side: best.side };
  }
  const knights = Object.keys(g).filter((r) => !isRoyalRank(r) && r !== "A").sort((a, b) => knightValue(b) * g[b].length - knightValue(a) * g[a].length);
  for (const r of knights) {
    if (knightValue(r) * g[r].length < 14 || me.board.length < 3) break;
    const sides = ["left", "right"].filter((s) => !knownAce(edge(opp.board, s)));
    if (sides.length && Math.random() < 0.5) return { idx: g[r], side: sides[Math.floor(Math.random() * sides.length)] };
  }
  return null;
}

function pickForcedAttack(game, pi) {
  const me = game.players[pi];
  const opp = game.players[1 - pi];
  if (!opp.board.length || !me.hand.length) return null;
  const sides = ["left", "right"].filter((s) => !knownAce(edge(opp.board, s)));
  if (!sides.length) return null;
  const side = sides[Math.floor(Math.random() * sides.length)];
  const g = groups(me.hand);
  const royal = ["J", "Q", "K", "E"].find((r) => g[r]);
  if (royal) return { idx: [g[royal][0]], side };
  const knights = Object.keys(g).filter((r) => !isRoyalRank(r));
  if (knights.length) {
    knights.sort((a, b) => knightValue(b) * g[b].length - knightValue(a) * g[a].length);
    return { idx: [...g[knights[0]], ...jokers(me.hand)], side };
  }
  const j = jokers(me.hand);
  return j.length ? { idx: [j[0]], side } : null;
}

// Perform exactly one move for the bot. Returns true if it moved.
function botStep(game, pi) {
  if (game.phase === "mulligan") {
    const p = game.players[pi];
    if (p.mulliganDone) return false;
    const strong = p.hand.filter((c) => c.rank === "W" || isRoyalRank(c.rank) || (c.rank !== "A" && knightValue(c.rank) >= 7)).length;
    game.mulligan(pi, strong < 2);
    return true;
  }
  if (game.phase !== "play" || game.turn !== pi) return false;
  const me = game.players[pi];
  const phase = game.phaseName();
  if (phase === "turn_over") return !!game.endTurn(pi);
  if (phase === "discard_excess") return !!game.discardExcess(pi, lowest(me.hand, me.hand.length - HAND_LIMIT));
  if (phase === "forced_attack") {
    const a = pickForcedAttack(game, pi);
    if (a && Math.random() < 0.9) game.attack(pi, a.idx, a.side);
    else game.passDiscardAll(pi);
    return true;
  }
  if (phase === "discard_for_b") return !!game.discardCards(pi, lowest(me.hand, 2));
  if (game.actionsTaken === 0 && phase === "action" && game.path === "A") {
    const a = pickAttack(game, pi);
    if (a) return !!game.attack(pi, a.idx, a.side);
    if (me.board.length >= 3 && me.hand.length >= 7) return !!game.switchToPathB(pi);
  }
  if (phase === "deploy" && me.board.length >= 3) return !!game.finishDeploy(pi);
  const d = me.hand.length ? pickDeploy(me.hand, me.board) : null;
  if (d && game.deploy(pi, d.idx, deploySide(me.board, d.royal)).ok) return true;
  if (phase === "deploy") game.finishDeploy(pi);
  else game.passAction(pi);
  return true;
}

module.exports = { botStep };
