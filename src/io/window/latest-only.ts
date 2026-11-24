/** Runs a step one at a time, and once more after a run that another call came in during. */
export function latestOnly(step: () => Promise<void>): () => Promise<void> {
  let running = false;
  let again = false;
  return async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await step();
      } while (again);
    } finally {
      running = false;
    }
  };
}
