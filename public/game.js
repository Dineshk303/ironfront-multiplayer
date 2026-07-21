import * as THREE from '/vendor/three.module.js';

const socket = window.io();

const VEHICLES = {
  vanguard: { name: 'Vanguard', type: 'tank', ability: 'Fortress Shield', color: '#4b92ff' },
  striker: { name: 'Striker', type: 'buggy', ability: 'Rapid Barrage', color: '#55d8b4' },
  annihilator: { name: 'Annihilator', type: 'siege', ability: 'Ground Shockwave', color: '#e3a53c' },
  spectre: { name: 'Spectre', type: 'hover', ability: 'Phase Drive', color: '#b879ff' },
  titan: { name: 'Titan', type: 'walker', ability: 'Titan Salvo', color: '#e95d65' }
};

const WORLD_NAMES = {
  jungle: 'Emerald Jungle',
  mountain: 'Frozen Mountain',
  arena: 'Grand Combat Arena',
  battlefield: 'Ruined Battleground',
  space: 'Zero-G Space Station'
};

const FACTION_NAMES = {
  iron: 'Iron Legion',
  neon: 'Neon Wolves',
  solar: 'Solar Dominion',
  void: 'Void Syndicate'
};

const POWERUP_LABELS = {
  heal: 'Repair Core',
  shield: 'Shield Field',
  rapid: 'Rapid Fire',
  speed: 'Engine Overdrive',
  godmode: 'Godmode Core',
  morph: 'Random Vehicle Morph'
};

const screens = {
  home: document.getElementById('homeScreen'),
  lobby: document.getElementById('lobbyScreen'),
  game: document.getElementById('gameScreen')
};

const state = {
  selfId: null,
  room: null,
  selectedVehicle: 'vanguard',
  match: null,
  snapshot: null,
  cameraMode: '3d',
  input: { forward: false, backward: false, left: false, right: false, fire: false },
  renderedPlayers: new Map(),
  renderedBullets: new Map(),
  renderedPowerups: new Map(),
  labels: new Map(),
  obstacleMeshes: [],
  worldMeshes: [],
  lastInputSent: 0
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('active', key === name));
}

function showMessage(id, text, error = false) {
  const element = document.getElementById(id);
  element.textContent = text;
  element.style.color = error ? '#ff7c83' : '#91bfff';
}

function vehicleButtons(containerId, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  Object.entries(VEHICLES).forEach(([key, vehicle]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `vehicle-option${state.selectedVehicle === key ? ' selected' : ''}`;
    button.innerHTML = `<strong>${vehicle.name}</strong><small>${vehicle.ability}</small>`;
    button.addEventListener('click', () => {
      state.selectedVehicle = key;
      vehicleButtons('homeVehicleGrid', selectHomeVehicle);
      vehicleButtons('lobbyVehicleGrid', selectLobbyVehicle);
      onSelect?.(key);
    });
    container.appendChild(button);
  });
}

function selectHomeVehicle() {}

function selectLobbyVehicle(vehicle) {
  if (!state.room) return;
  socket.emit('setVehicle', { vehicle }, (response) => {
    if (!response?.ok) showMessage('lobbyMessage', 'Vehicle selection failed.', true);
  });
}

vehicleButtons('homeVehicleGrid', selectHomeVehicle);
vehicleButtons('lobbyVehicleGrid', selectLobbyVehicle);

const roomQuery = new URLSearchParams(location.search).get('room');
if (roomQuery) document.getElementById('roomCodeInput').value = roomQuery.toUpperCase().slice(0, 5);

function playerName() {
  return document.getElementById('playerName').value.trim() || 'Commander';
}

function enterLobby(response) {
  if (!response?.ok) return;
  state.selfId = response.selfId;
  state.room = response.room;
  history.replaceState(null, '', `?room=${response.room.code}`);
  showScreen('lobby');
  renderLobby(response.room);
}

document.getElementById('createRoomButton').addEventListener('click', () => {
  showMessage('homeMessage', 'Creating room…');
  socket.emit('createRoom', { name: playerName(), vehicle: state.selectedVehicle }, (response) => {
    if (!response?.ok) return showMessage('homeMessage', response?.error || 'Could not create room.', true);
    enterLobby(response);
  });
});

