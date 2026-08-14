// ---------------------------------------------------------------------
// Spider-Man mascot — a small animated 3D figure that swings between
// note cards in the "All notes" list when the Spider-Man palette is
// active. Purely cosmetic; it never touches app state.
// ---------------------------------------------------------------------
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const SIZE = 52; // px footprint of the mascot's little canvas
const IDLE_PATROL_MS = 3200;

export class SpiderManMascot {
  /**
   * @param {HTMLElement} scrollContainer - the element that actually scrolls
   *   and holds the note cards (#note-list). Its innerHTML gets wiped and
   *   rebuilt on every render, so the mascot must NOT live inside it.
   * @param {string} itemSelector - selector for note cards within scrollContainer.
   * @param {() => boolean} isEnabled - whether the mascot should be visible right now.
   */
  constructor({ scrollContainer, itemSelector = '.note-card', isEnabled }) {
    this.scrollContainer = scrollContainer;
    // Mount on the stable parent pane so re-renders of scrollContainer's
    // innerHTML (which happen on every list refresh) never destroy the mascot.
    this.mountParent = scrollContainer.parentElement;
    this.itemSelector = itemSelector;
    this.isEnabled = isEnabled; // () => boolean

    this.items = [];
    this.currentIndex = 0;
    this.rafId = null;
    this.swingRafId = null;
    this.patrolTimer = null;
    this.visible = false;

    this._buildDom();
    this._buildScene();
    this._bindEvents();
    this._loop();
  }

  _buildDom() {
    this.root = document.createElement('div');
    this.root.className = 'spiderman-mascot';
    Object.assign(this.root.style, {
      position: 'absolute',
      width: SIZE + 'px',
      height: SIZE + 'px',
      pointerEvents: 'none',
      zIndex: '30',
      opacity: '0',
      overflow: 'visible',
      transition: 'opacity 0.25s ease',
      transform: 'translate(-9999px,-9999px)',
    });
    if (getComputedStyle(this.mountParent).position === 'static') {
      this.mountParent.style.position = 'relative';
    }
    this.mountParent.appendChild(this.root);
  }

