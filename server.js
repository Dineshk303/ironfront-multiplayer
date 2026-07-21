'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = 60;
const SNAPSHOT_RATE = 20;
const MAX_PLAYERS = 8;
const DISCONNECT_GRACE_MS = 30000;
const INPUT_TIMEOUT_MS = 500;
const CONTROL_ZONE_RADIUS = 6.5;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: false },
  perMessageDeflate: false,
  pingInterval: 10000,
  pingTimeout: 20000
});

const rooms = new Map();

const VEHICLES = {
  vanguard: { name: 'Vanguard Tank', hp: 120, speed: 10, damage: 24, reload: 520, radius: 1.45, muzzleDistance: 2.67, muzzleHeight: 1.4, ability: 'Fortress Shield' },
  striker: { name: 'Striker Buggy', hp: 88, speed: 15, damage: 16, reload: 260, radius: 1.25, muzzleDistance: 2.42, muzzleHeight: 1.15, ability: 'Rapid Barrage' },
  annihilator: { name: 'Annihilator Siege Tank', hp: 190, speed: 7.4, damage: 40, reload: 850, radius: 1.75, muzzleDistance: 3.42, muzzleHeight: 1.4, ability: 'Ground Shockwave' },
  spectre: { name: 'Spectre Hovercraft', hp: 105, speed: 13.5, damage: 28, reload: 430, radius: 1.45, muzzleDistance: 2.5, muzzleHeight: 1.38, ability: 'Phase Drive' },
  titan: { name: 'Titan Walker', hp: 260, speed: 6.2, damage: 48, reload: 980, radius: 1.8, muzzleDistance: 2.67, muzzleHeight: 2.78, ability: 'Titan Salvo' }
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

const CHALLENGES = {
  team_deathmatch: {
    name: 'Team Deathmatch',
    description: 'Destroy enemy vehicles. Every elimination gives your faction 3 points.',
    killPoints: 3,
    pickupPoints: 0
  },
  control_zone: {
    name: 'Control Zone',
    description: 'Hold the central zone. Exclusive control gives 1 point per second; eliminations give 1 point.',
    killPoints: 1,
    pickupPoints: 0
  },
  salvage_rush: {
    name: 'Salvage Rush',
    description: 'Collect battlefield power-ups. Pickups give 2 points, rare cores give 3, and eliminations give 1.',
    killPoints: 1,
    pickupPoints: 2
  }
};

const ALLOWED_DURATIONS = new Set([120, 180, 300, 480, 600]);
const POWERUP_TYPES = ['heal', 'shield', 'rapid', 'speed', 'godmode', 'morph'];

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), { maxAge: '1d', immutable: true }));
app.get('/health', (_req, res) => res.json({
  ok: true,
  rooms: rooms.size,
  players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0)
}));
app.get('/api/status', (_req, res) => res.json({
  ok: true,
  maxPlayers: MAX_PLAYERS,
  worlds: Object.keys(WORLDS),
  vehicles: Object.keys(VEHICLES),
  factions: Object.keys(FACTIONS),
  challenges: Object.keys(CHALLENGES)
}));

function now() {
  return Date.now();
}

function makeId() {
  return crypto.randomUUID();
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sanitizeName(value) {
  const clean = String(value || 'Player').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 18);
  return clean || 'Player';
}

function sanitizeVehicle(value) {
  return VEHICLES[value] ? value : 'vanguard';
}

function sanitizeFaction(value) {
  return FACTIONS[value] ? value : 'iron';
}

function sanitizeClientId(value) {
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return clean || crypto.randomUUID();
}

function sanitizeDuration(value) {
  const seconds = Math.round(Number(value));
  if (process.env.IRONFRONT_TEST_DURATION === '1' && seconds >= 2 && seconds <= 30) return seconds;
  return ALLOWED_DURATIONS.has(seconds) ? seconds : 300;
}

