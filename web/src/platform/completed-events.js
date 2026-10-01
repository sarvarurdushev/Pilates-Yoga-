export function markCompletion(input, markedAt = new Date().toISOString()) {
  if (input.checked) input.dataset.completedAt = markedAt;
  else delete input.dataset.completedAt;
}

export function completedEventPayload(inputs) {
  const selected = Array.from(inputs).filter((input) => input.checked);
  return {
    completed: selected.map((input) => input.value),
    completed_events: selected.map((input) => ({
      key: input.value,
      completed_at: input.dataset.completedAt || null,
    })),
  };
}
