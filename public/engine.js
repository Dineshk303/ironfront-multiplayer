import * as THREE from '/vendor/three.module.js';
import { controls } from './controls.js?v=3.0.0';

const VEHICLES = {
  vanguard: { name: 'Vanguard Tank', type: 'tank', hp: 120, speed: 10, damage: 24, reload: 0.52, radius: 1.45, ability: 'Fortress Shield', color: '#4b92ff' },
  striker: { name: 'Striker Buggy', type: 'buggy', hp: 88, speed: 15, damage: 16, reload: 0.26, radius: 1.25, ability: 'Rapid Barrage', color: '#55d8b4' },
  annihilator: { name: 'Annihilator Siege Tank', type: 'siege', hp: 190, speed: 7.4, damage: 40, reload: 0.85, radius: 1.75, ability: 'Ground Shockwave', color: '#e3a53c' },
  spectre: { name: 'Spectre Hovercraft', type: 'hover', hp: 105, speed: 13.5, damage: 28, reload: 0.43, radius: 1.45, ability: 'Phase Drive', color: '#b879ff' },
  titan: { name: 'Titan Walker', type: 'walker', hp: 260, speed: 6.2, damage: 48, reload: 0.98, radius: 1.8, ability: 'Titan Salvo', color: '#e95d65' }
};

const WORLDS = {
  jungle: { name: 'Emerald Jungle', sky: '#10251d', ground: '#183c28', accent: '#4fae67', traction: 0.82, bullet: 1, gravity: 1, effect: 'Mud zones reduce traction.', boss: 'Ancient Jungle Behemoth' },
  mountain: { name: 'Frozen Mountain', sky: '#9eb5c5', ground: '#65737b', accent: '#d5e8f3', traction: 0.9, bullet: 1.06, gravity: 1, effect: 'Avalanche strikes mark dangerous zones.', boss: 'Avalanche Fortress' },
  arena: { name: 'Grand Combat Arena', sky: '#291720', ground: '#59402f', accent: '#e2a54e', traction: 1.08, bullet: 1.12, gravity: 1, effect: 'Central energy pulses punish close combat.', boss: 'Arena Champion' },
  battlefield: { name: 'Ruined Battleground', sky: '#302b28', ground: '#4b443b', accent: '#b26c4a', traction: 0.96, bullet: 1, gravity: 1, effect: 'Random artillery targets the arena.', boss: 'Titan War Machine' },
  space: { name: 'Zero-G Space Station', sky: '#040712', ground: '#1d2635', accent: '#6c8cff', traction: 0.62, bullet: 0.82, gravity: 0.25, effect: 'Low gravity and gravity wells alter movement.', boss: 'Zero-G Dreadnought' }
};

const DIFFICULTIES = {
  easy: { enemyHp: 0.78, enemyDamage: 0.72, enemySpeed: 0.82, reward: 0.9 },
  normal: { enemyHp: 1, enemyDamage: 1, enemySpeed: 1, reward: 1 },
  hard: { enemyHp: 1.35, enemyDamage: 1.25, enemySpeed: 1.2, reward: 1.3 },
  nightmare: { enemyHp: 1.8, enemyDamage: 1.55, enemySpeed: 1.45, reward: 1.75 }
};

const POWERUP_TYPES = ['heal', 'shield', 'rapid', 'speed', 'godmode', 'morph'];

const FACTION_COLORS = {
  iron: '#7795b9',
  neon: '#55d8b4',
  solar: '#e3a53c',
  void: '#b879ff'
};

let initialized = false;
let renderer;
let scene;
let camera;
let clock;
let worldRoot;
let actorsRoot;
let effectsRoot;
let hemi;
let sun;
let canvasHost;
let fatalCallback = null;

const engineState = {
  mode: 'idle',
  paused: false,
  cameraMode: '3d',
  world: 'jungle',
  radius: 30,
  colliders: [],
  mudZones: [],
  gravityWells: [],
  multiplayer: null,
  single: null,
  previousTime: performance.now()
};

function worldForLevel(level) {
  const ids = Object.keys(WORLDS);
  return ids[Math.floor((Math.max(1, level) - 1) / 5) % ids.length];
}

function localLevel(level) {
  return ((Math.max(1, level) - 1) % 5) + 1;
}

function tierForLevel(level) {
  return Math.floor((Math.max(1, level) - 1) / 25) + 1;
}

function material(color, metalness = 0.45, roughness = 0.4) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function shadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function buildVehicle(type, color) {
  const group = new THREE.Group();
  const body = material(color, 0.58, 0.3);
  const dark = material('#151b23', 0.7, 0.32);
  const trim = material('#dcecff', 0.35, 0.24);

  if (type === 'buggy') {
    const chassis = shadow(new THREE.Mesh(new THREE.BoxGeometry(2, 0.48, 2.8), body));
    chassis.position.y = 0.65;
    group.add(chassis);
    [[-1.05, -0.8], [1.05, -0.8], [-1.05, 0.9], [1.05, 0.9]].forEach(([x, z]) => {
      const wheel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.35, 12), dark));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.45, z);
      group.add(wheel);
    });
    const cockpit = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.52, 1.1), trim));
    cockpit.position.set(0, 1.08, 0.25);
    group.add(cockpit);
    [-0.42, 0.42].forEach((x) => {
      const gun = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.8), trim));
      gun.position.set(x, 1.15, -1.35);
      group.add(gun);
    });
  } else if (type === 'hover') {
    const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.7, 0.5, 10), body));
    base.position.y = 0.85;
    group.add(base);
    const core = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.85, 0.55, 12), trim));
    core.position.y = 1.32;
    group.add(core);
    const gun = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 2.15), trim));
    gun.position.set(0, 1.38, -1.25);
    group.add(gun);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.11, 8, 28), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.55;
    group.add(ring);
  } else if (type === 'walker') {
    [-0.95, 0.95].forEach((x) => {
      const leg = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.5, 0.62), dark));
      leg.position.set(x, 0.9, 0.25);
      group.add(leg);
      const foot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 1.45), dark));
      foot.position.set(x, 0.2, -0.15);
      group.add(foot);
    });
    const torso = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.25, 1.05, 2.2), body));
    torso.position.y = 2;
    group.add(torso);
    const turret = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.92, 0.55, 10), body));
    turret.position.y = 2.75;
    group.add(turret);
    [-0.45, 0, 0.45].forEach((x) => {
      const gun = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.2), trim));
      gun.position.set(x, 2.78, -1.4);
      group.add(gun);
    });
  } else {
    const scale = type === 'siege' ? 1.2 : 1;
    [-0.95, 0.95].forEach((x) => {
      const track = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 2.9 * scale), dark));
      track.position.set(x * scale, 0.45, 0);
      group.add(track);
    });
    const chassis = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.8 * scale, 0.76, 2.45 * scale), body));
    chassis.position.y = 0.78;
    group.add(chassis);
    const turret = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.75 * scale, 0.88 * scale, 0.58, 12), body));
    turret.position.y = 1.36;
    group.add(turret);
    const gun = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.24 * scale, 0.24 * scale, type === 'siege' ? 2.8 : 2.1), trim));
    gun.position.set(0, 1.4, type === 'siege' ? -1.85 : -1.45);
    group.add(gun);
  }

  group.userData.radius = type === 'walker' ? 1.8 : type === 'siege' ? 1.75 : type === 'buggy' ? 1.25 : 1.45;
  group.userData.type = type;
  return group;
}

