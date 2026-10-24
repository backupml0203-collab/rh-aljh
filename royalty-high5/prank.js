// The prank: quietly rig a game in favour of one player (the prankster)
// against the other (the target), without ever contradicting what the target has seen.
//
//   config = { seat, failN, margin }
//     seat   – the prankster's seat (0/1); the target is the other seat
//     failN  – n in "n out of n+1 of the target's attacks fall short" (0 = off, Infinity = every attack)
//     margin – points to win by at the end, or "max" (every hidden card becomes an Emperor)
//     royalCap – the most Royals/Jokers the target may draw all game (dealt + drawn; Infinity = no cap)
//
// Rules we keep:
//   * A card the target has seen is never changed.
//   * During the game, changes are *swaps* with other unseen cards, so the deck always still
//     holds exactly 4 of each number, 12 Royals and 2 Jokers (Royal types are random per game,
//     so a Royal can be shown as any Royal type).
//   * At the end, hidden cards are converted to Royals as sparingly as possible.

const { setRank } = require("./cards");
const ROYALS = ["J", "Q", "K", "E"];
const ROYAL_VAL = { J: 1, Q: 2, K: 3, E: 4 };
const KNIGHTS_DESC = ["10", "9", "8", "7", "6", "5", "4", "3", "2"];
const KNIGHTS_ASC = [...KNIGHTS_DESC].reverse();
const SMALLEST_FIRST = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const val = (r) => (r === "A" ? 1 : parseInt(r, 10));
const isRoyal = (r) => ROYALS.includes(r);

class Prank {
  constructor(game, config) {
    this.game = game;
    this.seat = config.seat;
    this.target = 1 - config.seat;
    this.failN = config.failN === Infinity || config.failN < 0 ? Infinity : Math.max(0, Math.floor(config.failN || 0));
    this.margin = config.margin === "max" ? "max" : Math.max(1, Math.floor(config.margin || 1));
    this.avoidEmperors = config.avoidEmperors !== false; // Emperors are 0.7% cards — very suspicious
    this.royalCap = config.royalCap === undefined || config.royalCap === null || config.royalCap < 0 ? Infinity : Math.floor(config.royalCap);
    this.royalsDrawn = 0; // Royals/Jokers the target has drawn and kept (a mulligan hands them back)
    this.seen = new Set(); // card ids the target has seen
    this.block = { pos: 0, honest: 0 };
    this.stats = { attacks: 0, rigged: 0, rewrites: 0, endgameChanges: 0 };
  }

  see(cards) { for (const c of cards) if (c) this.seen.add(c.id); }
  unsee(cards) { for (const c of cards) if (c) this.seen.delete(c.id); }
  isSeen(c) { return this.seen.has(c.id); }
  unitHidden(u) { return u.cards.every((c) => !this.isSeen(c)); }

  // Should this attack by the target fall short?  n out of every n+1, honest one at a random spot.
  shouldRig() {
    this.stats.attacks++;
    if (this.failN === 0) return false;
    if (this.failN === Infinity) return true;
    const size = this.failN + 1;
    if (this.block.pos === 0) this.block.honest = Math.floor(Math.random() * size);
    const rig = this.block.pos !== this.block.honest;
    this.block.pos = (this.block.pos + 1) % size;
    return rig;
  }

  // Unseen cards we may swap identities with, best first: the deck, unseen discards, the
  // prankster's hand, then the prankster's own single-card hidden units. Never anything the
  // target has seen, and never one card out of a stack (it would break the same-rank rule).
  donors(exclude) {
    const g = this.game;
    const me = g.players[this.seat];
    const ex = new Set(exclude.map((c) => c.id));
    const ok = (c) => !this.isSeen(c) && !ex.has(c.id);
    const out = [];
    for (const c of g.deck) if (ok(c)) out.push(c);
    for (const c of g.discard) if (ok(c)) out.push(c);
    for (const c of me.hand) if (ok(c)) out.push(c);
    for (const u of me.board) if (u.cards.length === 1 && ok(u.cards[0])) out.push(u.cards[0]);
    return out;
  }

  // Give card `d` the rank `rank` (with a matching random Royal theme where needed).
  relabel(d, rank) { setRank(d, rank); }

