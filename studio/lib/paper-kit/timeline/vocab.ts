// Словари бумажного набора: позы, эмоции, предметы и точки кадра, которые набор умеет рисовать.
export const SPOTS = [
  "left", "center", "right", "far-left", "far-right",
] as const;
export const ANCHORS = [
  "top", "upper-left", "upper-right", "middle", "middle-left", "middle-right",
  "lower-left", "lower-right", "bottom",
] as const;
export const MOODS = ["neutral", "happy", "sad", "shocked", "proud", "worried", "thinking"] as const;
export const GESTURES = ["idle", "wave", "point", "hold", "shrug", "cheer"] as const;
export const PROPS = [
  "coin", "coins", "fish", "boat", "house", "bank", "car", "crown", "question",
  "bulb", "cross", "heart", "arrow-up", "arrow-down", "chest",
] as const;
export const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;