function sanitizeChallenge(value) {
  return CHALLENGES[value] ? value : 'team_deathmatch';
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let index = 0; index < 5; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let temporary = value;
    temporary = Math.imul(temporary ^ (temporary >>> 15), temporary | 1);
    temporary ^= temporary + Math.imul(temporary ^ (temporary >>> 7), temporary | 61);
    return ((temporary ^ (temporary >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function emptyTeamScores() {
  return Object.fromEntries(Object.keys(FACTIONS).map((faction) => [faction, 0]));
}

function clearPlayerControl(player) {
  player.control.throttle = 0;
  player.control.steer = 0;
  player.control.fire = false;
  player.vx = 0;
  player.vz = 0;
}

function createPlayer(socket, payload) {
  const id = sanitizeClientId(payload?.clientId);
  return {
    id,
    socketId: socket.id,
    name: sanitizeName(payload?.name),
    vehicle: sanitizeVehicle(payload?.vehicle),
    faction: sanitizeFaction(payload?.faction),
    connected: true,
    disconnectedAt: 0,
    lastControlAt: now(),
    lastControlSequence: -1,
    control: { throttle: 0, steer: 0, fire: false },
    x: 0,
    z: 0,
    angle: 0,
    vx: 0,
    vz: 0,
    hp: 1,
    maxHp: 1,
    score: 0,
    kills: 0,
    deaths: 0,
    objectiveScore: 0,
    dead: false,
    respawnAt: 0,
    nextShotAt: 0,
    abilityCooldownUntil: 0,
    abilityUntil: 0,
    power: null,
    powerUntil: 0
  };
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
      faction: player.faction,
      connected: player.connected
    })),
    maxPlayers: MAX_PLAYERS,
    result: room.result
  };
}

function emitLobby(room) {
  io.to(room.code).emit('lobbyState', publicLobby(room));
}

function getFactionStats(player) {
  return FACTIONS[player.faction] || FACTIONS.iron;
}

function getWorldStats(room) {
  return WORLDS[room.settings.world] || WORLDS.jungle;
}

function getPlayerStats(room, player, time = now()) {
  const base = VEHICLES[player.vehicle] || VEHICLES.vanguard;
  const faction = getFactionStats(player);
  const rapidPower = player.power === 'rapid' && player.powerUntil > time;
  const speedPower = player.power === 'speed' && player.powerUntil > time;
  const godmode = player.power === 'godmode' && player.powerUntil > time;
  const abilityRapid = player.vehicle === 'striker' && player.abilityUntil > time;
  return {
    hp: Math.round(base.hp * faction.hp),
    speed: base.speed * faction.speed * (speedPower || godmode ? 1.55 : 1),
    damage: base.damage * faction.damage * (godmode ? 1.8 : 1),
    reload: base.reload * faction.cooldown * (rapidPower || abilityRapid || godmode ? 0.38 : 1),
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

function segmentCircleHit(x1, z1, x2, z2, cx, cz, radius) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0.000001) return Math.hypot(x1 - cx, z1 - cz) <= radius;
  const projection = clamp(((cx - x1) * dx + (cz - z1) * dz) / lengthSquared, 0, 1);
  const closestX = x1 + dx * projection;
  const closestZ = z1 + dz * projection;
  return Math.hypot(closestX - cx, closestZ - cz) <= radius;
}

function projectileHitsObstacle(room, projectile, nextX, nextZ) {
  if (Math.hypot(nextX, nextZ) > room.radius + 1) return true;
  return room.obstacles.some((obstacle) => segmentCircleHit(
    projectile.x,
    projectile.z,
    nextX,
    nextZ,
    obstacle.x,
    obstacle.z,
    obstacle.r + projectile.radius
  ));
}

function pointSegmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 0.000001) return Math.hypot(px - ax, pz - az);
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function generateObstacles(room) {
  const random = seededRandom(room.seed);
  const count = Math.min(24, 5 + room.players.size * 2);
  const obstacles = [];
  const factionOrder = Object.keys(FACTIONS);
  const activeFactions = [...new Set([...room.players.values()].map((player) => player.faction))];
  const spawnLanes = activeFactions.map((faction) => {
    const angle = factionOrder.indexOf(faction) / factionOrder.length * Math.PI * 2;
    const distance = room.radius * 0.58;
    return { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
  });
  for (let index = 0; index < count; index += 1) {
    let x = 0;
    let z = 0;
    const radius = 1.4 + random() * 1.7;
    let safe = false;
    for (let attempt = 0; attempt < 60 && !safe; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 9 + random() * Math.max(4, room.radius - 14);
      x = Math.cos(angle) * distance;
      z = Math.sin(angle) * distance;
      const clearCenter = Math.hypot(x, z) > CONTROL_ZONE_RADIUS + radius + 3;
      const clearSpawnLanes = spawnLanes.every((spawn) => pointSegmentDistance(x, z, spawn.x, spawn.z, 0, 0) > radius + 3.2);
      safe = clearCenter && clearSpawnLanes && obstacles.every((other) => Math.hypot(x - other.x, z - other.z) > radius + other.r + 2.2);
    }
    if (safe) obstacles.push({ id: makeId(), x, z, r: radius, variant: index % 4 });
  }
  return obstacles;
}

function spawnPlayers(room) {
  const factionMembers = new Map(Object.keys(FACTIONS).map((faction) => [faction, []]));
  for (const player of room.players.values()) factionMembers.get(player.faction).push(player);
  const occupied = [];
  const factionOrder = Object.keys(FACTIONS);

  for (const [faction, members] of factionMembers) {
    const factionIndex = factionOrder.indexOf(faction);
    const baseAngle = factionIndex / factionOrder.length * Math.PI * 2;
    members.forEach((player, memberIndex) => {
      const radius = getPlayerStats(room, player).radius;
      let x = 0;
      let z = 0;
      let safe = false;
      for (let attempt = 0; attempt < 90 && !safe; attempt += 1) {
        const angle = baseAngle + (memberIndex - (members.length - 1) / 2) * 0.28 + attempt * 0.19;
        const distance = Math.min(room.radius - 6, room.radius * 0.58 + (attempt % 5) * 1.1);
        x = Math.cos(angle) * distance;
        z = Math.sin(angle) * distance;
        safe = !collides(room, x, z, radius) && occupied.every((other) => Math.hypot(x - other.x, z - other.z) > radius + other.radius + 2.4);
      }

      player.x = x;
      player.z = z;
      player.angle = Math.atan2(-x, z);
      player.score = 0;
      player.kills = 0;
      player.deaths = 0;
      player.objectiveScore = 0;
      player.dead = false;
      player.respawnAt = 0;
      player.power = null;
      player.powerUntil = 0;
      player.abilityUntil = 0;
      player.abilityCooldownUntil = 0;
      player.nextShotAt = 0;
      player.lastControlAt = now();
      player.lastControlSequence = -1;
      clearPlayerControl(player);
      player.maxHp = getPlayerStats(room, player).hp;
      player.hp = player.maxHp;
      occupied.push({ x, z, radius });
    });
  }
}

function respawnPlayer(room, player) {
  const factionPlayers = [...room.players.values()].filter((candidate) => candidate.faction === player.faction && !candidate.dead && candidate.id !== player.id);
  const anchor = factionPlayers[0];
  const baseAngle = anchor ? Math.atan2(anchor.z, anchor.x) : Object.keys(FACTIONS).indexOf(player.faction) / 4 * Math.PI * 2;
  const radius = getPlayerStats(room, player).radius;

  for (let attempt = 0; attempt < 70; attempt += 1) {
    const angle = baseAngle + (Math.random() - 0.5) * 0.8 + attempt * 0.17;
    const distance = Math.min(room.radius - 5, room.radius * 0.58 + (attempt % 4));
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!collides(room, x, z, radius)) {
      player.x = x;
      player.z = z;
      player.angle = Math.atan2(-x, z);
      break;
    }
  }

  player.dead = false;
  player.power = null;
  player.powerUntil = 0;
  player.abilityUntil = 0;
  player.nextShotAt = now() + 650;
  player.maxHp = getPlayerStats(room, player).hp;
  player.hp = player.maxHp;
  clearPlayerControl(player);
}

