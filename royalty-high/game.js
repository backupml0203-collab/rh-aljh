// Royalty High — rules engine.
// Pure game logic: no sockets, no timers. The server drives it.
//
// Cards are { id, rank, style? } where rank is "A","2".."10","J","Q","K","E" or "W" (Joker).

const KNIGHT_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const ROYAL_RANKS = ["J", "Q", "K", "E"];
const ROYAL_POINTS = { J: 1, Q: 2, K: 3, E: 4 };
const HAND_LIMIT = 10;
const START_HAND = 5;
const PLAYER_STYLES = ["crimson", "midnight"]; // royal card colours for player 1 / player 2

// Deck presets. "normal" is the real game; the rest are for pranks.
const DECK_PRESETS = {
  normal: "Normal deck",
  all_emperors: "Every card is an Emperor",
  royal_emperors: "All 12 Royals are Emperors",
  all_jokers: "Every card is a Joker",
};

const { Prank } = require("./prank");

let uid = 0;
const nextId = (p) => `${p}${(++uid).toString(36)}`;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollRoyal() {
  // 0.7% Emperor, otherwise an even three-way split (33.1% each).
  if (Math.random() < 0.007) return "E";
  return ["J", "Q", "K"][Math.floor(Math.random() * 3)];
}

function buildDeck(preset = "normal") {
  const deck = [];
  const card = (rank) => deck.push({ id: nextId("c"), rank });
  if (preset === "all_emperors") {
    for (let i = 0; i < 54; i++) card("E");
  } else if (preset === "all_jokers") {
    for (let i = 0; i < 54; i++) card("W");
  } else {
    for (const r of KNIGHT_RANKS) for (let i = 0; i < 4; i++) card(r);
    for (let i = 0; i < 12; i++) card(preset === "royal_emperors" ? "E" : rollRoyal());
    card("W");
    card("W");
  }
  return shuffle(deck);
}

const isJoker = (c) => c.rank === "W";
const knightValue = (r) => (r === "A" ? 1 : parseInt(r, 10));

// The rank a group of cards plays as. Jokers take on the rank of whatever they're with.
function baseRank(cards) {
  const real = cards.filter((c) => !isJoker(c));
  return real.length ? real[0].rank : "W";
}

function validGroup(cards) {
  if (!cards.length) return false;
  const real = cards.filter((c) => !isJoker(c));
  return real.every((c) => c.rank === real[0].rank);
}

function unitInfo(cards) {
  const base = baseRank(cards);
  const jokers = cards.filter(isJoker).length;
  const royal = base === "W" || ROYAL_RANKS.includes(base);
  const ace = base === "A";
  const power = royal ? 0 : knightValue(base) * cards.length;
  let points = 0;
  if (base === "W") points = 2 * cards.length;
  else if (ROYAL_RANKS.includes(base)) points = ROYAL_POINTS[base] * cards.length;
  else points = 2 * jokers;
  return { base, royal, ace, power, points };
}

const publicCard = (c) => {
  const o = { rank: c.rank, suit: "none" };
  if (c.style) o.style = c.style;
  return o;
};
// What the animations / reveals need to know about a unit.
function unitSummary(cards) {
  const i = unitInfo(cards);
  return { cards: cards.map(publicCard), is_royal: i.royal, power: i.power, rank: i.base === "W" ? "Joker" : i.base };
}

class Game {
  constructor(names, options = {}) {
    this.names = names; // [p1, p2]
    this.options = {
      noScoring: !!options.noScoring,
      reveal: !!options.reveal,
      timeLimit: Number(options.timeLimit) || 0, // seconds per turn, 0 = off
      noSpectators: !!options.noSpectators,
      deck: DECK_PRESETS[options.deck] ? options.deck : "normal",
    };
    this.deck = buildDeck(this.options.deck);
    this.discard = [];
    this.players = [0, 1].map((i) => ({ hand: [], board: [], mulliganDone: false, mulliganUsed: false, firstTurnDone: false, style: PLAYER_STYLES[i] }));
    this.prank = options.prank ? new Prank(this, options.prank) : null;
    for (let i = 0; i < START_HAND; i++) for (let p = 0; p < 2; p++) this.give(p, this.deck.pop());
    this.phase = "mulligan"; // mulligan | play | game_over
    this.forced = false;
    this.turn = options.firstPlayer === 0 || options.firstPlayer === 1 ? options.firstPlayer : Math.random() < 0.5 ? 0 : 1;
    this.turnToken = 0;
    this.events = []; // drained by the server on each broadcast
    this.result = null;
    this.resetTurnState();
  }

