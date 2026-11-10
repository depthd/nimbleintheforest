import * as THREE from 'three';
import type { Landforms, Point } from './landforms';
import { buildPlaneWreck, buildMountainStation, type MountainLandmark } from './landmarks';
import { EXPEDITION_SITES } from './expedition-sites';

export interface PlacedLandmark extends MountainLandmark {
  id: 'wreck' | 'station';
}

/** One matrix transforms every rendered vertex, collider and access anchor.
 * Negative determinant seed transforms reverse triangle winding as well.
 */
export function placeExpedition(land: Landforms): PlacedLandmark[] {
  return EXPEDITION_SITES.map(site => {
    const asset = site.id === 'wreck' ? buildPlaneWreck() : buildMountainStation();
    const origin = land.world(0, 0), x = land.world(1, 0), z = land.world(0, 1);
    const frame = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(x.x - origin.x, 0, x.z - origin.z),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(z.x - origin.x, 0, z.z - origin.z),
    ).setPosition(origin.x, 0, origin.z);
    const matrix = frame.multiply(new THREE.Matrix4().makeTranslation(site.x, site.y, site.z))
      .multiply(new THREE.Matrix4().makeRotationY(site.yaw));
    asset.group.applyMatrix4(matrix);
    asset.group.updateMatrixWorld(true);
    const v = new THREE.Vector3(), positions = asset.collider.positions.slice(), indices = asset.collider.indices.slice();
    for (let i = 0; i < positions.length; i += 3) v.fromArray(positions, i).applyMatrix4(matrix).toArray(positions, i);
    if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) {
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
    const anchors = Object.fromEntries(Object.entries(asset.anchors).map(([key, p]) => {
      v.set(p.x, p.y, p.z).applyMatrix4(matrix);
      return [key, { x: v.x, y: v.y, z: v.z }];
    }));
    const bounds = new THREE.Box3().setFromObject(asset.group);
    return { ...asset, id: site.id, collider: { positions, indices }, anchors,
      footprint: { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z } };
  });
}

export function expeditionViews(land: Landforms, assets: PlacedLandmark[]) {
  const wreck = assets.find(a => a.id === 'wreck')!, station = assets.find(a => a.id === 'station')!;
  const ground = (x: number, z: number): Point => { const w = land.world(x, z); return { ...w, y: land.heightAt(w.x, w.z) + 1.8 }; };
  const eye = (p: Point): Point => ({ ...p, y: p.y + 1.8 });
  return [
    { id: 'wreck-hint', name: 'За снежным плечом · обломок хвоста', position: ground(-172, -454), target: wreck.anchors.silhouette },
    { id: 'wreck-reveal', name: 'Верхний цирк · самолёт', position: ground(-91, -447), target: { ...wreck.anchors.hold, y: wreck.anchors.hold.y + 2 } },
    { id: 'wreck-entry', name: 'Разлом · вход в грузовой отсек', position: eye(wreck.anchors.approach), target: eye(wreck.anchors.hold) },
    { id: 'wreck-hold', name: 'Грузовой отсек · укрытие', position: eye(wreck.anchors.hold), target: eye(wreck.anchors.approach) },
    { id: 'crest-return', name: 'С гребня · весь пройденный цирк', position: ground(-190, -516), target: eye(wreck.anchors.hold) },
    { id: 'station-reveal', name: 'Лесное плечо · станция', position: ground(343, -108), target: eye(station.anchors.hall) },
    { id: 'station-entry', name: 'Станция · открытый ангар', position: eye(station.anchors.approach), target: eye(station.anchors.hall) },
    { id: 'station-office', name: 'Станция · мастерская и ночлег', position: eye(station.anchors.office), target: { ...station.anchors.officeApproach, y: station.anchors.officeApproach.y + 1.8 } },
  ];
}
