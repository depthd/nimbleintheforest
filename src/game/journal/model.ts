// @ts-nocheck
// Geometry adapted from the supplied diary prototype; authored units scaled to metres.
import * as THREE from 'three';
import { createDiaryTextures } from './textures';
export function createJournalModel(renderer: THREE.WebGLRenderer) {
const diary = new THREE.Group();
const textures = createDiaryTextures(renderer);
const paperLeft = new THREE.MeshStandardMaterial({map:textures.leftTexture,roughness:1,side:THREE.DoubleSide});
const paperRight = new THREE.MeshStandardMaterial({map:textures.rightTexture,roughness:1,side:THREE.DoubleSide});
const paperEdge = new THREE.MeshStandardMaterial({color:0x8f7751,roughness:1});
const paperDark = new THREE.MeshStandardMaterial({color:0x6b573a,roughness:1});
const leather = new THREE.MeshStandardMaterial({color:0x302820,roughness:.96,side:THREE.DoubleSide});
const leatherEdge = new THREE.MeshStandardMaterial({color:0x191917,roughness:.9});
const PAGE_W = 3.2;
const PAGE_H = 4.6;
function pageZ(u, v) {
  return .055 + Math.sin(u * Math.PI) * .17 - u * .075 + Math.cos((v - .5) * Math.PI) * .035;
}

function makePageGeometry(side, width = PAGE_W, height = PAGE_H, zOffset = 0, sx = 28, sy = 18) {
  const positions = [], uvs = [], indices = [];
  for (let iy = 0; iy <= sy; iy++) {
    const v = iy / sy;
    for (let ix = 0; ix <= sx; ix++) {
      const u = ix / sx;
      const deckle = ix === sx ? Math.sin(iy * 12.73) * .012 : 0;
      const x = side * (u * width + deckle);
      const y = (v - .5) * height + (ix === sx ? Math.sin(iy * 7.31) * .008 : 0);
      positions.push(x, y, pageZ(u, v) + zOffset);
      uvs.push(side < 0 ? 1 - u : u, v);
    }
  }
  for (let iy = 0; iy < sy; iy++) {
    for (let ix = 0; ix < sx; ix++) {
      const a = iy * (sx + 1) + ix, b = a + 1, c = a + sx + 1, d = c + 1;
      if (side > 0) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

for (const side of [-1, 1]) {
  const cover = new THREE.Mesh(makePageGeometry(side, PAGE_W + .15, PAGE_H + .18, -.25), leather);
  cover.name = side < 0 ? 'Cover_Left' : 'Cover_Right';diary.add(cover);
  for (let layer = 0; layer < 7; layer++) {
    const sheet = new THREE.Mesh(
      makePageGeometry(side, PAGE_W + .018 - layer * .003, PAGE_H + .015 - layer * .002, -.025 - layer * .023, 20, 12),
      layer % 3 === 0 ? paperDark : paperEdge
    );
    sheet.name = `${side < 0 ? 'Left' : 'Right'}_Paper_Layer_${layer + 1}`;
    diary.add(sheet);
  }
  const page = new THREE.Mesh(makePageGeometry(side), side < 0 ? paperLeft : paperRight);
  page.name = side < 0 ? 'Page_Left_Dynamic' : 'Page_Right';
  page.userData = side < 0 ? { dynamicTexture: true, indicators: ['hunger', 'thirst', 'fatigue', 'temperature'] } : {};
  diary.add(page);
}

const spine = new THREE.Mesh(new THREE.CylinderGeometry(.115, .135, PAGE_H + .2, 10, 1), leatherEdge);
spine.name = 'Leather_Spine';spine.position.set(0, 0, -.13);diary.add(spine);
const spineRidge = new THREE.Mesh(new THREE.CylinderGeometry(.035, .04, PAGE_H + .05, 8), paperDark);
spineRidge.name = 'Central_Fold';spineRidge.position.set(0, 0, .07);diary.add(spineRidge);

// Thin, imperfect raised cover rims give the open model a readable edge in game views.
for (const side of [-1, 1]) {
  const rim = new THREE.Mesh(new THREE.BoxGeometry(.055, PAGE_H + .14, .13), leatherEdge);
  rim.name = side < 0 ? 'Cover_Edge_Left' : 'Cover_Edge_Right';
  rim.position.set(side * (PAGE_W + .12), 0, -.23);rim.rotation.z = side * .004;diary.add(rim);
}


diary.scale.setScalar(.065);
return { model: diary, textures };
}
