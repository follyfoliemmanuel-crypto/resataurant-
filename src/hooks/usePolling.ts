import { useEffect, useRef } from 'react';

/**
 * Relance `task` toutes les `intervalMs` ms tant que l'onglet est visible,
 * et immédiatement au retour sur l'onglet / à la reconnexion réseau.
 * Pas de chevauchement : une nouvelle exécution attend la fin de la précédente.
 */
export function usePolling(task: () => Promise<void> | void, intervalMs: number, enabled = true) {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const tick = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        await taskRef.current();
      } catch (err) {
        console.warn('[polling]', err);
      } finally {
        running = false;
      }
    };
    const id = window.setInterval(tick, intervalMs);
    const onWake = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [intervalMs, enabled]);
}
