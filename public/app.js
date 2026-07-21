'use strict';

const VEHICLES = {
  vanguard: { name: 'Vanguard Tank', short: 'Vanguard', type: 'tank', cost: 0, hp: 120, speed: 10, damage: 24, reload: 520, ability: 'Fortress Shield', description: 'Balanced frontline tank. Its shield reduces incoming damage for a short duration.', color: '#4b92ff' },
  striker: { name: 'Striker Buggy', short: 'Striker', type: 'buggy', cost: 350, hp: 88, speed: 15, damage: 16, reload: 260, ability: 'Rapid Barrage', description: 'Fast twin-cannon buggy with the highest mobility and temporary rapid fire.', color: '#55d8b4' },
  annihilator: { name: 'Annihilator Siege Tank', short: 'Annihilator', type: 'siege', cost: 750, hp: 190, speed: 7.4, damage: 40, reload: 850, ability: 'Ground Shockwave', description: 'Heavy siege platform with explosive damage and a radial shockwave.', color: '#e3a53c' },
  spectre: { name: 'Spectre Hovercraft', short: 'Spectre', type: 'hover', cost: 1200, hp: 105, speed: 13.5, damage: 28, reload: 430, ability: 'Phase Drive', description: 'Advanced hover vehicle that becomes fast and invulnerable while phasing.', color: '#b879ff' },
  titan: { name: 'Titan Walker', short: 'Titan', type: 'walker', cost: 1900, hp: 260, speed: 6.2, damage: 48, reload: 980, ability: 'Titan Salvo', description: 'Ultimate armored walker with a devastating five-projectile salvo.', color: '#e95d65' }
};

const WORLDS = [
  { id: 'jungle', name: 'Emerald Jungle', effect: 'Mud zones reduce traction.', boss: 'Ancient Jungle Behemoth', levels: '1–5' },
  { id: 'mountain', name: 'Frozen Mountain', effect: 'Avalanche strikes mark dangerous zones.', boss: 'Avalanche Fortress', levels: '6–10' },
  { id: 'arena', name: 'Grand Combat Arena', effect: 'Central energy pulses punish close combat.', boss: 'Arena Champion', levels: '11–15' },
  { id: 'battlefield', name: 'Ruined Battleground', effect: 'Random artillery targets the arena.', boss: 'Titan War Machine', levels: '16–20' },
  { id: 'space', name: 'Zero-G Space Station', effect: 'Low gravity and gravity wells alter movement.', boss: 'Zero-G Dreadnought', levels: '21–25' }
];

const FACTIONS = {
  iron: 'Iron Legion',
  neon: 'Neon Wolves',
  solar: 'Solar Dominion',
  void: 'Void Syndicate'
};

const FACTION_COLORS = {
  iron: '#7795b9',
  neon: '#55d8b4',
  solar: '#e3a53c',
  void: '#b879ff'
};

const CHALLENGES = {
  team_deathmatch: {
    name: 'Team Deathmatch',
    description: 'Destroy enemy vehicles. Every elimination gives your faction 3 points.'
  },
  control_zone: {
    name: 'Control Zone',
    description: 'Hold the central zone. Exclusive control gives 1 point per second; eliminations give 1 point.'
  },
  salvage_rush: {
    name: 'Salvage Rush',
    description: 'Collect battlefield power-ups. Pickups give 2 points, rare cores give 3, and eliminations give 1.'
  }
};

const POWERUP_LABELS = {
  heal: 'Repair Core',
  shield: 'Shield Field',
  rapid: 'Rapid Fire',
  speed: 'Engine Overdrive',
  godmode: 'Godmode Core',
  morph: 'Vehicle Morph',
  coin: 'Coin Cache'
};

const DEFAULT_PROFILE = {
  coins: 150,
  level: 1,
  score: 0,
  kills: 0,
  selectedVehicle: 'vanguard',
  owned: ['vanguard'],
  upgrades: { armor: 0, cannon: 0, reload: 0, engine: 0 },
  difficulty: 'normal'
};

const screens = {
  modes: document.getElementById('modeScreen'),
  campaign: document.getElementById('campaignScreen'),
  garage: document.getElementById('garageScreen'),
  armory: document.getElementById('armoryScreen'),
  worldMap: document.getElementById('worldMapScreen'),
  multiplayer: document.getElementById('multiplayerHomeScreen'),
  lobby: document.getElementById('lobbyScreen'),
  game: document.getElementById('gameScreen')
};

let profile = loadProfile();
let selectedGarageVehicle = profile.selectedVehicle;
let armoryReturn = 'campaign';
let enginePromise = null;
let engine = null;
let gameMode = null;
let pendingLevelResult = null;
let multiplayerRoom = null;
let multiplayerSelfId = null;
let latestSnapshot = null;
let socket = null;
let socketConnected = false;
let resumeInFlight = false;
let activeMatchKey = null;
let selectedMultiplayerFaction = 'iron';

const MULTIPLAYER_CLIENT_ID = (() => {
  const key = 'ironfront-multiplayer-client-v1';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
})();

function loadProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem('ironfront-profile-v2') || 'null');
    if (!stored) return structuredClone(DEFAULT_PROFILE);
    return {
      ...structuredClone(DEFAULT_PROFILE),
      ...stored,
      owned: Array.isArray(stored.owned) ? stored.owned : ['vanguard'],
      upgrades: { ...DEFAULT_PROFILE.upgrades, ...(stored.upgrades || {}) }
    };
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

function saveProfile() {
  try {
    localStorage.setItem('ironfront-profile-v2', JSON.stringify(profile));
  } catch {
    // Progress remains available for the current session when storage is blocked.
  }
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('active', key === name));
}

