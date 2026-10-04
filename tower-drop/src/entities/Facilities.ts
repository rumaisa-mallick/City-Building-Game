import * as THREE from 'three';
import { registerFacade, snowCapMaterial } from '../utils/materialRegistry';
import type { PlaceableKind } from '../types';

// ============================================================================
// Static civic / commercial structures: hospital, grocery store, playground.
// All are procedural (zero external assets) and register emissive windows
// so they light up with the scene at night.
// ============================================================================

function tag(g: THREE.Object3D, kind: PlaceableKind): void {
  g.userData.editable = true;
  g.userData.kind = kind;
  g.userData.record = {
    kind,
    position: [0, 0, 0] as [number, number, number],
    rotationY: 0,
  };
}

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  // subtle bevel
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
  ctx.fillStyle = fg;
  ctx.font = 'bold 56px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Window material that glows at night with the rest of the city's windows */
function windowMat(color = '#a9c9e8'): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.18,
    metalness: 0.35,
    emissive: new THREE.Color('#ffe3a8'),
    emissiveIntensity: 0,
  });
  registerFacade(m);
  return m;
}

const shadowOn = (m: THREE.Mesh): THREE.Mesh => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

// ============================================================================
// Hospital
// ============================================================================

export function createHospital(): THREE.Group {
  const g = new THREE.Group();

  const W = 10, D = 9, H = 8;
  const wall = new THREE.MeshStandardMaterial({ color: '#eef0f3', roughness: 0.75 });
  const trim = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.8 });
  const red = new THREE.MeshStandardMaterial({
    color: '#df3b34', roughness: 0.45,
    emissive: new THREE.Color('#ff5040'), emissiveIntensity: 0.3,
  });
  const win = windowMat();
  const glass = new THREE.MeshStandardMaterial({ color: '#1b2a36', roughness: 0.1, metalness: 0.55 });

  const main = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wall));
  main.position.y = H / 2;
  g.add(main);

  // floor bands
  for (const y of [2.7, 5.4]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.16, 0.2, D + 0.16), trim);
    band.position.y = y;
    g.add(band);
  }

  // windows — front & back (rows), skip ground-center for the entrance
  const wgeo = new THREE.BoxGeometry(1.5, 1.5, 0.14);
  for (const row of [1.7, 4.3, 7.0]) {
    for (const col of [-3.6, -1.8, 0, 1.8, 3.6]) {
      if (row === 1.7 && col === 0) continue;
      const wf = new THREE.Mesh(wgeo, win);
      wf.position.set(col, row, D / 2 + 0.04);
      g.add(wf);
      const wb = new THREE.Mesh(wgeo, win);
      wb.position.set(col, row, -D / 2 - 0.04);
      g.add(wb);
    }
  }
  // side windows
  for (const row of [1.7, 4.3, 7.0]) {
    for (const col of [-2.7, -0.9, 0.9, 2.7]) {
      for (const sx of [-1, 1]) {
        const ws = new THREE.Mesh(wgeo, win);
        ws.rotation.y = Math.PI / 2;
        ws.position.set(sx * (W / 2 + 0.04), row, col);
        g.add(ws);
      }
    }
  }

  // rooftop sign panel with red cross
  const panel = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.4, 0.5), wall));
  panel.position.set(0, H + 1.2, D / 2 - 0.25);
  g.add(panel);
  const cv = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, 0.24), red);
  cv.position.set(0, H + 1.2, D / 2 + 0.1);
  const ch = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.9, 0.24), red);
  ch.position.set(0, H + 1.2, D / 2 + 0.1);
  g.add(cv, ch);
  // matching cross on the back so it reads from either side
  const cv2 = cv.clone();
  cv2.position.z = -D / 2 - 0.1;
  const ch2 = ch.clone();
  ch2.position.z = -D / 2 - 0.1;
  g.add(cv2, ch2);

  // entrance: canopy + glass doors
  const canopy = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.24, 2.4), trim));
  canopy.position.set(0, 3.1, D / 2 + 1.2);
  g.add(canopy);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3, 8), trim);
    post.position.set(sx * 2, 1.5, D / 2 + 2.2);
    g.add(post);
  }
  const doors = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 0.16), glass);
  doors.position.set(0, 1.3, D / 2 + 0.05);
  g.add(doors);
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.9, 0.1), trim);
  doorFrame.position.set(0, 1.45, D / 2 + 0.01);
  g.add(doorFrame);

  // roof: parapet cap + AC unit + helipad hint
  const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.3, D + 0.3), trim);
  cap.position.y = H + 0.15;
  g.add(cap);
  // snow cover (toggled by the snow scene)
  const snow = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.14, D - 0.5), snowCapMaterial);
  snow.position.y = H + 0.37;
  snow.visible = false;
  g.add(snow);
  g.userData.snowCap = snow;
  const ac = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.6), trim));
  ac.position.set(-2.6, H + 0.75, -1.8);
  g.add(ac);
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 10), trim);
  vent.position.set(2.8, H + 0.5, -2.2);
  g.add(vent);

  tag(g, 'hospital');
  return g;
}

