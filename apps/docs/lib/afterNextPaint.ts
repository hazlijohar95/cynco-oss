// Resolves after the browser has painted the frame that the pending state
// update produced: two rAFs guarantee the commit painted, and the trailing
// setTimeout escapes the rAF callback so any synchronous block that follows
// does not run inside the frame budget. Used before deliberately-synchronous
// work (workload generation, store builds) so busy states actually paint.
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}