document.getElementById('joinRoomButton').addEventListener('click', () => {
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) return showMessage('homeMessage', 'Enter a room code.', true);
  showMessage('homeMessage', 'Joining room…');
  socket.emit('joinRoom', { code, name: playerName(), vehicle: state.selectedVehicle }, (response) => {
    if (!response?.ok) return showMessage('homeMessage', response?.error || 'Could not join room.', true);
    enterLobby(response);
  });
});

document.getElementById('copyInviteButton').addEventListener('click', async () => {
  if (!state.room) return;
  const url = `${location.origin}${location.pathname}?room=${state.room.code}`;
  try {
    await navigator.clipboard.writeText(url);
    showMessage('lobbyMessage', 'Invite URL copied.');
  } catch {
    showMessage('lobbyMessage', url);
  }
});

document.getElementById('leaveLobbyButton').addEventListener('click', () => {
  socket.emit('leaveRoom');
  state.room = null;
  history.replaceState(null, '', location.pathname);
  showScreen('home');
});

document.getElementById('worldSelect').addEventListener('change', sendLobbySettings);
document.getElementById('factionSelect').addEventListener('change', sendLobbySettings);

function sendLobbySettings() {
  if (!state.room || state.room.leaderId !== state.selfId) return;
  socket.emit('setLobbySettings', {
    world: document.getElementById('worldSelect').value,
    faction: document.getElementById('factionSelect').value
  });
}

document.getElementById('startMatchButton').addEventListener('click', () => {
  socket.emit('startMatch', {}, (response) => {
    if (!response?.ok) showMessage('lobbyMessage', response?.error || 'Could not start match.', true);
  });
});