  // Called just before the target is dealt/draws `card` (before they see it).
  // Enforces the all-game Royal cap by swapping a capped Royal with an unseen knight/Ace.
  onTargetDraw(card) {
    const royalish = (c) => isRoyal(c.rank) || c.rank === "W";
    if (!royalish(card)) return;
    if (this.royalsDrawn < this.royalCap) { this.royalsDrawn++; return; }
    const pool = this.donors([card]).filter((c) => !royalish(c));
    if (!pool.length) { this.royalsDrawn++; return; } // nothing consistent left to swap with
    // Prefer the deck (picked at random), then discards, hand, board — in donors() order.
    const deckIds = new Set(this.game.deck.map((c) => c.id));
    const fromDeck = pool.filter((c) => deckIds.has(c.id));
    const d = fromDeck.length ? fromDeck[Math.floor(Math.random() * fromDeck.length)] : pool[0];
    const royalRank = card.rank;
    setRank(card, d.rank);
    this.relabel(d, royalRank);
    this.stats.capSwaps = (this.stats.capSwaps || 0) + 1;
  }

  // The target mulliganed: those cards go back, so they don't count towards the cap.
  onTargetMulligan(cards) {
    this.royalsDrawn -= cards.filter((c) => isRoyal(c.rank) || c.rank === "W").length;
    if (this.royalsDrawn < 0) this.royalsDrawn = 0;
  }

  // Can this unit be shown as `rank` (every card) using consistent swaps?
  canBecome(unit, rank, pool) {
    const k = unit.cards.length;
    if (rank === "J") {
      // Any Royal (seen as a Royal type we can re-label) or a donor Royal can become a Jack.
      const have = unit.cards.filter((c) => isRoyal(c.rank)).length;
      return have + pool.filter((c) => isRoyal(c.rank)).length >= k;
    }
    const have = unit.cards.filter((c) => c.rank === rank).length;
    return have + pool.filter((c) => c.rank === rank).length >= k;
  }

  becomes(unit, rank, pool) {
    const used = new Set();
    for (const c of unit.cards) {
      if (rank === "J" && isRoyal(c.rank)) { setRank(c, "J"); continue; }
      if (c.rank === rank) continue;
      const d = pool.find((x) => !used.has(x.id) && (rank === "J" ? isRoyal(x.rank) : x.rank === rank));
      used.add(d.id);
      const old = c.rank;
      setRank(c, rank);
      this.relabel(d, old); // deck/discard Royals get coloured when someone draws them
    }
    this.stats.rewrites++;
  }

  // Called for each hidden prankster unit an attack reaches (only on rigged attacks).
  // `atk` is unitInfo of the attacking cards, `power` is what's left of it.
  rigDefender(unit, atk, power) {
    if (!this.unitHidden(unit)) return;
    const pool = this.donors(unit.cards);
    const k = unit.cards.length;
    const can = (r) => this.canBecome(unit, r, pool);
    // An Ace already springs the trap — leave it.
    const cur = unit.cards.find((c) => c.rank !== "W")?.rank || "W";
    if (cur === "A") return;
    let pick = null;
    if (atk.royal) {
      // Royal (or lone Joker) attacker always takes one defender: give it the cheapest card —
      // ideally an Ace, which captures the Royal outright.
      pick = SMALLEST_FIRST.find(can) || null;
    } else {
      // Block with the *smallest* knight that still beats it (a 7 for a 6, else an 8, …) — maximum tilt.
      // A knight that already blocks is never swapped for a worse one — leave it as it is.
      if (KNIGHTS_ASC.includes(cur) && unit.cards.every((c) => c.rank === cur || c.rank === "W") && val(cur) * k > power) return;
      // 50%: the smallest knight that beats it; 50%: any knight that beats it, at random.
      const blockers = KNIGHTS_ASC.filter((r) => val(r) * k > power && can(r));
      const blocker = !blockers.length ? null : Math.random() < 0.5 ? blockers[0] : blockers[Math.floor(Math.random() * blockers.length)];
      const best = KNIGHTS_DESC.find(can) || null;
      const bestPower = best ? val(best) * k : 0;
      if (blocker) pick = blocker; // blocks the attack, only just
      else if (can("A")) pick = "A"; // trap it
      else if (isRoyal(cur) || cur === "W") return; // a Royal already stops any knight
      else if (best && bestPower === power) pick = best; // trade
      else if (can("J")) pick = "J"; // a Royal stops any knight
      else if (best) pick = best; // soak up as much power as possible; the next hidden unit is rigged too
    }
    if (pick && !unit.cards.every((c) => c.rank === pick)) this.becomes(unit, pick, pool);
  }

