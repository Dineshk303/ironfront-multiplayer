'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = 30;
const SNAPSHOT_RATE = 15;
const MAX_PLAYERS = 8;
const DISCONNECT_GRACE_MS = 30000;
const INPUT_TIMEOUT_MS = 220;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: false }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), { maxAge: '1d', immutable: true }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0) }));
app.get('/api/status', (_req, res) => res.json({ ok: true, maxPlayers: MAX_PLAYERS, worlds: Object.keys(WORLDS), vehicles: Object.keys(VEHICLES) }));

const rooms = new Map();

const VEHICLES = {
  vanguard: { name: 'Vanguard Tank', hp: 120, speed: 10, damage: 24, reload: 520, radius: 1.45, ability: 'Fortress Shield' },
  striker: { name: 'Striker Buggy', hp: 88, speed: 15, damage: 16, reload: 260, radius: 1.25, ability: 'Rapid Barrage' },
  annihilator: { name: 'Annihilator Siege Tank', hp: 190, speed: 7.4, damage: 40, reload: 850, radius: 1.75, ability: 'Ground Shockwave' },
  spectre: { name: 'Spectre Hovercraft', hp: 105, speed: 13.5, damage: 28, reload: 430, radius: 1.45, ability: 'Phase Drive' },
  titan: { name: 'Titan Walker', hp: 260, speed: 6.2, damage: 48, reload: 980, radius: 1.8, ability: 'Titan Salvo' }
};

const FACTIONS = {
  iron: { name: 'Iron Legion', hp: 1.2, speed: 1, damage: 1, cooldown: 1 },
  neon: { name: 'Neon Wolves', hp: 1, speed: 1.18, damage: 1, cooldown: 1 },
  solar: { name: 'Solar Dominion', hp: 1, speed: 1, damage: 1.18, cooldown: 1 },
  void: { name: 'Void Syndicate', hp: 1, speed: 1, damage: 1, cooldown: 0.78 }
};

const WORLDS = {
  jungle: { name: 'Emerald Jungle', traction: 0.82, bulletSpeed: 1, damage: 1, gravity: 1, obstacleBias: 'organic' },
  mountain: { name: 'Frozen Mountain', traction: 0.9, bulletSpeed: 1.06, damage: 1.04, gravity: 1, obstacleBias: 'rocks' },
  arena: { name: 'Grand Combat Arena', traction: 1.08, bulletSpeed: 1.12, damage: 1.08, gravity: 1, obstacleBias: 'pillars' },
  battlefield: { name: 'Ruined Battleground', traction: 0.96, bulletSpeed: 1, damage: 1.12, gravity: 1, obstacleBias: 'ruins' },
  space: { name: 'Zero-G Space Station', traction: 0.62, bulletSpeed: 0.82, damage: 1, gravity: 0.25, obstacleBias: 'reactors' }
};

const POWERUP_TYPES = ['heal', 'shield', 'rapid', 'speed', 'godmode', 'morph'];

function now() {
  return Date.now();
}

function makeId() {
  return crypto.randomUUID();
}

function sanitizeName(value) {
  const clean = String(value || 'Player').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18);
  return clean || 'Player';
}

function sanitizeVehicle(value) {
  return VEHICLES[value] ? value : 'vanguard';
}

function sanitizeClientId(value) {
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return clean || crypto.randomUUID();
}

function clearPlayerInput(player) {
  player.input.forward = false;
  player.input.backward = false;
  player.input.left = false;
  player.input.right = false;
  player.input.fire = false;
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function publicLobby(room) {
  return {
    code: room.code,
    leaderId: room.leaderId,
    status: room.status,
    settings: { ...room.settings },
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      vehicle: player.vehicle,
      connected: player.connected
    })),
    maxPlayers: MAX_PLAYERS
  };
}

function emitLobby(room) {
  io.to(room.code).emit('lobbyState', publicLobby(room));
}

