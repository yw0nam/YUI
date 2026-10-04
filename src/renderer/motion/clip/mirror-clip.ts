import type { AnimationClip } from "three";

/** Mirror a clip across the YZ plane and return a new clip. */
export function mirrorClipTracks(
  clip: AnimationClip,
  nameSwap: Map<string, string>,
): AnimationClip {
  const mirrored = clip.clone();
  const names = mirrored.tracks.map((track) => track.name);

  mirrored.tracks.forEach((track, trackIndex) => {
    const name = names[trackIndex];
    const splitAt = name.lastIndexOf(".");
    if (splitAt < 0) return;
    const node = name.slice(0, splitAt);
    const property = name.slice(splitAt);
    const counterpart = nameSwap.get(node);
    if (counterpart) track.name = `${counterpart}${property}`;

    if (property === ".quaternion") {
      for (let i = 0; i < track.values.length; i += 4) {
        track.values[i + 1] *= -1;
        track.values[i + 2] *= -1;
      }
    } else if (property === ".position") {
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] *= -1;
      }
    }
  });

  return mirrored;
}
