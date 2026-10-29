// A busy decoder never queues frames: the next pull reads the current latest.
export function createLatestFramePump(read, submit) {
  let busy = false;
  let submitted = null;
  let source = null;
  return {
    pull() {
      if (busy) return false;
      const buffer = read();
      const message = buffer.raw.at(-1);
      if (!message || message === submitted) return false;
      busy = true; submitted = message; source = buffer;
      submit(message);
      return true;
    },
    retry() { submitted = null; },
    complete() {
      const valid = busy && read() === source && read().raw.length > 0;
      busy = false;
      return valid;
    },
  };
}
