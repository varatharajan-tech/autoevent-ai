// Intelligent reel edit planner.
// Turns Vision AI data (ai_score, emotional_energy, storytelling_value,
// brand_moment, ai_scene_label, key_moment) into a narrative edit plan:
// HOOK → BUILD → BUILD → CLIMAX → CLOSE, with per-shot duration and a
// transition matched to what is actually in the photo.

export interface AssetWithVisionData {
  id: string;
  storage_path: string;
  signedUrl: string;
  kind?: "image" | "video";
  ai_score: number | null;
  emotional_energy: number | null;
  storytelling_value: number | null;
  people_engagement: number | null;
  composition_quality: number | null;
  brand_moment: boolean | null;
  ai_scene_label: string | null;
  key_moment: string | null;
  scoring_method: string | null;
}

export type NarrativePosition = "hook" | "build" | "climax" | "close";

export type TransitionType =
  | "flash"
  | "zoom_burst"
  | "cinematic_fade"
  | "smooth_slide"
  | "clean_cut"
  | "dramatic_fade";

export interface ScenePlan {
  asset: AssetWithVisionData;
  position: NarrativePosition;
  duration: number;
  transition: TransitionType;
  subtitleText: string | null;
  showSubtitle: boolean;
  isHook: boolean;
  isClose: boolean;
  shotIndex: number;
}

export interface ReelEditPlan {
  scenes: ScenePlan[];
  totalDuration: number;
  hookScene: ScenePlan | null;
  closeScene: ScenePlan | null;
  climaxScene: ScenePlan | null;
  eventName: string;
  brandName: string;
  editStyle: string;
}

export function calculateShotDuration(
  asset: AssetWithVisionData,
  position: NarrativePosition,
): number {
  if (position === "hook") return 1.8;
  if (position === "close") return 3.5;
  const story = asset.storytelling_value ?? 5;
  const energy = asset.emotional_energy ?? 5;
  if (story >= 9 || energy >= 9) return 4.0;
  if (story >= 7 || energy >= 7) return 3.0;
  if (story >= 5 || energy >= 5) return 2.5;
  return 2.0;
}

export function selectTransition(
  sceneLabel: string | null,
  position: NarrativePosition,
  emotionalEnergy: number | null,
): TransitionType {
  if (position === "hook") return "zoom_burst";
  if (position === "close") return "dramatic_fade";

  const label = (sceneLabel || "").toLowerCase();
  const has = (...words: string[]) => words.some(w => label.includes(w));

  if (has("award", "ceremony", "prize", "winner", "trophy")) return "flash";
  if (has("crowd", "applaud", "audience", "cheer", "dance", "celebrat")) return "zoom_burst";
  if (has("speaker", "podium", "address", "panel", "keynote", "stage")) return "cinematic_fade";
  if (has("network", "group", "lunch", "meeting", "conversation", "booth")) return "smooth_slide";
  if (has("brand", "logo", "product", "banner", "signage", "sponsor")) return "clean_cut";

  const energy = emotionalEnergy ?? 5;
  if (energy >= 8) return "flash";
  if (energy >= 6) return "zoom_burst";
  return "cinematic_fade";
}

const emptyPlan = (eventName: string, brandName: string, editStyle: string): ReelEditPlan => ({
  scenes: [],
  totalDuration: 0,
  hookScene: null,
  closeScene: null,
  climaxScene: null,
  eventName,
  brandName,
  editStyle,
});

/** True when at least one asset carries usable Vision AI scoring. */
export function hasVisionData(assets: AssetWithVisionData[]): boolean {
  return (assets ?? []).some(a => a.ai_score !== null && a.ai_score !== undefined);
}

