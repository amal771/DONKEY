# Party Blaster — Mobile-Optimized Rummy & Donkey

Party Blaster is an online multiplayer card game portal.

## What's New:
1. **Single-Screen Mobile Orientation**:
   - Table felt (Stock pile, Wild cut-joker slot, Discard pile) and all 13 player cards fit concurrently on one mobile screen without vertical scrolling (`100dvh`).
   - Cards use a cascading fanned layout (`margin-left: -26px`) so all 13 cards remain fully visible and clickable even on narrow mobile screens (360px - 420px width).
2. **Sort Button**:
   - Tapping `🔀 Sort` organizes hand cards automatically by suit groups and ascending rank order.
3. **Group by Selection**:
   - Select 2 to 5 cards and tap `🗂 Group` to bundle them into custom meld boxes (`G1`, `G2`, etc.).
   - Declaration (`Show`) automatically submits user-formed groups for rule verification.
   - Tap `Ungroup` to merge cards back into a single pool.
4. **Adaptive Timers**:
   - Inactive: 20s.
   - Screen interaction/touch: 45s.
   - Offline: 8s.
   - Auto-draw and auto-discard on expiry.
5. **Universal QR Code & Exit to Lobby**:
   - Accessible anytime from top bar.