  give(pi, card) {
    if (!card) return;
    if (!card.style && (ROYAL_RANKS.includes(card.rank))) card.style = card.rank === "E" ? "imperial" : this.players[pi].style;
    this.players[pi].hand.push(card);
    if (this.prank && pi === this.prank.target) this.prank.see([card]);
  }

  resetTurnState() {
    this.path = "A";
    this.actionsLeft = 1;
    this.awaitingDiscard = false; // Path B: waiting for the 2 discards
    this.inBonus = false; // in the middle of a deploy-bonus action
    this.turnOver = false; // action used up; waiting for end_turn
    this.mustDiscardExcess = false;
    this.actionsTaken = 0;
  }

  // ---------- event plumbing ----------
  log(msg) { this.events.push({ type: "log", msg }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // ---------- helpers ----------
  takeFromHand(pi, indices) {
    const hand = this.players[pi].hand;
    if (!Array.isArray(indices) || !indices.length) return null;
    if (new Set(indices).size !== indices.length) return null;
    if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= hand.length)) return null;
    return indices.map((i) => hand[i]);
  }
  removeFromHand(pi, cards) {
    const set = new Set(cards.map((c) => c.id));
    this.players[pi].hand = this.players[pi].hand.filter((c) => !set.has(c.id));
  }
  toDiscard(cards) {
    if (!cards.length) return;
    this.discard.push(...cards);
    if (this.prank) this.prank.see([cards[0], cards[cards.length - 1]]); // what the discard pile shows
    if (cards.length >= 2) this.events.push({ type: "discard", pair: [publicCard(cards[0]), publicCard(cards[cards.length - 1])] });
  }
  checkTurn(pi) {
    if (this.phase !== "play") return "Game isn't in progress.";
    if (pi !== this.turn) return "It's not your turn.";
    if (this.mustDiscardExcess) return "Discard down to 10 first.";
    if (this.turnOver) return "Your turn is over.";
    return null;
  }

  // ---------- phase / available actions (as the client sees them) ----------
  phaseName() {
    if (this.phase === "mulligan") return "mulligan";
    if (this.phase === "game_over") return "game_over";
    if (this.mustDiscardExcess) return "discard_excess";
    if (this.turnOver) return "turn_over";
    if (this.forced) return "forced_attack";
    if (this.awaitingDiscard) return "discard_for_b";
    if (this.inBonus) return "deploy";
    return "action";
  }
  availableActions(pi) {
    if (this.phase === "mulligan") return this.players[pi].mulliganDone ? [] : ["mulligan"];
    if (this.phase !== "play" || pi !== this.turn) return [];
    const me = this.players[pi];
    const opp = this.players[1 - pi];
    switch (this.phaseName()) {
      case "discard_excess": return ["discard_excess"];
      case "turn_over": return ["end_turn"];
      case "forced_attack": return [...(opp.board.length && me.hand.length ? ["attack"] : []), "pass_discard_all"];
      case "discard_for_b": return ["discard", "cancel_path_b"];
      case "deploy": return [...(me.hand.length ? ["deploy"] : []), "finish_deploy"];
      default: {
        const a = [];
        if (me.hand.length) a.push("deploy");
        if (this.path === "A" && opp.board.length && me.hand.length) a.push("attack");
        a.push("pass");
        if (this.path === "A" && this.actionsTaken === 0) a.push("switch_path_b");
        return a;
      }
    }
  }
  canPathB(pi) { return this.players[pi].hand.length >= 2; }

  // ---------- mulligan ----------
  mulligan(pi, doMulligan) {
    if (this.phase !== "mulligan") return { error: "Mulligan phase is over." };
    const p = this.players[pi];
    if (p.mulliganDone) return { error: "Already decided." };
    if (doMulligan && !p.mulliganUsed) {
      if (this.prank && pi === this.prank.target) this.prank.unsee(p.hand); // shuffled back: location unknown again
      this.deck.push(...p.hand);
      p.hand = [];
      shuffle(this.deck);
      for (let i = 0; i < START_HAND; i++) this.give(pi, this.deck.pop());
      p.mulliganUsed = true;
      this.log(`${this.names[pi]} mulliganed`);
    }
    p.mulliganDone = true;
    if (this.players.every((x) => x.mulliganDone)) {
      this.phase = "play";
      this.startTurn();
    }
    return { ok: true };
  }