function makeLabel(text) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 64;
  const context = labelCanvas.getContext('2d');
  context.fillStyle = 'rgba(5,12,22,.78)';
  if (typeof context.roundRect === 'function') context.roundRect(3, 8, 250, 48, 14);
  else context.rect(3, 8, 250, 48);
  context.fill();
  context.fillStyle = '#eef6ff';
  context.font = '700 25px system-ui';
  context.textAlign = 'center';
  context.fillText(text, 128, 41);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(4.6, 1.15, 1);
  return sprite;
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

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function generateObstacles(seed, radius, count) {
  const random = seededRandom(seed);
  const obstacles = [];
  for (let index = 0; index < count; index += 1) {
    let candidate = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 7 + random() * (radius - 11);
      const r = 1.3 + random() * 1.7;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (obstacles.every((other) => Math.hypot(x - other.x, z - other.z) > r + other.r + 2.1)) {
        candidate = { id: `ob-${index}`, x, z, r, variant: index % 4 };
        break;
      }
    }
    if (candidate) obstacles.push(candidate);
  }
  return obstacles;
}

function buildObstacle(worldId, obstacle, accent) {
  const group = new THREE.Group();
  if (worldId === 'jungle') {
    const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(obstacle.r * 0.28, obstacle.r * 0.36, obstacle.r * 2.2, 8), material('#5b3a24', 0, 0.95)));
    trunk.position.y = obstacle.r * 1.1;
    group.add(trunk);
    const crown = shadow(new THREE.Mesh(new THREE.SphereGeometry(obstacle.r, 8, 7), material('#2f7545', 0, 0.95)));
    crown.position.y = obstacle.r * 2.25;
    group.add(crown);
  } else if (worldId === 'mountain') {
    const rock = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(obstacle.r, 0), material(obstacle.variant % 2 ? '#d3dfe5' : '#77848c', 0.05, 0.95)));
    rock.scale.set(1, 1.3, 0.82);
    rock.position.y = obstacle.r;
    group.add(rock);
  } else if (worldId === 'arena') {
    const pillar = shadow(new THREE.Mesh(new THREE.CylinderGeometry(obstacle.r * 0.65, obstacle.r * 0.82, obstacle.r * 3, 12), material('#aa7347', 0.28, 0.48)));
    pillar.position.y = obstacle.r * 1.5;
    group.add(pillar);
  } else if (worldId === 'battlefield') {
    const crate = shadow(new THREE.Mesh(new THREE.BoxGeometry(obstacle.r * 1.5, obstacle.r * 1.15, obstacle.r * 1.5), material('#66503d', 0.15, 0.8)));
    crate.position.y = obstacle.r * 0.58;
    crate.rotation.y = obstacle.variant * 0.35;
    group.add(crate);
  } else {
    const reactor = shadow(new THREE.Mesh(new THREE.CylinderGeometry(obstacle.r * 0.68, obstacle.r * 0.68, obstacle.r * 2.6, 16), new THREE.MeshStandardMaterial({ color: '#344864', emissive: accent, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.2 })));
    reactor.position.y = obstacle.r * 1.3;
    group.add(reactor);
  }
  return group;
}

function setupWorld({ worldId, radius, seed, obstacles }) {
  clearGroup(worldRoot);
  clearGroup(actorsRoot);
  clearGroup(effectsRoot);
  engineState.colliders = obstacles.map((obstacle) => ({ ...obstacle }));
  engineState.mudZones = [];
  engineState.gravityWells = [];
  engineState.world = worldId;
  engineState.radius = radius;

  const world = WORLDS[worldId];
  scene.background = new THREE.Color(world.sky);
  scene.fog = new THREE.FogExp2(world.sky, worldId === 'space' ? 0.006 : worldId === 'jungle' ? 0.024 : 0.016);
  hemi.groundColor.set(world.ground);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), material(world.ground, worldId === 'space' ? 0.7 : 0.08, worldId === 'space' ? 0.35 : 0.92));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  worldRoot.add(ground);

  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.65, radius, 96), new THREE.MeshStandardMaterial({ color: world.accent, emissive: world.accent, emissiveIntensity: worldId === 'space' ? 1.5 : 0.35, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  worldRoot.add(ring);

  const grid = new THREE.GridHelper(radius * 2, Math.round(radius), world.accent, world.accent);
  grid.material.transparent = true;
  grid.material.opacity = worldId === 'space' ? 0.24 : 0.08;
  grid.position.y = 0.02;
  worldRoot.add(grid);

  obstacles.forEach((obstacle) => {
    const mesh = buildObstacle(worldId, obstacle, world.accent);
    mesh.position.set(obstacle.x, 0, obstacle.z);
    worldRoot.add(mesh);
  });

  const random = seededRandom(seed + 991);
  if (worldId === 'space') {
    const positions = [];
    for (let index = 0; index < 360; index += 1) positions.push((random() - 0.5) * radius * 4, 20 + random() * 70, (random() - 0.5) * radius * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    worldRoot.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffffff', size: 0.35 })));
    [[-radius * 0.32, 0], [radius * 0.34, radius * 0.2]].forEach(([x, z]) => addGravityWell(x, z));
  } else {
    for (let index = 0; index < 18; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = radius + 4 + random() * 16;
      const height = 4 + random() * 8;
      const decoration = shadow(new THREE.Mesh(new THREE.ConeGeometry(2 + random() * 3, height, 7), material(world.accent, 0, 0.9)));
      decoration.position.set(Math.cos(angle) * distance, height / 2 - 0.2, Math.sin(angle) * distance);
      worldRoot.add(decoration);
    }
  }

  if (worldId === 'jungle') {
    addMudZone(-8, 5, 4.2);
    addMudZone(10, -4, 3.6);
    addMudZone(1, -14, 3.2);
  }

  if (worldId === 'arena') {
    const arenaRing = new THREE.Mesh(new THREE.RingGeometry(6.5, 7.5, 48), new THREE.MeshStandardMaterial({ color: world.accent, emissive: world.accent, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
    arenaRing.rotation.x = -Math.PI / 2;
    arenaRing.position.y = 0.035;
    worldRoot.add(arenaRing);
  }
}

function addMudZone(x, z, radius) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshStandardMaterial({ color: '#342b20', roughness: 1, transparent: true, opacity: 0.92 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.028, z);
  worldRoot.add(mesh);
  engineState.mudZones.push({ x, z, radius });
}

function addGravityWell(x, z) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.13, 8, 34), new THREE.MeshStandardMaterial({ color: '#b879ff', emissive: '#b879ff', emissiveIntensity: 2 }));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, 0.14, z);
  worldRoot.add(mesh);
  engineState.gravityWells.push({ x, z, radius: 6, mesh });
}

function collides(x, z, radius) {
  if (Math.hypot(x, z) > engineState.radius - radius - 1) return true;
  return engineState.colliders.some((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) < radius + obstacle.r);
}

function moveWithCollision(mesh, dx, dz, radius) {
  if (!collides(mesh.position.x + dx, mesh.position.z, radius)) mesh.position.x += dx;
  if (!collides(mesh.position.x, mesh.position.z + dz, radius)) mesh.position.z += dz;
}

function terrainMultiplier(x, z) {
  for (const mud of engineState.mudZones) {
    if (Math.hypot(x - mud.x, z - mud.z) < mud.radius) return 0.5;
  }
  return 1;
}

function createExplosion(position, color = '#ff9f55', scale = 1) {
  const group = new THREE.Group();
  for (let index = 0; index < 12; index += 1) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.14, 7, 7), new THREE.MeshBasicMaterial({ color }));
    particle.position.copy(position);
    particle.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8).multiplyScalar(scale);
    group.add(particle);
  }
  effectsRoot.add(group);
  const started = performance.now();
  function animate() {
    const progress = (performance.now() - started) / 700;
    if (progress >= 1) return effectsRoot.remove(group);
    group.children.forEach((particle) => {
      particle.position.addScaledVector(particle.userData.velocity, 0.016);
      particle.userData.velocity.y -= 0.13;
      particle.scale.multiplyScalar(0.97);
    });
    requestAnimationFrame(animate);
  }
  animate();
}