function showMessage(id, text, error = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.style.color = error ? '#ff7c83' : '#91bfff';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function currentWorld(level = profile.level) {
  return WORLDS[Math.floor((Math.max(1, level) - 1) / 5) % WORLDS.length];
}

function localLevel(level = profile.level) {
  return ((Math.max(1, level) - 1) % 5) + 1;
}

function worldIndex(level = profile.level) {
  return Math.floor((Math.max(1, level) - 1) / 5) % WORLDS.length;
}

function campaignTier(level = profile.level) {
  return Math.floor((Math.max(1, level) - 1) / 25) + 1;
}

function renderCampaign() {
  const world = currentWorld();
  const vehicle = VEHICLES[profile.selectedVehicle];
  document.getElementById('campaignCoins').textContent = profile.coins;
  document.getElementById('campaignLevel').textContent = profile.level;
  document.getElementById('campaignWorld').textContent = world.name;
  document.getElementById('campaignVehicle').textContent = vehicle.short;
  document.getElementById('campaignWorldStage').textContent = `WORLD ${worldIndex() + 1} · LOCAL LEVEL ${localLevel()} · TIER ${campaignTier()}`;
  document.getElementById('campaignWorldTitle').textContent = world.name.toUpperCase();
  document.getElementById('campaignWorldEffect').textContent = localLevel() === 5 ? `BOSS: ${world.boss}` : world.effect;
  document.getElementById('continueCampaignButton').textContent = localLevel() === 5 ? `Fight boss — level ${profile.level}` : `Play level ${profile.level}`;
  const badge = document.getElementById('campaignWorldBadge');
  badge.className = `world-hero world-${world.id}`;
  document.getElementById('equippedVehiclePreview').textContent = vehicle.short.slice(0, 1);
  document.getElementById('equippedVehiclePreview').style.background = `radial-gradient(circle at 35% 25%, ${vehicle.color}, #15304e)`;
  document.getElementById('equippedVehicleName').textContent = vehicle.name;
  document.getElementById('equippedVehicleAbility').textContent = vehicle.ability;
  document.getElementById('equippedVehicleStats').innerHTML = vehicleStatsHtml(vehicle, true);
}

function vehicleStatsHtml(vehicle, includeUpgrades = false) {
  const armorBonus = includeUpgrades ? profile.upgrades.armor * 25 : 0;
  const damageMultiplier = includeUpgrades ? Math.pow(1.2, profile.upgrades.cannon) : 1;
  const speedMultiplier = includeUpgrades ? Math.pow(1.12, profile.upgrades.engine) : 1;
  const reloadMultiplier = includeUpgrades ? Math.pow(0.85, profile.upgrades.reload) : 1;
  return `
    <div>Hull <strong>${Math.round(vehicle.hp + armorBonus)}</strong></div>
    <div>Speed <strong>${(vehicle.speed * speedMultiplier).toFixed(1)}</strong></div>
    <div>Damage <strong>${Math.round(vehicle.damage * damageMultiplier)}</strong></div>
    <div>Reload <strong>${Math.round(vehicle.reload * reloadMultiplier)}ms</strong></div>
  `;
}

function renderVehicleOptions(containerId, selected, onSelect, ownedOnly = false) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  Object.entries(VEHICLES).forEach(([key, vehicle]) => {
    if (ownedOnly && !profile.owned.includes(key)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `vehicle-option${selected === key ? ' selected' : ''}`;
    button.innerHTML = `<strong>${vehicle.short}</strong><small>${vehicle.ability}</small>`;
    button.addEventListener('click', () => onSelect(key));
    container.appendChild(button);
  });
}

function renderGarage() {
  document.getElementById('garageVehicleGrid').innerHTML = '';
  Object.entries(VEHICLES).forEach(([key, vehicle]) => {
    const owned = profile.owned.includes(key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `garage-card${selectedGarageVehicle === key ? ' selected' : ''}`;
    button.innerHTML = `<strong>${vehicle.name}</strong><small>${vehicle.ability}</small><small>${vehicle.description}</small><span class="cost">${owned ? 'OWNED' : `${vehicle.cost} COINS`}</span>`;
    button.addEventListener('click', () => {
      selectedGarageVehicle = key;
      renderGarage();
    });
    document.getElementById('garageVehicleGrid').appendChild(button);
  });

  const vehicle = VEHICLES[selectedGarageVehicle];
  const owned = profile.owned.includes(selectedGarageVehicle);
  document.getElementById('garageVehicleIcon').textContent = vehicle.short.slice(0, 1);
  document.getElementById('garageVehicleIcon').style.background = `radial-gradient(circle at 35% 25%, ${vehicle.color}, #15304e)`;
  document.getElementById('garageVehicleName').textContent = vehicle.name;
  document.getElementById('garageVehicleAbility').textContent = vehicle.ability;
  document.getElementById('garageVehiclePrice').textContent = owned ? 'Owned' : `${vehicle.cost} coins`;
  document.getElementById('garageVehicleDescription').textContent = vehicle.description;
  document.getElementById('garageVehicleStats').innerHTML = vehicleStatsHtml(vehicle);
  const action = document.getElementById('garageVehicleAction');
  if (profile.selectedVehicle === selectedGarageVehicle) {
    action.textContent = 'Equipped';
    action.disabled = true;
  } else if (owned) {
    action.textContent = 'Equip vehicle';
    action.disabled = false;
  } else {
    action.textContent = `Buy for ${vehicle.cost} coins`;
    action.disabled = false;
  }
}

const UPGRADE_INFO = {
  armor: { name: 'Reinforced Armor', description: '+25 maximum hull per level' },
  cannon: { name: 'Cannon Calibration', description: '+20% damage per level' },
  reload: { name: 'Advanced Autoloader', description: '+15% firing speed per level' },
  engine: { name: 'Performance Engine', description: '+12% movement speed per level' }
};

function upgradeCost(key) {
  return 120 + profile.upgrades[key] * 140;
}

function renderArmory() {
  document.getElementById('armoryCoins').textContent = profile.coins;
  document.getElementById('armoryReturnLabel').textContent = armoryReturn === 'complete' ? 'Level complete' : 'Campaign';
  const grid = document.getElementById('upgradeGrid');
  grid.innerHTML = '';
  Object.entries(UPGRADE_INFO).forEach(([key, info]) => {
    const cost = upgradeCost(key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'upgrade-card';
    button.innerHTML = `<strong>${info.name}</strong><span class="muted">${info.description}</span><div class="upgrade-meta"><span>Level ${profile.upgrades[key]}</span><span>${cost} coins</span></div>`;
    button.addEventListener('click', () => {
      if (profile.coins < cost) {
        showMessage('armoryMessage', `You need ${cost - profile.coins} more coins.`, true);
        return;
      }
      profile.coins -= cost;
      profile.upgrades[key] += 1;
      saveProfile();
      renderArmory();
      renderCampaign();
      showMessage('armoryMessage', `${info.name} upgraded to level ${profile.upgrades[key]}.`);
    });
    grid.appendChild(button);
  });
}

function renderWorldMap() {
  const grid = document.getElementById('worldMapGrid');
  grid.innerHTML = '';
  WORLDS.forEach((world, index) => {
    const firstLevel = index * 5 + 1;
    const unlocked = profile.level >= firstLevel || campaignTier() > 1;
    const card = document.createElement('article');
    card.className = `world-map-card${world.id === currentWorld().id ? ' current' : ''}${unlocked ? '' : ' locked'}`;
    card.innerHTML = `<div><span class="world-number">WORLD ${index + 1} · LEVELS ${world.levels}</span><h3>${world.name}</h3><small>${world.effect}</small></div><div><strong>${unlocked ? 'UNLOCKED' : 'LOCKED'}</strong><small>Boss: ${world.boss}</small></div>`;
    grid.appendChild(card);
  });
}

async function loadEngine() {
  if (engine) return engine;
  if (!enginePromise) {
    enginePromise = import('/engine.js?v=4.0.0').then((module) => {
      engine = module;
      return module.initialize({
        canvasHost: document.getElementById('gameCanvas'),
        onFatalError: showFatalError
      }).then(() => module);
    }).catch((error) => {
      enginePromise = null;
      showFatalError(error);
      throw error;
    });
  }
  return enginePromise;
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error);
  document.getElementById('fatalErrorText').textContent = `${message}. Reload after checking the deployment files.`;
  document.getElementById('fatalError').classList.remove('hidden');
}

function prepareGameHud(mode, worldName, subLabel) {
  document.getElementById('gameModeLabel').textContent = mode === 'single' ? 'CAMPAIGN' : 'MULTIPLAYER';
  document.getElementById('worldLabel').textContent = worldName;
  document.getElementById('subWorldLabel').textContent = subLabel;
  document.getElementById('gamePlayerList').classList.toggle('hidden', mode !== 'multi');
  document.getElementById('deathHud').classList.toggle('hidden', mode !== 'multi');
  document.getElementById('coinHud').classList.toggle('hidden', mode !== 'single');
  document.getElementById('pauseGameButton').classList.toggle('hidden', mode !== 'single');
  document.getElementById('bossPanel').classList.add('hidden');
  document.getElementById('respawnOverlay').classList.add('hidden');
  document.getElementById('levelCompleteOverlay').classList.add('hidden');
  document.getElementById('singleGameOverOverlay').classList.add('hidden');
  document.getElementById('multiplayerResultOverlay').classList.add('hidden');
  document.getElementById('pauseOverlay').classList.add('hidden');
  document.getElementById('multiplayerResultOverlay').classList.add('hidden');
  document.getElementById('multiplayerTimerCard').classList.toggle('hidden', mode !== 'multi');
  document.getElementById('teamScorePanel').classList.toggle('hidden', mode !== 'multi');
  document.getElementById('objectivePanel').classList.toggle('hidden', mode !== 'multi');
  document.getElementById('eventFeed').innerHTML = '';
}

async function startSingleLevel() {
  try {
    const gameEngine = await loadEngine();
    gameMode = 'single';
    pendingLevelResult = null;
    const world = currentWorld();
    prepareGameHud('single', world.name, `Level ${profile.level} · ${localLevel() === 5 ? 'Boss' : `Sector ${localLevel()}`}`);
    document.getElementById('gameCoinsLabel').textContent = profile.coins;
    showScreen('game');
    gameEngine.startSingle({
      level: profile.level,
      vehicle: profile.selectedVehicle,
      upgrades: { ...profile.upgrades },
      difficulty: profile.difficulty,
      onHud: updateSingleHud,
      onCoins: (amount, reason) => {
        profile.coins += amount;
        saveProfile();
        document.getElementById('gameCoinsLabel').textContent = profile.coins;
        addFeed(`Collected ${amount} coins${reason ? ` — ${reason}` : ''}.`);
      },
      onPowerup: (event) => showPowerup(event.type, event.vehicle),
      onComplete: handleSingleComplete,
      onGameOver: handleSingleGameOver,
      onEvent: addFeed
    });
  } catch {
    showScreen('campaign');
  }
}

function updateSingleHud(hud) {
  updateCommonHud(hud);
  document.getElementById('scoreLabel').textContent = hud.score;
  document.getElementById('killsLabel').textContent = hud.kills;
  document.getElementById('gameCoinsLabel').textContent = profile.coins;
  document.getElementById('abilityButton').textContent = hud.abilityCooldown > 0 ? `${hud.ability} ${hud.abilityCooldown.toFixed(1)}s` : `${hud.ability} [Q]`;
  document.getElementById('abilityButton').disabled = hud.abilityCooldown > 0;
  if (hud.boss) {
    document.getElementById('bossPanel').classList.remove('hidden');
    document.getElementById('bossLabel').textContent = hud.boss.name;
    document.getElementById('bossHealthText').textContent = `${Math.ceil(hud.boss.health)} / ${hud.boss.maxHealth}`;
    document.getElementById('bossHealthBar').style.width = `${Math.max(0, hud.boss.health / hud.boss.maxHealth * 100)}%`;
  } else {
    document.getElementById('bossPanel').classList.add('hidden');
  }
}

function updateCommonHud(hud) {
  document.getElementById('healthText').textContent = `${Math.ceil(hud.health)} / ${hud.maxHealth}`;
  document.getElementById('healthBar').style.width = `${Math.max(0, hud.health / hud.maxHealth * 100)}%`;
}

function handleSingleComplete(result) {
  if (pendingLevelResult) return;
  pendingLevelResult = result;
  profile.score += result.score;
  profile.kills += result.kills;
  profile.coins += result.reward;
  saveProfile();
  document.getElementById('gameCoinsLabel').textContent = profile.coins;
  document.getElementById('levelCompleteTitle').textContent = result.boss ? `${result.worldName} conquered` : `Level ${profile.level} complete`;
  document.getElementById('levelCompleteText').textContent = `Completion reward: ${result.reward} coins. You destroyed ${result.kills} enemies and earned ${result.score} score.`;
  document.getElementById('levelCompleteOverlay').classList.remove('hidden');
}

function handleSingleGameOver(result) {
  profile.score += result.score;
  profile.kills += result.kills;
  saveProfile();
  document.getElementById('singleGameOverText').textContent = `Level ${profile.level} · ${result.kills} kills · ${result.score} score. Collected coins were retained.`;
  document.getElementById('singleGameOverOverlay').classList.remove('hidden');
}

function showPowerup(type, vehicle) {
  const banner = document.getElementById('powerupBanner');
  banner.textContent = type === 'morph' ? `VEHICLE MORPH — ${VEHICLES[vehicle]?.name || vehicle}` : POWERUP_LABELS[type] || type;
  banner.classList.remove('hidden');
  clearTimeout(showPowerup.timer);
  showPowerup.timer = setTimeout(() => banner.classList.add('hidden'), 2600);
}

function addFeed(text) {
  const feed = document.getElementById('eventFeed');
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.textContent = text;
  feed.prepend(item);
  while (feed.children.length > 5) feed.lastElementChild.remove();
  setTimeout(() => item.remove(), 5000);
}

function showCampaign() {
  gameMode = null;
  pendingLevelResult = null;
  if (engine) engine.stop();
  activeMatchKey = null;
  renderCampaign();
  showScreen('campaign');
}

function resetCampaign() {
  const confirmed = window.confirm('Restart the single-player campaign? Purchased vehicles and upgrades will be kept.');
  if (!confirmed) return;
  profile.level = 1;
  profile.score = 0;
  profile.kills = 0;
  saveProfile();
  renderCampaign();
  showMessage('campaignMessage', 'Campaign restarted at level 1.');
}

async function enterMultiplayerMatch(match, initialSnapshot = null) {
  const matchKey = `${match.roomCode}:${match.seed}`;
  if (activeMatchKey === matchKey && (gameMode === 'multi' || gameMode === 'multi-loading')) {
    if (initialSnapshot && engine && gameMode === 'multi') engine.applyMultiplayerSnapshot(initialSnapshot);
    return;
  }

  activeMatchKey = matchKey;
  gameMode = 'multi-loading';
  const gameEngine = await loadEngine();
  gameMode = 'multi';
  latestSnapshot = initialSnapshot || latestSnapshot || null;
  prepareGameHud('multi', WORLD_NAMES[match.settings.world], `${CHALLENGES[match.settings.challenge]?.name || 'Team Battle'} · Room ${match.roomCode}`);
  showScreen('game');
  gameEngine.startMultiplayer({
    socket,
    match,
    selfId: multiplayerSelfId,
    onHud: updateMultiplayerHud,
    onEvent: addFeed
  });
  if (latestSnapshot) gameEngine.applyMultiplayerSnapshot(latestSnapshot);
}

async function resumeCurrentRoom() {
  if (resumeInFlight || !socketConnected || !multiplayerRoom?.code) return;
  resumeInFlight = true;
  try {
    const response = await emitWithAck('resumeRoom', {
      code: multiplayerRoom.code,
      clientId: MULTIPLAYER_CLIENT_ID
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not restore the room session.');
    multiplayerSelfId = response.selfId;
    multiplayerRoom = response.room;
    if (response.match) {
      await enterMultiplayerMatch(response.match, response.snapshot || null);
    } else if (response.result) {
      gameMode = 'multi';
      showScreen('game');
      showMultiplayerResult(response.result);
    } else {
      activeMatchKey = null;
      gameMode = null;
      showScreen('lobby');
      renderLobby(response.room);
    }
  } catch (error) {
    engine?.releaseAllInputs?.();
    if (gameMode === 'multi') addFeed(error.message);
    else showMessage('lobbyMessage', error.message, true);
  } finally {
    resumeInFlight = false;
  }
}

function setupSocket() {
  if (socket) return socket;
  if (typeof window.io !== 'function') {
    setConnectionStatus('error', 'Socket.IO client did not load. Reload the page.');
    return null;
  }

  socket = window.io({
    autoConnect: false,
    transports: ['websocket', 'polling'],
    rememberUpgrade: true,
    reconnection: true,
    reconnectionAttempts: 12,
    reconnectionDelay: 300,
    reconnectionDelayMax: 1500,
    timeout: 10000
  });

  socket.on('connect', () => {
    socketConnected = true;
    setConnectionStatus('online', 'Connected to multiplayer server');
    if (multiplayerRoom?.code) resumeCurrentRoom();
  });

  socket.on('disconnect', (reason) => {
    socketConnected = false;
    engine?.releaseAllInputs?.();
    setConnectionStatus('offline', `Disconnected: ${reason}`);
    if (gameMode === 'multi') addFeed('Connection interrupted. Controls stopped while reconnecting…');
  });

  socket.on('connect_error', (error) => {
    socketConnected = false;
    setConnectionStatus('error', `Connection failed: ${error.message}`);
    showMessage('homeMessage', 'Could not connect to the multiplayer server. Wait for Render to wake up, then try again.', true);
  });

  socket.on('lobbyState', (room) => {
    if (multiplayerRoom?.code !== room.code && multiplayerRoom) return;
    multiplayerRoom = room;
    if (room.status === 'playing') {
      if (gameMode !== 'multi' && gameMode !== 'multi-loading') resumeCurrentRoom();
      return;
    }
    if (room.status === 'finished' && room.result) {
      gameMode = 'multi';
      showScreen('game');
      showMultiplayerResult(room.result);
      return;
    }
    activeMatchKey = null;
    gameMode = null;
    showScreen('lobby');
    renderLobby(room);
  });

  socket.on('matchStarted', async (match) => {
    try {
      await enterMultiplayerMatch(match);
    } catch (error) {
      activeMatchKey = null;
      gameMode = null;
      showScreen('lobby');
      showMessage('lobbyMessage', `The 3D game engine could not load: ${error.message}`, true);
    }
  });

  socket.on('sessionReplaced', () => {
    engine?.releaseAllInputs?.();
    showMessage('lobbyMessage', 'This player session was opened in another tab or device.', true);
  });

  socket.on('snapshot', (snapshot) => {
    latestSnapshot = snapshot;
    if (engine && gameMode === 'multi') engine.applyMultiplayerSnapshot(snapshot);
  });

  socket.on('powerupCollected', (event) => {
    addFeed(`${event.playerName} collected ${POWERUP_LABELS[event.type] || event.type}.`);
    if (event.playerId === multiplayerSelfId) showPowerup(event.type, event.vehicle);
  });

  socket.on('playerDestroyed', ({ victimId, killerId }) => {
    const victim = latestSnapshot?.players.find((player) => player.id === victimId);
    const killer = latestSnapshot?.players.find((player) => player.id === killerId);
    addFeed(killer ? `${killer.name} destroyed ${victim?.name || 'a player'}.` : `${victim?.name || 'A player'} was destroyed.`);
  });

  socket.on('shockwave', ({ x, z }) => {
    if (engine) engine.createRemoteShockwave(x, z);
  });

  socket.on('matchEnded', (result) => {
    engine?.releaseAllInputs?.();
    showMultiplayerResult(result);
  });

  socket.on('returnedToLobby', (room) => {
    engine?.stop?.();
    activeMatchKey = null;
    gameMode = null;
    multiplayerRoom = room;
    document.getElementById('multiplayerResultOverlay').classList.add('hidden');
    showScreen('lobby');
    renderLobby(room);
  });

  return socket;
}

const WORLD_NAMES = Object.fromEntries(WORLDS.map((world) => [world.id, world.name]));

function setConnectionStatus(status, message) {
  const element = document.getElementById('connectionStatus');
  element.className = `connection-status ${status}`;
  element.querySelector('strong').textContent = message;
  document.getElementById('createRoomButton').disabled = status !== 'online';
  document.getElementById('joinRoomButton').disabled = status !== 'online';
}

function connectSocket() {
  const activeSocket = setupSocket();
  if (!activeSocket) return;
  if (!activeSocket.connected) {
    setConnectionStatus('offline', 'Connecting to multiplayer server…');
    activeSocket.connect();
  }
}

function waitForConnection(timeout = 12000) {
  return new Promise((resolve, reject) => {
    const activeSocket = setupSocket();
    if (!activeSocket) return reject(new Error('Socket.IO is unavailable.'));
    if (activeSocket.connected) return resolve(activeSocket);
    activeSocket.connect();
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The server did not respond. It may still be waking up.'));
    }, timeout);
    const onConnect = () => { cleanup(); resolve(activeSocket); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      clearTimeout(timer);
      activeSocket.off('connect', onConnect);
      activeSocket.off('connect_error', onError);
    };
    activeSocket.once('connect', onConnect);
    activeSocket.once('connect_error', onError);
  });
}

function emitWithAck(event, payload, timeout = 9000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeout).emit(event, payload, (error, response) => {
      if (error) return reject(new Error('The multiplayer server did not answer in time.'));
      resolve(response);
    });
  });
}

