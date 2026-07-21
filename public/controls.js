'use strict';

const ACTIONS = Object.freeze(['forward', 'backward', 'left', 'right', 'fire']);
const KEY_BINDINGS = Object.freeze({
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'fire'
});

function shouldIgnoreTarget(target) {
  return target instanceof HTMLElement && (
    target.matches('input, textarea, select, button, a') ||
    target.isContentEditable
  );
}

class ControlSystem {
  constructor() {
    this.sources = new Map(ACTIONS.map((action) => [action, new Set()]));
    this.keyboardSources = new Map();
    this.sequence = 0;
    this.attached = false;
    this.isEnabled = () => false;
    this.onAbility = () => {};
    this.onCamera = () => {};
    this.onChange = () => {};
    this.lastPacket = this.packet();
  }

  attach({ isEnabled, onAbility, onCamera, onChange } = {}) {
    if (typeof isEnabled === 'function') this.isEnabled = isEnabled;
    if (typeof onAbility === 'function') this.onAbility = onAbility;
    if (typeof onCamera === 'function') this.onCamera = onCamera;
    if (typeof onChange === 'function') this.onChange = onChange;
    if (this.attached) return;
    this.attached = true;

    window.addEventListener('keydown', (event) => this.handleKeyDown(event), { passive: false });
    window.addEventListener('keyup', (event) => this.handleKeyUp(event), { passive: false });
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('pagehide', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
  }

  handleKeyDown(event) {
    if (!this.isEnabled() || shouldIgnoreTarget(event.target)) return;
    const action = KEY_BINDINGS[event.code];
    if (action) {
      event.preventDefault();
      if (!this.keyboardSources.has(event.code)) {
        const source = `keyboard:${event.code}`;
        this.keyboardSources.set(event.code, source);
        this.set(action, true, source);
      }
      return;
    }
    if (!event.repeat && event.code === 'KeyQ') {
      event.preventDefault();
      this.onAbility();
    } else if (!event.repeat && event.code === 'KeyC') {
      event.preventDefault();
      this.onCamera();
    }
  }

  handleKeyUp(event) {
    const action = KEY_BINDINGS[event.code];
    if (!action) return;
    event.preventDefault();
    const source = this.keyboardSources.get(event.code) || `keyboard:${event.code}`;
    this.keyboardSources.delete(event.code);
    this.set(action, false, source);
  }

  set(action, active, source = `external:${action}`) {
    if (!this.sources.has(action)) return;
    const activeSources = this.sources.get(action);
    const before = activeSources.size > 0;
    if (active) activeSources.add(source);
    else activeSources.delete(source);
    const after = activeSources.size > 0;
    if (before !== after) this.emitChange();
  }

  releaseSource(source) {
    let changed = false;
    for (const activeSources of this.sources.values()) {
      const before = activeSources.size;
      activeSources.delete(source);
      changed = changed || before !== activeSources.size;
    }
    if (changed) this.emitChange();
  }

  reset() {
    let changed = false;
    for (const activeSources of this.sources.values()) {
      changed = changed || activeSources.size > 0;
      activeSources.clear();
    }
    this.keyboardSources.clear();
    if (changed) this.emitChange();
  }

  snapshot() {
    const forward = this.sources.get('forward').size > 0;
    const backward = this.sources.get('backward').size > 0;
    const left = this.sources.get('left').size > 0;
    const right = this.sources.get('right').size > 0;
    return Object.freeze({
      forward,
      backward,
      left,
      right,
      fire: this.sources.get('fire').size > 0,
      move: (forward ? 1 : 0) - (backward ? 1 : 0),
      turn: (right ? 1 : 0) - (left ? 1 : 0)
    });
  }

  packet() {
    const state = this.snapshot();
    return {
      sequence: this.sequence,
      move: state.move,
      turn: state.turn,
      fire: state.fire
    };
  }

  emitChange() {
    this.sequence += 1;
    this.lastPacket = this.packet();
    this.onChange(this.lastPacket);
  }

  networkPacket() {
    return { ...this.lastPacket };
  }
}

export const controls = new ControlSystem();
