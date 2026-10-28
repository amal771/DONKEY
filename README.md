# Party Blaster — Multiplayer Game Hub

Party Blaster is a web-based card game portal supporting **20-Player Rummy** and **Donkey Online**.

## Features & Game Rules

### 1. Universal Fullscreen
- Integrated Fullscreen API toggle available on desktop and mobile.

### 2. Custom 20-Player Rummy
- **Deck & Jokers:** Configurable 3 to 6 decks (52 cards each) with 2 or 3 printed jokers per deck. Minimum 52 cards reserved in the closed stock pile.
- **Pick & Discard Turn Loop:**
  - Draw from the closed stock pile or open discard pile.
  - Discarding a card finishes your turn.
  - If the Joker is **HIDDEN**, players can freely pick the top card of the discard pile (even if it's a joker).
  - Once the Joker is **OPEN/revealed**, picking an open Joker from the discard pile is blocked.
- **Drop Option:**
  - First Drop (before or on 1st turn): **20 points**.
  - Middle Drop (2nd turn onward): **40 points**.
- **Identical Triplets (Sikkan):**
  - Three identical cards of the same rank and suit across separate packs (e.g., 3x 5♣, 3x A♠) count as a valid **Pure Sequence** without Jokers.
  - No duplicate cards allowed within natural run sequences (e.g., 4s-4s-5s is invalid).
- **Hidden Joker Reveal & Timers:**
  - When an active player presents a valid Pure Sequence or Sikkan:
    - All other players receive a 5-second popup showcasing the cut-joker with an immediate close button.
    - The unlocking player gets a 15-second inspection window before their turn timer resumes, with an option to close early.
- **Invalid Declaration:**
  - A false declaration triggers a warning popup allowing the player to fix combinations or place a card onto the discard pile to continue the game.
- **Scoring:**
  - Pure Sequence + Secondary Sequence must total at least 7 cards.
  - In the absence of a pure sequence, the penalty is capped at **80 points**.

### 3. Donkey Online
- Shedding trick card game with HIT whip effects, table rotation, and room QR sharing.

## Running Locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.