function createShockwave(x, z, color = '#f3c94c') {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.1, z);
  effectsRoot.add(ring);
  const started = performance.now();
  function animate() {
    const progress = (performance.now() - started) / 650;
    if (progress >= 1) return effectsRoot.remove(ring);
    ring.scale.setScalar(1 + progress * 10);
    ring.material.opacity = 1 - progress;
    requestAnimationFrame(animate);
  }
  animate();
}

function difficultyFor(value) {
  return DIFFICULTIES[value] || DIFFICULTIES.normal;
}

function playerStats(single, vehicleKey = single.currentVehicle) {
  const vehicle = VEHICLES[vehicleKey];
  return {
    maxHp: vehicle.hp + single.upgrades.armor * 25,
    speed: vehicle.speed * Math.pow(1.12, single.upgrades.engine),
    damage: vehicle.damage * Math.pow(1.2, single.upgrades.cannon),
    reload: Math.max(0.07, vehicle.reload * Math.pow(0.85, single.upgrades.reload)),
    radius: vehicle.radius
  };
}

function replaceSinglePlayerVehicle(vehicleKey, fullHeal = false) {
  const single = engineState.single;
  if (!single) return;
  const oldMesh = single.player.mesh;
  const position = oldMesh ? oldMesh.position.clone() : new THREE.Vector3(0, 0, engineState.radius * 0.65);
  const rotation = oldMesh ? oldMesh.rotation.y : 0;
  if (oldMesh) actorsRoot.remove(oldMesh);
  const vehicle = VEHICLES[vehicleKey];
  const mesh = buildVehicle(vehicle.type, vehicle.color);
  mesh.position.copy(position);
  mesh.rotation.y = rotation;
  actorsRoot.add(mesh);
  single.currentVehicle = vehicleKey;
  single.player.mesh = mesh;
  const stats = playerStats(single, vehicleKey);
  single.player.maxHp = stats.maxHp;
  single.player.hp = fullHeal ? stats.maxHp : Math.min(single.player.hp, stats.maxHp);
}

function spawnSingleEnemy(index, total, boss = false) {
  const single = engineState.single;
  const difficulty = difficultyFor(single.difficulty);
  const world = WORLDS[engineState.world];
  const choices = ['vanguard', 'striker', 'annihilator', 'spectre'];
  const vehicleKey = boss ? (engineState.world === 'space' ? 'titan' : engineState.world === 'mountain' ? 'annihilator' : 'titan') : choices[index % choices.length];
  const coinEnemy = !boss && Math.random() < 0.25;
  const vehicle = VEHICLES[vehicleKey];
  const mesh = buildVehicle(vehicle.type, boss ? world.accent : coinEnemy ? '#e95d65' : '#6f7d90');
  const angle = total > 0 ? index / total * Math.PI * 2 : 0;
  const distance = engineState.radius * 0.68 + (index % 3) * 1.4;
  mesh.position.set(Math.sin(angle) * distance, engineState.world === 'space' ? 0.55 : 0, Math.cos(angle) * distance);
  mesh.rotation.y = angle + Math.PI;
  if (boss) {
    mesh.scale.multiplyScalar(1.45);
    mesh.userData.radius *= 1.45;
  }
  actorsRoot.add(mesh);

  const baseHp = boss ? 450 + single.level * 75 : 36 + single.level * 7;
  const maxHp = Math.round(baseHp * difficulty.enemyHp * tierForLevel(single.level));
  const enemy = {
    id: `enemy-${single.enemySequence += 1}`,
    mesh,
    vehicle: vehicleKey,
    hp: maxHp,
    maxHp,
    speed: (boss ? 3.2 : 4.2 + Math.random() * 1.5) * difficulty.enemySpeed * world.traction,
    damage: (boss ? 30 : 13 + single.level * 0.35) * difficulty.enemyDamage,
    reload: boss ? 0.9 : 1.15 + Math.random() * 0.8,
    reloadRemaining: 0.7 + Math.random(),
    radius: mesh.userData.radius,
    coinEnemy,
    boss,
    strafe: Math.random() > 0.5 ? 1 : -1,
    strafeTimer: 1 + Math.random() * 1.5
  };
  single.enemies.push(enemy);
  if (boss) single.boss = enemy;
}

