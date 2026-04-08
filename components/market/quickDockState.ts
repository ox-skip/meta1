import { useEffect, useState } from "react";

type DockListener = (expanded: boolean) => void;

let expandedState = true;
const listeners = new Set<DockListener>();

function notify() {
  for (const listener of listeners) {
    try {
      listener(expandedState);
    } catch {
      // ignore listener failures
    }
  }
}

export function getMarketQuickDockExpanded() {
  return expandedState;
}

export function setMarketQuickDockExpanded(next: boolean) {
  if (expandedState === next) return;
  expandedState = next;
  notify();
}

export function toggleMarketQuickDockExpanded() {
  setMarketQuickDockExpanded(!expandedState);
}

export function subscribeMarketQuickDock(listener: DockListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMarketQuickDockExpanded() {
  const [expanded, setExpanded] = useState(getMarketQuickDockExpanded());

  useEffect(() => {
    setExpanded(getMarketQuickDockExpanded());
    return subscribeMarketQuickDock(setExpanded);
  }, []);

  return expanded;
}