function renderLobby(room) {
  state.room = room;
  document.getElementById('roomCodeLabel').textContent = room.code;
  document.getElementById('playerCountLabel').textContent = `${room.players.length} / ${room.maxPlayers}`;
  document.getElementById('worldSelect').value = room.settings.world;
  document.getElementById('factionSelect').value = room.settings.faction;

  const isLeader = room.leaderId === state.selfId;
  document.getElementById('leaderSettings').classList.toggle('hidden', !isLeader);
  document.getElementById('startMatchButton').classList.toggle('hidden', !isLeader);

  const self = room.players.find((player) => player.id === state.selfId);
  if (self) state.selectedVehicle = self.vehicle;
  vehicleButtons('lobbyVehicleGrid', selectLobbyVehicle);

  const list = document.getElementById('lobbyPlayerList');
  list.innerHTML = '';
  room.players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="player-avatar">${player.name.slice(0, 1).toUpperCase()}</div>
      <div><strong>${escapeHtml(player.name)}</strong><br><small>${VEHICLES[player.vehicle]?.name || player.vehicle}</small></div>
      <span>${player.id === room.leaderId ? 'LEADER' : 'READY'}</span>
    `;
    list.appendChild(row);
  });

  showMessage('lobbyMessage', isLeader ? 'Choose the world and faction, then start.' : 'Waiting for the lobby leader.');
}

socket.on('lobbyState', (room) => {
  if (state.room?.code === room.code || !state.room) renderLobby(room);
});

socket.on('matchStarted', (match) => {
  state.match = match;
  state.snapshot = null;
  state.cameraMode = '3d';
  document.getElementById('cameraToggleButton').textContent = '2D camera';
  document.getElementById('worldLabel').textContent = WORLD_NAMES[match.settings.world];
  document.getElementById('factionLabel').textContent = FACTION_NAMES[match.settings.faction];
  showScreen('game');
  setupWorld(match);
});

socket.on('snapshot', (snapshot) => {
  state.snapshot = snapshot;
  updateHud(snapshot);
});

socket.on('powerupCollected', (event) => {
  addFeed(`${event.playerName} collected ${POWERUP_LABELS[event.type] || event.type}${event.type === 'morph' ? ` and became ${VEHICLES[event.vehicle]?.name}` : ''}.`);
  if (event.playerId === state.selfId) {
    const banner = document.getElementById('powerupBanner');
    banner.textContent = event.type === 'morph' ? `VEHICLE MORPH: ${VEHICLES[event.vehicle]?.name}` : POWERUP_LABELS[event.type] || event.type;
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('hidden'), 2400);
  }
});

socket.on('playerDestroyed', ({ victimId, killerId }) => {
  const victim = state.snapshot?.players.find((player) => player.id === victimId);
  const killer = state.snapshot?.players.find((player) => player.id === killerId);
  addFeed(killer ? `${killer.name} destroyed ${victim?.name || 'a player'}.` : `${victim?.name || 'A player'} was destroyed.`);
});

socket.on('shockwave', ({ x, z }) => createShockwave(x, z));

function addFeed(text) {
  const feed = document.getElementById('eventFeed');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.textContent = text;
  feed.prepend(item);
  while (feed.children.length > 5) feed.lastElementChild.remove();
  setTimeout(() => item.remove(), 4500);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('gameCanvas').appendChild(renderer.domElement);

const worldRoot = new THREE.Group();
const actorsRoot = new THREE.Group();
const effectsRoot = new THREE.Group();
scene.add(worldRoot, actorsRoot, effectsRoot);

const hemi = new THREE.HemisphereLight(0xbdd8ff, 0x151d26, 1.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.35);
sun.position.set(18, 28, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
scene.add(sun);

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function material(color, metalness = 0.45, roughness = 0.4) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function shadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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

  return group;
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(5,12,22,.78)';
  context.roundRect(3, 8, 250, 48, 14);
  context.fill();
  context.fillStyle = '#eef6ff';
  context.font = '700 25px system-ui';
  context.textAlign = 'center';
  context.fillText(text, 128, 41);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(4.6, 1.15, 1);
  return sprite;
}

function setupWorld(match) {
  clearGroup(worldRoot);
  clearGroup(actorsRoot);
  clearGroup(effectsRoot);
  state.renderedPlayers.clear();
  state.renderedBullets.clear();
  state.renderedPowerups.clear();
  state.labels.clear();
  state.obstacleMeshes = [];

  const world = match.settings.world;
  const palette = {
    jungle: ['#10251d', '#183c28', '#3d7b4c'],
    mountain: ['#9eb5c5', '#65737b', '#d5e8f3'],
    arena: ['#291720', '#59402f', '#e2a54e'],
    battlefield: ['#302b28', '#4b443b', '#b26c4a'],
    space: ['#040712', '#1d2635', '#6c8cff']
  }[world];

  scene.background = new THREE.Color(palette[0]);
  scene.fog = new THREE.FogExp2(palette[0], world === 'space' ? 0.006 : 0.018);
  hemi.groundColor.set(palette[1]);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(match.radius, 96), material(palette[1], world === 'space' ? 0.7 : 0.08, world === 'space' ? 0.35 : 0.92));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  worldRoot.add(ground);

  const ring = new THREE.Mesh(new THREE.RingGeometry(match.radius - 0.65, match.radius, 96), new THREE.MeshStandardMaterial({ color: palette[2], emissive: palette[2], emissiveIntensity: world === 'space' ? 1.5 : 0.35, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  worldRoot.add(ring);

  const grid = new THREE.GridHelper(match.radius * 2, Math.round(match.radius), palette[2], palette[2]);
  grid.material.transparent = true;
  grid.material.opacity = world === 'space' ? 0.25 : 0.08;
  grid.position.y = 0.02;
  worldRoot.add(grid);

  match.obstacles.forEach((obstacle) => {
    const mesh = buildObstacle(world, obstacle, palette[2]);
    mesh.position.set(obstacle.x, 0, obstacle.z);
    worldRoot.add(mesh);
    state.obstacleMeshes.push(mesh);
  });

  addWorldDecor(world, match.radius, match.seed, palette);
}

function buildObstacle(world, obstacle, accent) {
  const group = new THREE.Group();
  if (world === 'jungle') {
    const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(obstacle.r * 0.28, obstacle.r * 0.36, obstacle.r * 2.2, 8), material('#5b3a24', 0, 0.95)));
    trunk.position.y = obstacle.r * 1.1;
    group.add(trunk);
    const crown = shadow(new THREE.Mesh(new THREE.SphereGeometry(obstacle.r, 8, 7), material('#2f7545', 0, 0.95)));
    crown.position.y = obstacle.r * 2.25;
    group.add(crown);
  } else if (world === 'mountain') {
    const rock = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(obstacle.r, 0), material(obstacle.variant % 2 ? '#d3dfe5' : '#77848c', 0.05, 0.95)));
    rock.scale.set(1, 1.3, 0.82);
    rock.position.y = obstacle.r;
    group.add(rock);
  } else if (world === 'arena') {
    const pillar = shadow(new THREE.Mesh(new THREE.CylinderGeometry(obstacle.r * 0.65, obstacle.r * 0.82, obstacle.r * 3, 12), material('#aa7347', 0.28, 0.48)));
    pillar.position.y = obstacle.r * 1.5;
    group.add(pillar);
  } else if (world === 'battlefield') {
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

function addWorldDecor(world, radius, seed, palette) {
  const random = seededRandom(seed + 991);
  if (world === 'space') {
    const positions = [];
    for (let i = 0; i < 350; i += 1) positions.push((random() - 0.5) * radius * 4, 20 + random() * 70, (random() - 0.5) * radius * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    worldRoot.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffffff', size: 0.35 })));
  } else {
    for (let i = 0; i < 18; i += 1) {
      const angle = random() * Math.PI * 2;
      const distance = radius + 4 + random() * 16;
      const height = 4 + random() * 8;
      const decoration = shadow(new THREE.Mesh(new THREE.ConeGeometry(2 + random() * 3, height, 7), material(palette[2], 0, 0.9)));
      decoration.position.set(Math.cos(angle) * distance, height / 2 - 0.2, Math.sin(angle) * distance);
      worldRoot.add(decoration);
    }
  }
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

function ensurePlayerMesh(player) {
  let entry = state.renderedPlayers.get(player.id);
  const vehicleType = VEHICLES[player.vehicle]?.type || 'tank';
  if (!entry || entry.vehicle !== player.vehicle) {
    if (entry) {
      actorsRoot.remove(entry.group);
      actorsRoot.remove(entry.label);
    }
    const color = player.id === state.selfId ? '#4b92ff' : colorForId(player.id);
    const group = buildVehicle(vehicleType, color);
    const label = makeLabel(player.name);
    actorsRoot.add(group, label);
    entry = { group, label, vehicle: player.vehicle, targetX: player.x, targetZ: player.z, targetAngle: player.angle };
    state.renderedPlayers.set(player.id, entry);
  }
  return entry;
}

function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 72% 58%)`;
}

