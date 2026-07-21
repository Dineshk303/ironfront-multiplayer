# Ironfront Complete Game v4.0

A deployable WebGL vehicle combat game with a full single-player campaign and real-time multiplayer for up to eight players.

## v4 control, aiming and network rewrite

- One canonical heading system across player movement, AI, vehicle rendering and bullets.
- `W` / `Arrow Up`: drive forward.
- `S` / `Arrow Down`: reverse.
- `A` / `Arrow Left`: rotate left.
- `D` / `Arrow Right`: rotate right.
- `Space`: fire from the actual vehicle muzzle.
- `Q`: vehicle ability.
- `C`: switch 2D/3D camera.
- Complete keyboard/touch reset on blur, tab hiding, pause and exit.
- Deterministic vehicle muzzle nodes for the player and AI.
- AI fires only after its hull is aimed at the player.
- Server-authoritative multiplayer movement, hits and projectiles.
- 60 Hz server simulation, 20 Hz volatile snapshots and 30 Hz input heartbeat.
- Local-player prediction, server reconciliation, remote extrapolation and projectile extrapolation.
- Live multiplayer latency shown beside the challenge name.

## Multiplayer

- Up to eight players.
- Private room codes and shareable invitation URLs.
- Per-player faction and vehicle selection.
- Leader-controlled world, challenge and match duration.
- Team Deathmatch, Control Zone and Salvage Rush.
- Vehicle Morph and temporary combat power-ups.
- Timed matches, faction scores, result screen and return-to-lobby flow.

## Deployment

The included `render.yaml` deploys the project as a Render Node Web Service.

```bash
npm install
npm start
```

Open `http://localhost:3000` for local testing.