function playerName() {
  return document.getElementById('playerName').value.trim() || 'Commander';
}

function renderMultiplayerVehicleGrids() {
  renderVehicleOptions('homeVehicleGrid', selectedGarageVehicle, (key) => {
    selectedGarageVehicle = key;
    renderMultiplayerVehicleGrids();
  });
  renderVehicleOptions('lobbyVehicleGrid', selectedGarageVehicle, async (key) => {
    selectedGarageVehicle = key;
    renderMultiplayerVehicleGrids();
    if (!multiplayerRoom) return;
    try {
      const response = await emitWithAck('setPlayerLoadout', { vehicle: key });
      if (!response?.ok) showMessage('lobbyMessage', 'Vehicle selection failed.', true);
    } catch (error) {
      showMessage('lobbyMessage', error.message, true);
    }
  });
}

async function createRoom() {
  const button = document.getElementById('createRoomButton');
  button.disabled = true;
  button.textContent = 'Creating room…';
  showMessage('homeMessage', 'Connecting and creating a lobby…');
  try {
    await waitForConnection();
    const response = await emitWithAck('createRoom', { name: playerName(), vehicle: selectedGarageVehicle, faction: selectedMultiplayerFaction, clientId: MULTIPLAYER_CLIENT_ID });
    if (!response?.ok) throw new Error(response?.error || 'Could not create room.');
    await enterLobby(response);
  } catch (error) {
    showMessage('homeMessage', error.message, true);
  } finally {
    button.textContent = 'Create online game';
    button.disabled = !socketConnected;
  }
}

