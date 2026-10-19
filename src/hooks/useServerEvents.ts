
import { useEffect } from 'react';

/**
 * Le rafraîchissement automatique est assuré par usePolling.
 * On désactive le flux SSE permanent pour éviter les connexions longues.
 */
export function useServerEvents(
  _onChange: () => void,
  _enabled = true
) {
  useEffect(() => {
    // Les données restent actualisées via usePolling.
    return undefined;
  }, []);
}