  // ---------- turn flow ----------
  startTurn() {
    this.resetTurnState();
    this.turnToken++;
    const p = this.players[this.turn];
    if (!this.forced && this.deck.length === 0) {
      this.forced = true;
      this.log("Deck empty — forced attack phase");
    }
    if (this.forced) {
      if (this.players.every((x) => x.hand.length === 0)) return this.finish();
      if (p.hand.length === 0) {
        this.turn = 1 - this.turn;
        return this.startTurn();
      }
    } else if (p.firstTurnDone) {
      this.give(this.turn, this.deck.pop());
    }
    p.firstTurnDone = true;
  }

  // Move to the next player (after end_turn / discards).
  advance() {
    this.turn = 1 - this.turn;
    this.startTurn();
  }

  consumeAction() {
    this.actionsLeft--;
    this.actionsTaken++;
    if (this.actionsLeft <= 0) this.turnOver = true;
  }

  endTurn(pi) {
    if (this.phase !== "play" || pi !== this.turn || !this.turnOver) return { error: "You can't end your turn yet." };
    this.turnOver = false;
    if (!this.forced && this.players[pi].hand.length > HAND_LIMIT) {
      this.mustDiscardExcess = true;
      return { ok: true };
    }
    this.advance();
    return { ok: true };
  }

  // ---------- Path B ----------
  switchToPathB(pi) {
    const e = this.checkTurn(pi);
    if (e) return { error: e };
    if (this.forced) return { error: "Not during the forced attack phase." };
    if (this.path === "B" || this.actionsTaken > 0 || this.inBonus) return { error: "You can only switch at the start of your turn." };
    if (!this.canPathB(pi)) return { error: "You need at least 2 cards." };
    this.path = "B";
    this.awaitingDiscard = true;
    return { ok: true };
  }
  cancelPathB(pi) {
    if (pi !== this.turn || !this.awaitingDiscard) return { error: "Nothing to undo." };
    this.path = "A";
    this.awaitingDiscard = false;
    return { ok: true };
  }
  discardCards(pi, indices) {
    const e = this.checkTurn(pi);
    if (e) return { error: e };
    if (!this.awaitingDiscard) return { error: "You're not discarding right now." };
    const cards = this.takeFromHand(pi, indices);
    if (!cards || cards.length !== 2) return { error: "Select exactly 2 cards." };
    this.removeFromHand(pi, cards);
    this.toDiscard(cards);
    this.awaitingDiscard = false;
    this.actionsLeft = 2;
    this.log(`${this.names[pi]} discarded 2 to take 2 actions`);
    return { ok: true };
  }

  // ---------- actions ----------
  deploy(pi, indices, side) {
    const e = this.checkTurn(pi);
    if (e) return { error: e };
    if (this.forced) return { error: "Deck empty — attack or discard all." };
    if (this.awaitingDiscard) return { error: "Discard 2 cards first." };
    if (side !== "left" && side !== "right") return { error: "Pick a side." };
    const cards = this.takeFromHand(pi, indices);
    if (!cards) return { error: "Invalid cards." };
    if (!validGroup(cards)) return { error: "Selected cards must be the same rank!" };
    const p = this.players[pi];
    if (!this.inBonus && p.board.length < 3) this.inBonus = true;
    this.removeFromHand(pi, cards);
    const unit = { id: nextId("u"), cards, revealed: false };
    if (side === "left") p.board.unshift(unit);
    else p.board.push(unit);
    this.events.push({ type: "deploy", player: pi + 1, side, card_count: cards.length });
    this.log(`${this.names[pi]} deployed on ${side}`);
    if (this.inBonus) {
      if (p.board.length >= 3 || p.hand.length === 0) {
        this.inBonus = false;
        this.consumeAction();
      }
    } else {
      this.consumeAction();
    }
    return { ok: true };
  }

  finishDeploy(pi) {
    const e = this.checkTurn(pi);
    if (e) return { error: e };
    if (!this.inBonus) return { error: "You're not deploying." };
    this.inBonus = false;
    this.consumeAction();
    return { ok: true };
  }