function createPlayer(socket, payload) {
  const id = sanitizeClientId(payload?.clientId);
  return {
    id,
    socketId: socket.id,
    name: sanitizeName(payload?.name),
    vehicle: sanitizeVehicle(payload?.vehicle),
    connected: true,
    disconnectedAt: 0,
    lastInputAt: now(),
    input: { forward: false, backward: false, left: false, right: false, fire: false },
    x: 0,
    z: 0,
    angle: 0,
    hp: 1,
    maxHp: 1,
    score: 0,
    kills: 0,
    deaths: 0,
    dead: false,
    respawnAt: 0,
    lastFireAt: 0,
    abilityCooldownUntil: 0,
    abilityUntil: 0,
    power: null,
    powerUntil: 0
  };
}

function getFactionStats(room) {
  return FACTIONS[room.settings.faction] || FACTIONS.iron;
}

function getWorldStats(room) {
  return WORLDS[room.settings.world] || WORLDS.jungle;
}

function getPlayerStats(room, player) {
  const base = VEHICLES[player.vehicle] || VEHICLES.vanguard;
  const faction = getFactionStats(room);
  const rapid = player.power === 'rapid' && player.powerUntil > now();
  const speedBoost = player.power === 'speed' && player.powerUntil > now();
  const godmode = player.power === 'godmode' && player.powerUntil > now();
  const abilityRapid = player.vehicle === 'striker' && player.abilityUntil > now();
  return {
    hp: Math.round(base.hp * faction.hp),
    speed: base.speed * faction.speed * (speedBoost || godmode ? 1.55 : 1),
    damage: base.damage * faction.damage * (godmode ? 1.8 : 1),
    reload: base.reload * faction.cooldown * (rapid || abilityRapid || godmode ? 0.38 : 1),
    radius: base.radius
  };
}

function collides(room, x, z, radius) {
  if (Math.hypot(x, z) > room.radius - radius - 1) return true;
  return room.obstacles.some((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) < radius + obstacle.r);
}

function moveWithCollision(room, player, dx, dz) {
  const radius = getPlayerStats(room, player).radius;
  if (!collides(room, player.x + dx, player.z, radius)) player.x += dx;
  if (!collides(room, player.x, player.z + dz, radius)) player.z += dz;
}

function generateObstacles(room) {
  const random = seededRandom(room.seed);
  const count = Math.min(22, 5 + room.players.size * 2);
  const obstacles = [];
  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let z = 0;
    let r = 1.4 + random() * 1.7;
    let safe = false;
    for (let attempt = 0; attempt < 50 && !safe; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 7 + random() * (room.radius - 11);
      x = Math.cos(angle) * distance;
      z = Math.sin(angle) * distance;
      safe = obstacles.every((other) => Math.hypot(x - other.x, z - other.z) > r + other.r + 2.2);
    }
    if (safe) obstacles.push({ id: makeId(), x, z, r, variant: i % 4 });
  }
  return obstacles;
}

function spawnPlayers(room) {
  const faction = getFactionStats(room);
  const players = [...room.players.values()];
  const occupied = [];

  players.forEach((player, index) => {
    const preferredAngle = (index / Math.max(1, players.length)) * Math.PI * 2;
    const preferredDistance = Math.min(12, room.radius * 0.35);
    const radius = getPlayerStats(room, player).radius;
    let x = Math.cos(preferredAngle) * preferredDistance;
    let z = Math.sin(preferredAngle) * preferredDistance;
    let safe = !collides(room, x, z, radius);

    for (let attempt = 0; attempt < 80 && !safe; attempt += 1) {
      const angle = preferredAngle + attempt * 0.55;
      const distance = 5 + (attempt % 6) * Math.max(2.2, (room.radius - 10) / 6);
      x = Math.cos(angle) * Math.min(distance, room.radius - 5);
      z = Math.sin(angle) * Math.min(distance, room.radius - 5);
      safe = !collides(room, x, z, radius) && occupied.every((other) => Math.hypot(x - other.x, z - other.z) > radius + other.radius + 2);
    }

    player.x = x;
    player.z = z;
    player.angle = Math.atan2(-x, z);
    player.score = 0;
    player.kills = 0;
    player.deaths = 0;
    player.dead = false;
    player.respawnAt = 0;
    player.power = null;
    player.powerUntil = 0;
    player.abilityUntil = 0;
    player.abilityCooldownUntil = 0;
    player.lastInputAt = now();
    clearPlayerInput(player);
    const base = VEHICLES[player.vehicle];
    player.maxHp = Math.round(base.hp * faction.hp);
    player.hp = player.maxHp;
    occupied.push({ x, z, radius });
  });
}

