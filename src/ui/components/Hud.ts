import type {BattleState, Combatant, SideId} from '../../core/types';
import type {VisualState} from '../types';
import {escapeHtml} from '../html';
import {statusLabels, volatileLabels} from '../labels';

function hpPercent(battle: BattleState, visual: VisualState, side: SideId): number {
  const combatant = battle.sides[side];
  return Math.max(0, Math.round((visual.hp[side] / combatant.maxHp) * 100));
}

function hpTone(battle: BattleState, visual: VisualState, side: SideId): string {
  const percent = hpPercent(battle, visual, side);
  if (percent <= 20) return 'danger';
  if (percent <= 50) return 'warn';
  return 'good';
}

function currentStatuses(combatant: Combatant): string[] {
  const statuses: string[] = [];
  if (combatant.status) statuses.push(statusLabels[combatant.status]);
  if (combatant.confusionTurns > 0) statuses.push(volatileLabels.confusion);
  if (combatant.leechSeedBy !== null) statuses.push(volatileLabels.leechseed);
  if (combatant.partialTrapTurns > 0) statuses.push(volatileLabels.partiallytrapped);
  if (combatant.substituteHp > 0) statuses.push(volatileLabels.substitute);
  if (combatant.reflect) statuses.push(volatileLabels.reflect);
  if (combatant.lightScreen) statuses.push(volatileLabels.lightscreen);
  if (combatant.mist) statuses.push(volatileLabels.mist);
  return statuses;
}

function statusBadges(combatant: Combatant): string {
  const statuses = currentStatuses(combatant);
  if (statuses.length === 0) return '<span class="status-badge normal">정상</span>';
  return statuses.map(status => `<span class="status-badge">${escapeHtml(status)}</span>`).join('');
}

function typeBadges(combatant: Combatant): string {
  const types = combatant.transformedTypes ?? combatant.species.types;
  return types
    .map(type => `<span class="type-badge type-${type.toLowerCase()}">${escapeHtml(type)}</span>`)
    .join('');
}

export function renderHud(battle: BattleState, visual: VisualState, side: SideId): string {
  const combatant = battle.sides[side];
  const alignment = side === 0 ? 'player' : 'enemy';
  const percent = hpPercent(battle, visual, side);

  return `
    <section class="hud ${alignment}">
      <div class="hud-name">
        <strong>${escapeHtml(combatant.species.name)}</strong>
        <span>Lv.${combatant.level}</span>
      </div>
      <div class="hp-row">
        <span>HP</span>
        <div class="hp-meter ${hpTone(battle, visual, side)}">
          <div style="width: ${percent}%"></div>
        </div>
      </div>
      <div class="hp-numbers">${visual.hp[side]}/${combatant.maxHp}</div>
      <div class="badge-row">${typeBadges(combatant)}${statusBadges(combatant)}</div>
    </section>
  `;
}