function spawnPowerup(room, forcedType = null) {
  if (room.powerups.length >= Math.min(6, 2 + Math.ceil(room.players.size / 2))) return;
  const type = forcedType || POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 4 + Math.random() * Math.max(4, room.radius - 8);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!collides(room, x, z, 1)) {
      room.powerups.push({ id: makeId(), type, x, z, expiresAt: now() + 15000 });
      return;
    }
  }
}

function addTeamScore(room, faction, amount) {
  if (!FACTIONS[faction] || !Number.isFinite(amount)) return;
  room.teamScores[faction] = Math.max(0, (room.teamScores[faction] || 0) + amount);
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

  if (room.settings.challenge === 'salvage_rush') {
    const points = powerup.type === 'morph' || powerup.type === 'godmode' ? 3 : CHALLENGES.salvage_rush.pickupPoints;
    addTeamScore(room, player.faction, points);
    player.objectiveScore += points;
  }

  io.to(room.code).emit('powerupCollected', {
    playerId: player.id,
    playerName: player.name,
    faction: player.faction,
    type: powerup.type,
    vehicle: player.vehicle
  });
}

function spawnProjectile(room, player, angleOffset = 0, options = {}) {
  const time = now();
  const world = getWorldStats(room);
  const stats = getPlayerStats(room, player, time);
  const vehicle = VEHICLES[player.vehicle] || VEHICLES.vanguard;
  const heading = player.angle + angleOffset;
  const directionX = Math.sin(heading);
  const directionZ = -Math.cos(heading);
  const speed = 23 * world.bulletSpeed * (options.speedMultiplier || 1);
  const radius = options.explosive ? 0.42 : 0.23;
  const muzzleDistance = vehicle.muzzleDistance + radius + 0.08;
  room.projectiles.push({
    id: makeId(),
    ownerId: player.id,
    ownerFaction: player.faction,
    x: player.x + directionX * muzzleDistance,
    y: vehicle.muzzleHeight,
    z: player.z + directionZ * muzzleDistance,
    vx: directionX * speed,
    vz: directionZ * speed,
    damage: stats.damage * world.damage * (options.damageMultiplier || 1),
    radius,
    explosive: Boolean(options.explosive),
    expiresAt: time + (room.settings.world === 'space' ? 4700 : 3200)
  });
}

function fireVehicleWeapon(room, player, time) {
  const stats = getPlayerStats(room, player, time);
  if (time < player.nextShotAt) return;
  const rapidAbility = player.vehicle === 'striker' && player.abilityUntil > time;
  const godmode = player.power === 'godmode' && player.powerUntil > time;

  if (rapidAbility) {
    spawnProjectile(room, player, -0.075, { explosive: godmode });
    spawnProjectile(room, player, 0.075, { explosive: godmode });
  } else {
    spawnProjectile(room, player, 0, { explosive: godmode });
  }

  player.nextShotAt = time + Math.max(70, stats.reload);
}

function useAbility(room, player) {
  const time = now();
  if (player.dead || player.abilityCooldownUntil > time || room.status !== 'playing') return;
  const faction = getFactionStats(player);
  player.abilityCooldownUntil = time + 16000 * faction.cooldown;

  if (player.vehicle === 'vanguard') {
    player.abilityUntil = time + 5500;
  } else if (player.vehicle === 'striker') {
    player.abilityUntil = time + 5500;
  } else if (player.vehicle === 'spectre') {
    player.abilityUntil = time + 4500;
  } else if (player.vehicle === 'annihilator') {
    for (const target of room.players.values()) {
      if (target.id === player.id || target.dead || target.faction === player.faction) continue;
      if (Math.hypot(target.x - player.x, target.z - player.z) <= 8.5) {
        target.hp -= getPlayerStats(room, player, time).damage * 1.7;
        if (target.hp <= 0) killPlayer(room, target, player.id);
      }
    }
    io.to(room.code).emit('shockwave', { playerId: player.id, x: player.x, z: player.z });
  } else if (player.vehicle === 'titan') {
    [-0.32, -0.16, 0, 0.16, 0.32].forEach((offset) => spawnProjectile(room, player, offset, { explosive: true, damageMultiplier: 1.35 }));
  }
}

