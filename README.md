# Donkey Online — multiplayer card game

Node.js + Express + Socket.IO. Files: `server.js`, `package.json`, `public/index.html` (the client **must** live in `public/`).

## Run
`npm install` then `npm start` → http://localhost:3000. Deploy on Render/Railway (Node 18+, WebSocket support, run `npm start`, HTTPS).

## Rules implemented
- **Rooms**: 3-letter code while fewer than 100 rooms are active (4 letters beyond that). Scannable QR code (`/qr/CODE`) opens the site with the code pre-filled. Up to 20 people; anyone joining mid-match **waits** and is seated at the next deal.
- **Decks**: 16 (Ace–Jack), 32 (Ace–7), 52 (single deck), or 104 cards (double deck). Equal ranks: first pack wins. First-pack cards carry a gold ● in double-deck games.
- **Opening**: holder of the (first-pack) Ace of Spades starts. ≤6 players: Ace auto-plays after 30 s settle-up. >6: holder gets sound + vibration and leads any card.
- **Tricks**: follow the lead suit if you can. Table cards are shown in ascending order; the highest lead-suit card is highlighted with its player's name and colour. All follow → highest wins, cards are folded, winner leads. Off-suit card = **HIT**: round ends at once, highest lead-suit player takes every card on the table including the HIT card.
- **Winning**: first to empty their hand wins, but the game only ends when one player is left (the Donkey). Finishing ranks are shown.
- **Surrender**: when exactly 3 players remain, any of them can raise the white flag; one of the other two must approve. The surrenderer becomes the Donkey.
- **Hand**: drag to reorder; Auto-sort re-sorts incoming cards and switches itself off after a manual drag.
- **Card request**: before leading, the round starter asks the next player for **all** their cards (15 s to answer, auto-declines).
- **Timers**: 50 s per turn, 15 s if the player was inactive in the previous round. With 10 s left: beeps + vibration, and the host plus next three players may grant +30 s.
- **Neon-green flash** (3×) appears only for the player whose turn it is.
- **Host**: pause/resume; kick players before a match starts. Offline players auto-play after 5 s.
- **Fullscreen**: built-in fullscreen button on desktop and mobile.

## v0.7 updates
- **Fullscreen button**: accessible at all times from the top bar on desktop and mobile.
- **Alternating color card sorting**: Auto-sort ensures cards of the same color never sit adjacent between suits (alternating Black ♠ -> Red ♥ -> Black ♣ -> Red ♦).
- **Overlapping/Stacked card hand**: Hand cards fan with cascading overlap, allowing 20+ cards to be clearly viewed at once without vertical crowding. Hovering or tapping a card elevates it smoothly.
- **Universal Pause & Vote**: Any player can pause or resume the match. In a 2-player match, the pause takes effect immediately without confirmation; in games with 3 or more players, an approval popup appears and requires at least one other player's permission.

## v0.8 updates (layout overhaul)
- **Single fullscreen button** (⛶) in the always-visible top bar — in the lobby and during play. The duplicate buttons/functions were removed; it also supports Safari's `webkit` prefix and tells iPhone users to use *Add to Home Screen* (iOS doesn't allow fullscreen on web pages).
- **3-bar menu (☰)**: room code + QR + waiting list, Pause/Resume, Call-off vote, Sound, Exit room and a short how-to. The screen only shows in-game things: status line, turn timer, table, your hand, and the action buttons (Deal card, Request cards, Surrender, Whip-on-HIT, Auto-sort).
- **Stacked hand**: cards overlap just enough to fit the whole hand on one row at the biggest possible size (92×132 on desktop, up from 64×92; 68×98 on phones, up from 42–52 wide). Card index (rank + suit) sits in the top-left so it stays readable when stacked.
- **Stacked table pile**: always sorted low → high, with a coloured owner bar + name tag per card. The highest lead-suit card is lifted and gold-highlighted.
- **Alternating-colour sorting**: Auto-sort is **on by default** and orders suits ♠ ♥ ♣ ♦ (black, red, black, red). It adapts to the suits you actually hold, and puts the lead suit first when that keeps colours alternating. A manual drag switches it off; tick it again to re-sort.
- The board now fills the screen on every device (no page scrolling in a room). "Deal & start" and the results appear on the felt before/after a match.
- Fixed: `SUIT_ORDER` was referenced but never defined (sorting threw an error); pause-request popup had no positioning.
- `server.js` and `package.json` are unchanged.
