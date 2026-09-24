import * as THREE from 'three';
import './style.css';
import { Game } from './game';
import { isCapture } from './core/params';

// M0 test scene: a ground plane and a few blocks, until the generated world is wired in.
const game = new Game(document.getElementById('app')!);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x6f7a5a, roughness: 0.95 }),
);
ground.receiveShadow = true;
game.scene.add(ground);

const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const colors = [0xe8d9c4, 0xf2c6c2, 0xbfe0dc, 0xdedede, 0x9fb4c7];
for (let i = 0; i < 60; i++) {
  const h = 6 + ((i * 37) % 11) * 9;
  const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.8 }));
  m.scale.set(18, h, 18);
  m.position.set(((i % 10) - 5) * 40, 0, (Math.floor(i / 10) - 3) * 40);
  m.castShadow = m.receiveShadow = true;
  game.scene.add(m);
}

addHint();
document.getElementById('loading')?.classList.add('done');
game.start();
game.markReady();

function addHint(): void {
  if (isCapture) return;
  const el = document.createElement('div');
  el.className = 'hint';
  el.innerHTML =
    '<b>Port Solmar</b> (early build)<br>' +
    '<kbd>Click</kbd> look around &nbsp; <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly<br>' +
    '<kbd>E</kbd>/<kbd>Q</kbd> up/down &nbsp; <kbd>Shift</kbd> fast &nbsp; wheel: speed<br>' +
    '<kbd>[</kbd><kbd>]</kbd> time of day &nbsp; <kbd>O</kbd> quality &nbsp; <kbd>F3</kbd> stats &nbsp; <kbd>F2</kbd> screenshot';
  document.body.appendChild(el);
}