function killPlayer(room, victim, killerId) {
  if (victim.dead) return;
  victim.dead = true;
  victim.hp = 0;
  victim.deaths += 1;
  victim.respawnAt = now() + 3000;
  clearPlayerControl(victim);

  if (killerId && killerId !== victim.id) {
    const killer = room.players.get(killerId);
    if (killer && killer.faction !== victim.faction) {
      killer.kills += 1;
      killer.score += 100;
      addTeamScore(room, killer.faction, CHALLENGES[room.settings.challenge].killPoints);
    }
  }

  io.to(room.code).emit('playerDestroyed', {
    victimId: victim.id,
    victimName: victim.name,
    victimFaction: victim.faction,
    killerId
  });
}

function updateControlZone(room, dt) {
  if (room.settings.challenge !== 'control_zone') return;
  const factionsInZone = new Set();
  for (const player of room.players.values()) {
    if (!player.connected || player.dead) continue;
    if (Math.hypot(player.x, player.z) <= CONTROL_ZONE_RADIUS) factionsInZone.add(player.faction);
  }

  const controllingFaction = factionsInZone.size === 1 ? [...factionsInZone][0] : null;
  if (controllingFaction && room.objective.controlFaction === controllingFaction) {
    room.objective.controlAccumulator += dt;
  } else {
    room.objective.controlFaction = controllingFaction;
    room.objective.controlAccumulator = 0;
  }

  while (room.objective.controlAccumulator >= 1) {
    room.objective.controlAccumulator -= 1;
    addTeamScore(room, controllingFaction, 1);
    for (const player of room.players.values()) {
      if (player.faction === controllingFaction && !player.dead && Math.hypot(player.x, player.z) <= CONTROL_ZONE_RADIUS) {
        player.objectiveScore += 1;
      }
    }
  }
}

function updateProjectiles(room, dt, time) {
  for (let index = room.projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = room.projectiles[index];
    const nextX = projectile.x + projectile.vx * dt;
    const nextZ = projectile.z + projectile.vz * dt;

    if (time >= projectile.expiresAt || projectileHitsObstacle(room, projectile, nextX, nextZ)) {
      room.projectiles.splice(index, 1);
      continue;
    }

    let hitTarget = null;
    for (const target of room.players.values()) {
      if (target.id === projectile.ownerId || target.dead || target.faction === projectile.ownerFaction) continue;
      const stats = getPlayerStats(room, target, time);
      if (segmentCircleHit(projectile.x, projectile.z, nextX, nextZ, target.x, target.z, stats.radius + projectile.radius)) {
        hitTarget = target;
        break;
      }
    }

    if (hitTarget) {
      const phase = hitTarget.vehicle === 'spectre' && hitTarget.abilityUntil > time;
      const shield = hitTarget.power === 'shield' && hitTarget.powerUntil > time;
      const godmode = hitTarget.power === 'godmode' && hitTarget.powerUntil > time;
      const fortress = hitTarget.vehicle === 'vanguard' && hitTarget.abilityUntil > time;
      if (!phase && !godmode) {
        const multiplier = fortress ? 0.16 : shield ? 0.25 : 1;
        hitTarget.hp -= projectile.damage * multiplier;
        if (hitTarget.hp <= 0) killPlayer(room, hitTarget, projectile.ownerId);
      }

      if (projectile.explosive) {
        for (const target of room.players.values()) {
          if (target.dead || target.faction === projectile.ownerFaction || target.id === hitTarget.id) continue;
          if (Math.hypot(target.x - nextX, target.z - nextZ) <= 4.5) {
            target.hp -= projectile.damage * 0.45;
            if (target.hp <= 0) killPlayer(room, target, projectile.ownerId);
          }
        }
      }

      room.projectiles.splice(index, 1);
      continue;
    }

    projectile.x = nextX;
    projectile.z = nextZ;
  }
}

