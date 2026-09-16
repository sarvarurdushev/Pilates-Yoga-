export const exercises = [
  {
    id: "breathing",
    name: "Supported breathing",
    area: "Awareness",
    seconds: 90,
    cue: "Sit comfortably with support. Breathe at your normal pace and let the shoulders settle. Avoid forcing a deeper breath.",
    source:
      "https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/",
  },
  {
    id: "bird-dog",
    name: "Bird dog",
    area: "Trunk control",
    seconds: 60,
    image: "bird-dog.png",
    cue: "Begin on hands and knees. Reach the opposite arm and leg within a comfortable range while keeping the trunk steady. Return slowly.",
    source: "https://www.orthoinfo.org/recovery/spine-conditioning-program/",
  },
  {
    id: "bridge",
    name: "Bridge",
    area: "Hip control",
    seconds: 60,
    image: "bridge.png",
    cue: "Lie on your back with knees bent and feet supported. Lift the hips comfortably, then lower with control. Keep breathing.",
    source: "https://www.orthoinfo.org/recovery/spine-conditioning-program/",
  },
  {
    id: "wall-slide",
    name: "Comfortable arm raise",
    area: "Shoulder mobility",
    seconds: 60,
    cue: "Stand comfortably and raise the arms through an easy range. Keep the movement slow. Your coach can adjust the range or add support.",
    source:
      "https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/",
  },
  {
    id: "balance",
    name: "Supported balance",
    area: "Balance",
    seconds: 60,
    cue: "Stand beside a stable support. Briefly shift weight to one foot while keeping support within reach. Alternate sides at your own pace.",
    source: "https://www.nhs.uk/live-well/exercise/balance-exercises/",
  },
  {
    id: "stretch",
    name: "Comfortable mobility",
    area: "Cool down",
    seconds: 90,
    cue: "Choose an easy standing or seated movement with your coach. Move smoothly without bouncing or forcing the end of the range.",
    source:
      "https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/",
  },
];
export const exerciseById = (id) => exercises.find((e) => e.id === id);