// ============================================================================
// Grocery store
// ============================================================================

export function createGrocery(): THREE.Group {
  const g = new THREE.Group();

  const W = 9, D = 7, H = 3.6;
  const wall = new THREE.MeshStandardMaterial({ color: '#f2ead9', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: '#2a6b41', roughness: 0.6 });
  const win = windowMat('#9fc3e0');
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.95 });

  const main = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wall));
  main.position.y = H / 2;
  g.add(main);

  // storefront glass (front face)
  const shopGlass = new THREE.Mesh(new THREE.BoxGeometry(W - 2.2, 2.3, 0.16), win);
  shopGlass.position.set(-0.8, 1.5, D / 2 + 0.04);
  g.add(shopGlass);
  const glassFrame = new THREE.Mesh(new THREE.BoxGeometry(W - 2, 2.5, 0.1), trim);
  glassFrame.position.set(-0.8, 1.5, D / 2 + 0.01);
  g.add(glassFrame);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.5, 0.2), windowMat('#8fb4d4'));
  door.position.set(W / 2 - 1.4, 1.25, D / 2 + 0.06);
  g.add(door);

  // striped awning over the storefront
  const aw = document.createElement('canvas');
  aw.width = 256; aw.height = 64;
  const actx = aw.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    actx.fillStyle = i % 2 ? '#f4f1e8' : '#2f7a49';
    actx.fillRect((i * 256) / 8, 0, 256 / 8, 64);
  }
  const awTex = new THREE.CanvasTexture(aw);
  awTex.colorSpace = THREE.SRGBColorSpace;
  awTex.wrapS = awTex.wrapT = THREE.RepeatWrapping;
  awTex.repeat.set(2, 1);
  const awn = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.6, 0.16, 2.3),
    new THREE.MeshStandardMaterial({ map: awTex, roughness: 0.9 })
  );
  awn.position.set(0, 3.0, D / 2 + 1.05);
  awn.rotation.x = 0.28;
  awn.castShadow = true;
  g.add(awn);

  // sign above the awning
  const plate = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.05, 0.2), trim);
  plate.position.set(0, H + 0.55, D / 2 + 0.06);
  g.add(plate);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(6.3, 0.9),
    new THREE.MeshStandardMaterial({ map: signTexture('FRESH MARKET', '#2a6b41', '#f6f2e6'), roughness: 0.7 })
  );
  face.position.set(0, H + 0.55, D / 2 + 0.17);
  g.add(face);

  // produce crates out front
  const crateColors = ['#d94f3d', '#e8a33d', '#67b04a'];
  for (let n = 0; n < 3; n++) {
    const cx = -W / 2 + 1.2 + n * 1.5;
    const crate = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.55, 0.9), wood));
    crate.position.set(cx, 0.28, D / 2 + 0.9);
    g.add(crate);
    for (let a = 0; a < 3; a++) {
      const fruit = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 6),
        new THREE.MeshStandardMaterial({ color: crateColors[n], roughness: 0.6 })
      );
      fruit.position.set(cx - 0.32 + a * 0.32, 0.63, D / 2 + 0.9);
      g.add(fruit);
    }
  }

  // roof detail
  const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.24, D + 0.3), trim);
  cap.position.y = H + 0.12;
  g.add(cap);
  // snow cover (toggled by the snow scene)
  const snow = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.14, D - 0.5), snowCapMaterial);
  snow.position.y = H + 0.31;
  snow.visible = false;
  g.add(snow);
  g.userData.snowCap = snow;
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 8), wood);
  vent.position.set(2.6, H + 0.5, -1.6);
  g.add(vent);

  tag(g, 'grocery');
  return g;
}

// ============================================================================
// Playground (slide + swings)
// ============================================================================

