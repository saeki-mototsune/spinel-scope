const chips = new Map(
  [...document.querySelectorAll(".stage-chip")].map((el) => [el.dataset.stage, el]),
);

export function setStage(stage, state, ms) {
  const chip = chips.get(stage);
  if (!chip) return;
  chip.dataset.state = state;
  chip.querySelector(".stage-ms").textContent = ms == null ? "" : `${ms}ms`;
}

export function resetStages() {
  for (const stage of chips.keys()) setStage(stage, "idle");
}