function startSingleInternal(config) {
  const worldId = worldForLevel(config.level);
  const seed = hashText(`single-${config.level}-${Date.now()}`);
  const radius = 30;
  const obstacles = generateObstacles(seed, radius, 10 + Math.min(10, config.level));
  setupWorld({ worldId, radius, seed, obstacles });
  engineState.mode = 'single';
  engineState.paused = false;
  engineState.cameraMode = '3d';
  controls.reset();

  engineState.single = {
    level: config.level,
    difficulty: config.difficulty,
    upgrades: config.upgrades,
    baseVehicle: config.vehicle,
    currentVehicle: config.vehicle,
    morphUntil: 0,
    player: { mesh: null, hp: 1, maxHp: 1, nextShotAt: 0, invulnerableUntil: performance.now() + 1400 },
    enemies: [],
    bullets: [],
    pickups: [],
    hazardEvents: [],
    boss: null,
    score: 0,
    kills: 0,
    callbacks: config,
    power: null,
    powerUntil: 0,
    abilityUntil: 0,
    abilityCooldownUntil: 0,
    nextPowerupAt: performance.now() + 5000,
    nextHazardAt: performance.now() + 4500,
    completeAt: 0,
    completed: false,
    gameOver: false,
    enemySequence: 0,
    hudAccumulator: 0
  };

  const playerMesh = buildVehicle(VEHICLES[config.vehicle].type, VEHICLES[config.vehicle].color);
  playerMesh.position.set(0, worldId === 'space' ? 0.55 : 0, radius * 0.64);
  actorsRoot.add(playerMesh);
  engineState.single.player.mesh = playerMesh;
  const stats = playerStats(engineState.single);
  engineState.single.player.maxHp = stats.maxHp;
  engineState.single.player.hp = stats.maxHp;

  if (localLevel(config.level) === 5) {
    spawnSingleEnemy(0, 1, true);
    config.onEvent?.(`Boss detected: ${WORLDS[worldId].boss}.`);
  } else {
    const count = Math.min(4 + config.level, 15);
    for (let index = 0; index < count; index += 1) spawnSingleEnemy(index, count, false);
    config.onEvent?.(`${count} enemy vehicles deployed.`);
  }
}

function segmentCircleHit2D(x1, z1, x2, z2, cx, cz, radius) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0.000001) return Math.hypot(x1 - cx, z1 - cz) <= radius;
  const projection = THREE.MathUtils.clamp(((cx - x1) * dx + (cz - z1) * dz) / lengthSquared, 0, 1);
  const closestX = x1 + dx * projection;
  const closestZ = z1 + dz * projection;
  return Math.hypot(closestX - cx, closestZ - cz) <= radius;
}

function projectileHitsWorld(projectile, nextX, nextZ) {
  if (Math.hypot(nextX, nextZ) > engineState.radius + 1) return true;
  return engineState.colliders.some((obstacle) => segmentCircleHit2D(
    projectile.mesh.position.x,
    projectile.mesh.position.z,
    nextX,
    nextZ,
    obstacle.x,
    obstacle.z,
    obstacle.r + projectile.radius
  ));
}

function createSingleProjectile({ owner, hostile, angleOffset = 0, explosive = false, damageMultiplier = 1, speedMultiplier = 1 }) {
  const single = engineState.single;
  if (!single) return;
  const sourceMesh = hostile ? owner.mesh : single.player.mesh;
  const angle = sourceMesh.rotation.y + angleOffset;
  const directionX = Math.sin(angle);
  const directionZ = -Math.cos(angle);
  const color = hostile ? '#ff6972' : explosive ? '#f3c94c' : VEHICLES[single.currentVehicle].color;
  const radius = explosive ? 0.32 : 0.2;
  const sourceRadius = hostile ? owner.radius : playerStats(single).radius;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 9, 9),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.3 })
  );
  mesh.position.copy(sourceMesh.position);
  mesh.position.y += sourceMesh.userData.type === 'walker' ? 2.7 : 1.3;
  mesh.position.x += directionX * (sourceRadius + 1.05);
  mesh.position.z += directionZ * (sourceRadius + 1.05);
  actorsRoot.add(mesh);

  const speed = (hostile ? 16 : 23) * WORLDS[engineState.world].bullet * speedMultiplier;
  const damage = hostile
    ? owner.damage * damageMultiplier
    : playerStats(single).damage * damageMultiplier * (single.power === 'godmode' && single.powerUntil > performance.now() ? 1.8 : 1);

  single.bullets.push({
    id: `projectile-${single.enemySequence += 1}-${performance.now()}`,
    mesh,
    hostile,
    ownerId: hostile ? owner.id : 'player',
    vx: directionX * speed,
    vz: directionZ * speed,
    damage,
    radius,
    explosive,
    expiresAt: performance.now() + (engineState.world === 'space' ? 4500 : 3200)
  });
}

function tryFireSinglePlayer(force = false) {
  const single = engineState.single;
  if (!single || single.gameOver || single.completed) return false;
  const time = performance.now();
  if (!force && time < single.player.nextShotAt) return false;

  const rapid = (single.power === 'rapid' && single.powerUntil > time) || (single.currentVehicle === 'striker' && single.abilityUntil > time);
  const godmode = single.power === 'godmode' && single.powerUntil > time;
  const titanSalvo = single.currentVehicle === 'titan' && single.abilityUntil > time;

  if (titanSalvo) {
    [-0.32, -0.16, 0, 0.16, 0.32].forEach((offset) => createSingleProjectile({
      owner: single.player,
      hostile: false,
      angleOffset: offset,
      explosive: true,
      damageMultiplier: 1.35
    }));
    single.abilityUntil = 0;
  } else if (rapid) {
    createSingleProjectile({ owner: single.player, hostile: false, angleOffset: -0.075, explosive: godmode });
    createSingleProjectile({ owner: single.player, hostile: false, angleOffset: 0.075, explosive: godmode });
  } else {
    createSingleProjectile({ owner: single.player, hostile: false, explosive: godmode });
  }

  const reloadSeconds = playerStats(single).reload * (rapid || godmode ? 0.42 : 1);
  single.player.nextShotAt = time + Math.max(70, reloadSeconds * 1000);
  return true;
}

function spawnSinglePickup(type = null, position = null, value = 0) {
  const single = engineState.single;
  if (!single) return;
  const pickupType = type || POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  let x;
  let z;
  if (position) {
    x = position.x;
    z = position.z;
  } else {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 4 + Math.random() * (engineState.radius - 8);
      x = Math.cos(angle) * distance;
      z = Math.sin(angle) * distance;
      if (!collides(x, z, 1)) break;
    }
  }
  const color = pickupType === 'coin' ? '#f3c94c' : pickupType === 'morph' ? '#ffb748' : pickupType === 'godmode' ? '#b879ff' : '#55d8b4';
  const geometry = pickupType === 'coin' ? new THREE.CylinderGeometry(0.55, 0.55, 0.18, 18) : new THREE.IcosahedronGeometry(pickupType === 'morph' ? 1 : 0.72, 1);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.1, metalness: 0.35, roughness: 0.18 }));
  if (pickupType === 'coin') mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, engineState.world === 'space' ? 1.7 : 1.1, z);
  actorsRoot.add(mesh);
  single.pickups.push({ id: `pickup-${Math.random()}`, type: pickupType, mesh, value, expiresAt: performance.now() + (pickupType === 'coin' ? 20000 : 8000) });
}