function updatePowerups(room, time) {
  room.powerups = room.powerups.filter((powerup) => time < powerup.expiresAt);
  for (const player of room.players.values()) {
    if (player.dead) continue;
    for (let index = room.powerups.length - 1; index >= 0; index -= 1) {
      const powerup = room.powerups[index];
      if (Math.hypot(player.x - powerup.x, player.z - powerup.z) < getPlayerStats(room, player, time).radius + 1.1) {
        applyPowerup(room, player, powerup);
        room.powerups.splice(index, 1);
      }
    }
  }

  if (time >= room.nextPowerupAt) {
    const morphChance = Math.random() < 0.22;
    spawnPowerup(room, morphChance ? 'morph' : null);
    room.nextPowerupAt = time + 5200 + Math.random() * 3200;
  }
}

function finishMatch(room) {
  if (room.status !== 'playing') return;
  room.status = 'finished';
  room.finishedAt = now();
  for (const player of room.players.values()) clearPlayerControl(player);

  const activeFactions = [...new Set([...room.players.values()].map((player) => player.faction))];
  const highestTeamScore = Math.max(0, ...activeFactions.map((faction) => room.teamScores[faction] || 0));
  const winningFactions = activeFactions.filter((faction) => (room.teamScores[faction] || 0) === highestTeamScore);
  const leaderboard = [...room.players.values()]
    .map((player) => ({
      id: player.id,
      name: player.name,
      faction: player.faction,
      vehicle: player.vehicle,
      kills: player.kills,
      deaths: player.deaths,
      score: player.score,
      objectiveScore: player.objectiveScore
    }))
    .sort((a, b) => (b.kills - a.kills) || (b.objectiveScore - a.objectiveScore) || (b.score - a.score));

  room.result = {
    endedAt: room.finishedAt,
    challenge: room.settings.challenge,
    challengeName: CHALLENGES[room.settings.challenge].name,
    teamScores: { ...room.teamScores },
    winningFactions,
    leaderboard
  };

  io.to(room.code).emit('matchEnded', room.result);
  emitLobby(room);
}

function updateRoom(room, dt) {
  if (room.status !== 'playing') return;
  const time = now();
  if (time >= room.endsAt) {
    finishMatch(room);
    return;
  }

  const world = getWorldStats(room);
  for (const player of room.players.values()) {
    if (!player.connected) continue;
    if (time - player.lastControlAt > INPUT_TIMEOUT_MS) clearPlayerControl(player);
    if (player.dead) {
      if (time >= player.respawnAt) respawnPlayer(room, player);
      continue;
    }

    const stats = getPlayerStats(room, player, time);
    player.angle += player.control.steer * dt * 2.45 * world.traction;
    player.angle = Math.atan2(Math.sin(player.angle), Math.cos(player.angle));
    player.vx = 0;
    player.vz = 0;
    if (player.control.throttle !== 0) {
      const phase = player.vehicle === 'spectre' && player.abilityUntil > time;
      const speed = stats.speed * world.traction * (phase ? 1.65 : 1);
      player.vx = Math.sin(player.angle) * player.control.throttle * speed;
      player.vz = -Math.cos(player.angle) * player.control.throttle * speed;
      const beforeX = player.x;
      const beforeZ = player.z;
      moveWithCollision(room, player, player.vx * dt, player.vz * dt);
      player.vx = (player.x - beforeX) / Math.max(dt, 0.0001);
      player.vz = (player.z - beforeZ) / Math.max(dt, 0.0001);
    }

    if (player.control.fire) fireVehicleWeapon(room, player, time);
  }

  updateProjectiles(room, dt, time);
  updatePowerups(room, time);
  updateControlZone(room, dt);
}

function snapshot(room) {
  const time = now();
  return {
    serverTime: time,
    roomCode: room.code,
    status: room.status,
    radius: room.radius,
    settings: { ...room.settings },
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    remainingMs: Math.max(0, room.endsAt - time),
    teamScores: { ...room.teamScores },
    objective: {
      controlFaction: room.objective.controlFaction,
      controlRadius: CONTROL_ZONE_RADIUS
    },
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      vehicle: player.vehicle,
      faction: player.faction,
      connected: player.connected,
      x: player.x,
      z: player.z,
      angle: player.angle,
      vx: player.vx,
      vz: player.vz,
      hp: Math.max(0, player.hp),
      maxHp: player.maxHp,
      score: player.score,
      kills: player.kills,
      deaths: player.deaths,
      objectiveScore: player.objectiveScore,
      dead: player.dead,
      respawnAt: player.respawnAt,
      abilityCooldownUntil: player.abilityCooldownUntil,
      abilityUntil: player.abilityUntil,
      power: player.powerUntil > time ? player.power : null,
      powerUntil: player.powerUntil
    })),
    bullets: room.projectiles,
    powerups: room.powerups
  };
}

