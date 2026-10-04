import * as THREE from 'three';
import type { ToolId, BuildingParams, TreeType, PlaceableKind, PlacedRecord, ZoneType } from '../types';
import { TOTAL, roadCenter, GRID, BLOCK, blockOrigin, COSTS, costBuilding, refundOf, ZONE_COLORS, ZONE_STYLES, ZONE_NAMES, TOOL_NAMES } from '../types';
import { Engine } from '../core/Engine';
import { InputManager } from '../core/InputManager';
import { CitySystem } from './CitySystem';
import { buildTrainModel, GAP, type RailLoop } from '../entities/Train';
import type { Person } from '../entities/Person';
import type { Animal } from '../entities/Animal';
import { snapToGrid } from '../utils/math';

const PROP_TOOLS: ToolId[] = [
  'tree', 'bush', 'grass', 'flower', 'bench', 'lamp', 'fountain',
  'hospital', 'grocery', 'playground', 'busStop', 'firestation', 'police',
  'dog', 'cat', 'duck', 'cow', 'snowman',
];

/**
 * Tool-based placement: choose a tool, ghost-preview with the cursor,
 * click to place, bulldoze to remove. The select tool picks placed objects
 * up (click), carries them to the cursor (R / Shift+drag rotates) and drops
 * them with a second click; Esc/right-click puts everything back.
 */
export class BuildSystem {
  tool: ToolId = 'building';
  params: BuildingParams = { style: 'concrete', floors: 5, width: 11, depth: 12, variant: 0 };
  treeType: TreeType = 'oak';
  zoneType: ZoneType = 1;
  rotY = 0;
  /** Shop → Sell tab: clicking any placed object resells it for cash */
  sellMode = false;

  private engine: Engine;
  private input: InputManager;
  private city: CitySystem;

  private ghost: THREE.Object3D | null = null;
  private ghostKey = '';
  private ghostValid = false;

  private lotIndex: number | null = null;
  private freeMode = false;
  private carInfo: { axis: 'x' | 'z'; dir: 1 | -1; lane: number; start: number } | null = null;
  private railSnap: { s: number; x: number; z: number } | null = null;

  // select & move
  private selected: THREE.Object3D | null = null;
  private holding = false;
  private origPos = new THREE.Vector3();
  private origRot = 0;
  private origLot: number | null = null;
  private selBox: THREE.BoxHelper | null = null;

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private point = new THREE.Vector3();

  constructor(engine: Engine, input: InputManager, city: CitySystem) {
    this.engine = engine;
    this.input = input;
    this.city = city;

    input.onPlace = () => this.tryPlace();
    input.onCancel = (src) => {
      // Esc with nothing in flight pauses the game (right-click never does)
      if (!this.cancel() && src === 'key') this.engine.emit('pauseRequested', { source: 'esc' });
    };
    input.onRotate = () => {
      this.rotY += Math.PI / 2;
    };
    // Shift + left-drag: smooth mouse rotation to fine-tune placement angle
    input.onRotateDelta = (dx) => {
      this.rotY += dx * 0.01;
    };
  }

  setTool(t: ToolId): void {
    this.sellMode = false; // picking a tool always leaves resell mode
    if (this.tool === 'select' && t !== 'select') this.deselect(true);
    if (this.tool === 'zone' && t !== 'zone') this.city.showZoneOverlay(false);
    this.tool = t;
    this.rotY = 0;
    this.invalidateGhost();
    if (t === 'select') this.hideGhost(); // select never shows a placement ghost
    if (t === 'zone') this.city.showZoneOverlay(true);
  }

  /** Esc/right-click: undo whatever is in flight — true when something was */
  private cancel(): boolean {
    if (this.sellMode) {
      this.exitSellMode();
      this.engine.emit('notice', { message: '💰 Resell mode off' });
      return true;
    }
    if (this.tool === 'select') {
      if (!this.selected) return false;
      this.deselect(true);
      return true;
    }
    const wasShown = !!this.ghost?.visible;
    this.hideGhost();
    return wasShown;
  }

  setParams(p: Partial<BuildingParams>): void {
    Object.assign(this.params, p);
    this.invalidateGhost();
  }