async function joinRoom() {
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
  if (!code) return showMessage('homeMessage', 'Enter a room code.', true);
  const button = document.getElementById('joinRoomButton');
  button.disabled = true;
  button.textContent = 'Joining…';
  showMessage('homeMessage', 'Joining multiplayer lobby…');
  try {
    await waitForConnection();
    const response = await emitWithAck('joinRoom', { code, name: playerName(), vehicle: selectedGarageVehicle, faction: selectedMultiplayerFaction, clientId: MULTIPLAYER_CLIENT_ID });
    if (!response?.ok) throw new Error(response?.error || 'Could not join room.');
    await enterLobby(response);
  } catch (error) {
    showMessage('homeMessage', error.message, true);
  } finally {
    button.textContent = 'Join game';
    button.disabled = !socketConnected;
  }
}

async function enterLobby(response) {
  multiplayerSelfId = response.selfId;
  multiplayerRoom = response.room;
  history.replaceState(null, '', `?room=${response.room.code}`);
  if (response.match) {
    await enterMultiplayerMatch(response.match, response.snapshot || null);
    return;
  }
  if (response.result) {
    gameMode = 'multi';
    showScreen('game');
    showMultiplayerResult(response.result);
    return;
  }
  activeMatchKey = null;
  showScreen('lobby');
  renderLobby(response.room);
}