  _buildScene() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(SIZE, SIZE);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.root.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0.4, 4.2);
    this.camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    this.figure = this._buildFigure();
    this.scene.add(this.figure);
  }

  _buildFigure() {
    const group = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xe2262f, roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x1b3a8c, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.4 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), red);
    head.position.y = 0.9;
    group.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
    const eyeL = new THREE.Mesh(eyeGeo, white);
    eyeL.position.set(-0.12, 0.95, 0.27);
    eyeL.scale.set(1, 1.4, 0.6);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.12;
    group.add(eyeL, eyeR);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 12), blue);
    torso.position.y = 0.4;
    group.add(torso);

    const chestWeb = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), black);
    chestWeb.position.set(0, 0.45, 0.24);
    group.add(chestWeb);

    const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8);
    armGeo.translate(0, -0.25, 0);
    this.armL = new THREE.Mesh(armGeo, red);
    this.armL.position.set(-0.34, 0.6, 0);
    this.armR = this.armL.clone();
    this.armR.position.x = 0.34;
    group.add(this.armL, this.armR);

    const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.55, 8);
    legGeo.translate(0, -0.275, 0);
    this.legL = new THREE.Mesh(legGeo, blue);
    this.legL.position.set(-0.14, 0.12, 0);
    this.legR = this.legL.clone();
    this.legR.position.x = 0.14;
    group.add(this.legL, this.legR);

    group.scale.setScalar(0.82);
    return group;
  }

  /** Call after every renderNoteList() / renderNoteCardsInto() so the
   * mascot re-reads the current card positions. */
  refresh() {
    const active = !!(this.isEnabled && this.isEnabled());
    this.items = active ? Array.from(this.scrollContainer.querySelectorAll(this.itemSelector)) : [];

    if (!active || this.items.length === 0) {
      this.visible = false;
      this.root.style.opacity = '0';
      clearInterval(this.patrolTimer);
      return;
    }

    if (this.currentIndex >= this.items.length) this.currentIndex = 0;
    this.visible = true;
    this._snapTo(this.currentIndex);
    this._resetPatrolTimer();
  }

  _rectFor(index) {
    const el = this.items[index];
    if (!el) return null;
    const itemRect = el.getBoundingClientRect();
    const anchorRect = this.mountParent.getBoundingClientRect();
    return {
      left: itemRect.right - anchorRect.left - SIZE * 0.55,
      top: itemRect.top - anchorRect.top + itemRect.height / 2 - SIZE / 2,
    };
  }

  /** Is the given note card actually within the scrollable list's visible viewport
   * right now? Used to hide the mascot when its target has scrolled off-screen,
   * since it's mounted outside the clipping/overflow of #note-list itself. */
  _isItemInViewport(index) {
    const el = this.items[index];
    if (!el) return false;
    const itemRect = el.getBoundingClientRect();
    const viewport = this.scrollContainer.getBoundingClientRect();
    return itemRect.bottom > viewport.top && itemRect.top < viewport.bottom;
  }

  _snapTo(index) {
    const pos = this._rectFor(index);
    if (!pos) return;
    this.root.style.transform = `translate(${pos.left}px, ${pos.top}px)`;
    this.root.style.opacity = this._isItemInViewport(index) ? '1' : '0';
  }

  goToNote(index) {
    if (!this.visible || index < 0 || index >= this.items.length || index === this.currentIndex) return;
    const from = this._rectFor(this.currentIndex);
    const to = this._rectFor(index);
    if (!from || !to) return;
    this.currentIndex = index;

    cancelAnimationFrame(this.swingRafId);
    const duration = 420;
    const start = performance.now();
    const arcHeight = 24;

    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const x = from.left + (to.left - from.left) * ease;
      const y = from.top + (to.top - from.top) * ease - Math.sin(t * Math.PI) * arcHeight;
      const tilt = Math.sin(t * Math.PI) * 0.5 * (to.top >= from.top ? 1 : -1);

      this.root.style.transform = `translate(${x}px, ${y}px)`;
      this.root.style.opacity = this._isItemInViewport(index) ? '1' : '0';
      this.figure.rotation.z = tilt;
      this.figure.position.y = Math.sin(t * Math.PI) * 0.15;

      if (t < 1) {
        this.swingRafId = requestAnimationFrame(step);
      } else {
        this.figure.rotation.z = 0;
        this.figure.position.y = 0;
      }
    };
    this.swingRafId = requestAnimationFrame(step);
  }

  _bindEvents() {
    this._onHover = (e) => {
      if (!this.visible) return;
      const el = e.target.closest?.(this.itemSelector);
      if (!el) return;
      const idx = this.items.indexOf(el);
      if (idx !== -1) {
        this.goToNote(idx);
        this._resetPatrolTimer();
      }
    };
    this.scrollContainer.addEventListener('mouseover', this._onHover);

    this._onReposition = () => { if (this.visible) this._snapTo(this.currentIndex); };
    this.scrollContainer.addEventListener('scroll', this._onReposition, { passive: true });
    window.addEventListener('resize', this._onReposition);
  }

  _resetPatrolTimer() {
    clearInterval(this.patrolTimer);
    this.patrolTimer = setInterval(() => {
      if (!this.visible || this.items.length < 2) return;
      this.goToNote((this.currentIndex + 1) % this.items.length);
    }, IDLE_PATROL_MS);
  }

  _loop() {
    const tick = () => {
      if (this.visible) {
        const t = performance.now() / 1000;
        this.legL.rotation.x = Math.sin(t * 4) * 0.4;
        this.legR.rotation.x = -Math.sin(t * 4) * 0.4;
        this.armL.rotation.x = -Math.sin(t * 3) * 0.25;
        this.armR.rotation.x = Math.sin(t * 3) * 0.25;
        this.figure.rotation.y = Math.sin(t * 1.5) * 0.25;
        this.renderer.render(this.scene, this.camera);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    cancelAnimationFrame(this.swingRafId);
    clearInterval(this.patrolTimer);
    this.scrollContainer.removeEventListener('mouseover', this._onHover);
    this.scrollContainer.removeEventListener('scroll', this._onReposition);
    window.removeEventListener('resize', this._onReposition);
    this.renderer.dispose();
    this.root.remove();
  }
}
