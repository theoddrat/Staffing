// Props every guided view receives: the shared store state + actions (both UIs use one store).
import type { ExtState, StoreActions } from '../state/store';

export interface GuidedProps {
  state: ExtState;
  actions: StoreActions;
  /** Open the "Customize" drawer for the current scenario. */
  openCustomize(): void;
}
