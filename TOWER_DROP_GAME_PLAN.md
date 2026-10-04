# Tower Drop Game - Development Plan

> ## 🔄 V2 DIRECTION (current): Realistic City Sandbox
> The game has evolved from a tower-stacking game into a **full city builder**.
> Implemented in `tower-drop/`. Current features:
> - **Whole procedural city**: road grid with lane markings, sidewalks, crosswalks, 3×3 blocks with a central park
> - **Realistic look**: Three.js Sky shader (physically based sun/sky), ACES tone mapping, soft shadows, fog, PBR materials, procedural facade textures (windows, shops, signs)
> - **Build your own buildings**: 6 styles (glass/brick/concrete/classic/warehouse/neon), 1–24 floors, lot-snapped or free placement outside the ring
> - **People & traffic**: articulated walking people (swinging arms/legs), cars driving on lanes
> - **Nature tools**: 3 tree types, bushes, grass tufts, flowers, benches, street lamps, fountains
> - **5 scenes/time-of-day**: Morning, Day, Sunset, Night (glowing windows + street lamps + stars), Rain (rain streaks + wet light)
> - **Save/Load/New City** via localStorage
>
> Roadmap ideas: zoning brush, elevation/terrain, bridges, day cycle, sound, screenshot share.

## 🎮 Game Concept
A 3D tower-building game where players stack pixel-art compartment blocks to build towers against beautiful scenic backgrounds. Players have full control over block placement - blocks can hang in air or rest on ground/other blocks.

## 🛠 Technology Stack
| Component | Choice | Reason |
|-----------|--------|--------|
| **Renderer** | Three.js (r155+) | Professional 3D, WebGL, excellent performance |
| **Physics** | Cannon-es / Rapier | Lightweight physics for block settling |
| **Pixel Art** | Custom shader + texture atlases | Authentic pixel look in 3D |
| **Input** | PointerLockControls + Raycasting | Precise 3D placement |
| **State** | Custom ECS-lite | Lightweight entity management |
| **Build** | Vite | Fast dev, optimized production |
| **Language** | TypeScript | Type safety, professional codebase |

## 🎨 Visual Style: Pixel Art in 3D

### Compartment Blocks
- **Base unit**: 1×1×1 meter cubes (scalable)
- **Pixel density**: 16×16 or 32×32 per face
- **Style variants**:
  - Residential (windows, balconies, AC units)
  - Commercial (storefronts, signs, awnings)
  - Industrial (pipes, vents, cargo doors)
  - Sci-fi (holographic panels, neon, force fields)
  - Fantasy (stone bricks, magical runes, vines)

### Rendering Approach
```
┌─────────────────────────────────────────────┐
│  Three.js Scene                             │
│  ├── OrthographicCamera (pixel-perfect)     │
│  ├── PixelArtShader (nearest-neighbor)      │
│  ├── Texture Atlas (all block faces)        │
│  ├── Post-processing: CRT/Scanlines (opt)   │
│  └── Parallax Background Layers             │
└─────────────────────────────────────────────┘
```

## 🗺 Map System (All Themes)

### Map Definition Structure
```typescript
interface GameMap {
  id: string;
  name: string;
  theme: 'city' | 'nature' | 'fantasy' | 'scifi' | 'cyberpunk' | 'space';
  background: BackgroundLayers;
  groundPlane: GroundConfig;
  lighting: LightingConfig;
  ambientAudio: string;
  unlockRequirement?: UnlockCondition;
}

interface BackgroundLayers {
  far: ParallaxLayer;      // Mountains, distant city, stars
  mid: ParallaxLayer;      // Trees, buildings, clouds
  near: ParallaxLayer;     // Foreground details
  sky: SkyboxConfig;       // Gradient/HDRI sky
}

interface ParallaxLayer {
  texture: string;
  speed: number;           // 0.0 - 1.0
  scale: Vector2;
  opacity: number;
  blendMode?: BlendingMode;
}
```

### Theme Packs (6+ Maps at Launch)

| Theme | Maps | Visual Identity |
|-------|------|-----------------|
| **City** | Downtown Day, Neon Night, Sunset Rooftops | Skyscrapers, traffic, windows |
| **Nature** | Mountain Valley, Cherry Blossom, Autumn Forest | Organic, seasonal colors |
| **Fantasy** | Floating Islands, Crystal Caves, Ancient Ruins | Magical, impossible geometry |
| **Sci-Fi** | Orbital Station, Mars Colony, Cyberpunk Alley | High-tech, neon, holograms |
| **Post-Apoc** | Wasteland, Overgrown City, Bunker Entrance | Decay, nature reclaiming |
| **Abstract** | Void, Geometric Dreams, Color Waves | Pure aesthetic, minimal |

## 🎯 Core Gameplay Mechanics

