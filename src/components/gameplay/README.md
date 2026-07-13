# Gameplay UI Components

This folder contains presentation-only gameplay components extracted from `pages/MahjongGamePage.jsx`.

- `GameplayPrimitives.jsx`: tiles, walls, side tools, player badges, and compass.
- `GameplayOverlays.jsx`: tile-focus overlay, Fei reclaim prompt, and bonus rack.

Gameplay socket handling, game state, actions, and rules remain in `MahjongGamePage.jsx`.
Layout styling remains isolated in:

- `styles/gameplay/gameplay.shared.css`
- `styles/gameplay/gameplay.landscape.css`
- `styles/gameplay/gameplay.portrait.css`
