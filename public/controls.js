'use strict';

const ACTION_CODES = Object.freeze({
  forward: new Set(['KeyW', 'ArrowUp']),
  backward: new Set(['KeyS', 'ArrowDown']),
  left: new Set(['KeyA', 'ArrowLeft']),
  right: new Set(['KeyD', 'ArrowRight']),
  fire: new Set(['Space'])
});

const ALL_CODES = new Set(Object.values(ACTION_CODES).flatMap((codes) => [...codes]));

function isEditableTarget(target) {
  return target instanceof HTMLElement && (
    target.matches('input, textarea, select, button, a') ||
    target.isContentEditable
  );
}

function axis(positive, negative) {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}

class ControlSystem {
  constructor() {
    this.keyboard = new Set();
    this.external = new Map();
    this.sequence = 0;
    this.attached = false;
    this.enabled = () => false;
    this.onAbility = () => {};
    this.onCamera = () => {};
    this.onChange = () => {};
    this.previousStateKey = '';
  }

  attach({ isEnabled, onAbility, onCamera, onChange } = {}) {
    if (typeof isEnabled === 'function') this.enabled = isEnabled;
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
    if (!this.enabled() || isEditableTarget(event.target)) return;

    if (ALL_CODES.has(event.code)) {
      event.preventDefault();
      if (!this.keyboard.has(event.code)) {
        this.keyboard.add(event.code);
        this.emitIfChanged();
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
    if (!ALL_CODES.has(event.code)) return;
    event.preventDefault();
    if (this.keyboard.delete(event.code)) this.emitIfChanged();
  }

  actionActive(action) {
    const codes = ACTION_CODES[action];
    if (codes && [...codes].some((code) => this.keyboard.has(code))) return true;
    const externalSources = this.external.get(action);
    return Boolean(externalSources && externalSources.size > 0);
  }

  snapshot() {
    const forward = this.actionActive('forward');
    const backward = this.actionActive('backward');
    const left = this.actionActive('left');
    const right = this.actionActive('right');
    const fire = this.actionActive('fire');

    return Object.freeze({
      forward,
      backward,
      left,
      right,
      fire,
      throttle: axis(forward, backward),
      steer: axis(right, left)
    });
  }

  packet() {
    const state = this.snapshot();
    return {
      sequence: this.sequence,
      throttle: state.throttle,
      steer: state.steer,
      fire: state.fire,
      clientTime: performance.now()
    };
  }

  set(action, active, source = `external:${action}`) {
    if (!Object.hasOwn(ACTION_CODES, action)) return;
    let sources = this.external.get(action);
    if (!sources) {
      sources = new Set();
      this.external.set(action, sources);
    }
    const changed = active ? !sources.has(source) : sources.has(source);
    if (active) sources.add(source);
    else sources.delete(source);
    if (sources.size === 0) this.external.delete(action);
    if (changed) this.emitIfChanged();
  }

  releaseSource(source) {
    let changed = false;
    for (const [action, sources] of this.external) {
      if (sources.delete(source)) changed = true;
      if (sources.size === 0) this.external.delete(action);
    }
    if (changed) this.emitIfChanged();
  }

  reset() {
    const hadInput = this.keyboard.size > 0 || this.external.size > 0;
    this.keyboard.clear();
    this.external.clear();
    if (hadInput) this.emitIfChanged(true);
  }

  emitIfChanged(force = false) {
    const state = this.snapshot();
    const key = `${state.throttle}|${state.steer}|${state.fire ? 1 : 0}`;
    if (!force && key === this.previousStateKey) return;
    this.previousStateKey = key;
    this.sequence += 1;
    this.onChange(this.packet());
  }

  networkPacket() {
    return this.packet();
  }
}

export const controls = new ControlSystem();