/** No Vision AI data: upload order, flat 3s shots, plain fades. Never fails. */
function fallbackPlan(
  assets: AssetWithVisionData[],
  eventName: string,
  brandName: string,
): ReelEditPlan {
  const picked = assets.slice(0, 5);
  const scenes: ScenePlan[] = picked.map((asset, index) => {
    const isHook = index === 0;
    const isClose = index === picked.length - 1 && picked.length > 1;
    const position: NarrativePosition = isHook ? "hook" : isClose ? "close" : "build";
    return {
      asset,
      position,
      duration: 3,
      transition: isClose ? "dramatic_fade" : "cinematic_fade",
      subtitleText: asset.key_moment || asset.ai_scene_label || null,
      showSubtitle: false,
      isHook,
      isClose,
      shotIndex: index,
    };
  });
  return {
    scenes,
    totalDuration: Math.round(scenes.reduce((s, x) => s + x.duration, 0) * 10) / 10,
    hookScene: scenes.find(s => s.isHook) ?? null,
    closeScene: scenes.find(s => s.isClose) ?? null,
    climaxScene: null,
    eventName,
    brandName,
    editStyle: "fallback",
  };
}

export function buildNarrativeArc(
  assets: AssetWithVisionData[],
  eventName: string,
  brandName: string,
  editStyle: string = "cinematic",
): ReelEditPlan {
  if (!assets || assets.length === 0) return emptyPlan(eventName, brandName, editStyle);
  if (!hasVisionData(assets)) return fallbackPlan(assets, eventName, brandName);

  const scored = [...assets].sort((a, b) => (b.ai_score ?? 0) - (a.ai_score ?? 0));

  // HOOK — most energetic frame.
  const hookAsset = [...assets].sort(
    (a, b) => (b.emotional_energy ?? 0) - (a.emotional_energy ?? 0),
  )[0];

  // CLOSE — prefer a brand-visible frame, else the lowest storytelling frame.
  const brandPhotos = assets.filter(a => a.brand_moment === true && a.id !== hookAsset?.id);
  const closeAsset =
    brandPhotos.length > 0
      ? brandPhotos[0]
      : [...assets]
          .filter(a => a.id !== hookAsset?.id)
          .sort((a, b) => (a.storytelling_value ?? 0) - (b.storytelling_value ?? 0))[0];

  // CLIMAX — highest storytelling frame not already used.
  const usedIds = new Set<string>([hookAsset?.id, closeAsset?.id].filter(Boolean) as string[]);
  const climaxAsset = [...assets]
    .filter(a => !usedIds.has(a.id))
    .sort((a, b) => (b.storytelling_value ?? 0) - (a.storytelling_value ?? 0))[0];
  if (climaxAsset) usedIds.add(climaxAsset.id);

  // BUILD — up to 2 more, best score first.
  const buildAssets = scored.filter(a => !usedIds.has(a.id)).slice(0, 2);

  const ordered: Array<{ asset: AssetWithVisionData; position: NarrativePosition }> = [];
  if (hookAsset) ordered.push({ asset: hookAsset, position: "hook" });
  buildAssets.forEach(a => ordered.push({ asset: a, position: "build" }));
  if (climaxAsset) ordered.push({ asset: climaxAsset, position: "climax" });
  if (closeAsset && closeAsset.id !== hookAsset?.id) {
    ordered.push({ asset: closeAsset, position: "close" });
  }

  let totalDuration = 0;
  const scenes: ScenePlan[] = ordered.map(({ asset, position }, index) => {
    const duration = calculateShotDuration(asset, position);
    const transition = selectTransition(asset.ai_scene_label, position, asset.emotional_energy);
    const subtitleText = asset.key_moment || asset.ai_scene_label || null;
    totalDuration += duration;
    return {
      asset,
      position,
      duration,
      transition,
      subtitleText,
      showSubtitle: !!subtitleText && position !== "hook",
      isHook: position === "hook",
      isClose: position === "close",
      shotIndex: index,
    };
  });

  return {
    scenes,
    totalDuration: Math.round(totalDuration * 10) / 10,
    hookScene: scenes.find(s => s.isHook) ?? null,
    closeScene: scenes.find(s => s.isClose) ?? null,
    climaxScene: scenes.find(s => s.position === "climax") ?? null,
    eventName,
    brandName,
    editStyle,
  };
}