function collectSinglePickup(pickup) {
  const single = engineState.single;
  const now = performance.now();
  if (pickup.type === 'coin') {
    single.callbacks.onCoins?.(pickup.value, 'battlefield pickup');
  } else if (pickup.type === 'heal') {
    single.player.hp = Math.min(single.player.maxHp, single.player.hp + Math.round(single.player.maxHp * 0.55));
  } else if (pickup.type === 'morph') {
    const choices = Object.keys(VEHICLES).filter((vehicle) => vehicle !== single.currentVehicle);
    const nextVehicle = choices[Math.floor(Math.random() * choices.length)] || 'vanguard';
    replaceSinglePlayerVehicle(nextVehicle, true);
    single.morphUntil = now + 12000;
    single.power = 'godmode';
    single.powerUntil = now + 5000;
    single.callbacks.onPowerup?.({ type: 'morph', vehicle: nextVehicle });
  } else {
    single.power = pickup.type;
    single.powerUntil = now + (pickup.type === 'godmode' ? 7000 : 10000);
    single.callbacks.onPowerup?.({ type: pickup.type, vehicle: single.currentVehicle });
  }
  createExplosion(pickup.mesh.position, pickup.type === 'morph' ? '#ffb748' : '#55d8b4', 0.55);
  actorsRoot.remove(pickup.mesh);
}

function damageSinglePlayer(amount) {
  const single = engineState.single;
  const now = performance.now();
  const fortress = single.currentVehicle === 'vanguard' && single.abilityUntil > now;
  const phase = single.currentVehicle === 'spectre' && single.abilityUntil > now;
  const shielded = single.power === 'shield' && single.powerUntil > now;
  const godmode = single.power === 'godmode' && single.powerUntil > now;
  if (single.player.invulnerableUntil > now || phase || godmode) return;
  single.player.hp -= amount * (fortress ? 0.16 : shielded ? 0.25 : 1);
  single.player.invulnerableUntil = now + 220;
  if (single.player.hp <= 0 && !single.gameOver) {
    single.player.hp = 0;
    single.gameOver = true;
    createExplosion(single.player.mesh.position, VEHICLES[single.currentVehicle].color, 2.2);
    single.callbacks.onGameOver?.({ score: single.score, kills: single.kills });
  }
}

function destroySingleEnemy(enemy, bullet) {
  const single = engineState.single;
  const index = single.enemies.indexOf(enemy);
  if (index < 0) return;
  single.enemies.splice(index, 1);
  actorsRoot.remove(enemy.mesh);
  single.kills += 1;
  single.score += enemy.boss ? 1500 : enemy.coinEnemy ? 220 : 100;
  createExplosion(enemy.mesh.position, enemy.boss ? WORLDS[engineState.world].accent : '#e95d65', enemy.boss ? 2.6 : 1);
  if (enemy.boss) {
    const reward = 280 + single.level * 28;
    for (let coinIndex = 0; coinIndex < 8; coinIndex += 1) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5);
      spawnSinglePickup('coin', enemy.mesh.position.clone().add(offset), Math.round(reward / 8));
    }
    single.boss = null;
    single.callbacks.onEvent?.('World boss destroyed. Collect the coin caches.');
  } else if (enemy.coinEnemy) {
    spawnSinglePickup('coin', enemy.mesh.position, 30 + single.level * 3);
    single.callbacks.onEvent?.('Special red enemy destroyed — coin cache dropped.');
  }
}

function updateSinglePlayer(deltaTime) {
  const single = engineState.single;
  const world = WORLDS[engineState.world];
  const time = performance.now();
  const vehicle = VEHICLES[single.currentVehicle];
  const stats = playerStats(single);
  const control = controls.snapshot();

  single.player.mesh.rotation.y += control.turn * deltaTime * 2.45 * world.traction;
  if (control.move !== 0) {
    const direction = new THREE.Vector3(Math.sin(single.player.mesh.rotation.y), 0, -Math.cos(single.player.mesh.rotation.y));
    const phase = single.currentVehicle === 'spectre' && single.abilityUntil > time;
    const speedPower = (single.power === 'speed' || single.power === 'godmode') && single.powerUntil > time;
    const speed = stats.speed * world.traction * terrainMultiplier(single.player.mesh.position.x, single.player.mesh.position.z) * (phase ? 1.65 : 1) * (speedPower ? 1.55 : 1);
    moveWithCollision(single.player.mesh, direction.x * control.move * speed * deltaTime, direction.z * control.move * speed * deltaTime, stats.radius);
  }
  if (control.fire) tryFireSinglePlayer();

  if (engineState.world === 'space' || vehicle.type === 'hover') {
    single.player.mesh.position.y = 0.55 + Math.sin(performance.now() * 0.003) * 0.12;
  } else {
    single.player.mesh.position.y = 0;
  }

  if (single.morphUntil > 0 && time >= single.morphUntil) {
    single.morphUntil = 0;
    replaceSinglePlayerVehicle(single.baseVehicle, false);
    single.callbacks.onEvent?.(`Vehicle Morph ended. Returned to ${VEHICLES[single.baseVehicle].name}.`);
  }
  if (single.powerUntil > 0 && time >= single.powerUntil) {
    single.powerUntil = 0;
    single.power = null;
  }
}

function updateSingleEnemies(deltaTime) {
  const single = engineState.single;
  const playerPosition = single.player.mesh.position;
  single.enemies.forEach((enemy) => {
    const direction = playerPosition.clone().sub(enemy.mesh.position);
    const distance = direction.length();
    direction.y = 0;
    direction.normalize();
    const targetAngle = Math.atan2(direction.x, -direction.z);
    const difference = Math.atan2(Math.sin(targetAngle - enemy.mesh.rotation.y), Math.cos(targetAngle - enemy.mesh.rotation.y));
    enemy.mesh.rotation.y += THREE.MathUtils.clamp(difference, -deltaTime * 2.1, deltaTime * 2.1);
    enemy.strafeTimer -= deltaTime;
    if (enemy.strafeTimer <= 0) {
      enemy.strafeTimer = 0.7 + Math.random() * 1.5;
      if (Math.random() < 0.45) enemy.strafe *= -1;
    }
    const forward = new THREE.Vector3(Math.sin(enemy.mesh.rotation.y), 0, -Math.cos(enemy.mesh.rotation.y));
    const side = new THREE.Vector3(forward.z, 0, -forward.x);
    const advance = distance > (enemy.boss ? 13 : 10) ? 1 : distance < 5 ? -0.55 : 0;
    const movement = forward.multiplyScalar(advance).add(side.multiplyScalar(enemy.strafe * 0.34));
    moveWithCollision(enemy.mesh, movement.x * enemy.speed * deltaTime, movement.z * enemy.speed * deltaTime, enemy.radius);
    if (engineState.world === 'space' || VEHICLES[enemy.vehicle].type === 'hover') enemy.mesh.position.y = 0.55 + Math.sin(performance.now() * 0.002 + enemy.mesh.position.x) * 0.14;
    enemy.reloadRemaining -= deltaTime;
    if (enemy.reloadRemaining <= 0 && distance < 34) {
      createSingleProjectile({ owner: enemy, hostile: true, explosive: enemy.boss });
      if (enemy.boss && Math.random() < 0.55) {
        createSingleProjectile({ owner: enemy, hostile: true, angleOffset: -0.16, explosive: true });
        createSingleProjectile({ owner: enemy, hostile: true, angleOffset: 0.16, explosive: true });
      }
      enemy.reloadRemaining = enemy.reload;
    }
  });
}