### Player-Controlled Placement System
```
┌────────────────────────────────────────────────────────────┐
│  PLACEMENT MODES                                           │
├────────────────────────────────────────────────────────────┤
│  1. FREE PLACEMENT (Default)                               │
│     - Ghost preview follows cursor (raycast to plane)      │
│     - Click to place at exact position                     │
│     - Hold SHIFT: snap to grid (1m increments)             │
│     - Hold CTRL: vertical stack mode (auto-align top)      │
│                                                              │
│  2. HANGING MODE                                           │
│     - Blocks can float/anchor to sides of existing blocks  │
│     - Physics joint connects to anchor point               │
│     - Visual indicator: glowing tether/chain               │
│                                                              │
│  3. GROUND SNAP                                            │
│     - Auto-align to ground or highest block below          │
│     - Shows shadow preview on landing surface              │
└────────────────────────────────────────────────────────────┘
```

### Block Physics & Stability
- **Mass**: Based on block type (stone > wood > metal > sci-fi)
- **Center of Mass**: Calculated per tower
- **Stability Check**: Tower tips if COM outside base bounds
- **Wind/Weather**: Optional environmental forces per map
- **Settle Animation**: Blocks gently drop/rotate into place

### Block Types & Properties
```typescript
interface BlockType {
  id: string;
  name: string;
  category: 'residential' | 'commercial' | 'industrial' | 'special';
  dimensions: Vector3;           // e.g., (1, 1, 1), (2, 1, 1), (1, 2, 1)
  mass: number;
  pixelTexture: TextureAtlasCoords;
  connectionPoints: Vector3[];   // Where other blocks can attach
  specialProperties?: {
    glows?: boolean;
    animated?: boolean;
    emitsParticles?: ParticleConfig;
    structural?: boolean;        // Core support block
  };
}
```

## 🎮 Controls & UX

### Keyboard/Mouse
| Action | Control |
|--------|---------|
| Rotate Camera | Right-click drag / Q/E |
| Pan Camera | Middle-click drag / WASD |
| Zoom | Scroll wheel |
| Place Block | Left-click |
| Cancel/Hold | Right-click (while holding) |
| Rotate Block | R / Mouse wheel (while holding) |
| Toggle Grid Snap | G |
| Toggle Hanging Mode | H |
| Undo Last | Ctrl+Z |
| Save Tower | Ctrl+S |
| Load Tower | Ctrl+O |
| Map Select | M |
| Block Palette | 1-9 / Tab |

### Touch/Mobile (Future)
- Two-finger rotate/zoom
- Drag ghost preview
- Tap to place
- Palette slide-out panel

## 🏗 Technical Architecture

