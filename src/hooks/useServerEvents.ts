import { useEffect, useRef } from 'react';

/**
 * Écoute les signaux du serveur (/api/events) : dès qu'une commande, un plat,
 * une promotion... change, `onChange` est appelé aussitôt (mise à jour instantanée).
 * Le rafraîchissement périodique (usePolling) reste en secours si la connexion tombe.
 */
export function useServerEvents(onChange: () => void, enabled = true) {
  const ref = useRef(onChange);
  useEffect(() => {
    ref.current = onChange;
  });

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let timer: number | undefined;
    const es = new EventSource('/api/events');
    es.addEventListener('change', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => ref.current(), 150);
    });
    return () => {
      window.clearTimeout(timer);
      es.close();
    };
  }, [enabled]);
}