function updateSingleBullets(deltaTime) {
  const single = engineState.single;
  const time = performance.now();
  for (let index = single.bullets.length - 1; index >= 0; index -= 1) {
    const projectile = single.bullets[index];
    const startX = projectile.mesh.position.x;
    const startZ = projectile.mesh.position.z;
    const nextX = startX + projectile.vx * deltaTime;
    const nextZ = startZ + projectile.vz * deltaTime;

    if (time >= projectile.expiresAt || projectileHitsWorld(projectile, nextX, nextZ)) {
      actorsRoot.remove(projectile.mesh);
      single.bullets.splice(index, 1);
      continue;
    }

    if (projectile.hostile) {
      const radius = playerStats(single).radius + projectile.radius;
      const playerPosition = single.player.mesh.position;
      if (segmentCircleHit2D(startX, startZ, nextX, nextZ, playerPosition.x, playerPosition.z, radius)) {
        damageSinglePlayer(projectile.damage);
        createExplosion(new THREE.Vector3(nextX, projectile.mesh.position.y, nextZ), '#ff6972', projectile.explosive ? 0.55 : 0.22);
        actorsRoot.remove(projectile.mesh);
        single.bullets.splice(index, 1);
        continue;
      }
    } else {
      let hitEnemy = null;
      for (let enemyIndex = single.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
        const enemy = single.enemies[enemyIndex];
        if (segmentCircleHit2D(startX, startZ, nextX, nextZ, enemy.mesh.position.x, enemy.mesh.position.z, enemy.radius + projectile.radius)) {
          hitEnemy = enemy;
          break;
        }
      }

      if (hitEnemy) {
        hitEnemy.hp -= projectile.damage;
        const impactPosition = new THREE.Vector3(nextX, projectile.mesh.position.y, nextZ);
        createExplosion(impactPosition, projectile.explosive ? '#f3c94c' : VEHICLES[single.currentVehicle].color, projectile.explosive ? 0.6 : 0.25);
        if (hitEnemy.hp <= 0) destroySingleEnemy(hitEnemy, projectile);
        if (projectile.explosive) {
          single.enemies.forEach((other) => {
            if (other !== hitEnemy && other.mesh.position.distanceTo(impactPosition) < 5) other.hp -= playerStats(single).damage * 0.9;
          });
        }
        actorsRoot.remove(projectile.mesh);
        single.bullets.splice(index, 1);
        continue;
      }
    }

    projectile.mesh.position.x = nextX;
    projectile.mesh.position.z = nextZ;
  }
}

function updateSinglePickups(deltaTime) {
  const single = engineState.single;
  const now = performance.now();
  for (let index = single.pickups.length - 1; index >= 0; index -= 1) {
    const pickup = single.pickups[index];
    pickup.mesh.rotation.x += deltaTime * 1.1;
    pickup.mesh.rotation.y += deltaTime * 1.8;
    pickup.mesh.position.y = (engineState.world === 'space' ? 1.7 : 1.1) + Math.sin(now * 0.005 + index) * 0.24;
    if (pickup.mesh.position.distanceTo(single.player.mesh.position) < playerStats(single).radius + 1.1) {
      collectSinglePickup(pickup);
      single.pickups.splice(index, 1);
      continue;
    }
    if (now >= pickup.expiresAt) {
      actorsRoot.remove(pickup.mesh);
      single.pickups.splice(index, 1);
    }
  }
  if (now >= single.nextPowerupAt && single.enemies.length > 0) {
    const forcedMorph = Math.random() < 0.24;
    spawnSinglePickup(forcedMorph ? 'morph' : null);
    single.nextPowerupAt = now + 6000 + Math.random() * 3500;
  }
}

function spawnHazardWarning(x, z, radius, damage, color) {
  const single = engineState.single;
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.75, radius, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.08, z);
  effectsRoot.add(ring);
  single.hazardEvents.push({ ring, x, z, radius, damage, expiresAt: performance.now() + 1500, duration: 1500 });
}

function updateSingleHazards(deltaTime) {
  const single = engineState.single;
  const now = performance.now();
  const worldId = engineState.world;
  if (now >= single.nextHazardAt) {
    single.nextHazardAt = now + (worldId === 'battlefield' ? 4200 : 6500);
    if (worldId === 'mountain' || worldId === 'battlefield') {
      const x = single.player.mesh.position.x + (Math.random() - 0.5) * 16;
      const z = single.player.mesh.position.z + (Math.random() - 0.5) * 16;
      spawnHazardWarning(x, z, worldId === 'battlefield' ? 4 : 3.2, worldId === 'battlefield' ? 32 : 22, worldId === 'battlefield' ? '#ff665d' : '#e8f6ff');
    } else if (worldId === 'arena') {
      spawnHazardWarning(0, 0, 7, 26, '#e2a54e');
    }
  }

  for (let index = single.hazardEvents.length - 1; index >= 0; index -= 1) {
    const hazard = single.hazardEvents[index];
    const remaining = hazard.expiresAt - now;
    hazard.ring.material.opacity = Math.max(0.08, remaining / hazard.duration);
    hazard.ring.rotation.z += deltaTime * 1.6;
    if (remaining <= 0) {
      if (Math.hypot(single.player.mesh.position.x - hazard.x, single.player.mesh.position.z - hazard.z) < hazard.radius) damageSinglePlayer(hazard.damage);
      single.enemies.forEach((enemy) => {
        if (Math.hypot(enemy.mesh.position.x - hazard.x, enemy.mesh.position.z - hazard.z) < hazard.radius) enemy.hp -= hazard.damage * 0.45;
      });
      createExplosion(new THREE.Vector3(hazard.x, 0.2, hazard.z), hazard.ring.material.color, hazard.radius * 0.35);
      effectsRoot.remove(hazard.ring);
      single.hazardEvents.splice(index, 1);
    }
  }

  if (worldId === 'space') {
    engineState.gravityWells.forEach((well) => {
      well.mesh.rotation.z += deltaTime * 0.8;
      const targets = [single.player.mesh, ...single.enemies.map((enemy) => enemy.mesh)];
      targets.forEach((mesh) => {
        const dx = well.x - mesh.position.x;
        const dz = well.z - mesh.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < well.radius && distance > 0.8) {
          const pull = (1 - distance / well.radius) * 7 * deltaTime;
          moveWithCollision(mesh, dx / distance * pull, dz / distance * pull, mesh.userData.radius || 1.4);
        }
      });
    });
  }
}

function resolveSingleEnemyDeaths() {
  const single = engineState.single;
  if (!single) return;
  for (let index = single.enemies.length - 1; index >= 0; index -= 1) {
    const enemy = single.enemies[index];
    if (enemy.hp <= 0) destroySingleEnemy(enemy, null);
  }
}

