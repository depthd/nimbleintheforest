// Audio follows the support accepted by locomotion, not a house/water map zone.
// Keeping the decision pure also lets probes snapshot snow before the boot deforms it.
export type FootstepMaterial = 'snow' | 'wood' | 'ice' | 'stone';
export type Footwear = 'soft' | 'boot' | 'sneaker' | 'bare';

// These definitions have wooden standing surfaces in buildItemMesh. Do not
// infer a surface from fuel/chop properties: a bed has a mattress, for example.
const WOODEN_ITEMS = new Set(['chair', 'stool', 'table', 'wardrobe', 'cabinet', 'crate',
  'chest', 'bench', 'workbench', 'block', 'shelf']);
export function isWoodenFootstepOwner(owner: { kind?: string; defId?: string; data?: { wood?: unknown } } | null | undefined): boolean {
  return !!owner && (!!owner.data?.wood || owner.kind === 'door' || owner.kind === 'railing' ||
    owner.kind === 'trunk' || owner.kind === 'stump' || WOODEN_ITEMS.has(owner.defId ?? ''));
}

export interface FootstepEvidence {
  support?: number;
  woodenSupport?: boolean;
  iceSupport?: boolean;
  terrainSupport?: boolean;
  /** Only supplied by a snow probe that accepted this particular support. */
  snowDepth?: number;
  packedSnow?: boolean;
  compaction?: number;
}

export function footstepSurface(e: FootstepEvidence): { material: FootstepMaterial; compaction?: number } {
  if (e.support === undefined) return { material: 'stone' };
  // A plank above a lake or snowy terrain remains a plank. The actual support
  // takes precedence; there is no invented snowy cover on ice or structures.
  if (e.woodenSupport) return { material: 'wood' };
  if (e.iceSupport) return { material: 'ice' };
  if ((e.snowDepth !== undefined && e.snowDepth > 0.004) || (e.terrainSupport && e.packedSnow)) {
    const barePackedBase = e.terrainSupport && e.packedSnow && !(e.snowDepth! > 0.004);
    return { material: 'snow', compaction: barePackedBase ? 1 :
      Number.isFinite(e.compaction) ? Math.max(0, Math.min(1, e.compaction!)) : 0 };
  }
  return { material: 'stone' };
}

export function footwearFor(id: string | undefined): Footwear {
  if (id === 'sneakers') return 'sneaker';
  if (id === 'valenki' || id === 'unty') return 'soft';
  if (id === 'boots') return 'boot';
  return 'bare';
}

export function footstepSound(material: FootstepMaterial | undefined): 'step_snow' | 'step_wood' | 'step_ice' | 'step_stone' {
  return material === 'snow' ? 'step_snow' : material === 'wood' ? 'step_wood' : material === 'ice' ? 'step_ice' : 'step_stone';
}
