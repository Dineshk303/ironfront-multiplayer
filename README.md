# Ironfront Online

A deployable WebGL multiplayer vehicle arena for up to 8 players.

## Included

- Real-time Socket.IO multiplayer
- Private room codes and shareable invite URLs
- Maximum 8 players
- Arena radius expands with player count
- Lobby leader selects the world and faction
- Each player selects a starting vehicle
- Five WebGL worlds: Jungle, Mountain, Arena, Battleground, Space Station
- 2D top-down and 3D chase cameras
- Random power-ups: repair, shield, rapid fire, speed, godmode
- Random **Vehicle Morph** pickup that swaps the player's vehicle and ability during the match
- Vehicle-specific active abilities
- Respawns, kills, deaths, score, roster and event feed
- Desktop and mobile controls

## Local development

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser windows to test multiplayer.

## Share it with friends

This project needs a public Node.js host because multiplayer requires a persistent WebSocket server. Deploy it to Render, Railway, Fly.io, a VPS, or another host that supports WebSockets.

### Render

1. Put this folder in a GitHub repository.
2. In Render, create a new Blueprint or Web Service from the repository.
3. Render detects `render.yaml`.
4. Deploy.
5. Open the generated HTTPS URL, create a room, then use **Copy invite URL**.

### Docker

```bash
docker build -t ironfront-online .
docker run --rm -p 3000:3000 ironfront-online
```

## Controls

- `W/S` or arrows: drive
- `A/D` or arrows: steer
- `Space`: fire
- `Q`: vehicle ability
- `C`: change 2D/3D camera

## Production notes

The included server keeps room state in memory. For multiple server instances or long-term accounts, add Redis for Socket.IO room synchronization and a database for saved player progression.
