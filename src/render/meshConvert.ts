import * as THREE from 'three';
import type { MeshData } from '../world/mesh/meshData';

/** Turn plain MeshData (from world generation) into a BufferGeometry. */
export function toBufferGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  if (m.colors) g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
  if (m.extra) {
    for (const [name, a] of Object.entries(m.extra)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize));
  }
  const maxIndex = m.positions.length / 3;
  g.setIndex(new THREE.BufferAttribute(maxIndex > 65535 ? m.indices : new Uint16Array(m.indices), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