function matchPayload(room) {
  return {
    roomCode: room.code,
    radius: room.radius,
    settings: { ...room.settings },
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    seed: room.seed,
    obstacles: room.obstacles,
    vehicles: VEHICLES,
    factions: FACTIONS,
    worlds: WORLDS,
    challenges: CHALLENGES,
    controlZoneRadius: CONTROL_ZONE_RADIUS
  };
}

function startMatch(room) {
  room.status = 'playing';
  room.result = null;
  room.radius = 28 + Math.max(0, room.players.size - 1) * 4.5;
  room.seed = hashCode(`${room.code}-${now()}`);
  room.projectiles = [];
  room.powerups = [];
  room.teamScores = emptyTeamScores();
  room.objective = { controlFaction: null, controlAccumulator: 0 };
  room.nextPowerupAt = now() + 3500;
  room.obstacles = generateObstacles(room);
  room.startedAt = now() + 500;
  room.endsAt = room.startedAt + room.settings.durationSeconds * 1000;
  spawnPlayers(room);
  io.to(room.code).emit('matchStarted', matchPayload(room));
  emitLobby(room);
}

function resetRoomToLobby(room) {
  room.status = 'lobby';
  room.result = null;
  room.startedAt = 0;
  room.endsAt = 0;
  room.projectiles = [];
  room.powerups = [];
  room.obstacles = [];
  room.teamScores = emptyTeamScores();
  room.objective = { controlFaction: null, controlAccumulator: 0 };
  for (const player of room.players.values()) {
    clearPlayerControl(player);
    player.dead = false;
    player.hp = 1;
    player.maxHp = 1;
  }
  io.to(room.code).emit('returnedToLobby', publicLobby(room));
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
  if (!player || (player.socketId && player.socketId !== socket.id)) return;
  player.connected = false;
  player.socketId = null;
  player.disconnectedAt = now();
  clearPlayerControl(player);
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
  player.lastControlAt = now();
  player.lastControlSequence = -1;
  clearPlayerControl(player);
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
        settings: {
          world: 'jungle',
          challenge: 'team_deathmatch',
          durationSeconds: 300
        },
        players: new Map([[player.id, player]]),
        radius: 28,
        seed: hashCode(code),
        obstacles: [],
        projectiles: [],
        powerups: [],
        teamScores: emptyTeamScores(),
        objective: { controlFaction: null, controlAccumulator: 0 },
        nextPowerupAt: now() + 5000,
        startedAt: 0,
        endsAt: 0,
        finishedAt: 0,
        result: null
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
      if (room.status === 'lobby') {
        player.vehicle = sanitizeVehicle(payload?.vehicle || player.vehicle);
        player.faction = sanitizeFaction(payload?.faction || player.faction);
      }
    }

    attachPlayerSocket(room, player, socket);
    callback?.({
      ok: true,
      room: publicLobby(room),
      selfId: player.id,
      match: room.status === 'playing' ? matchPayload(room) : null,
      snapshot: room.status === 'playing' ? snapshot(room) : null,
      result: room.status === 'finished' ? room.result : null
    });
    emitLobby(room);
  });

  socket.on('resumeRoom', (payload, callback) => {
    const code = String(payload?.code || '').trim().toUpperCase();
    const clientId = sanitizeClientId(payload?.clientId);
    const room = rooms.get(code);
    const player = room?.players.get(clientId);
    if (!room || !player) return callback?.({ ok: false, error: 'Your previous room session is no longer available.' });

    if (socket.data.roomCode !== code || socket.data.playerId !== player.id) removePlayerFromRoom(socket);
    attachPlayerSocket(room, player, socket);
    callback?.({
      ok: true,
      room: publicLobby(room),
      selfId: player.id,
      match: room.status === 'playing' ? matchPayload(room) : null,
      snapshot: room.status === 'playing' ? snapshot(room) : null,
      result: room.status === 'finished' ? room.result : null
    });
    emitLobby(room);
  });

  socket.on('setLobbySettings', (payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.leaderId !== socket.data.playerId || room.status !== 'lobby') return callback?.({ ok: false, error: 'Only the leader can change match settings.' });
    if (WORLDS[payload?.world]) room.settings.world = payload.world;
    room.settings.challenge = sanitizeChallenge(payload?.challenge);
    room.settings.durationSeconds = sanitizeDuration(payload?.durationSeconds);
    emitLobby(room);
    callback?.({ ok: true });
  });

  socket.on('setPlayerLoadout', (payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || room.status !== 'lobby') return callback?.({ ok: false, error: 'Loadout can only be changed in the lobby.' });
    if (payload?.vehicle !== undefined) player.vehicle = sanitizeVehicle(payload.vehicle);
    if (payload?.faction !== undefined) player.faction = sanitizeFaction(payload.faction);
    emitLobby(room);
    callback?.({ ok: true });
  });

  socket.on('startMatch', (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.leaderId !== socket.data.playerId || room.status !== 'lobby') return callback?.({ ok: false, error: 'Only the leader can start.' });
    const connectedPlayers = [...room.players.values()].filter((player) => player.connected);
    if (connectedPlayers.length < 1) return callback?.({ ok: false, error: 'No connected players.' });
    const connectedFactions = new Set(connectedPlayers.map((player) => player.faction));
    if (connectedPlayers.length > 1 && connectedFactions.size < 2) {
      return callback?.({ ok: false, error: 'Choose at least two different factions before starting a team match.' });
    }
    startMatch(room);
    callback?.({ ok: true, match: matchPayload(room), snapshot: snapshot(room) });
  });

  socket.on('control', (payload) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || room.status !== 'playing' || player.socketId !== socket.id) return;
    const sequence = Number.isFinite(payload?.sequence) ? Math.floor(payload.sequence) : player.lastControlSequence + 1;
    if (sequence < player.lastControlSequence) return;
    if (sequence > player.lastControlSequence) player.lastControlSequence = sequence;
    player.control.throttle = clamp(Math.round(Number(payload?.throttle) || 0), -1, 1);
    player.control.steer = clamp(Math.round(Number(payload?.steer) || 0), -1, 1);
    player.control.fire = Boolean(payload?.fire);
    // Heartbeat packets may intentionally repeat a sequence while a key is held.
    player.lastControlAt = now();
  });

  socket.on('ability', () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (room && player && room.status === 'playing' && player.socketId === socket.id) useAbility(room, player);
  });

  socket.on('returnToLobby', (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.leaderId !== socket.data.playerId || room.status !== 'finished') return callback?.({ ok: false, error: 'Only the leader can return the room to the lobby.' });
    resetRoomToLobby(room);
    callback?.({ ok: true, room: publicLobby(room) });
  });

  socket.on('latencyPing', (callback) => callback?.({ serverTime: now() }));

  socket.on('leaveRoom', () => removePlayerFromRoom(socket));
  socket.on('disconnect', () => detachPlayerSocket(socket));
});

let snapshotAccumulator = 0;
let previousTickAt = now();
setInterval(() => {
  const tickAt = now();
  const dt = clamp((tickAt - previousTickAt) / 1000, 0, 0.05);
  previousTickAt = tickAt;
  snapshotAccumulator += dt;
  for (const room of [...rooms.values()]) {
    if (cleanupDisconnectedPlayers(room, tickAt)) updateRoom(room, dt);
  }
  if (snapshotAccumulator >= 1 / SNAPSHOT_RATE) {
    snapshotAccumulator %= 1 / SNAPSHOT_RATE;
    for (const room of rooms.values()) {
      if (room.status === 'playing') io.to(room.code).volatile.emit('snapshot', snapshot(room));
    }
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Ironfront Complete Game v4 running on http://localhost:${PORT}`);
});
