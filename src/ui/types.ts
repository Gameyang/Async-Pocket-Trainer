import type {BattleEvent, SideId} from '../core/types';

export type AnimationSlot = 'attack' | 'impact' | 'status' | 'faint' | null;

export interface VisualState {
  hp: [number, number];
  message: string;
  activeSide: SideId | null;
  impactSide: SideId | null;
  statusSide: SideId | null;
  animation: AnimationSlot;
  eventQueue: BattleEvent[];
  seedDraft: string;
}