function renderLobby(room) {
  multiplayerRoom = room;
  document.getElementById('roomCodeLabel').textContent = room.code;
  document.getElementById('playerCountLabel').textContent = `${room.players.length} / ${room.maxPlayers}`;
  document.getElementById('worldSelect').value = room.settings.world;
  document.getElementById('challengeSelect').value = room.settings.challenge || 'team_deathmatch';
  document.getElementById('durationSelect').value = String(room.settings.durationSeconds || 300);
  document.getElementById('challengeDescription').textContent = CHALLENGES[room.settings.challenge]?.description || CHALLENGES.team_deathmatch.description;

  const isLeader = room.leaderId === multiplayerSelfId;
  document.getElementById('leaderSettings').classList.toggle('hidden', !isLeader);
  document.getElementById('startMatchButton').classList.toggle('hidden', !isLeader);
  const self = room.players.find((player) => player.id === multiplayerSelfId);
  if (self) {
    selectedGarageVehicle = self.vehicle;
    selectedMultiplayerFaction = self.faction || 'iron';
  }
  document.getElementById('playerFactionSelect').value = selectedMultiplayerFaction;
  renderMultiplayerVehicleGrids();

  const list = document.getElementById('lobbyPlayerList');
  list.innerHTML = '';
  room.players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.dataset.faction = player.faction || 'iron';
    const stateLabel = player.connected === false ? 'RECONNECTING' : player.id === room.leaderId ? 'LEADER' : 'READY';
    row.classList.toggle('disconnected', player.connected === false);
    row.innerHTML = `<div class="player-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</div><div><strong>${escapeHtml(player.name)}</strong><br><small>${VEHICLES[player.vehicle]?.name || player.vehicle}</small><br><small class="faction-name">${FACTIONS[player.faction] || player.faction}</small></div><span>${stateLabel}</span>`;
    list.appendChild(row);
  });
  showMessage('lobbyMessage', isLeader ? 'Choose the world, challenge and time limit. Every player chooses their own faction.' : 'Choose your faction and vehicle, then wait for the lobby leader.');
}

