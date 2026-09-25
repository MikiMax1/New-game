// Prints world-space bounds of each top-level node of a GLB (textures skipped).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
globalThis.self = globalThis;
const id = process.argv[2];
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const buf = readFileSync(`public/content/models/${id}/${id}.glb`);
// Drop images so no decoding is attempted.
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
delete json.images; delete json.textures; delete json.samplers;
for (const m of json.materials ?? []) { for (const k of Object.keys(m)) if (/Texture$/.test(k)) delete m[k]; if (m.pbrMetallicRoughness) for (const k of Object.keys(m.pbrMetallicRoughness)) if (/Texture$/.test(k)) delete m.pbrMetallicRoughness[k]; delete m.extensions; }
json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => !/texture|materials/.test(e));
json.extensionsRequired = (json.extensionsRequired ?? []).filter((e) => !/texture|materials/.test(e));
let js = Buffer.from(JSON.stringify(json));
const pad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
const binStart = 20 + jsonLen;
const bin = buf.slice(binStart);
const out = Buffer.alloc(12 + 8 + js.length + bin.length);
out.write('glTF', 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(js.length, 12); out.write('JSON', 16); js.copy(out, 20); bin.copy(out, 20 + js.length);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
await MeshoptDecoder.ready;
loader.parse(out.buffer.slice(out.byteOffset, out.byteOffset + out.length), '', (gltf) => {
  gltf.scene.updateMatrixWorld(true);
  const b = new THREE.Box3(), s = new THREE.Vector3();
  const deep = process.argv.includes('--meshes');
  const items = [];
  if (deep) gltf.scene.traverse((o) => o.isMesh && items.push(o)); else items.push(...gltf.scene.children);
  for (const c of items) {
    if (filter && !filter.test(c.name)) continue;
    b.setFromObject(c); b.getSize(s);
    let tris = 0; c.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    console.log(`${c.name.padEnd(36)} size ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)}  min ${b.min.x.toFixed(2)},${b.min.y.toFixed(2)},${b.min.z.toFixed(2)}  max ${b.max.x.toFixed(2)},${b.max.y.toFixed(2)},${b.max.z.toFixed(2)}  tris ${tris}`);
  }
}, (e) => console.error('ERR', e));