  passAction(pi) {
    const e = this.checkTurn(pi);
    if (e) return { error: e };
    if (this.forced) return { error: "Deck empty — attack or discard all." };
    this.awaitingDiscard = false;
    this.inBonus = false;
    this.log(`${this.names[pi]} passed`);
    this.actionsLeft = 0;
    this.turnOver = false;
    if (this.players[pi].hand.length > HAND_LIMIT) this.mustDiscardExcess = true;
    else this.advance();
    return { ok: true };
  }

  passDiscardAll(pi) {
    const e = this.checkTurn(pi);
    if (e) return { error: e };
    if (!this.forced) return { error: "Only when the deck is empty." };
    const p = this.players[pi];
    const cards = p.hand;
    p.hand = [];
    this.toDiscard(cards);
    this.log(`${this.names[pi]} passed and discarded all`);
    this.advance();
    return { ok: true };
  }

  discardExcess(pi, indices) {
    if (this.phase !== "play" || pi !== this.turn || !this.mustDiscardExcess) return { error: "Nothing to discard." };
    const p = this.players[pi];
    const cards = this.takeFromHand(pi, indices);
    if (!cards) return { error: "Select cards to discard." };
    this.removeFromHand(pi, cards);
    this.toDiscard(cards);
    if (p.hand.length <= HAND_LIMIT) {
      this.mustDiscardExcess = false;
      this.log(`${this.names[pi]} discarded down to ${HAND_LIMIT}`);
      this.advance();
    }
    return { ok: true };
  }

  attack(pi, indices, side) {
    const e = this.checkTurn(pi);
    if (e) return { error: e };
    if (this.path === "B") return { error: "You can't attack on a Path B turn." };
    if (this.inBonus) return { error: "Finish deploying first." };
    if (this.awaitingDiscard) return { error: "Discard 2 cards first." };
    if (side !== "left" && side !== "right") return { error: "Pick a side." };
    const cards = this.takeFromHand(pi, indices);
    if (!cards) return { error: "Invalid cards." };
    if (!validGroup(cards)) return { error: "Selected cards must be the same rank!" };
    const opp = this.players[1 - pi];
    if (!opp.board.length) return { error: "There's nothing to attack." };
    this.removeFromHand(pi, cards);

    const atk = unitInfo(cards);
    const rig = this.prank && pi === this.prank.target ? this.prank.shouldRig() : false;
    if (this.prank) this.prank.see(cards);
    if (rig) this.prank.stats.rigged++;
    const anim = { attacker_player: pi + 1, side, attacker: unitSummary(cards), steps: [] };
    const order = side === "left" ? opp.board.map((_, i) => i) : opp.board.map((_, i) => opp.board.length - 1 - i);
    const destroyed = new Set();
    let captured = null;
    let power = atk.power;

    for (const idx of order) {
      const def = opp.board[idx];
      if (rig) this.prank.rigDefender(def, atk, power);
      if (this.prank) this.prank.see(def.cards); // shown in the attack flash
      const d = unitInfo(def.cards);
      const step = { defender: unitSummary(def.cards) };
      anim.steps.push(step);
      if (d.ace) {
        // The Ace trap: the attacker is captured and the Ace is spent.
        step.outcome = "absorbed";
        step.remaining_power = 0;
        destroyed.add(def.id);
        captured = idx;
        break;
      }
      if (atk.royal || d.royal) {
        // Royal attackers kill exactly one defender; anything that hits a Royal trades with it.
        step.outcome = "both_destroyed";
        step.remaining_power = 0;
        destroyed.add(def.id);
        break;
      }
      if (power > d.power) {
        power -= d.power;
        step.outcome = "destroyed";
        step.remaining_power = power;
        destroyed.add(def.id);
        continue;
      }
      if (power < d.power) {
        step.outcome = "blocked";
        step.remaining_power = 0;
        if (this.options.reveal) def.revealed = def.revealedByAttack = true;
        break;
      }
      step.outcome = "both_destroyed";
      step.remaining_power = 0;
      destroyed.add(def.id);
      break;
    }

    const lost = [];
    const newBoard = [];
    opp.board.forEach((u, i) => {
      if (i === captured) {
        lost.push(...u.cards);
        newBoard.push({ id: nextId("u"), cards, revealed: true, absorbed: true });
      } else if (destroyed.has(u.id)) lost.push(...u.cards);
      else newBoard.push(u);
    });
    opp.board = newBoard;
    if (captured === null) lost.push(...cards); // attacker is spent
    this.discard.push(...lost);

    this.events.push({ type: "attack", anim });
    this.actionsLeft = 0;
    this.actionsTaken++;
    this.turnOver = true;
    return { ok: true };
  }

