# Donkey Online — multiplayer prototype

A minimal Node.js + Express + Socket.IO browser prototype for a custom Donkey-style card game.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` in a browser. Open it in other browser windows/devices on the same hosted URL to join with the room code.

## Deploy for internet play
Deploy the folder to a Node.js host that supports long-lived WebSocket connections (for example Render, Railway, or a VPS). The host should run `npm start` and expose the assigned `PORT`. Use HTTPS in production.

## Implemented in this prototype
- Room creation and room-code joining; player names; up to 20 seats.
- Single or double deck; card order breaks equal-rank ties in favour of pack 1 (the first deck).
- Host starts/deals; for 6 or fewer players the first player's Ace of Spades is auto-played when present; above 6, the starter chooses a card.
- Follow lead suit when possible; off-suit play is a HIT, with the trick's cards going to the highest card of the lead suit; otherwise highest lead-suit card wins and leads the next round.
- Auto-sort, short HIT sound toggle, card selection, request/approve/decline UI, random seat insertion for players joining mid-match.

## Prototype caveats / rule assumptions
This is a starter, not a production-tested game. It assumes one card is played by each online player per round, the lead suit must be followed if possible, and a HIT awards the entire current trick to the highest lead-suit card player. Mid-game joiners are seated but are not dealt cards until a new deal. The current request-card UI and card passing need final rules/QA before public release; reconnect handling, host migration, anti-cheat, persistent rooms, rate limiting, and automated tests are not yet production-ready. A 20-player single deck has only 52 cards, so hands are dealt as evenly as possible and the table should choose double deck for larger groups.


## Confirmed HIT rule

A player who has no card of the lead suit may play a card of another suit to make a HIT. The round ends immediately. The highest card of the lead suit already played wins the round and receives **all cards played in that round, including the off-suit HIT card**. No remaining players play to that round after the HIT.