export function createPlayground(): THREE.Group {
  const g = new THREE.Group();

  const red = new THREE.MeshStandardMaterial({ color: '#d94f3d', roughness: 0.6 });
  const blue = new THREE.MeshStandardMaterial({ color: '#3f74c9', roughness: 0.6 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e8bf3d', roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.4, metalness: 0.5 });

  // soft rubber pad
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(5.2, 5.2, 0.14, 26),
    new THREE.MeshStandardMaterial({ color: '#b3553f', roughness: 1 })
  );
  pad.position.y = 0.07;
  pad.receiveShadow = true;
  g.add(pad);

  // ---- slide tower (left) ----
  const tx = -2.4;
  const platform = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 1.5), yellow));
  platform.position.set(tx, 1.7, 0);
  g.add(platform);
  for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 8), steel);
    leg.position.set(tx + ox, 0.85, oz);
    leg.castShadow = true;
    g.add(leg);
  }
  // ladder at the back
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.0, 0.07), steel);
    rail.position.set(tx + s * 0.5, 0.95, -1.15);
    rail.rotation.x = 0.35;
    g.add(rail);
  }
  for (let n = 0; n < 4; n++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6), steel);
    rung.rotation.z = Math.PI / 2;
    rung.position.set(tx, 0.35 + n * 0.42, -1.45 + n * 0.16);
    g.add(rung);
  }
  // slide chute toward +z
  const chute = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 3.6), red));
  chute.position.set(tx, 0.9, 1.7);
  chute.rotation.x = 0.5;
  g.add(chute);
  for (const s of [-1, 1]) {
    const wallRail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 3.6), red);
    wallRail.position.set(tx + s * 0.55, 1.06, 1.7);
    wallRail.rotation.x = 0.5;
    g.add(wallRail);
  }
  // little roof
  const roof = shadowOn(new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.9, 4), blue));
  roof.position.set(tx, 2.5, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);

  // ---- swing set (right) ----
  const sx = 2.6;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.9, 8), steel);
      pole.position.set(sx + s * 0.15, 1.35, t * 1.5);
      pole.rotation.x = -t * 0.42;
      pole.castShadow = true;
      g.add(pole);
    }
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), steel);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(sx, 2.65, 0);
  g.add(bar);
  const swings: THREE.Group[] = [];
  for (const t of [-0.75, 0.75]) {
    const sw = new THREE.Group();
    for (const c of [-0.3, 0.3]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 5), steel);
      chain.position.set(c, -0.75, 0);
      sw.add(chain);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.34), t < 0 ? blue : yellow);
    seat.position.y = -1.5;
    seat.castShadow = true;
    sw.add(seat);
    sw.position.set(sx, 2.6, t);
    g.add(sw);
    swings.push(sw);
  }
  g.userData.swings = swings;

  tag(g, 'playground');
  return g;
}

// ============================================================================
// Bus stop (shelter + bench + sign)
// ============================================================================

export function createBusStop(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({
    color: '#9fc9e0', roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.55,
  });
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.95 });

  // shelter: roof + back/side glass panels
  const roof = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 1.6), metal));
  roof.position.set(0, 2.5, 0);
  g.add(roof);
  const back = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 0.1), glass);
  back.position.set(0, 1.25, -0.75);
  g.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 1.5), glass);
    side.position.set(sx * 1.75, 1.25, 0);
    g.add(side);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.5, 8), metal);
    post.position.set(sx * 1.75, 1.25, 0.72);
    g.add(post);
  }
  // bench
  const seat = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.45), wood));
  seat.position.set(0, 0.55, -0.45);
  g.add(seat);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.4), metal);
    leg.position.set(sx * 1.1, 0.28, -0.45);
    g.add(leg);
  }
  // sign pole
  const pole = shadowOn(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 8), metal));
  pole.position.set(2.3, 1.7, 0);
  g.add(pole);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.55, 0.08),
    new THREE.MeshStandardMaterial({ color: '#2a6fd8', roughness: 0.5 })
  );
  plate.position.set(2.3, 3.2, 0);
  g.add(plate);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.46),
    new THREE.MeshStandardMaterial({ map: signTexture('BUS', '#2a6fd8', '#ffffff'), roughness: 0.6 })
  );
  face.position.set(2.3, 3.2, 0.05);
  g.add(face);
  const face2 = face.clone();
  face2.rotation.y = Math.PI;
  face2.position.z = -0.05;
  g.add(face2);

  tag(g, 'busStop');
  return g;
}

// ============================================================================
// Police station
// ============================================================================

