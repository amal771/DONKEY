# Party Blaster — Multi-Game Portal (Rummy & Donkey)

Party Blaster is a web-based card game hub that supports **20-Player Rummy** and **Donkey**.

## Features in this Version:
1. **Room QR Code**:
   - Universal `📱 QR Code` button in the header across all games.
   - Shows a modal with the room code and scannable QR code (`/qr/CODE`) allowing mobile players to scan and join instantly.
2. **Exit to Lobby**:
   - `Exit to Lobby` button visible in the top navigation bar when inside any game room.
   - Confirms departure, safely detaches the player's socket, prunes the table or manages offline state, and returns the client to the lobby view.
3. **Adaptive Rummy Turn Timers & Auto-Play**:
   - **Inactive Player**: 20-second countdown.
   - **Active Touch/Movement**: Interacting with cards or touching the screen extends the timer to **45 seconds**.
   - **Offline Player**: Automatically executes the turn within **8 seconds**.
   - **Timeout Auto-Action**:
     - Automatically draws 1 card from the stock pile.
     - Automatically discards 1 non-joker card to the top of the open discard pile and advances the turn.
4. **Donkey Game Features**:
   - 16, 32, 52, or 104 deck sizes.
   - 30-second Ace of Spades settle-up start.
   - Lead suit following, high-card highlight, off-suit HIT collection, and whip sound.
   - Card request modal and 3-player surrender negotiation.
5. **Universal Fullscreen Support**:
   - Accessible from the top bar across mobile and desktop.

## Run Locally
```bash
npm install
npm start
```
Open `http://localhost:3000`.