  rotateGhost(): void {
    this.rotY += Math.PI / 2;
  }

  private invalidateGhost(): void {
    this.ghostKey = '';
  }

  private hideGhost(): void {
    if (this.ghost) this.ghost.visible = false;
    this.ghostValid = false;
    this.lotIndex = null;
    this.freeMode = false;
    this.carInfo = null;
    this.railSnap = null;
  }

  private disposeGhost(): void {
    if (!this.ghost) return;
    this.engine.scene.remove(this.ghost);
    this.ghost.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) mat.dispose();
      }
    });
    this.ghost = null;
    this.ghostKey = '';
  }

  private ensureGhost(key: string, make: () => THREE.Object3D): void {
    if (this.ghost && this.ghostKey === key) {
      this.ghost.visible = true;
      return;
    }
    this.disposeGhost();
    this.ghost = make();
    this.engine.scene.add(this.ghost);
    this.ghostKey = key;
    this.ghost.visible = true;
  }

  /** Clone-tint an object for use as a ghost preview */
  private tint(root: THREE.Object3D): THREE.Object3D {
    const green = new THREE.Color('#4ade80');
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const src = m.material as THREE.Material;
        const mat = src.clone() as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.6;
        if ((mat as unknown as { color?: THREE.Color }).color) {
          (mat as unknown as { color: THREE.Color }).color.lerp(green, 0.45);
        }
        m.material = mat;
        m.castShadow = false;
      }
    });
    return root;
  }

  /** Surface height under a point: sidewalk/block = 0.16, road = 0.02 */
  private surfaceY(x: number, z: number): number {
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const bx = blockOrigin(i);
        const bz = blockOrigin(j);
        if (x >= bx && x <= bx + BLOCK && z >= bz && z <= bz + BLOCK) return 0.16;
      }
    }
    return 0.02;
  }

  private outsideCity(x: number, z: number): boolean {
    const half = TOTAL / 2 + 4;
    return Math.abs(x) > half || Math.abs(z) > half;
  }

  // =====================================================================
  // Ghost update
  // =====================================================================

  update(_dt: number): void {
    // keep the pointer ray live even when reselling — sellAtPointer reads it
    const cam = this.engine.camera;
    this.raycaster.setFromCamera(this.input.mouse, cam);
    if (this.sellMode) {
      this.hideGhost(); // no placement ghost while reselling
      return;
    }
    if (!this.raycaster.ray.intersectPlane(this.plane, this.point)) {
      this.hideGhost();
      return;
    }
    const x = this.point.x;
    const z = this.point.z;

    if (this.tool === 'select') {
      this.selectUpdate(x, z);
      return;
    }
    if (this.tool === 'zone') {
      this.zoneUpdate(x, z);
      return;
    }
    if (this.tool === 'bulldoze') {
      this.hideGhost();
      return;
    }
    if (this.tool === 'building') {
      this.buildingGhost(x, z);
      return;
    }
    if (this.tool === 'person') {
      this.personGhost(x, z);
      return;
    }
    if (this.tool === 'car') {
      this.carGhost(x, z);
      return;
    }
    if (this.tool === 'train') {
      this.trainGhost(x, z);
      return;
    }
    this.propGhost(x, z);
  }

  private buildingGhost(x: number, z: number): void {
    const lot = this.city.nearestFreeLot(x, z, 14);
    if (lot) {
      const p: BuildingParams = { ...this.params, width: lot.w, depth: lot.d };
      const key = `bl|${lot.index}|${p.style}|${p.floors}|${p.variant}`;
      this.ensureGhost(key, () => this.city.buildingsFactory.createGhost(p));
      if (this.ghost) {
        this.ghost.visible = true;
        this.ghost.position.set(lot.cx, 0.16, lot.cz);
        this.ghost.rotation.y = lot.rotY;
        const edge = this.ghost.children[0] as THREE.LineSegments | undefined;
        if (edge) (edge.material as THREE.LineBasicMaterial).color.set('#4ade80');
      }
      this.ghostValid = true;
      this.lotIndex = lot.index;
      this.freeMode = false;
      return;
    }

    if (this.outsideCity(x, z)) {
      const p = this.params;
      const key = `bf|${p.style}|${p.floors}|${p.width}|${p.depth}|${p.variant}`;
      this.ensureGhost(key, () => this.city.buildingsFactory.createGhost(p));
      if (this.ghost) {
        this.ghost.visible = true;
        this.ghost.position.set(snapToGrid(x, 2), 0, snapToGrid(z, 2));
        this.ghost.rotation.y = this.rotY;
      }
      this.ghostValid = true;
      this.lotIndex = null;
      this.freeMode = true;
      return;
    }
    this.hideGhost();
  }

  private propGhost(x: number, z: number): void {
    const isTree = this.tool === 'tree';
    const key = `p|${this.tool}|${isTree ? this.treeType : ''}`;
    this.ensureGhost(key, () => {
      const seed = 7;
      let obj: THREE.Object3D;
      switch (this.tool) {
        case 'tree': obj = this.tint(this.city.makeTreeForGhost(this.treeType, seed)); break;
        case 'bush': obj = this.tint(this.city.makeBushForGhost(seed)); break;
        case 'grass': obj = this.tint(this.city.makeGrassForGhost(seed)); break;
        case 'flower': obj = this.tint(this.city.makeFlowerForGhost(seed)); break;
        case 'bench': obj = this.tint(this.city.makeBenchForGhost()); break;
        case 'lamp': obj = this.tint(this.city.makeLampForGhost()); break;
        case 'fountain': obj = this.tint(this.city.makeFountainForGhost()); break;
        case 'hospital': case 'grocery': case 'playground': case 'busStop': case 'firestation': case 'police':
          obj = this.tint(this.city.makeFacilityForGhost(this.tool));
          break;
        case 'snowman':
          obj = this.tint(this.city.makeSnowmanForGhost());
          break;
        case 'dog': case 'cat': case 'duck': case 'cow':
          obj = this.tint(this.city.makeAnimalForGhost(this.tool));
          break;
        default: obj = new THREE.Object3D();
      }
      return obj;
    });

    const gx = snapToGrid(x, 1);
    const gz = snapToGrid(z, 1);
    const y = this.surfaceY(gx, gz);
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(gx, y, gz);
      this.ghost.rotation.y = this.rotY;
    }

    const distOk = Math.hypot(x, z) < 260;
    this.ghostValid = distOk && !this.city.insideBuilding(gx, gz, 0.6);
    this.lotIndex = null;
    this.freeMode = false;
  }

  private personGhost(x: number, z: number): void {
    const key = 'person-marker';
    this.ensureGhost(key, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.3, 1.1, 4, 8),
        new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.55 })
      );
      body.position.y = 0.9;
      g.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 8),
        new THREE.MeshBasicMaterial({ color: '#86efac', transparent: true, opacity: 0.7 })
      );
      head.position.y = 1.75;
      g.add(head);
      return g;
    });
    const gx = snapToGrid(x, 1);
    const gz = snapToGrid(z, 1);
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(gx, this.surfaceY(gx, gz), gz);
      this.ghost.rotation.y = this.rotY;
    }
    this.ghostValid = !this.city.insideBuilding(gx, gz, 0.5) && Math.hypot(x, z) < TOTAL / 2 + 60;
  }

  /** Train preview: the consist snaps onto the nearest point of the rail loop */
  private trainGhost(x: number, z: number): void {
    const rail = this.city.getRail();
    if (!rail) {
      this.hideGhost();
      return;
    }
    const near = rail.closest(x, z);
    this.railSnap = near;
    this.ensureGhost('train-ghost', () => {
      const m = buildTrainModel(7);
      m.group.userData.cars = m.cars;
      return this.tint(m.group);
    });
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(0, 0, 0);
      this.ghost.rotation.y = 0;
      const cars = (this.ghost.userData.cars as THREE.Group[]) || [];
      for (let i = 0; i < cars.length; i++) {
        const s = near.s - i * GAP;
        const p = rail.posAt(s);
        cars[i].position.set(p.x, 0, p.z);
        cars[i].rotation.y = rail.headingAt(s);
      }
    }
    this.ghostValid = near.dist < 30;
    this.lotIndex = null;
    this.freeMode = false;
  }

  private carGhost(x: number, z: number): void {
    // nearest road line on each axis
    let bestC = 0, bestD = 1e9, bestAxis: 'x' | 'z' = 'x';
    for (let k = 0; k <= GRID; k++) {
      const c = roadCenter(k);
      const dx = Math.abs(x - c);
      if (dx < bestD) { bestD = dx; bestC = c; bestAxis = 'x'; } // vertical road at x=c → drives along z
      const dz = Math.abs(z - c);
      if (dz < bestD) { bestD = dz; bestC = c; bestAxis = 'z'; } // horizontal road at z=c → drives along x
    }

    // axis naming: 'x' means driving along x (horizontal road)
    const drivingAxis: 'x' | 'z' = bestAxis === 'x' ? 'z' : 'x';
    const dir: 1 | -1 = 1;
    const lane = drivingAxis === 'x' ? bestC + 3 : bestC - 3;
    const start = drivingAxis === 'x' ? x : z;

    this.carInfo = { axis: drivingAxis, dir, lane, start };

    const key = 'car-marker';
    this.ensureGhost(key, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, 1, 1.9),
        new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.5 })
      );
      body.position.y = 0.6;
      g.add(body);
      const cab = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.7, 1.7),
        new THREE.MeshBasicMaterial({ color: '#86efac', transparent: true, opacity: 0.6 })
      );
      cab.position.set(-0.25, 1.3, 0);
      g.add(cab);
      return g;
    });

    if (this.ghost) {
      this.ghost.visible = true;
      if (drivingAxis === 'x') {
        this.ghost.position.set(snapToGrid(x, 1), 0.02, lane);
        this.ghost.rotation.y = 0;
      } else {
        this.ghost.position.set(lane, 0.02, snapToGrid(z, 1));
        this.ghost.rotation.y = Math.PI / 2;
      }
    }
    this.ghostValid = Math.abs(x) < TOTAL / 2 && Math.abs(z) < TOTAL / 2;
  }

  // =====================================================================
  // Placement
  // =====================================================================

  private currentCost(): number {
    if (this.tool === 'building') {
      if (this.freeMode) return costBuilding(this.params);
      if (this.lotIndex !== null) {
        const lot = this.city.lots[this.lotIndex];
        return costBuilding({ ...this.params, width: lot.w, depth: lot.d });
      }
      return 0;
    }
    return COSTS[this.tool] ?? 0;
  }

  private deny(cost: number): void {
    this.engine.emit('notice', { message: `💸 Not enough money — needs $${cost.toLocaleString()}` });
  }

  tryPlace(): void {
    if (this.sellMode) {
      this.sellAtPointer();
      return;
    }
    if (this.tool === 'bulldoze') {
      this.bulldoze();
      return;
    }
    if (this.tool === 'select') {
      this.selectClick();
      return;
    }
    if (this.tool === 'zone') {
      this.zoneClick();
      return;
    }
    if (!this.ghost || !this.ghost.visible || !this.ghostValid) return;

    // pay the placement cost up front
    const cost = this.currentCost();
    if (cost > 0 && !this.city.spend(cost)) {
      this.deny(cost);
      return;
    }

    const gx = this.ghost.position.x;
    const gz = this.ghost.position.z;

    switch (this.tool) {
      case 'building': {
        if (this.freeMode) {
          const g = this.city.addBuildingAt(this.params, gx, gz, this.rotY);
          this.city.beginConstruction(g);
        } else if (this.lotIndex !== null) {
          const p: BuildingParams = { ...this.params };
          const lot = this.city.lots[this.lotIndex];
          p.width = lot.w;
          p.depth = lot.d;
          // zoning shapes the skyline: zoned blocks dictate the style
          const zone = this.city.zoneAtPoint(lot.cx, lot.cz);
          const zStyles = ZONE_STYLES[zone];
          if (zStyles && zStyles.length) {
            const s = zStyles[(p.variant + p.floors) % zStyles.length];
            if (s !== p.style) {
              p.style = s;
              this.engine.emit('notice', { message: `🏙️ ${ZONE_NAMES[zone]} zone → ${s} building` });
            }
          }
          const g = this.city.addBuilding(p, this.lotIndex);
          this.city.beginConstruction(g);
        }
        break;
      }
      case 'person':
        this.city.spawnPersonAt(gx, gz);
        break;
      case 'train':
        if (this.railSnap) {
          this.city.addPlaced('train', new THREE.Vector3(0, 0, 0), 0, { progress: this.railSnap.s });
        }
        break;
      case 'car': {
        if (this.carInfo) this.city.spawnCarAt(this.carInfo.axis, this.carInfo.dir, this.carInfo.lane, this.carInfo.start);
        break;
      }
      default: {
        if (PROP_TOOLS.includes(this.tool)) {
          this.city.addPlaced(this.tool as PlaceableKind, new THREE.Vector3(gx, this.ghost.position.y, gz), this.rotY, {
            treeType: this.tool === 'tree' ? this.treeType : undefined,
          });
        }
      }
    }
    this.invalidateGhost();
  }

  private bulldoze(): void {
    const hits = this.raycaster.intersectObjects([this.city.group], true);
    if (hits.length === 0) return;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !o.userData.editable) o = o.parent;
    if (!o) return;
    // demolition returns part of the investment
    const refund = this.refundFor(o);
    this.city.remove(o);
    if (refund > 0) this.city.earn(refund);
  }

  /**
   * What the player gets back for selling one placed object: 50% of its
   * sticker price (40% for buildings — they lose more on resale). Shared by
   * the bulldoze tool, the selection panel's Sell button and Shop resell mode.
   */
  refundFor(o: THREE.Object3D): number {
    return refundOf(o.userData.record as PlacedRecord | undefined);
  }

  /** Read-only quote for the object currently carrying the selection box */
  refundQuote(): number {
    return this.selected ? this.refundFor(this.selected) : 0;
  }

  /** Price the shop would charge to place `t` right now (buildings are dynamic) */
  toolCost(t: ToolId): number {
    if (t === 'building') return costBuilding(this.params);
    return COSTS[t] ?? 0;
  }

  /** Resell mode: click-to-sell instead of click-to-place */
  enterSellMode(): void {
    this.sellMode = true;
    this.hideGhost();
  }

  exitSellMode(): void {
    this.sellMode = false;
  }

  /** Shop → Sell tab: resell whatever sits under the cursor for its refund */
  private sellAtPointer(): void {
    const hits = this.raycaster.intersectObjects([this.city.group], true);
    if (hits.length === 0) return;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !o.userData.editable) o = o.parent;
    if (!o) return;
    const rec = o.userData.record as PlacedRecord | undefined;
    const kind = rec?.kind;
    const refund = this.refundFor(o);
    const name = kind ? (TOOL_NAMES[kind] ?? kind) : 'object';
    this.city.remove(o);
    if (this.selected === o) this.deselect(false);
    if (refund > 0) this.city.earn(refund);
    this.engine.emit('notice', { message: `💰 Sold ${name} — +$${refund.toLocaleString()} back` });
  }

  /** Selection panel: resell the picked object (same refund as bulldozing) */
  selectSell(): number {
    const o = this.selected;
    if (!o) return 0;
    const refund = this.refundFor(o);
    this.city.remove(o);
    this.deselect(false);
    if (refund > 0) this.city.earn(refund);
    return refund;
  }

  // =====================================================================
  // Zone tool
  // =====================================================================

  private zoneUpdate(x: number, z: number): void {
    const idx = this.city.blockIndexAt(x, z);
    if (idx < 0) {
      this.hideGhost();
      return;
    }
    const zt = this.zoneType;
    const key = `zone|${idx}|${zt}`;
    this.ensureGhost(key, () => {
      const geo = new THREE.PlaneGeometry(BLOCK - 1.5, BLOCK - 1.5);
      geo.rotateX(-Math.PI / 2);
      const color = zt > 0 ? ZONE_COLORS[zt] : '#ffffff';
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: zt > 0 ? 0.5 : 0.18, depthWrite: false })
      );
      m.raycast = () => void 0;
      return m;
    });
    const i = idx % GRID;
    const j = Math.floor(idx / GRID);
    if (this.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(blockOrigin(i) + BLOCK / 2, 0.22, blockOrigin(j) + BLOCK / 2);
    }
    this.ghostValid = true;
  }

  private zoneClick(): void {
    const idx = this.city.blockIndexAt(this.point.x, this.point.z);
    if (idx < 0) return;
    if (this.city.zoneAt(idx) === this.zoneType) return;
    if (this.zoneType !== 0 && !this.city.spend(COSTS.zone)) {
      this.deny(COSTS.zone);
      return;
    }
    this.city.setZone(idx, this.zoneType);
    this.engine.emit('notice', {
      message: this.zoneType > 0
        ? `🗺️ Block zoned ${ZONE_NAMES[this.zoneType]}`
        : '🗺️ Zone cleared',
    });
    this.invalidateGhost();
  }

  // =====================================================================
  // Select & move
  // =====================================================================

  private selectUpdate(x: number, z: number): void {
    if (this.holding && this.selected) {
      const o = this.selected;
      if (o.userData.kind === 'train') {
        // trains stay glued to the rail — drag re-seats their progress
        const rail = this.city.getRail();
        const train = o.userData.train as { progress: number; update(dt: number, loop: RailLoop): void } | undefined;
        if (rail && train) {
          const near = rail.closest(x, z);
          train.progress = near.s;
          train.update(0, rail);
        }
        return;
      }
      const gx = snapToGrid(x, 1);
      const gz = snapToGrid(z, 1);
      o.position.set(gx, this.surfaceY(gx, gz), gz);
      o.rotation.y = this.rotY;
      this.selBox?.update();
      return;
    }
    this.hideGhost();
    this.selBox?.update();
  }

  private selectClick(): void {
    if (this.holding && this.selected) {
      this.dropSelected();
      return;
    }
    const hits = this.raycaster.intersectObjects([this.city.group], true);
    // walk the hit list so non-editable scenery (roads, poles, birds)
    // never blocks selecting the object behind it
    let o: THREE.Object3D | null = null;
    for (const h of hits) {
      let cand: THREE.Object3D | null = h.object;
      while (cand && !cand.userData.editable) cand = cand.parent;
      // rising buildings can't be picked up — try what's behind them
      if (cand && !cand.userData.constructing) { o = cand; break; }
    }
    if (!o) {
      this.deselect(true);
      return;
    }
    if (o.userData.kind === 'train' && !this.city.getRail()) {
      this.deselect(true);
      return;
    }
    this.pickUp(o);
  }

  private pickUp(o: THREE.Object3D): void {
    this.selected = o;
    this.holding = true;
    this.rotY = o.rotation.y;
    this.origPos.copy(o.position);
    this.origRot = o.rotation.y;
    const rec = o.userData.record as PlacedRecord | undefined;
    this.origLot = rec && rec.lotIndex !== undefined ? rec.lotIndex : null;
    if (this.origLot !== null) {
      const lot = this.city.lots[this.origLot];
      if (lot) lot.occupied = false;
    }
    const person = o.userData.person as Person | undefined;
    if (person) person.frozen = true;
    const animal = o.userData.animal as Animal | undefined;
    if (animal) animal.frozen = true;

    const box = new THREE.BoxHelper(o, 0x4ade80);
    (box.material as THREE.LineBasicMaterial).depthTest = false;
    this.selBox = box;
    this.engine.scene.add(box);
    this.engine.emit('selectionChanged', { obj: o });
  }

  private dropSelected(): void {
    const o = this.selected;
    if (!o) return;
    const rec = o.userData.record as PlacedRecord | undefined;
    const x = o.position.x;
    const y = o.position.y;
    const z = o.position.z;
    const dx = x - this.origPos.x;
    const dy = y - this.origPos.y;
    const dz = z - this.origPos.z;

    if (rec && rec.kind === 'train') {
      const train = o.userData.train as { progress: number } | undefined;
      if (train) rec.progress = train.progress;
    } else if (rec) {
      rec.position = [x, y, z];
      rec.rotationY = o.rotation.y;
      if (rec.kind === 'building' || rec.lotIndex !== undefined) {
        const lot = this.city.lotAt(x, z);
        if (lot) {
          lot.occupied = true;
          rec.lotIndex = lot.index;
        } else {
          rec.lotIndex = undefined;
        }
      }
      const animal = o.userData.animal as Animal | undefined;
      if (animal) animal.shiftPath(dx, dy, dz);
    } else {
      const person = o.userData.person as Person | undefined;
      if (person) person.shiftPath(dx, dy, dz);
    }

    const person = o.userData.person as Person | undefined;
    if (person) person.frozen = false;
    const animal = o.userData.animal as Animal | undefined;
    if (animal) animal.frozen = false;
    this.deselect(false);
  }

  private deselect(restore: boolean): void {
    const o = this.selected;
    if (!o) {
      this.holding = false;
      return;
    }
    if (this.holding && restore) {
      o.position.copy(this.origPos);
      o.rotation.y = this.origRot;
      if (this.origLot !== null) {
        const lot = this.city.lots[this.origLot];
        if (lot) lot.occupied = true;
        const rec = o.userData.record as PlacedRecord | undefined;
        if (rec) rec.lotIndex = this.origLot;
      }
      const train = o.userData.train as { progress: number; update(dt: number, loop: RailLoop): void } | undefined;
      const rec = o.userData.record as PlacedRecord | undefined;
      if (train && rec) {
        train.progress = rec.progress ?? train.progress;
        const rail = this.city.getRail();
        if (rail) train.update(0, rail);
      }
    }
    const person = o.userData.person as Person | undefined;
    if (person) person.frozen = false;
    const animal = o.userData.animal as Animal | undefined;
    if (animal) animal.frozen = false;

    if (this.selBox) {
      this.engine.scene.remove(this.selBox);
      this.selBox.geometry.dispose();
      (this.selBox.material as THREE.Material).dispose();
      this.selBox = null;
    }
    this.selected = null;
    this.holding = false;
    this.origLot = null;
    this.engine.emit('selectionChanged', { obj: null });
  }

  /** Panel button: rotate the carried object by 90° */
  selectRotate(): void {
    this.rotY += Math.PI / 2;
  }

  /** Panel button: place a copy next to the selected object */
  selectDuplicate(): void {
    const o = this.selected;
    if (!o) return;
    const rec = o.userData.record as PlacedRecord | undefined;
    const x = snapToGrid(o.position.x + 4, 2);
    const z = snapToGrid(o.position.z + 4, 2);

    if (!rec) {
      if (!this.city.spend(COSTS.person)) return this.deny(COSTS.person);
      this.city.spawnPersonAt(x, z);
      this.engine.emit('notice', { message: '🚶 Person duplicated' });
      return;
    }
    if (rec.kind === 'train') {
      if (!this.city.spend(COSTS.train)) return this.deny(COSTS.train);
      this.city.addPlaced('train', new THREE.Vector3(0, 0, 0), 0, { progress: rec.progress });
      this.engine.emit('notice', { message: '🚆 Train duplicated' });
      return;
    }
    if (rec.kind === 'building' && rec.building) {
      const cost = costBuilding(rec.building);
      if (!this.city.spend(cost)) return this.deny(cost);
      const lot = this.city.lotAt(x, z);
      if (lot) {
        const g = this.city.addBuilding(rec.building, lot.index);
        this.city.beginConstruction(g);
      } else {
        const g = this.city.addBuildingAt(rec.building, x, z, rec.rotationY);
        g.position.y = this.surfaceY(x, z);
        const r2 = g.userData.record as PlacedRecord;
        r2.position = [x, g.position.y, z];
        this.city.beginConstruction(g);
      }
      this.engine.emit('notice', { message: '🏢 Building duplicated' });
      return;
    }

    const cost = COSTS[rec.kind as ToolId] ?? 0;
    if (!this.city.spend(cost)) return this.deny(cost);
    this.city.addPlaced(rec.kind, new THREE.Vector3(x, this.surfaceY(x, z), z), rec.rotationY + Math.PI, {
      treeType: rec.treeType,
      color: rec.color,
    });
    this.engine.emit('notice', { message: '✅ Duplicated' });
  }

  /** Panel button: delete the selected object (no refund — 💰 Sell for that) */
  selectDelete(): void {
    const o = this.selected;
    if (!o) return;
    this.city.remove(o);
    this.deselect(false);
    this.engine.emit('notice', { message: '🗑 Removed' });
  }
}