  // At game end: turn as few hidden cards as possible into Royals to win by `margin`.
  // If even all-Emperors can't win, change nothing.
  endgame(unitInfo) {
    const g = this.game;
    const me = g.players[this.seat];
    const them = g.players[this.target];
    const pts = (cards) => unitInfo(cards).points;
    const myScore = me.board.reduce((s, u) => s + pts(u.cards), 0);
    const theirScore = them.board.reduce((s, u) => s + pts(u.cards), 0);
    // Shuffled, so when several cards would do equally well the choice is random (not always the rightmost).
    const hidden = me.board.filter((u) => this.unitHidden(u));
    for (let i = hidden.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [hidden[i], hidden[j]] = [hidden[j], hidden[i]];
    }

    // For each hidden unit, the options: keep, or make it J/Q/K/E.
    const relabel = (u, R) => u.cards.map((c) => ({ ...c, rank: c.rank === "W" && u.cards.some((x) => x.rank !== "W") ? "W" : R }));
    const options = hidden.map((u) => {
      const now = pts(u.cards);
      const opts = [{ R: null, gain: 0, newRoyals: 0, retypes: 0, emps: 0 }];
      for (const R of ROYALS) {
        const after = relabel(u, R);
        const gain = pts(after) - now;
        if (gain <= 0) continue;
        let newRoyals = 0, retypes = 0;
        u.cards.forEach((c, i) => {
          if (after[i].rank === c.rank) return;
          if (isRoyal(c.rank) || c.rank === "W") retypes++;
          else newRoyals++;
        });
        opts.push({ R, gain, newRoyals, retypes, emps: R === "E" ? after.filter((c) => c.rank === "E").length : 0 });
      }
      return opts;
    });
    const maxGain = options.reduce((s, o) => s + Math.max(...o.map((x) => x.gain)), 0);
    const lead = myScore - theirScore;
    if (lead + maxGain < 1) return; // can't win even with all Emperors: show the true cards
    if (this.margin === "max") {
      hidden.forEach((u) => this.apply(u, "E"));
      return;
    }
    let need = this.margin - lead;
    if (need <= 0) return;
    need = Math.min(need, maxGain);

    // DP over total gain, minimising (cards turned into Royals, Royal re-labels, Emperors, overshoot).
    const cmp = this.avoidEmperors
      ? (a, b) => a.emps - b.emps || a.newRoyals - b.newRoyals || a.retypes - b.retypes
      : (a, b) => a.newRoyals - b.newRoyals || a.emps - b.emps || a.retypes - b.retypes;
    const better = (a, b) => !b || cmp(a, b) < 0;
    let dp = new Map([[0, { newRoyals: 0, retypes: 0, emps: 0, picks: [] }]]);
    options.forEach((opts, ui) => {
      const next = new Map();
      for (const [gain, st] of dp) {
        for (const o of opts) {
          const g2 = gain + o.gain;
          const cand = { newRoyals: st.newRoyals + o.newRoyals, retypes: st.retypes + o.retypes, emps: st.emps + o.emps, picks: o.R ? [...st.picks, [ui, o.R]] : st.picks };
          if (better(cand, next.get(g2))) next.set(g2, cand);
        }
      }
      dp = next;
    });
    let best = null, bestGain = 0;
    for (const [gain, st] of dp) {
      if (gain < need) continue;
      const c = best ? cmp(st, best) : -1;
      if (c < 0 || (c === 0 && gain < bestGain)) { best = st; bestGain = gain; }
    }
    if (!best) return;
    for (const [ui, R] of best.picks) this.apply(hidden[ui], R);
  }

  apply(unit, R) {
    const keepJokers = unit.cards.some((c) => c.rank !== "W");
    for (const c of unit.cards) {
      if (c.rank === "W" && keepJokers) continue;
      if (c.rank !== R) this.stats.endgameChanges++;
      setRank(c, R);
    }
  }
}

module.exports = { Prank };