function updateSingle(deltaTime) {
  const single = engineState.single;
  if (!single || single.completed || single.gameOver) return;
  updateSinglePlayer(deltaTime);
  updateSingleEnemies(deltaTime);
  updateSingleBullets(deltaTime);
  updateSinglePickups(deltaTime);
  updateSingleHazards(deltaTime);
  resolveSingleEnemyDeaths();

  const now = performance.now();
  if (single.enemies.length === 0 && !single.completeAt) single.completeAt = now + 1200;
  if (single.completeAt && now >= single.completeAt && !single.completed) {
    single.completed = true;
    const bossLevel = localLevel(single.level) === 5;
    const difficulty = difficultyFor(single.difficulty);
    const reward = Math.round((bossLevel ? 220 + single.level * 18 : 70 + single.level * 7) * difficulty.reward);
    single.callbacks.onComplete?.({ reward, score: single.score, kills: single.kills, boss: bossLevel, worldName: WORLDS[engineState.world].name });
  }

  single.hudAccumulator += deltaTime;
  if (single.hudAccumulator >= 0.08) {
    single.hudAccumulator = 0;
    const abilityRemaining = Math.max(0, (single.abilityCooldownUntil - now) / 1000);
    single.callbacks.onHud?.({
      health: single.player.hp,
      maxHealth: single.player.maxHp,
      score: single.score,
      kills: single.kills,
      ability: VEHICLES[single.currentVehicle].ability,
      abilityCooldown: abilityRemaining,
      power: single.powerUntil > now ? single.power : null,
      boss: single.boss ? { name: WORLDS[engineState.world].boss, health: Math.max(0, single.boss.hp), maxHealth: single.boss.maxHp } : null
    });
  }
}

function activateSingleAbility() {
  const single = engineState.single;
  const now = performance.now();
  if (!single || single.abilityCooldownUntil > now || single.gameOver || single.completed) return;
  single.abilityCooldownUntil = now + 16000;
  if (single.currentVehicle === 'vanguard' || single.currentVehicle === 'striker') single.abilityUntil = now + 5500;
  else if (single.currentVehicle === 'spectre') single.abilityUntil = now + 4500;
  else if (single.currentVehicle === 'annihilator') {
    single.enemies.forEach((enemy) => {
      if (enemy.mesh.position.distanceTo(single.player.mesh.position) <= 8.5) enemy.hp -= playerStats(single).damage * 1.7;
    });
    createShockwave(single.player.mesh.position.x, single.player.mesh.position.z);
  } else if (single.currentVehicle === 'titan') {
    single.abilityUntil = now + 1000;
    tryFireSinglePlayer(true);
  }
  single.callbacks.onEvent?.(`${VEHICLES[single.currentVehicle].ability} activated.`);
}

function colorForId(id) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  return `hsl(${Math.abs(hash) % 360} 72% 58%)`;
}

function startMultiplayerInternal(config) {
  engineState.mode = 'multi';
  engineState.paused = false;
  engineState.cameraMode = '3d';
  controls.reset();
  setupWorld({ worldId: config.match.settings.world, radius: config.match.radius, seed: config.match.seed, obstacles: config.match.obstacles });
  if (config.match.settings.challenge === 'control_zone') {
    const radius = config.match.controlZoneRadius || 6.5;
    const zone = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.35, radius, 64),
      new THREE.MeshStandardMaterial({ color: '#dcecff', emissive: '#4b92ff', emissiveIntensity: 0.75, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.y = 0.045;
    zone.name = 'control-zone-marker';
    worldRoot.add(zone);
  }
  engineState.multiplayer = {
    socket: config.socket,
    selfId: config.selfId,
    match: config.match,
    snapshot: null,
    renderedPlayers: new Map(),
    renderedBullets: new Map(),
    renderedPowerups: new Map(),
    callbacks: config,
    lastControlSentAt: 0,
    lastControlSequenceSent: -1
  };
}

function ensureMultiplayerPlayerMesh(player) {
  const multiplayer = engineState.multiplayer;
  let entry = multiplayer.renderedPlayers.get(player.id);
  const vehicle = VEHICLES[player.vehicle] || VEHICLES.vanguard;
  if (!entry || entry.vehicle !== player.vehicle) {
    if (entry) {
      actorsRoot.remove(entry.group);
      actorsRoot.remove(entry.label);
    }
    const group = buildVehicle(vehicle.type, FACTION_COLORS[player.faction] || (player.id === multiplayer.selfId ? '#4b92ff' : colorForId(player.id)));
    const label = makeLabel(player.name);
    actorsRoot.add(group, label);
    entry = { group, label, vehicle: player.vehicle };
    multiplayer.renderedPlayers.set(player.id, entry);
  }
  return entry;
}

function syncMultiplayer(snapshot, deltaTime) {
  const multiplayer = engineState.multiplayer;
  if (!multiplayer) return;
  const aliveIds = new Set(snapshot.players.map((player) => player.id));
  for (const [id, entry] of multiplayer.renderedPlayers) {
    if (!aliveIds.has(id)) {
      actorsRoot.remove(entry.group);
      actorsRoot.remove(entry.label);
      multiplayer.renderedPlayers.delete(id);
    }
  }

  snapshot.players.forEach((player) => {
    const entry = ensureMultiplayerPlayerMesh(player);
    entry.group.visible = !player.dead;
    entry.label.visible = !player.dead;
    entry.group.traverse((child) => {
      if (child.material) {
        child.material.transparent = player.connected === false;
        child.material.opacity = player.connected === false ? 0.45 : 1;
      }
    });
    entry.group.position.x = THREE.MathUtils.lerp(entry.group.position.x, player.x, 1 - Math.pow(0.0001, deltaTime));
    entry.group.position.z = THREE.MathUtils.lerp(entry.group.position.z, player.z, 1 - Math.pow(0.0001, deltaTime));
    const difference = Math.atan2(Math.sin(player.angle - entry.group.rotation.y), Math.cos(player.angle - entry.group.rotation.y));
    entry.group.rotation.y += difference * Math.min(1, deltaTime * 12);
    const hover = player.vehicle === 'spectre' || snapshot.settings.world === 'space';
    entry.group.position.y = hover ? 0.55 + Math.sin(performance.now() * 0.003 + player.x) * 0.12 : 0;
    entry.label.position.set(entry.group.position.x, entry.group.position.y + (player.vehicle === 'titan' ? 4.3 : 2.8), entry.group.position.z);
  });

  const bulletIds = new Set(snapshot.bullets.map((bullet) => bullet.id));
  for (const [id, mesh] of multiplayer.renderedBullets) {
    if (!bulletIds.has(id)) {
      actorsRoot.remove(mesh);
      multiplayer.renderedBullets.delete(id);
    }
  }
  snapshot.bullets.forEach((bullet) => {
    let mesh = multiplayer.renderedBullets.get(bullet.id);
    if (!mesh) {
      const color = FACTION_COLORS[bullet.ownerFaction] || (bullet.ownerId === multiplayer.selfId ? '#7db7ff' : '#ff6c73');
      mesh = new THREE.Mesh(new THREE.SphereGeometry(bullet.radius, 9, 9), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 }));
      actorsRoot.add(mesh);
      multiplayer.renderedBullets.set(bullet.id, mesh);
    }
    mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, bullet.x, 0.72);
    mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, bullet.z, 0.72);
    mesh.position.y = snapshot.settings.world === 'space' ? 1.7 : 1.25;
  });

  const pickupIds = new Set(snapshot.powerups.map((powerup) => powerup.id));
  for (const [id, mesh] of multiplayer.renderedPowerups) {
    if (!pickupIds.has(id)) {
      actorsRoot.remove(mesh);
      multiplayer.renderedPowerups.delete(id);
    }
  }
  snapshot.powerups.forEach((powerup, index) => {
    let mesh = multiplayer.renderedPowerups.get(powerup.id);
    if (!mesh) {
      const color = powerup.type === 'morph' ? '#f3c94c' : powerup.type === 'godmode' ? '#bd79ff' : '#55d8b4';
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(powerup.type === 'morph' ? 1 : 0.72, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.1, metalness: 0.35, roughness: 0.18 }));
      actorsRoot.add(mesh);
      multiplayer.renderedPowerups.set(powerup.id, mesh);
    }
    mesh.position.set(powerup.x, 1.15 + Math.sin(performance.now() * 0.005 + index) * 0.24, powerup.z);
    mesh.rotation.x += deltaTime * 1.1;
    mesh.rotation.y += deltaTime * 1.8;
  });

  const self = snapshot.players.find((player) => player.id === multiplayer.selfId);
  if (self) {
    const remaining = Math.max(0, (self.abilityCooldownUntil - snapshot.serverTime) / 1000);
    multiplayer.callbacks.onHud?.({
      health: self.hp,
      maxHealth: self.maxHp,
      kills: self.kills,
      deaths: self.deaths,
      score: self.score,
      dead: self.dead,
      ability: VEHICLES[self.vehicle]?.ability || 'Ability',
      abilityCooldown: remaining,
      faction: self.faction,
      players: [...snapshot.players].sort((a, b) => (b.kills - a.kills) || (b.objectiveScore - a.objectiveScore) || (b.score - a.score)),
      teamScores: snapshot.teamScores || {},
      remainingMs: snapshot.remainingMs || 0,
      challenge: snapshot.settings.challenge,
      objective: snapshot.objective || null
    });
  }
}