function syncScene(snapshot, dt) {
  const aliveIds = new Set(snapshot.players.map((player) => player.id));
  for (const [id, entry] of state.renderedPlayers) {
    if (!aliveIds.has(id)) {
      actorsRoot.remove(entry.group, entry.label);
      state.renderedPlayers.delete(id);
    }
  }

  snapshot.players.forEach((player) => {
    const entry = ensurePlayerMesh(player);
    entry.targetX = player.x;
    entry.targetZ = player.z;
    entry.targetAngle = player.angle;
    entry.group.visible = !player.dead;
    entry.label.visible = !player.dead;
    entry.group.position.x = THREE.MathUtils.lerp(entry.group.position.x, entry.targetX, 1 - Math.pow(0.0001, dt));
    entry.group.position.z = THREE.MathUtils.lerp(entry.group.position.z, entry.targetZ, 1 - Math.pow(0.0001, dt));
    const diff = Math.atan2(Math.sin(entry.targetAngle - entry.group.rotation.y), Math.cos(entry.targetAngle - entry.group.rotation.y));
    entry.group.rotation.y += diff * Math.min(1, dt * 12);
    const hover = player.vehicle === 'spectre' || snapshot.settings.world === 'space';
    entry.group.position.y = hover ? 0.55 + Math.sin(performance.now() * 0.003 + player.x) * 0.12 : 0;
    entry.label.position.set(entry.group.position.x, entry.group.position.y + (player.vehicle === 'titan' ? 4.3 : 2.8), entry.group.position.z);
  });

  const bulletIds = new Set(snapshot.bullets.map((bullet) => bullet.id));
  for (const [id, mesh] of state.renderedBullets) {
    if (!bulletIds.has(id)) {
      actorsRoot.remove(mesh);
      state.renderedBullets.delete(id);
    }
  }
  snapshot.bullets.forEach((bullet) => {
    let mesh = state.renderedBullets.get(bullet.id);
    if (!mesh) {
      const color = bullet.ownerId === state.selfId ? '#7db7ff' : '#ff6c73';
      mesh = new THREE.Mesh(new THREE.SphereGeometry(bullet.radius, 9, 9), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2 }));
      actorsRoot.add(mesh);
      state.renderedBullets.set(bullet.id, mesh);
    }
    mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, bullet.x, 0.72);
    mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, bullet.z, 0.72);
    mesh.position.y = snapshot.settings.world === 'space' ? 1.7 : 1.25;
  });

  const powerupIds = new Set(snapshot.powerups.map((powerup) => powerup.id));
  for (const [id, mesh] of state.renderedPowerups) {
    if (!powerupIds.has(id)) {
      actorsRoot.remove(mesh);
      state.renderedPowerups.delete(id);
    }
  }
  snapshot.powerups.forEach((powerup, index) => {
    let mesh = state.renderedPowerups.get(powerup.id);
    if (!mesh) {
      const color = powerup.type === 'morph' ? '#f3c94c' : powerup.type === 'godmode' ? '#bd79ff' : '#55d8b4';
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(powerup.type === 'morph' ? 1 : 0.72, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.1, metalness: 0.35, roughness: 0.18 }));
      actorsRoot.add(mesh);
      state.renderedPowerups.set(powerup.id, mesh);
    }
    mesh.position.set(powerup.x, 1.15 + Math.sin(performance.now() * 0.005 + index) * 0.24, powerup.z);
    mesh.rotation.x += dt * 1.1;
    mesh.rotation.y += dt * 1.8;
  });
}

