# Party Blaster — Multi-Game Portal (Rummy & Donkey)

Party Blaster is a web-based card game hub that supports **20-Player Rummy** and **Donkey**.

## Changes in this update:
1. **Renamed Game**: Changed "Donkey Online" to **Donkey**.
2. **Fixed Room Creation Options**: Donkey now has its full room creation options (16, 32, 52, or 104 deck sizes).
3. **Fixed Game Launching Routing**: Creating or joining a Donkey room opens the genuine Donkey felt table, seating ring, trick tracking, and whip controls instead of defaulting to Rummy.
4. **Complete Donkey Mechanics Retained**:
   - Adaptive turn timers (50s / 15s) and 30s Ace of Spades settle-up start.
   - Lead suit following, high-card highlight, off-suit HIT collection, and whip sound trigger.
   - Card request modal (ask next player for all cards) and 3-player surrender option.
5. **Rummy 20-Player Mechanics**:
   - 3 to 6 decks (auto-scaling to ensure $\ge 52$ closed draw pile cards).
   - Hidden/Open Joker inspection timers (5s table broadcast, 15s unlocker inspection).
   - Identical triplets (Sikkan) pure sequences.
   - First (20 pts) & Middle (40 pts) drops.
   - Soft invalid declaration popup.

## Run Locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.
