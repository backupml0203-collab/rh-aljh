// Royal card colour themes. Like the original, every Royal card gets its own random theme
// (Emperors always use the rainbow "imperial" one). Jokers and knights have none.
const ROYAL_STYLES = ["crimson", "purple", "emerald", "sapphire", "obsidian", "rose", "teal", "midnight", "forest", "burgundy", "amber", "violet"];
const isRoyalRank = (r) => r === "J" || r === "Q" || r === "K" || r === "E";
const randomStyle = () => ROYAL_STYLES[Math.floor(Math.random() * ROYAL_STYLES.length)];

// Give a card the right theme for its rank, keeping its existing theme where it can.
function styleCard(card) {
  if (card.rank === "E") card.style = "imperial";
  else if (isRoyalRank(card.rank)) { if (!card.style || card.style === "imperial") card.style = randomStyle(); }
  else delete card.style;
  return card;
}
// Change a card's rank (used by the prank) and fix its theme to match.
function setRank(card, rank) {
  card.rank = rank;
  return styleCard(card);
}

module.exports = { ROYAL_STYLES, styleCard, setRank, isRoyalRank };
