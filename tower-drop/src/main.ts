import './style.css';
import { Engine } from './core/Engine';
import { InputManager } from './core/InputManager';
import { CameraSystem } from './systems/CameraSystem';
import { SplashCinematic } from './systems/SplashCinematic';
import { SceneSystem } from './systems/SceneSystem';
import { WeatherSystem } from './systems/WeatherSystem';
import { PostFXSystem } from './systems/PostFXSystem';
import { CitySystem } from './systems/CitySystem';
import { MarketSystem } from './systems/MarketSystem';
import { BuildSystem } from './systems/BuildSystem';
import { AudioSystem } from './systems/AudioSystem';
import { UISystem } from './ui/UISystem';
import { saveCity, loadCity, hasSave } from './systems/SaveSystem';
import { installHeightFog } from './utils/heightFog';

// Must run before the first render: overrides THREE.ShaderChunk.fog_* so every
// built-in material gets altitude-aware haze instead of flat distance fog.
installHeightFog();

function main(): void {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app not found');

  const uiRoot = document.createElement('div');
  uiRoot.id = 'ui';
  document.body.appendChild(uiRoot);

  // --- core ---
  const engine = new Engine(container);
  const input = new InputManager(engine.renderer.domElement, engine.camera);

  // --- systems ---
  // created before SceneSystem so it catches the initial sceneChanged event
  const postfx = new PostFXSystem(engine);
  const cameraSystem = new CameraSystem(engine.camera, input);
  // title-screen camera: composes the live city behind the splash card
  const splashCine = new SplashCinematic(engine, cameraSystem);
  const sceneSystem = new SceneSystem(engine);
  const city = new CitySystem(engine);
  // educational stock market: own RNG, own feed, own allowance (a separate
  // pocket of money) — ticks with the city but never writes into it
  const market = new MarketSystem(engine, city);
  // dynamic weather: shares one live modifier object with the systems that
  // paint it (SceneSystem) or react to it (CitySystem, AudioSystem, UI)
  const weather = new WeatherSystem(engine, () => city.season);
  sceneSystem.attachWeather(weather.mod);
  city.attachWeather(weather.mod);
  // pollution → smog: one live value drives the sky haze and the grade veil
  sceneSystem.attachSmog(() => city.pollution);
  postfx.attachSmog(() => city.pollution);
  const build = new BuildSystem(engine, input, city);
  const audio = new AudioSystem(sceneSystem, city, weather);
  const ui = new UISystem(uiRoot, engine, city, build, sceneSystem, audio, weather, market);

  // splashCine first: it composes the shot, CameraSystem then follows it
  engine.addSystem(splashCine);
  engine.addSystem(cameraSystem);
  engine.addSystem(postfx);
  engine.addSystem(weather); // before sceneSystem so paint() reads fresh values
  engine.addSystem(sceneSystem);
  engine.addSystem(city);
  engine.addSystem(market); // after the city so it reads a fresh day/tick
  engine.addSystem(build);
  engine.addSystem(audio);
  engine.addSystem({ update: () => input.endFrame() });

  // --- input wiring ---
  input.onDigitPressed = (n) => ui.selectDigit(n);
  input.onUndo = () => city.undo();
  input.onMapSelect = () => sceneSystem.cycle();
  input.onPause = () => ui.togglePause();
  input.onNews = () => ui.toggleNews();
  input.onCutaway = () => ui.toggleCutaway();
  input.onSave = () => {
    const ok = saveCity(city, sceneSystem.current, market);
    ui.toast(ok ? '💾 City saved!' : '❌ Save failed');
  };
  input.onLoad = () => {
    const s = loadCity(city, market);
    if (s) {
      sceneSystem.apply(s);
      ui.toast('📂 City loaded!');
    } else {
      ui.toast('No save found');
    }
  };

  // --- build the world ---
  city.generate();
  sceneSystem.apply('day');

  if (hasSave()) {
    const s = loadCity(city, market);
    if (s) {
      sceneSystem.apply(s);
      ui.toast('📂 Save restored');
    }
  }

  engine.setState('playing');
  engine.start();

  (window as unknown as { game: unknown }).game = {
    engine, city, build, sceneSystem, cameraSystem, postfx, input, ui, audio,
    weather, traffic: city.traffic, market,
  };
  console.log('%c🏙 City Builder loaded', 'color:#4ade80;font-weight:bold');
}

main();