function sendLobbySettings() {
  if (!multiplayerRoom || multiplayerRoom.leaderId !== multiplayerSelfId) return;
  socket.emit('setLobbySettings', {
    world: document.getElementById('worldSelect').value,
    challenge: document.getElementById('challengeSelect').value,
    durationSeconds: Number(document.getElementById('durationSelect').value)
  });
}

async function sendPlayerFaction() {
  selectedMultiplayerFaction = document.getElementById('playerFactionSelect').value;
  if (!multiplayerRoom) return;
  try {
    const response = await emitWithAck('setPlayerLoadout', { faction: selectedMultiplayerFaction });
    if (!response?.ok) showMessage('lobbyMessage', response?.error || 'Faction selection failed.', true);
  } catch (error) {
    showMessage('lobbyMessage', error.message, true);
  }
}

function formatMatchTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateMultiplayerHud(hud) {
  updateCommonHud(hud);
  document.getElementById('killsLabel').textContent = hud.kills;
  document.getElementById('deathsLabel').textContent = hud.deaths;
  document.getElementById('scoreLabel').textContent = hud.score;
  document.getElementById('matchTimerLabel').textContent = formatMatchTime(hud.remainingMs);
  const challengeName = CHALLENGES[hud.challenge]?.name || 'Team Battle';
  const latency = Number.isFinite(hud.latencyMs) && hud.latencyMs > 0 ? ` · ${hud.latencyMs} ms` : '';
  document.getElementById('challengeHudLabel').textContent = `${challengeName}${latency}`;
  document.getElementById('respawnOverlay').classList.toggle('hidden', !hud.dead);
  document.getElementById('abilityButton').textContent = hud.abilityCooldown > 0 ? `${hud.ability} ${hud.abilityCooldown.toFixed(1)}s` : `${hud.ability} [Q]`;
  document.getElementById('abilityButton').disabled = hud.dead || hud.abilityCooldown > 0;

  const roster = document.getElementById('gamePlayerList');
  roster.innerHTML = '';
  hud.players.forEach((player) => {
    const row = document.createElement('div');
    row.className = `roster-row${player.id === multiplayerSelfId ? ' me' : ''}${player.dead ? ' dead' : ''}`;
    row.innerHTML = `<span>${escapeHtml(player.name)} · ${FACTIONS[player.faction] || player.faction}</span><span>${player.kills}/${player.deaths} · ${VEHICLES[player.vehicle]?.short || player.vehicle}</span>`;
    roster.appendChild(row);
  });

  const teamPanel = document.getElementById('teamScorePanel');
  teamPanel.innerHTML = '';
  Object.entries(hud.teamScores || {}).sort((a, b) => b[1] - a[1]).forEach(([faction, score]) => {
    const row = document.createElement('div');
    row.className = `team-score-row${faction === hud.faction ? ' me' : ''}`;
    row.style.borderLeft = `3px solid ${FACTION_COLORS[faction] || '#8fbfff'}`;
    row.innerHTML = `<span>${FACTIONS[faction] || faction}</span><strong>${Math.floor(score)}</strong>`;
    teamPanel.appendChild(row);
  });

  const objective = document.getElementById('objectivePanel');
  if (hud.challenge === 'control_zone') {
    const controller = hud.objective?.controlFaction;
    objective.textContent = controller ? `${FACTIONS[controller] || controller} controls the central zone` : 'Central zone is neutral or contested';
  } else if (hud.challenge === 'salvage_rush') {
    objective.textContent = 'Collect power-ups to score faction points';
  } else {
    objective.textContent = 'Destroy enemy faction vehicles';
  }
}