function spawnPowerup(room, forcedType = null) {
  if (room.powerups.length >= Math.min(5, 2 + Math.ceil(room.players.size / 2))) return;
  const type = forcedType || POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 4 + Math.random() * (room.radius - 8);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!collides(room, x, z, 1)) {
      room.powerups.push({ id: makeId(), type, x, z, expiresAt: now() + 15000 });
      return;
    }
  }
}

function respawnPlayer(room, player) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * Math.max(3, room.radius - 8);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!collides(room, x, z, getPlayerStats(room, player).radius)) {
      player.x = x;
      player.z = z;
      player.angle = Math.random() * Math.PI * 2;
      break;
    }
  }
  player.dead = false;
  player.power = null;
  player.powerUntil = 0;
  player.abilityUntil = 0;
  player.maxHp = getPlayerStats(room, player).hp;
  player.hp = player.maxHp;
}

function applyPowerup(room, player, powerup) {
  const time = now();
  if (powerup.type === 'heal') {
    player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.55));
  } else if (powerup.type === 'morph') {
    const choices = Object.keys(VEHICLES).filter((vehicle) => vehicle !== player.vehicle);
    player.vehicle = choices[Math.floor(Math.random() * choices.length)] || 'vanguard';
    player.power = 'godmode';
    player.powerUntil = time + 7000;
    player.maxHp = getPlayerStats(room, player).hp;
    player.hp = player.maxHp;
  } else {
    player.power = powerup.type;
    player.powerUntil = time + (powerup.type === 'godmode' ? 6500 : 10000);
  }
  io.to(room.code).emit('powerupCollected', {
    playerId: player.id,
    playerName: player.name,
    type: powerup.type,
    vehicle: player.vehicle
  });
}

function spawnBullet(room, player, angleOffset = 0, damageMultiplier = 1) {
  const world = getWorldStats(room);
  const stats = getPlayerStats(room, player);
  const angle = player.angle + angleOffset;
  const speed = 23 * world.bulletSpeed;
  room.bullets.push({
    id: makeId(),
    ownerId: player.id,
    x: player.x + Math.sin(angle) * (stats.radius + 1),
    z: player.z - Math.cos(angle) * (stats.radius + 1),
    vx: Math.sin(angle) * speed,
    vz: -Math.cos(angle) * speed,
    damage: stats.damage * world.damage * damageMultiplier,
    radius: damageMultiplier > 1.4 ? 0.45 : 0.25,
    expiresAt: now() + (room.settings.world === 'space' ? 4500 : 3000)
  });
}

function useAbility(room, player) {
  const time = now();
  if (player.dead || player.abilityCooldownUntil > time) return;
  const faction = getFactionStats(room);
  player.abilityCooldownUntil = time + 16000 * faction.cooldown;

  if (player.vehicle === 'vanguard') {
    player.abilityUntil = time + 5500;
  } else if (player.vehicle === 'striker') {
    player.abilityUntil = time + 5500;
  } else if (player.vehicle === 'spectre') {
    player.abilityUntil = time + 4500;
  } else if (player.vehicle === 'annihilator') {
    for (const target of room.players.values()) {
      if (target.id === player.id || target.dead) continue;
      if (Math.hypot(target.x - player.x, target.z - player.z) <= 8.5) {
        target.hp -= getPlayerStats(room, player).damage * 1.7;
        if (target.hp <= 0) killPlayer(room, target, player.id);
      }
    }
    io.to(room.code).emit('shockwave', { playerId: player.id, x: player.x, z: player.z });
  } else if (player.vehicle === 'titan') {
    [-0.32, -0.16, 0, 0.16, 0.32].forEach((offset) => spawnBullet(room, player, offset, 1.35));
  }
}

