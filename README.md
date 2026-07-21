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


## Multiplayer reliability update 2.1

- Stable browser player IDs instead of temporary Socket.IO connection IDs
- Automatic lobby and active-match rejoin after a connection interruption
- A 30-second disconnect grace period before a player is removed
- Missed match-start recovery for clients that reconnect while a match is running
- Server-side stale-input timeout to prevent vehicles driving after a lost key-up event
- Left/right steering correction
- Safe spawn placement away from world obstacles
- Input reset on blur, hidden tab and page exit

After uploading this version, deploy the latest commit and use a hard refresh (`Ctrl + Shift + R`).
