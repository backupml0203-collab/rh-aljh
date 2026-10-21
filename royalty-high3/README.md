# Royalty High — April Fools copy

A copy of Royalty High (A Game of Crowns and Strategies) with the same screens, buttons, wording,
animations and sounds — plus a secret prank panel.

## Run it

```bash
npm install
npm start          # → http://localhost:3000
```

Anyone who opens the site is **automatically logged in as `poumsday`** (change with `DEFAULT_USER=… npm start`) — so when
the target clicks the link, it looks like the real site with him already signed in. The prankster should click **Log out →
Log in** with their own username first (two poumsdays can't join each other's room).

## The prank panel

On the **Create / Join Room** screen (or **Direct Challenge**), tap the screen's title **5 times quickly**. Switch prank
mode on, set the dials, hit Save, then create a room, join one, or send a challenge as usual. Whoever armed it is the
prankster; their opponent is the target. The settings live only in that browser tab and apply to **the next game only** —
once it starts they're cleared (nothing is stored in cookies or on the server). Arm it again for another round.

**Dial 1 — "Their attacks fall short"** (Never, 1 of 2, 2 of 3 … 19 of 20, Every attack). In each block of n+1 attacks by
the target, one random attack plays out honestly and the rest are rigged. On a rigged attack, each of your *hidden* units
it reaches is swapped for the best defender that's still possible from the target's point of view:

- Royal / lone Joker attacking → the smallest possible card (an Ace if one is unaccounted for — it captures the Royal).
- Knight attacking → a knight that beats it: half the time the *smallest* possible one (a 7 for a 6; no 7 left → an 8, …),
  half the time any possible knight that beats it, at random — so it doesn't always "just" fail. A hidden knight that already blocks is never swapped for a worse one — your 8 stays an 8 against a 3. Otherwise an Ace trap; if your card is
  already a Royal it's left alone (it stops the knight anyway); otherwise an equal knight (trade); otherwise a Jack;
  otherwise the biggest knight available to soak up power — the next hidden unit is rigged too.
- Cards the target has seen are never changed: their own cards, anything shown in a combat flash or revealed, and what
  the discard pile has shown (mulliganed cards count as unknown again after the shuffle).
- Changes are **swaps** with unseen cards: the deck, unseen discards, **your hand**, or one of your single hidden board
  cards — so the deck always still adds up: 4 of each number, 12 Royals, 2 Jokers. Your hand can change during his turn.

**Dial 2 — "Win by at the end"** (just enough, 2, 3, 4, 5, 8, 12, 20, or every hidden card → Emperor). When the game ends,
the fewest possible hidden cards on your board are turned into Royals to reach that margin (no consistency needed any more).
If the margin can't be reached, it goes as high as it can; if even all-Emperors can't win, your real cards are shown.
Kings are always used before Emperors (0.7%-rare cards would look suspicious), even if that changes a few more cards.
When several of your hidden cards would do equally well, which one changes is picked at random.

**Dial 3 — "Most Royals they can draw"** (0–14 or no limit, default 6). An all-game cap on the Royals and Jokers he is dealt
or draws (cards he mulligans back don't count; Royals that land on his board by capturing yours don't either). When he'd
draw one over the cap, it's swapped — before he sees it — with an unseen knight or Ace from the deck (or discards, your
hand, your board), so the extra Royals pile up on your side. If nothing unseen is left to swap with, it goes through.

Rigged games are recorded in stats like any other game.

**Head-to-head records** — the real site tints the in-game background by your record against that opponent
(red → yellow → green). Log in and enter your real record vs the friend you're pranking so the tint matches.

Heads-up: spectators see every card face-up, so someone spectating a rigged game could see a hidden card change.

## Same as the original

Menu, Play With Friends, Create/Join Room (No Scoring / Reveal Attacked / Time Limit slider 15–120s / No Spectators),
Direct Challenge (3-letter search, recently challenged, bell + Accept/Decline), Spectate (ongoing games + player search),
Leaderboard (all-time 15+ games, this month 10+), My stats (Overall / vs each player, All time / This month with the
+/− monthly score, recent games with final boards), Settings, and the **All players** admin screen for poumsday
(Players, Recent Games with spectators, Log Game).

In game: coin flip, mulligan, drag-or-click drop zones, Path B, deploy bonus, END TURN flash, the event log, attack
flashes (DESTROYED / BLOCKED / MUTUAL DESTRUCTION / TRAPPED BY ACE), the Ace-trap effect, card-type death sounds,
the turn timer with ticking, 💬 emotes (😂 😡 🤔 Thank you, TOAST, SKETCH), the 👁 spectator list with kick,
the red deck when ≤5 cards, the reveal-and-score game over screen, "Opponent disconnected." and Play Again.
The bot exists but isn't on the menu (same as the original): type `startBot()` in the browser console.

Stats are seeded from the real leaderboard (poumsday 348-232-209, etc.).

**Differences on purpose:** the How to Play text and the sample-game script are written in my own words (same
sections, same examples, same demos). The login form shows a Password box like the original, but the password is
**never read or sent anywhere** — so if a friend types their real password, it can't leak. Accounts here are
username-only.

## Files

| File | What it does |
| --- | --- |
| `server.js` | API, auto-login, stats, admin, rooms, challenges, spectating, timers, prank settings |
| `game.js` | Rules engine (+ prank deck presets) |
| `bot.js` | The hidden practice bot |
| `public/` | The client: `index.html`, `style.css`, `app.js` |
| `data/db.json` | Created on first run. Delete it to reset to the seeded stats. |

Hosting: works on Render like the original (`npm start`, uses `$PORT`). On Render's free tier the disk resets on
redeploy, so stats and prank settings go back to the seed — fine for a one-day prank.