export function createPoliceStation(): THREE.Group {
  const g = new THREE.Group();

  const W = 10, D = 8, H = 6.5;
  const wall = new THREE.MeshStandardMaterial({ color: '#e9ecf2', roughness: 0.72 });
  const navy = new THREE.MeshStandardMaterial({ color: '#1d3568', roughness: 0.55 });
  const trim = new THREE.MeshStandardMaterial({ color: '#b9c0cc', roughness: 0.8 });
  const win = windowMat('#9fc0e4');
  const glass = new THREE.MeshStandardMaterial({ color: '#17222e', roughness: 0.1, metalness: 0.55 });

  const main = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wall));
  main.position.y = H / 2;
  g.add(main);

  // navy plinth + story band — the station's livery
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 1.1, D + 0.2), navy);
  plinth.position.y = 0.55;
  g.add(plinth);
  const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.16, 0.2, D + 0.16), navy);
  band.position.y = 4.4;
  g.add(band);

  // windows front & back (ground-center left open for the entrance)
  const wgeo = new THREE.BoxGeometry(1.5, 1.5, 0.14);
  for (const row of [1.9, 3.5, 5.5]) {
    for (const col of [-3.6, -1.8, 0, 1.8, 3.6]) {
      if (row === 1.9 && col === 0) continue;
      const wf = new THREE.Mesh(wgeo, win);
      wf.position.set(col, row, D / 2 + 0.04);
      g.add(wf);
      const wb = new THREE.Mesh(wgeo, win);
      wb.position.set(col, row, -D / 2 - 0.04);
      g.add(wb);
    }
  }
  // side windows
  for (const row of [1.9, 3.5, 5.5]) {
    for (const col of [-2.7, -0.9, 0.9, 2.7]) {
      for (const sx of [-1, 1]) {
        const ws = new THREE.Mesh(wgeo, win);
        ws.rotation.y = Math.PI / 2;
        ws.position.set(sx * (W / 2 + 0.04), row, col);
        g.add(ws);
      }
    }
  }

  // entrance: navy canopy + glass doors
  const canopy = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.22, 2.2), navy));
  canopy.position.set(0, 3.0, D / 2 + 1.1);
  g.add(canopy);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3, 8), trim);
    post.position.set(sx * 1.8, 1.5, D / 2 + 2.1);
    g.add(post);
  }
  const doors = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.4, 0.16), glass);
  doors.position.set(0, 1.2, D / 2 + 0.05);
  g.add(doors);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.7, 0.1), trim);
  frame.position.set(0, 1.35, D / 2 + 0.01);
  g.add(frame);

  // POLICE sign above the canopy
  const plate = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.0, 0.2), navy);
  plate.position.set(0, H + 0.5, D / 2 + 0.06);
  g.add(plate);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(5.9, 0.85),
    new THREE.MeshStandardMaterial({ map: signTexture('POLICE', '#16305f', '#ffffff'), roughness: 0.7 })
  );
  face.position.set(0, H + 0.5, D / 2 + 0.17);
  g.add(face);

  // roof: cap + snow cover + AC + emergency light bar
  const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.26, D + 0.3), trim);
  cap.position.y = H + 0.13;
  g.add(cap);
  const snow = new THREE.Mesh(new THREE.BoxGeometry(W - 0.5, 0.14, D - 0.5), snowCapMaterial);
  snow.position.y = H + 0.33;
  snow.visible = false;
  g.add(snow);
  g.userData.snowCap = snow;
  const ac = shadowOn(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.6), trim));
  ac.position.set(2.8, H + 0.72, -1.8);
  g.add(ac);

  // roof-top beacon bar: red / blue, always glowing so it reads at night
  const barBase = shadowOn(new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.16, 0.5),
    new THREE.MeshStandardMaterial({ color: '#22262c', roughness: 0.6 })
  ));
  barBase.position.set(0, H + 0.36, D / 2 - 1.4);
  g.add(barBase);
  const beaconRed = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.22, 0.42),
    new THREE.MeshStandardMaterial({ color: '#7a1512', emissive: new THREE.Color('#ff3b30'), emissiveIntensity: 1.5, roughness: 0.4 })
  );
  beaconRed.position.set(-0.5, H + 0.52, D / 2 - 1.4);
  const beaconBlue = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.22, 0.42),
    new THREE.MeshStandardMaterial({ color: '#12275c', emissive: new THREE.Color('#2f6bff'), emissiveIntensity: 1.5, roughness: 0.4 })
  );
  beaconBlue.position.set(0.5, H + 0.52, D / 2 - 1.4);
  g.add(beaconRed, beaconBlue);

  tag(g, 'police');
  return g;
}