function killPlayer(room, victim, killerId) {
  if (victim.dead) return;
  victim.dead = true;
  victim.hp = 0;
  victim.deaths += 1;
  victim.respawnAt = now() + 3000;
  if (killerId && killerId !== victim.id) {
    const killer = room.players.get(killerId);
    if (killer) {
      killer.kills += 1;
      killer.score += 100;
    }
  }
  io.to(room.code).emit('playerDestroyed', { victimId: victim.id, killerId });
}

function updateRoom(room, dt) {
  if (room.status !== 'playing') return;
  const time = now();
  const world = getWorldStats(room);

  for (const player of room.players.values()) {
    if (!player.connected) continue;
    if (time - player.lastInputAt > INPUT_TIMEOUT_MS) clearPlayerInput(player);
    if (player.dead) {
      if (time >= player.respawnAt) respawnPlayer(room, player);
      continue;
    }

    const stats = getPlayerStats(room, player);
    const turn = (player.input.right ? 1 : 0) - (player.input.left ? 1 : 0);
    const drive = (player.input.forward ? 1 : 0) - (player.input.backward ? 1 : 0);
    player.angle += turn * dt * 2.45 * world.traction;

    if (drive !== 0) {
      const phase = player.vehicle === 'spectre' && player.abilityUntil > time;
      const speed = stats.speed * world.traction * (phase ? 1.65 : 1);
      const dx = Math.sin(player.angle) * drive * speed * dt;
      const dz = -Math.cos(player.angle) * drive * speed * dt;
      moveWithCollision(room, player, dx, dz);
    }

    if (player.input.fire && time - player.lastFireAt >= stats.reload) {
      player.lastFireAt = time;
      if (player.vehicle === 'striker' && player.abilityUntil > time) {
        spawnBullet(room, player, -0.08);
        spawnBullet(room, player, 0.08);
      } else {
        spawnBullet(room, player);
      }
    }
  }

  for (let i = room.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = room.bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.z += bullet.vz * dt;

    if (time >= bullet.expiresAt || Math.hypot(bullet.x, bullet.z) > room.radius + 2 || collides(room, bullet.x, bullet.z, bullet.radius)) {
      room.bullets.splice(i, 1);
      continue;
    }

    let removed = false;
    for (const target of room.players.values()) {
      if (target.id === bullet.ownerId || target.dead) continue;
      const stats = getPlayerStats(room, target);
      if (Math.hypot(target.x - bullet.x, target.z - bullet.z) <= stats.radius + bullet.radius) {
        const phase = target.vehicle === 'spectre' && target.abilityUntil > time;
        const shield = target.power === 'shield' && target.powerUntil > time;
        const godmode = target.power === 'godmode' && target.powerUntil > time;
        const fortress = target.vehicle === 'vanguard' && target.abilityUntil > time;
        if (!phase && !godmode) {
          const multiplier = fortress ? 0.16 : shield ? 0.25 : 1;
          target.hp -= bullet.damage * multiplier;
          if (target.hp <= 0) killPlayer(room, target, bullet.ownerId);
        }
        room.bullets.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (removed) continue;
  }

  room.powerups = room.powerups.filter((powerup) => time < powerup.expiresAt);
  for (const player of room.players.values()) {
    if (player.dead) continue;
    for (let i = room.powerups.length - 1; i >= 0; i -= 1) {
      const powerup = room.powerups[i];
      if (Math.hypot(player.x - powerup.x, player.z - powerup.z) < getPlayerStats(room, player).radius + 1.1) {
        applyPowerup(room, player, powerup);
        room.powerups.splice(i, 1);
      }
    }
  }

  if (time >= room.nextPowerupAt) {
    const morphChance = Math.random() < 0.22;
    spawnPowerup(room, morphChance ? 'morph' : null);
    room.nextPowerupAt = time + 5500 + Math.random() * 3500;
  }
}

function snapshot(room) {
  const time = now();
  return {
    serverTime: time,
    roomCode: room.code,
    radius: room.radius,
    settings: { ...room.settings },
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      vehicle: player.vehicle,
      connected: player.connected,
      x: player.x,
      z: player.z,
      angle: player.angle,
      hp: Math.max(0, player.hp),
      maxHp: player.maxHp,
      score: player.score,
      kills: player.kills,
      deaths: player.deaths,
      dead: player.dead,
      respawnAt: player.respawnAt,
      abilityCooldownUntil: player.abilityCooldownUntil,
      abilityUntil: player.abilityUntil,
      power: player.powerUntil > time ? player.power : null,
      powerUntil: player.powerUntil
    })),
    bullets: room.bullets,
    powerups: room.powerups
  };
}