function createShockwave(x, z) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 48), new THREE.MeshBasicMaterial({ color: '#f3c94c', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
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

function updateHud(snapshot) {
  const self = snapshot.players.find((player) => player.id === state.selfId);
  if (!self) return;
  document.getElementById('healthText').textContent = `${Math.ceil(self.hp)} / ${self.maxHp}`;
  document.getElementById('healthBar').style.width = `${Math.max(0, self.hp / self.maxHp * 100)}%`;
  document.getElementById('killsLabel').textContent = self.kills;
  document.getElementById('deathsLabel').textContent = self.deaths;
  document.getElementById('scoreLabel').textContent = self.score;
  document.getElementById('respawnOverlay').classList.toggle('hidden', !self.dead);

  const remaining = Math.max(0, self.abilityCooldownUntil - snapshot.serverTime);
  document.getElementById('abilityButton').textContent = remaining > 0 ? `${VEHICLES[self.vehicle]?.ability} ${(remaining / 1000).toFixed(1)}s` : `${VEHICLES[self.vehicle]?.ability} [Q]`;
  document.getElementById('abilityButton').disabled = remaining > 0 || self.dead;

  const roster = document.getElementById('gamePlayerList');
  roster.innerHTML = '';
  [...snapshot.players].sort((a, b) => b.score - a.score).forEach((player) => {
    const row = document.createElement('div');
    row.className = `roster-row${player.id === state.selfId ? ' me' : ''}${player.dead ? ' dead' : ''}`;
    row.innerHTML = `<span>${escapeHtml(player.name)}</span><span>${player.kills}/${player.deaths} · ${VEHICLES[player.vehicle]?.name}</span>`;
    roster.appendChild(row);
  });
}

function updateCamera(dt) {
  const self = state.snapshot?.players.find((player) => player.id === state.selfId);
  if (!self) return;
  const entry = state.renderedPlayers.get(self.id);
  if (!entry) return;
  const target = entry.group.position;
  if (state.cameraMode === '2d') {
    camera.position.lerp(new THREE.Vector3(target.x, 38, target.z + 0.01), Math.min(1, dt * 8));
    camera.lookAt(target.x, 0, target.z);
  } else {
    const offset = new THREE.Vector3(0, 10.5, 14).applyAxisAngle(new THREE.Vector3(0, 1, 0), entry.group.rotation.y);
    camera.position.lerp(target.clone().add(offset), Math.min(1, dt * 6));
    camera.lookAt(target.x, 1, target.z);
  }
}

function sendInput(force = false) {
  const time = performance.now();
  if (!force && time - state.lastInputSent < 33) return;
  state.lastInputSent = time;
  socket.emit('input', state.input);
}

function setKey(code, active) {
  if (code === 'KeyW' || code === 'ArrowUp') state.input.forward = active;
  if (code === 'KeyS' || code === 'ArrowDown') state.input.backward = active;
  if (code === 'KeyA' || code === 'ArrowLeft') state.input.left = active;
  if (code === 'KeyD' || code === 'ArrowRight') state.input.right = active;
  if (code === 'Space') state.input.fire = active;
  sendInput(true);
}

window.addEventListener('keydown', (event) => {
  if (!screens.game.classList.contains('active')) return;
  const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  if (keys.includes(event.code)) {
    event.preventDefault();
    setKey(event.code, true);
  }
  if (event.code === 'KeyQ' && !event.repeat) socket.emit('ability');
  if (event.code === 'KeyC' && !event.repeat) toggleCamera();
});
window.addEventListener('keyup', (event) => setKey(event.code, false));
window.addEventListener('blur', () => {
  Object.keys(state.input).forEach((key) => state.input[key] = false);
  sendInput(true);
});

function toggleCamera() {
  state.cameraMode = state.cameraMode === '3d' ? '2d' : '3d';
  document.getElementById('cameraToggleButton').textContent = state.cameraMode === '3d' ? '2D camera' : '3D camera';
}

document.getElementById('cameraToggleButton').addEventListener('click', toggleCamera);
document.getElementById('abilityButton').addEventListener('click', () => socket.emit('ability'));
document.getElementById('mobileAbilityButton').addEventListener('click', () => socket.emit('ability'));

document.getElementById('leaveMatchButton').addEventListener('click', () => {
  socket.emit('leaveRoom');
  state.room = null;
  state.match = null;
  state.snapshot = null;
  clearGroup(worldRoot);
  clearGroup(actorsRoot);
  clearGroup(effectsRoot);
  history.replaceState(null, '', location.pathname);
  showScreen('home');
});

document.querySelectorAll('[data-touch]').forEach((button) => {
  const key = button.dataset.touch;
  const start = (event) => {
    event.preventDefault();
    state.input[key] = true;
    sendInput(true);
    button.setPointerCapture?.(event.pointerId);
  };
  const end = (event) => {
    event.preventDefault();
    state.input[key] = false;
    sendInput(true);
  };
  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', end);
  button.addEventListener('pointercancel', end);
  button.addEventListener('lostpointercapture', end);
});

const mobileFire = document.getElementById('mobileFireButton');
mobileFire.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  state.input.fire = true;
  sendInput(true);
  mobileFire.setPointerCapture?.(event.pointerId);
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => mobileFire.addEventListener(name, (event) => {
  event.preventDefault();
  state.input.fire = false;
  sendInput(true);
}));

socket.on('disconnect', () => {
  if (screens.game.classList.contains('active') || screens.lobby.classList.contains('active')) {
    addFeed('Disconnected from server. Reconnect or reload the page.');
  }
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let previousTime = performance.now();
function animate(time) {
  const dt = Math.min((time - previousTime) / 1000, 0.05);
  previousTime = time;
  if (state.snapshot && screens.game.classList.contains('active')) {
    syncScene(state.snapshot, dt);
    updateCamera(dt);
    sendInput();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