function updateCamera(deltaTime) {
  let targetMesh = null;
  if (engineState.mode === 'single') targetMesh = engineState.single?.player.mesh;
  else if (engineState.mode === 'multi') {
    const multiplayer = engineState.multiplayer;
    targetMesh = multiplayer?.renderedPlayers.get(multiplayer.selfId)?.group || null;
  }
  if (!targetMesh) return;
  const target = targetMesh.position;
  if (engineState.cameraMode === '2d') {
    camera.position.lerp(new THREE.Vector3(target.x, 38, target.z + 0.01), Math.min(1, deltaTime * 8));
    camera.lookAt(target.x, 0, target.z);
  } else {
    const offset = new THREE.Vector3(0, 10.5, 14).applyAxisAngle(new THREE.Vector3(0, 1, 0), targetMesh.rotation.y);
    camera.position.lerp(target.clone().add(offset), Math.min(1, deltaTime * 6));
    camera.lookAt(target.x, 1, target.z);
  }
}

function sendMultiplayerControl(force = false) {
  const multiplayer = engineState.multiplayer;
  if (!multiplayer) return;
  const time = performance.now();
  const packet = controls.networkPacket();
  const sequenceChanged = packet.sequence !== multiplayer.lastControlSequenceSent;
  if (!force && !sequenceChanged && time - multiplayer.lastControlSentAt < 100) return;
  multiplayer.lastControlSentAt = time;
  multiplayer.lastControlSequenceSent = packet.sequence;
  multiplayer.socket.emit('control', packet);
}

function resize() {
  if (!renderer) return;
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}


function animate(time) {
  const deltaTime = Math.min((time - engineState.previousTime) / 1000, 0.05);
  engineState.previousTime = time;
  try {
    if (!engineState.paused) {
      if (engineState.mode === 'single') updateSingle(deltaTime);
      else if (engineState.mode === 'multi' && engineState.multiplayer?.snapshot) {
        syncMultiplayer(engineState.multiplayer.snapshot, deltaTime);
        sendMultiplayerControl();
      }
    }
    if (engineState.mode !== 'idle') updateCamera(deltaTime);
    renderer.render(scene, camera);
  } catch (error) {
    fatalCallback?.(error);
    engineState.mode = 'idle';
  }
  requestAnimationFrame(animate);
}

export async function initialize({ canvasHost: host, onFatalError }) {
  if (initialized) return;
  canvasHost = host;
  fatalCallback = onFatalError;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 300);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasHost.appendChild(renderer.domElement);
  worldRoot = new THREE.Group();
  actorsRoot = new THREE.Group();
  effectsRoot = new THREE.Group();
  scene.add(worldRoot, actorsRoot, effectsRoot);
  hemi = new THREE.HemisphereLight(0xbdd8ff, 0x151d26, 1.55);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, 2.35);
  sun.position.set(18, 28, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);
  window.addEventListener('resize', resize);
  controls.attach({
    isEnabled: () => engineState.mode !== 'idle' && !engineState.paused,
    onAbility: () => activateAbility(),
    onCamera: () => toggleCamera(),
    onChange: () => {
      if (engineState.mode === 'multi') sendMultiplayerControl(true);
    }
  });
  resize();
  initialized = true;
  engineState.previousTime = performance.now();
  requestAnimationFrame(animate);
}

export function startSingle(config) {
  stop();
  startSingleInternal(config);
}

export function startMultiplayer(config) {
  stop();
  startMultiplayerInternal(config);
}

export function applyMultiplayerSnapshot(snapshot) {
  if (engineState.mode !== 'multi' || !engineState.multiplayer) return;
  engineState.multiplayer.snapshot = snapshot;
}

export function setInput(control, active) {
  controls.set(control, Boolean(active), `external:${control}`);
}

export function releaseAllInputs() {
  controls.reset();
}

export function activateAbility() {
  if (engineState.mode === 'single') activateSingleAbility();
  else if (engineState.mode === 'multi') engineState.multiplayer?.socket.emit('ability');
}

export function toggleCamera() {
  engineState.cameraMode = engineState.cameraMode === '3d' ? '2d' : '3d';
  return engineState.cameraMode;
}

export function setPaused(value) {
  if (engineState.mode !== 'single') return;
  engineState.paused = Boolean(value);
  if (engineState.paused) controls.reset();
}

export function createRemoteShockwave(x, z) {
  if (engineState.mode === 'multi') createShockwave(x, z);
}

export function stop() {
  controls.reset();
  engineState.mode = 'idle';
  engineState.paused = false;
  engineState.multiplayer = null;
  engineState.single = null;
  clearGroup(worldRoot);
  clearGroup(actorsRoot);
  clearGroup(effectsRoot);
  scene.background = new THREE.Color('#02060b');
  scene.fog = null;
}