function showMultiplayerResult(result) {
  if (!result) return;
  engine?.releaseAllInputs?.();
  document.getElementById('multiplayerResultOverlay').classList.remove('hidden');
  const winners = result.winningFactions || [];
  document.getElementById('matchResultTitle').textContent = winners.length === 1 ? `${FACTIONS[winners[0]] || winners[0]} wins` : 'Match draw';
  document.getElementById('matchResultSubtitle').textContent = `${result.challengeName || 'Timed match'} ended when the time limit reached.`;

  const teams = document.getElementById('matchTeamScores');
  teams.innerHTML = '';
  Object.entries(result.teamScores || {}).sort((a, b) => b[1] - a[1]).forEach(([faction, score]) => {
    const row = document.createElement('div');
    row.className = `result-team${winners.includes(faction) ? ' winner' : ''}`;
    row.innerHTML = `<span>${FACTIONS[faction] || faction}</span><strong>${Math.floor(score)} pts</strong>`;
    teams.appendChild(row);
  });

  const leaderboard = document.getElementById('matchLeaderboard');
  leaderboard.innerHTML = '';
  (result.leaderboard || []).forEach((player, index) => {
    const row = document.createElement('div');
    row.className = 'result-player-row';
    row.innerHTML = `<strong>${index + 1}</strong><span>${escapeHtml(player.name)}<br><small>${FACTIONS[player.faction] || player.faction} · ${VEHICLES[player.vehicle]?.short || player.vehicle}</small></span><span>${player.kills} K · ${player.objectiveScore || 0} OBJ</span>`;
    leaderboard.appendChild(row);
  });

  const isLeader = multiplayerRoom?.leaderId === multiplayerSelfId;
  document.getElementById('returnLobbyButton').classList.toggle('hidden', !isLeader);
  document.getElementById('waitForLeaderButton').classList.toggle('hidden', isLeader);
}

function leaveCurrentGame() {
  if (engine) engine.stop();
  activeMatchKey = null;
  document.getElementById('pauseOverlay').classList.add('hidden');
  document.getElementById('levelCompleteOverlay').classList.add('hidden');
  document.getElementById('singleGameOverOverlay').classList.add('hidden');
  document.getElementById('multiplayerResultOverlay').classList.add('hidden');
  if (gameMode === 'multi') {
    socket?.emit('leaveRoom');
    multiplayerRoom = null;
    latestSnapshot = null;
    history.replaceState(null, '', location.pathname);
    gameMode = null;
    showScreen('multiplayer');
    connectSocket();
  } else {
    showCampaign();
  }
}

// Navigation

document.getElementById('singlePlayerButton').addEventListener('click', () => { renderCampaign(); showScreen('campaign'); });
document.getElementById('multiplayerButton').addEventListener('click', () => { selectedGarageVehicle = profile.selectedVehicle; renderMultiplayerVehicleGrids(); showScreen('multiplayer'); connectSocket(); });
document.querySelectorAll('.backToModes').forEach((button) => button.addEventListener('click', () => { if (socket && multiplayerRoom) socket.emit('leaveRoom'); multiplayerRoom = null; history.replaceState(null, '', location.pathname); showScreen('modes'); }));

document.getElementById('continueCampaignButton').addEventListener('click', startSingleLevel);
document.getElementById('newCampaignButton').addEventListener('click', resetCampaign);
document.getElementById('campaignGarageButton').addEventListener('click', () => { selectedGarageVehicle = profile.selectedVehicle; renderGarage(); showScreen('garage'); });
document.getElementById('closeGarageButton').addEventListener('click', () => { renderCampaign(); showScreen('campaign'); });
document.getElementById('campaignArmoryButton').addEventListener('click', () => { armoryReturn = 'campaign'; renderArmory(); showScreen('armory'); });
document.getElementById('campaignWorldMapButton').addEventListener('click', () => { renderWorldMap(); showScreen('worldMap'); });
document.getElementById('closeWorldMapButton').addEventListener('click', () => { renderCampaign(); showScreen('campaign'); });

document.getElementById('garageVehicleAction').addEventListener('click', () => {
  const vehicle = VEHICLES[selectedGarageVehicle];
  if (!profile.owned.includes(selectedGarageVehicle)) {
    if (profile.coins < vehicle.cost) return showMessage('garageMessage', `You need ${vehicle.cost - profile.coins} more coins.`, true);
    profile.coins -= vehicle.cost;
    profile.owned.push(selectedGarageVehicle);
  }
  profile.selectedVehicle = selectedGarageVehicle;
  saveProfile();
  renderGarage();
  renderCampaign();
  showMessage('garageMessage', `${vehicle.name} equipped.`);
});

document.getElementById('closeArmoryButton').addEventListener('click', () => {
  if (armoryReturn === 'complete') {
    showScreen('game');
    document.getElementById('levelCompleteOverlay').classList.remove('hidden');
  } else {
    renderCampaign();
    showScreen('campaign');
  }
});

document.getElementById('betweenLevelArmoryButton').addEventListener('click', () => {
  armoryReturn = 'complete';
  renderArmory();
  showScreen('armory');
});

