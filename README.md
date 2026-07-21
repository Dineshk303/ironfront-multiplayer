# Ironfront: World War

A complete WebGL vehicle combat game containing:

- Single-player campaign with five 3D worlds
- Boss level every five levels
- Coins, vehicle garage, permanent upgrades and saved progression
- Red coin enemies and collectible coin drops
- Random combat powerups and vehicle morph pickups
- 2D top-down and 3D chase cameras
- Online Socket.IO multiplayer for up to eight players
- Lobby codes, invite URLs, leader world/faction selection
- Arena size scaling based on player count

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Render deployment

The repository includes `render.yaml`. Connect the repository as a Render Blueprint or Web Service. Render must deploy it as a Node Web Service, not as a Static Site.

## Important deployment fix

The server exposes the entire Three.js build directory at `/vendor`. `three.module.js` imports `three.core.js`, so both files must be served. This fixes the previous blank vehicle selector and non-working Create Game button.
