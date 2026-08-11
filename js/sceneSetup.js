import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export const CAMERA_START_Z = 11;

/**
 * SceneSetup
 * -----------------------------------------------------------------------
 * Everything that exists independent of the planet itself: renderer,
 * camera, void-of-space background, lab-style teal/amber point lights,
 * a slow starfield, and a modest bloom pass so the molecule specks read
 * as glowing rather than flat-shaded.
 */
export class SceneSetup {
  constructor(canvas, { bloom = true } = {}) {
    this.canvas = canvas;
    this.bloomEnabled = bloom;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090c11);
    this.scene.fog = new THREE.FogExp2(0x090c11, 0.011);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 0, CAMERA_START_Z);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this._buildLights();
    this._buildStarfield();
    this._buildComposer();

    this._onResize = () => this.handleResize();
    window.addEventListener('resize', this._onResize);
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x2c4750, 0x0a0806, 0.7);
    this.scene.add(hemi);

    const teal = new THREE.PointLight(0x4dd9c4, 22, 34, 2);
    teal.position.set(-6.5, 3, 6);
    this.scene.add(teal);

    const amber = new THREE.PointLight(0xe8a94d, 16, 32, 2);
    amber.position.set(7, -4, 4.5);
    this.scene.add(amber);

    const rim = new THREE.DirectionalLight(0xaecdd6, 0.45);
    rim.position.set(0, 6, -8);
    this.scene.add(rim);
  }

  _buildStarfield() {
    const starCount = 1800;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = THREE.MathUtils.randFloat(40, 95);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x9fb4bd,
      size: 0.3,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
    });
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  _buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55, // strength
      0.65, // radius
      0.18 // threshold
    );
    this.bloomPass.enabled = this.bloomEnabled;
    this.composer.addPass(this.bloomPass);
  }

  setBloomEnabled(enabled) {
    this.bloomEnabled = enabled;
    this.bloomPass.enabled = enabled;
  }

  handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render() {
    this.stars.rotation.y += 0.00005;
    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.renderer.dispose();
  }
}