function matchPayload(room) {
  return {
    roomCode: room.code,
    radius: room.radius,
    settings: { ...room.settings },
    seed: room.seed,
    obstacles: room.obstacles,
    vehicles: VEHICLES,
    factions: FACTIONS,
    worlds: WORLDS
  };
}

function startMatch(room) {
  room.status = 'playing';
  room.radius = 28 + Math.max(0, room.players.size - 1) * 4.5;
  room.seed = hashCode(`${room.code}-${now()}`);
  room.bullets = [];
  room.powerups = [];
  room.nextPowerupAt = now() + 4000;
  room.obstacles = generateObstacles(room);
  spawnPlayers(room);
  io.to(room.code).emit('matchStarted', matchPayload(room));
  emitLobby(room);
}

function transferLeadership(room) {
  const next = [...room.players.values()].find((player) => player.connected) || room.players.values().next().value;
  room.leaderId = next?.id || null;
}

function removePlayerFromRoom(socket) {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code || !playerId) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.playerId = null;
  if (!room) return;

  room.players.delete(playerId);
  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }
  if (room.leaderId === playerId) transferLeadership(room);
  emitLobby(room);
}

function detachPlayerSocket(socket) {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code || !playerId) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.playerId = null;
  if (!room) return;

  const player = room.players.get(playerId);
  if (!player) return;
  if (player.socketId && player.socketId !== socket.id) return;
  player.connected = false;
  player.socketId = null;
  player.disconnectedAt = now();
  clearPlayerInput(player);
  emitLobby(room);
}

function attachPlayerSocket(room, player, socket) {
  if (player.socketId && player.socketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(player.socketId);
    previousSocket?.leave(room.code);
    if (previousSocket) {
      previousSocket.data.roomCode = null;
      previousSocket.data.playerId = null;
      previousSocket.emit('sessionReplaced');
    }
  }
  room.players.set(player.id, player);
  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = 0;
  player.lastInputAt = now();
  clearPlayerInput(player);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
}

function cleanupDisconnectedPlayers(room, time) {
  let changed = false;
  for (const [playerId, player] of room.players) {
    if (!player.connected && player.disconnectedAt && time - player.disconnectedAt > DISCONNECT_GRACE_MS) {
      room.players.delete(playerId);
      if (room.leaderId === playerId) transferLeadership(room);
      changed = true;
    }
  }
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return false;
  }
  if (changed) emitLobby(room);
  return true;
}

