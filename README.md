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
