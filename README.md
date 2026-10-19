# Donkey Online — multiplayer card game

Node.js + Express + Socket.IO. Files: `server.js`, `package.json`, `public/index.html` (the client **must** live in `public/`).

## Run
`npm install` then `npm start` → http://localhost:3000. Deploy on Render/Railway (Node 18+, WebSocket support, run `npm start`, HTTPS).

## Rules implemented
- **Rooms**: 3-letter code while fewer than 100 rooms are active (4 letters beyond that). Scannable QR code (`/qr/CODE`) opens the site with the code pre-filled. Up to 20 people; anyone joining mid-match **waits** and is seated at the next deal.
- **Decks**: single or double. Equal ranks: first pack wins. First-pack cards carry a gold ● in double-deck games.
- **Opening**: holder of the (first-pack) Ace of Spades starts. ≤6 players: Ace auto-plays after 15 s. >6: holder gets sound + vibration and leads any card.
- **Tricks**: follow the lead suit if you can. Table cards are shown in ascending order; the highest lead-suit card is highlighted with its player's name and colour. All follow → highest wins, cards are folded, winner leads. Off-suit card = **HIT**: round ends at once, highest lead-suit player takes every card on the table including the HIT card.
- **Winning**: first to empty their hand wins, but the game only ends when one player is left (the Donkey). Finishing ranks are shown.
- **Surrender**: when exactly 3 players remain, any of them can raise the white flag (🏳 on a brown stick); one of the other two must approve. The surrenderer becomes the Donkey.
- **Hand**: drag to reorder; Auto-sort re-sorts incoming cards and switches itself off after a manual drag.
- **Card request**: before leading, the round starter asks the next player for **all** their cards (15 s to answer, auto-declines). ≤3 cards: shown face-up to everyone. >3: 8-second popup saying who gave whom and how many.
- **Timers**: 50 s per turn, 15 s if the player was inactive in the previous round. With 10 s left: beeps + vibration, and the host plus next three players may grant +30 s (once per turn). Timeout auto-plays a legal card just below the current high card, else the lowest lead-suit card. If a player holds exactly one card of the required suit, it is auto-played after 10 s and is **not** counted as inactive.
- **Neon-green flash** (3×) appears only for the player whose turn it is.
- **Host**: pause/resume; kick players before a match starts. Offline players auto-play after 5 s.
- **New game vote**: shown when a player is offline or inactive for 2 rounds; needs min(3, majority of online players) votes. Offline and inactive players are pruned before every deal.

## Interpretations (change in `server.js` if you meant otherwise)
- Surrender can be offered by any of the final 3 players, not only the last-placed one.
- "Request cards" transfers the next player's whole hand; the giver is then out of the game (finishes).
- The finished trick stays on the table for 2 s (3 s after a HIT) before clearing.

## Not done yet
Reconnect after refresh (a dropped player is marked offline), touch drag-and-drop for reordering, rate limiting, automated tests.


## v0.3 additions
- **Exit room** button with a confirmation popup; returns to the lobby (mid-match the seat is auto-played and pruned at the next deal).
- Player name is **mandatory** to create/join and is remembered in the browser (blank if none saved). QR codes open `/?room=CODE` with the code pre-filled.
- **30 s settle-up** before the first play of every game: with 6 or fewer players the Ace auto-plays after 30 s; with more than 6 the starter's 50 s timer starts after 30 s.
- Deal a card by **dragging it onto the table** (mouse or touch), **double-tapping** it, or **selecting it and pressing Deal**.
- **Whip-crack** sound on every HIT (synthesised, honours the Sound toggle).
- Portrait **and** landscape: on phones the table (dealt cards) and your hand always share one screen.
- **Card-request popup** is offered to the leader at the start (more than 6 players) and after any clean round (no HIT). **Golden-letter banners** announce the round winner, HIT collector, and card-request transfers.

## v0.4 changes
- **Deck choices**: 16 (Ace–Jack), 32 (Ace–7, 8 ranks × 4 suits), 52, or 104 cards.
- **Dealing**: one card at a time with a card-dealing sound. Game 1 starts with the room creator, game 2 with the next seat, and so on.
- **Round messages**: a small white scroll says who starts the next round, or who got HIT and with which card. Golden letters are used only when a player clears all their cards.
- **Card request**: the popup appears only for the player after the requester. Everyone sees a scroll when the request is made and again when it is approved/declined (cards named if 3 or fewer).
- **Whip**: when a player is forced to HIT, a "Crack whip on this HIT" toggle appears (remembered, off by default). If it is on, everyone hears the whip when the HIT is played. The master Sound button silences all effects.

## v0.5 changes
- **QR / join link fixed**: the pre-fill code was sitting inside the `<script src>` tag, so browsers ignored it. Scanning the QR now opens the site with the room code filled in (and the saved name restored). Socket.IO is now served by your own server (`/socket.io/socket.io.js`) instead of a CDN.
- **"You lost the game"** full-screen message for the last player holding cards (also shown to a player whose surrender was approved).
- **Dealing**: cards are dealt one at a time with a flick sound per card. Gap between cards: 0.40 s (16), 0.30 s (32), 0.25 s (52), 0.15 s (104). Change `DEAL_GAP_MS` in `server.js`. The 30 s settle period starts after the last card.

## v0.6 changes
- **Auto-sort follows the lead suit**: while a round is in progress, players with Auto-sort on see cards of the lead suit first (highest to lowest), then their other suits. Normal sorting returns when the round ends.