io.on('connection', (socket) => {
  socket.on('createRoom', (payload, callback) => {
    try {
      removePlayerFromRoom(socket);
      const code = makeRoomCode();
      const player = createPlayer(socket, payload);
      const room = {
        code,
        leaderId: player.id,
        status: 'lobby',
        settings: { world: 'jungle', faction: 'iron' },
        players: new Map([[player.id, player]]),
        radius: 28,
        seed: hashCode(code),
        obstacles: [],
        bullets: [],
        powerups: [],
        nextPowerupAt: now() + 5000
      };
      rooms.set(code, room);
      attachPlayerSocket(room, player, socket);
      callback?.({ ok: true, room: publicLobby(room), selfId: player.id });
      emitLobby(room);
    } catch (error) {
      console.error('createRoom failed', error);
      callback?.({ ok: false, error: 'Could not create room.' });
    }
  });

  socket.on('joinRoom', (payload, callback) => {
    const code = String(payload?.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    const clientId = sanitizeClientId(payload?.clientId);
    if (!room) return callback?.({ ok: false, error: 'Room not found.' });

    let player = room.players.get(clientId);
    if (!player) {
      if (room.status !== 'lobby') return callback?.({ ok: false, error: 'Match already started.' });
      if (room.players.size >= MAX_PLAYERS) return callback?.({ ok: false, error: 'Room is full.' });
      removePlayerFromRoom(socket);
      player = createPlayer(socket, { ...payload, clientId });
      room.players.set(player.id, player);
    } else {
      removePlayerFromRoom(socket);
      player.name = sanitizeName(payload?.name || player.name);
      if (room.status === 'lobby') player.vehicle = sanitizeVehicle(payload?.vehicle || player.vehicle);
    }

    attachPlayerSocket(room, player, socket);
    callback?.({
      ok: true,
      room: publicLobby(room),
      selfId: player.id,
      match: room.status === 'playing' ? matchPayload(room) : null,
      snapshot: room.status === 'playing' ? snapshot(room) : null
    });
    emitLobby(room);
  });

  socket.on('resumeRoom', (payload, callback) => {
    const code = String(payload?.code || '').trim().toUpperCase();
    const clientId = sanitizeClientId(payload?.clientId);
    const room = rooms.get(code);
    const player = room?.players.get(clientId);
    if (!room || !player) return callback?.({ ok: false, error: 'Your previous room session is no longer available.' });

    removePlayerFromRoom(socket);
    attachPlayerSocket(room, player, socket);
    callback?.({
      ok: true,
      room: publicLobby(room),
      selfId: player.id,
      match: room.status === 'playing' ? matchPayload(room) : null,
      snapshot: room.status === 'playing' ? snapshot(room) : null
    });
    emitLobby(room);
  });

  socket.on('setLobbySettings', (payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.leaderId !== socket.data.playerId || room.status !== 'lobby') return callback?.({ ok: false });
    if (WORLDS[payload?.world]) room.settings.world = payload.world;
    if (FACTIONS[payload?.faction]) room.settings.faction = payload.faction;
    emitLobby(room);
    callback?.({ ok: true });
  });

  socket.on('setVehicle', (payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || room.status !== 'lobby') return callback?.({ ok: false });
    player.vehicle = sanitizeVehicle(payload?.vehicle);
    emitLobby(room);
    callback?.({ ok: true });
  });

  socket.on('startMatch', (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.leaderId !== socket.data.playerId || room.status !== 'lobby') return callback?.({ ok: false, error: 'Only the leader can start.' });
    const connectedPlayers = [...room.players.values()].filter((player) => player.connected);
    if (connectedPlayers.length < 1) return callback?.({ ok: false, error: 'No connected players.' });
    startMatch(room);
    callback?.({ ok: true, match: matchPayload(room) });
  });

  socket.on('input', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || room.status !== 'playing' || player.socketId !== socket.id) return;
    player.input.forward = Boolean(payload?.forward);
    player.input.backward = Boolean(payload?.backward);
    player.input.left = Boolean(payload?.left);
    player.input.right = Boolean(payload?.right);
    player.input.fire = Boolean(payload?.fire);
    player.lastInputAt = now();
  });

  socket.on('ability', () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (room && player && room.status === 'playing' && player.socketId === socket.id) useAbility(room, player);
  });

  socket.on('leaveRoom', () => removePlayerFromRoom(socket));
  socket.on('disconnect', () => detachPlayerSocket(socket));
});

let snapshotAccumulator = 0;
setInterval(() => {
  const dt = 1 / TICK_RATE;
  snapshotAccumulator += dt;
  const time = now();
  for (const room of [...rooms.values()]) {
    if (cleanupDisconnectedPlayers(room, time)) updateRoom(room, dt);
  }
  if (snapshotAccumulator >= 1 / SNAPSHOT_RATE) {
    snapshotAccumulator = 0;
    for (const room of rooms.values()) {
      if (room.status === 'playing') io.to(room.code).emit('snapshot', snapshot(room));
    }
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Ironfront Complete Game running on http://localhost:${PORT}`);
});
