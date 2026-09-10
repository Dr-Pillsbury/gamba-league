// Rendering never opens a listener. Each connection owns its callbacks, so
// events delivered after cleanup cannot publish into the current connection.
export function createSubscriptionStore<T>(
  initial: T,
  connect: (publish: (update: (previous: T) => T) => void) => () => void,
) {
  let snapshot = initial;
  let disconnect: (() => void) | undefined;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        let active = true;
        const stop = connect((update) => {
          if (!active) return;
          snapshot = update(snapshot);
          listeners.forEach((notify) => notify());
        });
        disconnect = () => {
          active = false;
          stop();
        };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          disconnect?.();
          disconnect = undefined;
          snapshot = initial;
        }
      };
    },
  };
}
