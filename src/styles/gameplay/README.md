# Gameplay CSS structure

The Gameplay UI is split into one explicit source per responsibility:

- `gameplay.shared.css`: visual rules shared by both layouts.
- `gameplay.landscape.css`: desktop and rotated-mobile layout (`data-layout="landscape"`).
- `gameplay.portrait.css`: upright-mobile layout (`data-layout="portrait"`).

## Landscape editing

Open `gameplay.landscape.css` and edit the grouped `--gp-*` variables in the
first `.gameplay-screen` rule. The Landscape control panel covers:

- room header and information
- side menu
- table, timer, tile walls, and discard lanes
- player hand and action buttons
- top, bottom, and left player panels
- bonus and meld racks
- draw/discard focus overlays

Do not append Landscape overrides at the bottom of the file. Add a control
variable to the first rule and bind the relevant declaration to that variable.

## Portrait editing

Open `gameplay.portrait.css` and edit the grouped `--pt-*` variables in the
first `.gameplay-screen` rule. The Portrait control panel covers:

- the 720x1280 design canvas
- room HUD and Leave button
- all three player cards
- table, timer, and tile-wall lanes
- discard, bonus, and meld racks
- hand and action buttons
- focus and error overlay positions

Portrait and Landscape controls are independent. A `--pt-*` edit cannot change
Landscape, and a `--gp-*` edit cannot change Portrait.

## General rules

1. Do not add Gameplay overrides to `global.css`, `desktop/`, or `mobile/`.
2. Gameplay positioning and sizing must use `data-layout`, not `data-device`.
3. Reuse the control panel before adding a new declaration.
4. Add genuinely shared visual styling to `gameplay.shared.css` only.
