import * as THREE from 'three';
import { MOLECULE_TYPES, randomMoleculeTypeIndex } from './moleculeData.js';

/**
 * MolecularPlanet
 * -----------------------------------------------------------------------
 * A sphere-shell "planet" built from thousands of instanced molecule
 * specks. One InstancedMesh = one draw call, so instance count can climb
 * into the thousands without the frame rate suffering (the MediaPipe
 * inference pass, not the render, is the actual per-frame bottleneck).
 *
 * Each instance remembers its rest position/scale/quaternion so the
 * "explode" interaction can scale distance-from-center on the fly without
 * re-deriving random transforms every frame.
 */
export class MolecularPlanet {
  constructor({ count = 6000, innerRadius = 3.0, outerRadius = 4.4 } = {}) {
    this.count = count;
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
    this.explosionFactor = 0; // 0 = rest shell, 1 = fully scattered

    this.group = new THREE.Group();
    this.group.name = 'molecularPlanet';

    this._basePos = new Float32Array(count * 3);
    this._scale = new Float32Array(count);
    this._quat = new Float32Array(count * 4);
    this.typeIndices = new Int16Array(count);

    this._buildMesh();
    this._buildHighlight();
    this._generateInstances();
    this._applyExplosion(); // write initial (rest) matrices
  }

  _buildMesh() {
    const geometry = new THREE.IcosahedronGeometry(0.06, 0);
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.4,
      metalness: 0.25,
      emissive: new THREE.Color(0x0a1512),
      emissiveIntensity: 0.8,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
  }

  /** Small wireframe icosahedron that snaps to whichever instance is hovered/selected. */
  _buildHighlight() {
    const geometry = new THREE.IcosahedronGeometry(0.11, 0);
    const material = new THREE.MeshBasicMaterial({
      color: 0xe8a94d,
      wireframe: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    this.highlight = new THREE.Mesh(geometry, material);
    this.highlight.visible = false;
    this.highlight.renderOrder = 10;
    this.group.add(this.highlight);
  }

  _generateInstances() {
    const color = new THREE.Color();
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const dummyQuat = new THREE.Quaternion();
    const dummyEuler = new THREE.Euler();

    for (let i = 0; i < this.count; i++) {
      const t = (i + 0.5) / this.count;
      const inclination = Math.acos(1 - 2 * t);
      const azimuth = goldenAngle * i;
      const radius = THREE.MathUtils.lerp(this.innerRadius, this.outerRadius, Math.random());

      const x = Math.sin(inclination) * Math.cos(azimuth) * radius;
      const y = Math.sin(inclination) * Math.sin(azimuth) * radius;
      const z = Math.cos(inclination) * radius;

      const idx3 = i * 3;
      this._basePos[idx3] = x;
      this._basePos[idx3 + 1] = y;
      this._basePos[idx3 + 2] = z;

      this._scale[i] = THREE.MathUtils.randFloat(0.55, 1.35);

      dummyEuler.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      dummyQuat.setFromEuler(dummyEuler);
      const q4 = i * 4;
      this._quat[q4] = dummyQuat.x;
      this._quat[q4 + 1] = dummyQuat.y;
      this._quat[q4 + 2] = dummyQuat.z;
      this._quat[q4 + 3] = dummyQuat.w;

      const typeIdx = randomMoleculeTypeIndex();
      this.typeIndices[i] = typeIdx;
      color.setHex(MOLECULE_TYPES[typeIdx].color);
      this.mesh.setColorAt(i, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Rewrites every instance matrix for the current explosionFactor. Called on gather/scatter changes. */
  _applyExplosion() {
    const dummy = new THREE.Object3D();
    const scaleMul = 1 + this.explosionFactor * 2.4;
    for (let i = 0; i < this.count; i++) {
      const idx3 = i * 3;
      dummy.position.set(this._basePos[idx3] * scaleMul, this._basePos[idx3 + 1] * scaleMul, this._basePos[idx3 + 2] * scaleMul);
      const q4 = i * 4;
      dummy.quaternion.set(this._quat[q4], this._quat[q4 + 1], this._quat[q4 + 2], this._quat[q4 + 3]);
      dummy.scale.setScalar(this._scale[i]);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  /** factor in [0,1]; 0 = rest shell, 1 = fully scattered outward ("exploded"). */
  setExplosionFactor(factor) {
    const clamped = THREE.MathUtils.clamp(factor, 0, 1);
    if (Math.abs(clamped - this.explosionFactor) < 0.001) return;
    this.explosionFactor = clamped;
    this._applyExplosion();
  }

  /** Slow ambient spin so the planet reads as alive even with no hands in frame. */
  update(deltaSeconds) {
    this.group.rotation.y += deltaSeconds * 0.035;
  }

  /** Casts a ray and returns { typeIndex, instanceId, worldPosition } for the nearest hit molecule, or null. */
  pick(raycaster) {
    const hits = raycaster.intersectObject(this.mesh, false);
    if (!hits.length || hits[0].instanceId == null) {
      this.setHighlighted(null);
      return null;
    }
    const instanceId = hits[0].instanceId;
    this.setHighlighted(instanceId);
    return {
      instanceId,
      typeIndex: this.typeIndices[instanceId],
      type: MOLECULE_TYPES[this.typeIndices[instanceId]],
      worldPosition: hits[0].point,
    };
  }

  setHighlighted(instanceId) {
    if (instanceId == null) {
      this.highlight.visible = false;
      return;
    }
    const matrix = new THREE.Matrix4();
    this.mesh.getMatrixAt(instanceId, matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
    this.highlight.position.copy(pos);
    this.highlight.visible = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.highlight.geometry.dispose();
    this.highlight.material.dispose();
  }
}