### Project Structure
```
tower-drop/
├── public/
│   ├── assets/
│   │   ├── textures/
│   │   │   ├── atlases/          # Pixel art texture atlases
│   │   │   ├── backgrounds/      # Parallax layers per map
│   │   │   └── skyboxes/         # HDR/gradient skies
│   │   ├── audio/
│   │   │   ├── ambient/          # Per-map ambient tracks
│   │   │   ├── sfx/              # Place, click, wind, etc.
│   │   │   └── music/            # Background music loops
│   │   └── models/               # GLTF for complex props
│   └── index.html
├── src/
│   ├── core/
│   │   ├── Engine.ts             # Three.js init, render loop
│   │   ├── SceneManager.ts       # Scene graph management
│   │   ├── AssetLoader.ts        # Texture, audio, model loading
│   │   └── InputManager.ts       # Unified input handling
│   ├── systems/
│   │   ├── BlockSystem.ts        # Block creation, placement, physics
│   │   ├── MapSystem.ts          # Map loading, parallax, transitions
│   │   ├── CameraSystem.ts       # Camera controls, constraints
│   │   ├── UISystem.ts           # HUD, menus, block palette
│   │   ├── SaveSystem.ts         # Tower serialization, localStorage
│   │   └── ParticleSystem.ts     # Effects, weather, magic
│   ├── entities/
│   │   ├── Block.ts              # Block entity with physics body
│   │   ├── Tower.ts              # Composite tower entity
│   │   └── BackgroundLayer.ts    # Parallax layer entity
│   ├── components/
│   │   ├── PixelArtMaterial.ts   # Custom shader material
│   │   ├── GhostPreview.ts       # Placement preview mesh
│   │   └── StabilityIndicator.ts # Visual COM/base indicator
│   ├── maps/
│   │   ├── MapRegistry.ts        # All map definitions
│   │   ├── MapLoader.ts          # Async map loading
│   │   └── themes/               # Per-theme configurations
│   ├── ui/
│   │   ├── BlockPalette.ts       # Draggable block selection
│   │   ├── MapSelector.ts        # Map selection screen
│   │   ├── TowerStats.ts         # Height, blocks, stability
│   │   └── SettingsMenu.ts
│   ├── shaders/
│   │   ├── pixelArt.vert         # Vertex shader
│   │   ├── pixelArt.frag         # Fragment shader (nearest neighbor)
│   │   ├── parallax.vert
│   │   └── parallax.frag
│   ├── utils/
│   │   ├── math.ts               # Vector helpers, grid snap
│   │   ├── serialization.ts      # Save/load tower data
│   │   └── color.ts              # Palette management
│   └── main.ts                   # Entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 📦 Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Project setup: Vite + Three.js + TypeScript
- [ ] Basic render loop, camera controls
- [ ] Pixel art shader (nearest-neighbor, palette support)
- [ ] Texture atlas system
- [ ] Basic block entity (cube with pixel faces)
- [ ] Ground plane + simple lighting

### Phase 2: Placement System (Week 2-3)
- [ ] Raycast-based ghost preview
- [ ] Click-to-place with grid snap option
- [ ] Block palette UI (1-9 keys)
- [ ] Basic physics (Cannon-es): gravity, collision
- [ ] Tower entity: tracks blocks, calculates COM
- [ ] Stability visualization (COM marker, base outline)

### Phase 3: Map System (Week 3-4)
- [ ] Parallax background system (3-5 layers)
- [ ] Map registry with 6 initial maps
- [ ] Map selector UI with previews
- [ ] Dynamic lighting per map (time of day)
- [ ] Ambient audio system
- [ ] Skybox/gradient sky rendering

### Phase 4: Polish & Features (Week 4-5)
- [ ] Hanging mode with physics joints
- [ ] Block rotation (90° increments)
- [ ] Undo/Redo system (command pattern)
- [ ] Save/Load towers (localStorage + export JSON)
- [ ] Tower stats HUD (height, block count, stability %)
- [ ] Particle effects (dust, magic, sci-fi)
- [ ] CRT/Scanline post-processing (toggleable)

### Phase 5: Content & Polish (Week 5-6)
- [ ] 20+ block types across themes
- [ ] Animated blocks (blinking lights, flowing water)
- [ ] Special blocks: bridges, cantilevers, balloons
- [ ] Weather effects per map (rain, snow, sandstorm)
- [ ] Daily challenge mode (target tower shape)
- [ ] Screenshot/Share tower feature
- [ ] Performance optimization (instancing, LOD)

## 🎨 Asset Creation Pipeline

### Pixel Art Workflow
```
Aseprite → Export PNG → TexturePacker → Atlas JSON + PNG → Three.js Loader
```

### Required Assets (MVP)
| Asset Type | Count | Priority |
|------------|-------|----------|
| Block face textures (16×16) | 6 faces × 20 types = 120 | High |
| Parallax layers | 6 maps × 4 layers = 24 | High |
| Sky gradients/HDRI | 6 | Medium |
| UI icons | 30+ | Medium |
| Particle textures | 10 | Low |
| Sound effects | 15 | Medium |
| Ambient tracks | 6 | Medium |

### Color Palettes (Per Theme)
- **City**: Concrete grays, window blues, neon accents
- **Nature**: Earth tones, greens, sky blues, seasonal accents
- **Fantasy**: Stone grays, gem colors, gold, magical glow
- **Sci-Fi**: Metallic, neon cyan/magenta, deep space black
- **Cyberpunk**: Hot pink, cyan, purple, warning yellow
- **Space**: Starfield, nebula purples, ship hull grays

## 💾 Save Data Format
```json
{
  "version": "1.0",
  "mapId": "city-night",
  "tower": {
    "blocks": [
      {
        "typeId": "residential-1x1",
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "colorVariant": 0
      }
    ],
    "stats": {
      "height": 15.3,
      "blockCount": 47,
      "stability": 0.87
    }
  },
  "timestamp": 1699999999999
}
```

## 🚀 Stretch Goals (Post-MVP)
- Multiplayer: Visit friends' towers
- Tower defense mode: Protect your tower
- VR support (WebXR)
- Procedural map generation
- Block editor (create custom pixel blocks)
- Steam/itch.io release with leaderboards
- Mobile app (Capacitor/Cordova)

## 📊 Success Metrics
- 60 FPS on 5-year-old hardware (1000+ blocks)
- < 3s initial load (progressive loading)
- < 100ms placement response
- Tower height limit: 500m (engineering challenge)

---

## 🎯 Next Steps
1. **Initialize project** with Vite + Three.js + TypeScript
2. **Create pixel art shader** and test with sample atlas
3. **Build first map** (City Day) with parallax
4. **Implement placement system** with ghost preview
5. **Add block palette** with 5 initial block types

Would you like me to start implementing Phase 1? I can begin with the project setup and core rendering foundation.