  // Called by the server when the per-turn clock runs out.
  timeout() {
    if (this.phase !== "play") return;
    const pi = this.turn;
    const p = this.players[pi];
    if (this.turnOver) return this.endTurn(pi);
    if (this.mustDiscardExcess) {
      const n = p.hand.length - HAND_LIMIT;
      return this.discardExcess(pi, p.hand.map((_, i) => i).slice(0, n));
    }
    if (this.forced) return this.passDiscardAll(pi);
    this.log(`${this.names[pi]} ran out of time`);
    this.inBonus = false;
    this.awaitingDiscard = false;
    this.turnOver = false;
    if (p.hand.length > HAND_LIMIT) {
      const n = p.hand.length - HAND_LIMIT;
      this.toDiscard(p.hand.splice(0, n));
    }
    this.advance();
  }

  finish() {
    if (this.prank) this.prank.endgame(unitInfo);
    this.phase = "game_over";
    const reveal = (p) => p.board.map((u) => ({ ...unitSummary(u.cards), points: unitInfo(u.cards).points }));
    const scores = this.players.map((p) => p.board.reduce((s, u) => s + unitInfo(u.cards).points, 0));
    this.result = {
      scores,
      winner: scores[0] > scores[1] ? 1 : scores[1] > scores[0] ? 2 : 0,
      boards: this.players.map(reveal),
    };
  }

  // ---------- views ----------
  boardView(p, showAll) {
    return p.board.map((u) => {
      if (!showAll && !u.revealed) return { card_count: u.cards.length, revealed: false };
      const v = { ...unitSummary(u.cards), revealed: true };
      if (u.revealedByAttack) v.revealed_by_attack = true;
      if (u.absorbed) v.absorbed = true;
      return v;
    });
  }

  viewFor(pi, extra = {}) {
    const spectator = pi !== 0 && pi !== 1;
    const me = spectator ? 0 : pi;
    const mine = this.players[me];
    const opp = this.players[1 - me];
    const phase = this.phaseName();
    const v = {
      phase,
      your_turn: !spectator && this.phase !== "game_over" && (this.phase === "mulligan" ? true : this.turn === me),
      player_number: me + 1,
      hand: mine.hand.map(publicCard),
      board: this.boardView(mine, true),
      opponent_board: this.boardView(opp, spectator),
      opponent_hand_count: opp.hand.length,
      deck_count: this.deck.length,
      discard_top: this.discard.length ? publicCard(this.discard[this.discard.length - 1]) : null,
      discard_count: this.discard.length,
      actions_remaining: this.actionsLeft,
      path: this.phase === "play" ? this.path : null,
      available_actions: spectator ? [] : this.availableActions(me),
      can_path_b: this.canPathB(me),
      mulligan_waiting: this.phase === "mulligan" && mine.mulliganDone,
      no_scoring: this.options.noScoring,
      reveal_attacked: this.options.reveal,
      time_limit: this.options.timeLimit,
      turn_token: this.turnToken,
      opponent_name: this.names[1 - me],
      ...extra,
    };
    if (spectator) {
      v.is_spectator = true;
      v.p1_name = this.names[0];
      v.p2_name = this.names[1];
      v.opponent_hand = opp.hand.map(publicCard);
      v.your_hand_count = mine.hand.length;
      v.spectator_current_turn = this.phase === "play" ? this.turn + 1 : null;
    }
    if (this.phase === "game_over" && this.result) {
      v.scores = { you: this.result.scores[me], opponent: this.result.scores[1 - me] };
      v.your_board_reveal = this.result.boards[me];
      v.opp_board_reveal = this.result.boards[1 - me];
    }
    return v;
  }
}

module.exports = { Game, unitInfo, validGroup, baseRank, knightValue, ROYAL_POINTS, HAND_LIMIT, DECK_PRESETS };
