# Ironfront: World War v3

A deployable WebGL vehicle combat game with a full single-player campaign and real-time online multiplayer.

## Version 3 highlights

### Rewritten controls

- New input system in `public/controls.js`
- Keyboard, arrow-key and touch controls use one source-aware controller
- Movement packets contain normalized `move`, `turn` and `fire` values
- Sequence numbers reject old network input packets
- 100 ms multiplayer control heartbeat
- Server stops stale controls after 320 ms
- Inputs reset on blur, hidden tab, page exit, pause and match exit

### Rewritten shooting

- Single-player and multiplayer shooting systems were rebuilt
- Consistent muzzle spawning for every vehicle
- Time-based reload control rather than frame-dependent firing
- Swept projectile collision to prevent fast bullets passing through targets
- Authoritative multiplayer projectile simulation
- Friendly fire disabled between players in the same faction
- Explosive splash damage, twin fire, godmode rounds and Titan Salvo supported

### Timed faction multiplayer

- Up to eight players
- Every player chooses their own faction/team and vehicle
- The leader chooses the world, challenge and time limit
- Time limits: 2, 3, 5, 8 or 10 minutes
- Match results, faction scores and player leaderboard
- Leader can return the entire room to the lobby after a match

### Multiplayer challenges

- **Team Deathmatch:** eliminations give 3 faction points
- **Control Zone:** hold the central zone for points; eliminations also score
- **Salvage Rush:** collect power-ups for faction points; rare cores score more

### Existing full-game features

- Single-player campaign with five 3D worlds
- Boss level every five levels
- Coins, garage, unlockable vehicles and permanent upgrades
- Red coin enemies and collectible drops
- Repair, shield, rapid-fire, speed, godmode and Vehicle Morph power-ups
- 2D top-down and 3D chase cameras
- Private lobby codes and shareable invite URLs
- Arena size scales with player count
- Stable reconnecting player identity and a 30-second reconnect grace period

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Render deployment

The repository includes `render.yaml`. Deploy it as a **Node Web Service**, not a Static Site.

After replacing files in GitHub, deploy the latest commit and hard-refresh the game with `Ctrl + Shift + R`.