document.getElementById('nextLevelButton').addEventListener('click', () => {
  if (!pendingLevelResult) return;
  profile.level += 1;
  saveProfile();
  pendingLevelResult = null;
  document.getElementById('levelCompleteOverlay').classList.add('hidden');
  startSingleLevel();
});

document.getElementById('completeExitButton').addEventListener('click', showCampaign);
document.getElementById('retryLevelButton').addEventListener('click', () => { document.getElementById('singleGameOverOverlay').classList.add('hidden'); startSingleLevel(); });
document.getElementById('gameOverExitButton').addEventListener('click', showCampaign);

// Multiplayer controls

document.getElementById('createRoomButton').addEventListener('click', createRoom);
document.getElementById('joinRoomButton').addEventListener('click', joinRoom);
document.getElementById('roomCodeInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
document.getElementById('worldSelect').addEventListener('change', sendLobbySettings);
document.getElementById('challengeSelect').addEventListener('change', () => {
  document.getElementById('challengeDescription').textContent = CHALLENGES[document.getElementById('challengeSelect').value]?.description || '';
  sendLobbySettings();
});
document.getElementById('durationSelect').addEventListener('change', sendLobbySettings);
document.getElementById('playerFactionSelect').addEventListener('change', sendPlayerFaction);
document.getElementById('startMatchButton').addEventListener('click', async () => {
  try {
    const response = await emitWithAck('startMatch', {});
    if (!response?.ok) showMessage('lobbyMessage', response?.error || 'Could not start match.', true);
    else if (response.match) await enterMultiplayerMatch(response.match, response.snapshot || null);
  } catch (error) {
    showMessage('lobbyMessage', error.message, true);
  }
});
document.getElementById('copyInviteButton').addEventListener('click', async () => {
  if (!multiplayerRoom) return;
  const url = `${location.origin}${location.pathname}?room=${multiplayerRoom.code}`;
  try { await navigator.clipboard.writeText(url); showMessage('lobbyMessage', 'Invite URL copied.'); }
  catch { showMessage('lobbyMessage', url); }
});
document.getElementById('leaveLobbyButton').addEventListener('click', () => {
  socket?.emit('leaveRoom');
  multiplayerRoom = null;
  multiplayerSelfId = null;
  activeMatchKey = null;
  history.replaceState(null, '', location.pathname);
  showScreen('multiplayer');
});


document.getElementById('returnLobbyButton').addEventListener('click', async () => {
  try {
    const response = await emitWithAck('returnToLobby', {});
    if (!response?.ok) showMessage('lobbyMessage', response?.error || 'Could not return to lobby.', true);
  } catch (error) {
    addFeed(error.message);
  }
});
document.getElementById('resultLeaveButton').addEventListener('click', leaveCurrentGame);

// Shared in-game controls

document.getElementById('cameraToggleButton').addEventListener('click', () => {
  if (!engine) return;
  const cameraMode = engine.toggleCamera();
  document.getElementById('cameraToggleButton').textContent = cameraMode === '3d' ? '2D camera' : '3D camera';
});
document.getElementById('abilityButton').addEventListener('click', () => engine?.activateAbility());
document.getElementById('mobileAbilityButton').addEventListener('click', () => engine?.activateAbility());
document.getElementById('pauseGameButton').addEventListener('click', () => {
  if (gameMode !== 'single' || !engine) return;
  engine.setPaused(true);
  document.getElementById('pauseOverlay').classList.remove('hidden');
});
document.getElementById('resumeGameButton').addEventListener('click', () => {
  engine?.setPaused(false);
  document.getElementById('pauseOverlay').classList.add('hidden');
});
document.getElementById('pauseExitButton').addEventListener('click', leaveCurrentGame);
document.getElementById('leaveMatchButton').addEventListener('click', leaveCurrentGame);

document.querySelectorAll('[data-touch]').forEach((button) => {
  const control = button.dataset.touch;
  const activeSources = new Map();
  const start = (event) => {
    event.preventDefault();
    const source = `touch:${control}:${event.pointerId}`;
    activeSources.set(event.pointerId, source);
    engine?.setInput(control, true, source);
    button.setPointerCapture?.(event.pointerId);
  };
  const end = (event) => {
    event.preventDefault();
    const source = activeSources.get(event.pointerId);
    if (source) engine?.releaseInputSource?.(source);
    activeSources.delete(event.pointerId);
  };
  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', end);
  button.addEventListener('pointercancel', end);
  button.addEventListener('lostpointercapture', end);
});

const mobileFire = document.getElementById('mobileFireButton');
const mobileFireSources = new Map();
mobileFire.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const source = `touch:fire:${event.pointerId}`;
  mobileFireSources.set(event.pointerId, source);
  engine?.setInput('fire', true, source);
  mobileFire.setPointerCapture?.(event.pointerId);
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((eventName) => mobileFire.addEventListener(eventName, (event) => {
  event.preventDefault();
  const source = mobileFireSources.get(event.pointerId);
  if (source) engine?.releaseInputSource?.(source);
  mobileFireSources.delete(event.pointerId);
}));

document.getElementById('reloadButton').addEventListener('click', () => location.reload());

const roomQuery = new URLSearchParams(location.search).get('room');
if (roomQuery) {
  document.getElementById('roomCodeInput').value = roomQuery.toUpperCase().slice(0, 5);
}

renderCampaign();
renderGarage();
renderArmory();
renderWorldMap();
renderMultiplayerVehicleGrids();
setConnectionStatus('offline', 'Open Multiplayer to connect');

if (roomQuery) {
  selectedGarageVehicle = profile.selectedVehicle;
  renderMultiplayerVehicleGrids();
  showScreen('multiplayer');
  connectSocket();
  showMessage('homeMessage', `Invite detected for room ${roomQuery.toUpperCase().slice(0, 5)}. Enter your name and press Join game.`);
}
