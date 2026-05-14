import { runAutoBattle } from "./battle/battleEngine";
import { attemptCapture } from "./capture/captureSystem";
import { createCreature, healTeam, normalizeCreatureBattleLoadout } from "./creatureFactory";
import { defaultBalance, getMove, getSpecies, movesById, starterSpeciesIds } from "./data/catalog";
import {
  DEFAULT_HEADLESS_TRAINER_NAME,
  formatWave,
  localizeBall,
  localizeType,
  localizeWinner,
  withJosa,
} from "./localization";
import { getLearnableLevelUpMoves } from "./moveLearning";
import { SeededRng } from "./rng";
import { chooseReplacementIndex, getTeamHealthRatio, scoreCreature, scoreTeam } from "./scoring";
import {
  getBallCost,
  getHealProduct,
  getLevelBoostProduct,
  getPremiumOffer,
  getRarityBoostProduct,
  getScoutProduct,
  getStatBoostProduct,
  getStatRerollProduct,
  getTeachMoveProduct,
  getTeamSortProduct,
  getTypeLockProduct,
  hasPremiumOffer,
  premiumOfferIds,
  shopElementTypes,
  shopStatKeys,
  statBoostTiers,
  teachMoveElements,
  teamSortActionId,
  teamSortOptions,
  typeLockElements,
} from "./shopCatalog";
import { ballTypes } from "./types";
import { createGameFrame, type GameFrame } from "./view/frame";
import {
  calculateReward,
  calculateRestCost,
  createEncounter,
  createTrainerEncounterFromSnapshot,
  replaceTeamAfterCapture,
} from "./wave/waveSystem";
import type { TrainerSnapshot } from "./sync/trainerSnapshot";
import { applyOpponentBattleOutcomeToSummary } from "./sync/teamBattleRecord";
import {
  awardCheckpointDefeat,
  awardDexUnlock,
  awardSkillUnlock,
  awardWaveMilestone,
  ensureMetaCurrency,
  type AchievementAward,
} from "./achievements";
import type {
  AutoPlayOptions,
  BallType,
  Creature,
  ElementType,
  EncounterBoost,
  EncounterSnapshot,
  GameAction,
  GameBalance,
  GameEvent,
  GameState,
  HealScope,
  HealTier,
  LevelBoostTier,
  MetaCurrencyState,
  MoveDefinition,
  PremiumOfferId,
  RarityBoostTier,
  RouteId,
  RunSummary,
  ScoutKind,
  ScoutTier,
  ShopDeal,
  ShopInventory,
  ShopInventoryEntry,
  ShopStatKey,
  SortDirection,
  StatBoostTier,
  TeamEffectFlash,
  TeamSortKey,
} from "./types";
import { computeRerollCost } from "./view/frame";

export interface HeadlessClientOptions {
  seed?: string;
  trainerName?: string;
  balance?: Partial<GameBalance>;
  trainerSnapshots?: TrainerSnapshot[];
}

export interface HeadlessClientSnapshot {
  version: 1;
  frameId: number;
  nextEventId: number;
  balance: GameBalance;
  trainerSnapshots: TrainerSnapshot[];
  state: GameState;
}

type ShopInventoryPoolEntry = { actionId: string; weight: number; stock: number };

export class HeadlessGameClient {
  private balance: GameBalance;
  private readonly rng: SeededRng;
  private trainerSnapshots: TrainerSnapshot[];
  private state: GameState;
  private nextEventId = 1;
  private frameId = 0;

  constructor(options: HeadlessClientOptions = {}) {
    const seed = options.seed ?? "apt-headless-default";
    this.balance = normalizeBalance(options.balance);
    this.rng = new SeededRng(seed);
    this.trainerSnapshots = (options.trainerSnapshots ?? []).map(cloneTrainerSnapshot);
    this.state = {
      version: 1,
      seed,
      rngState: this.rng.getState(),
      trainerName: options.trainerName ?? DEFAULT_HEADLESS_TRAINER_NAME,
      phase: "starterChoice",
      currentWave: 1,
      money: this.balance.startingMoney,
      balls: createStartingBalls(this.balance),
      team: [],
      events: [],
    };
  }

  static fromSnapshot(snapshot: HeadlessClientSnapshot): HeadlessGameClient {
    const client = new HeadlessGameClient({
      seed: snapshot.state.seed,
      trainerName: snapshot.state.trainerName,
      balance: snapshot.balance,
      trainerSnapshots: snapshot.trainerSnapshots,
    });
    client.loadSnapshot(snapshot);
    return client;
  }

  getSnapshot(): GameState {
    return cloneState(this.state);
  }

  saveSnapshot(): HeadlessClientSnapshot {
    return cloneClientSnapshot({
      version: 1,
      frameId: this.frameId,
      nextEventId: this.nextEventId,
      balance: { ...this.balance },
      trainerSnapshots: this.trainerSnapshots,
      state: this.state,
    });
  }

  loadSnapshot(snapshot: HeadlessClientSnapshot): GameState {
    assertValidClientSnapshot(snapshot);

    this.balance = normalizeBalance(snapshot.balance);
    this.trainerSnapshots = snapshot.trainerSnapshots.map(cloneTrainerSnapshot);
    this.state = normalizeStateBattleLoadouts(cloneState(snapshot.state));
    this.rng.setState(this.state.rngState);
    this.frameId = snapshot.frameId;
    this.nextEventId = snapshot.nextEventId;

    return this.getSnapshot();
  }

  getFrame(): GameFrame {
    return createGameFrame(this.state, this.balance, this.frameId);
  }

  getBalance(): GameBalance {
    return { ...this.balance };
  }

  addTrainerSnapshot(snapshot: TrainerSnapshot): void {
    this.trainerSnapshots = [...this.trainerSnapshots, cloneTrainerSnapshot(snapshot)];
  }

  dispatch(action: GameAction): GameState {
    switch (action.type) {
      case "START_RUN":
        this.startRun(action.starterSpeciesId, action.trainerName);
        break;
      case "RETURN_TO_STARTER_CHOICE":
        this.returnToStarterChoice(action.trainerName);
        break;
      case "SET_TRAINER_NAME":
        this.setTrainerName(action.trainerName);
        break;
      case "CHOOSE_ROUTE":
        this.chooseRoute(action.routeId);
        break;
      case "RESOLVE_NEXT_ENCOUNTER":
        this.resolveNextEncounter();
        break;
      case "ATTEMPT_CAPTURE":
        this.tryCapture(action.ball);
        break;
      case "ACCEPT_CAPTURE":
        this.acceptCapture(action.replaceIndex);
        break;
      case "DISCARD_CAPTURE":
        this.discardCapture();
        break;
      case "REST_TEAM":
        this.restTeam();
        break;
      case "BUY_HEAL":
        this.buyHeal(action.scope, action.tier, action.targetEntityId);
        break;
      case "BUY_BALL":
        this.buyBall(action.ball, action.quantity ?? 1);
        break;
      case "BUY_SCOUT":
        this.buyScout(action.kind, action.tier);
        break;
      case "BUY_RARITY_BOOST":
        this.buyRarityBoost(action.tier);
        break;
      case "BUY_LEVEL_BOOST":
        this.buyLevelBoost(action.tier);
        break;
      case "BUY_STAT_BOOST":
        this.buyStatBoost(action.stat, action.tier, action.targetEntityId);
        break;
      case "BUY_STAT_REROLL":
        this.buyStatReroll(action.targetEntityId);
        break;
      case "BUY_TEACH_MOVE":
        this.buyTeachMove(action.element, action.targetEntityId);
        break;
      case "BUY_TYPE_LOCK":
        this.buyTypeLock(action.element);
        break;
      case "SORT_TEAM":
        this.sortTeam(action.sortBy, action.direction);
        break;
      case "BUY_PREMIUM_SHOP_ITEM":
        this.buyPremiumShopItem(action.offerId, action.targetEntityId);
        break;
      case "BUY_PREMIUM_MASTERBALL":
        this.buyPremiumShopItem("premium:ball:masterball:2");
        break;
      case "BUY_PREMIUM_REVIVE_ALL":
        this.buyPremiumShopItem("premium:heal:team:3");
        break;
      case "BUY_PREMIUM_COIN_BAG":
        this.addEvent("premium_denied", "이전 프리미엄 상품은 더 이상 판매하지 않습니다.");
        break;
      case "BUY_PREMIUM_TEAM_REROLL":
        this.addEvent("premium_denied", "이전 프리미엄 상품은 더 이상 판매하지 않습니다.");
        break;
      case "BUY_PREMIUM_DEX_UNLOCK":
        this.addEvent("premium_denied", "이전 프리미엄 상품은 더 이상 판매하지 않습니다.");
        break;
      case "CLAIM_DEX_REWARD":
        this.claimDexReward(action.speciesId);
        break;
      case "CLAIM_SKILL_REWARD":
        this.claimSkillReward(action.moveId);
        break;
      case "REROLL_SHOP_INVENTORY":
        this.rerollShopInventory();
        break;
    }

    this.detectWaveMilestones();
    this.consumeShopInventory(action);
    this.syncRngState();
    this.frameId += 1;
    return this.getSnapshot();
  }

  private rerollShopInventory(): void {
    if (this.state.phase !== "ready") {
      this.addEvent("reroll_ignored", "준비 상태에서만 상점을 재구성할 수 있습니다.");
      return;
    }
    const current = this.getActiveShopInventory();
    const rerollCount = current?.rerollCount ?? 0;
    const cost = computeRerollCost(rerollCount);
    if (this.state.money < cost) {
      this.addEvent("reroll_denied", "상점 재구성에 필요한 코인이 부족합니다.");
      return;
    }
    this.state.money -= cost;
    this.state.shopInventory = this.generateShopInventory(rerollCount + 1);
    this.addEvent("shop_rerolled", `상점을 ${cost}코인으로 재구성했습니다.`, {
      rerollCount: rerollCount + 1,
    });
  }

  private getActiveShopInventory(): ShopInventory | undefined {
    return this.state.shopInventory?.wave === this.state.currentWave
      ? this.state.shopInventory
      : undefined;
  }

  private generateShopInventory(rerollCount = 0): ShopInventory {
    const rng = new SeededRng(`${this.state.seed}:inv:${this.state.currentWave}:${rerollCount}`);
    const pool: ShopInventoryPoolEntry[] = [
      { actionId: "shop:rest", weight: 8, stock: 1 },
      { actionId: "shop:heal:single:1", weight: 14, stock: 1 },
      { actionId: "shop:heal:single:2", weight: 12, stock: 1 },
      { actionId: "shop:heal:single:3", weight: 8, stock: 1 },
      { actionId: "shop:heal:single:4", weight: 5, stock: 1 },
      { actionId: "shop:heal:single:5", weight: 3, stock: 1 },
      { actionId: "shop:heal:team:1", weight: 12, stock: 1 },
      { actionId: "shop:heal:team:2", weight: 10, stock: 1 },
      { actionId: "shop:heal:team:3", weight: 7, stock: 1 },
      { actionId: "shop:heal:team:4", weight: 4, stock: 1 },
      { actionId: "shop:pokeball", weight: 18, stock: 3 },
      { actionId: "shop:greatball", weight: 14, stock: 2 },
      { actionId: "shop:ultraball", weight: 10, stock: 2 },
      { actionId: "shop:hyperball", weight: 6, stock: 1 },
      { actionId: "shop:masterball", weight: 2, stock: 1 },
      { actionId: "shop:rarity-boost:1", weight: 8, stock: 1 },
      { actionId: "shop:rarity-boost:2", weight: 5, stock: 1 },
      { actionId: "shop:rarity-boost:3", weight: 2, stock: 1 },
      { actionId: "shop:level-boost:1", weight: 8, stock: 1 },
      { actionId: "shop:level-boost:2", weight: 6, stock: 1 },
      { actionId: "shop:level-boost:3", weight: 4, stock: 1 },
      { actionId: "shop:level-boost:4", weight: 2, stock: 1 },
      ...shopElementTypes.map((element) => ({
        actionId: `shop:type-lock:${element}`,
        weight: getTypeWeightedShopWeight(element),
        stock: 1,
      })),
      ...shopStatKeys.flatMap((stat) =>
        statBoostTiers.map((tier) => ({
          actionId: `shop:stat-boost:${stat}:${tier}`,
          weight: tier === 1 ? 8 : tier === 2 ? 5 : 2,
          stock: 1,
        })),
      ),
      ...teachMoveElements.map((element) => ({
        actionId: `shop:teach-move:${element}`,
        weight: getTypeWeightedShopWeight(element),
        stock: 1,
      })),
      ...teamSortOptions.map((option) => ({
        actionId: teamSortActionId(option.sortBy, option.direction),
        weight: 8,
        stock: 1,
      })),
      ...premiumOfferIds.map((offerId) => ({
        actionId: `shop:${offerId}`,
        weight: getPremiumOffer(offerId).weight,
        stock: 1,
      })),
    ];

    const premiumOffers =
      this.state.premiumOfferIds?.wave === this.state.currentWave &&
      this.state.premiumOfferIds.ids.some(hasPremiumOffer)
        ? this.state.premiumOfferIds.ids.filter(hasPremiumOffer)
        : rollActivePremiumOffers(this.state.seed, this.state.currentWave);
    const activePremiumActionIds = new Set(premiumOffers.map((offerId) => `shop:${offerId}`));
    const groups: ShopInventoryPoolEntry[][] = [
      pool.filter((entry) => isRecoveryShopAction(entry.actionId)),
      pool.filter((entry) => isBallShopAction(entry.actionId)),
      pool.filter((entry) => isEncounterBoostShopAction(entry.actionId)),
      pool.filter((entry) => isTeamUpgradeShopAction(entry.actionId)),
      pool.filter((entry) => activePremiumActionIds.has(entry.actionId)),
    ];
    const bonusGroups: ShopInventoryPoolEntry[][] = [
      pool.filter(
        (entry) => isRecoveryShopAction(entry.actionId) || isBallShopAction(entry.actionId),
      ),
      pool.filter((entry) => isEncounterBoostShopAction(entry.actionId)),
      pool.filter(
        (entry) =>
          isEncounterBoostShopAction(entry.actionId) || isTeamUpgradeShopAction(entry.actionId),
      ),
    ];
    const pickedActionIds = new Set<string>();
    const picked = [...groups, ...bonusGroups].map((group) => {
      const entry = pickUniqueWeightedShopEntry(group, rng, pickedActionIds);
      pickedActionIds.add(entry.actionId);
      return entry;
    });
    const chosen = picked.map(createShopInventoryEntry);

    return {
      wave: this.state.currentWave,
      entries: chosen,
      rerollCount,
    };
  }

  private consumeShopInventory(action: GameAction): void {
    if (!this.state.shopInventory || this.state.shopInventory.wave !== this.state.currentWave) {
      return;
    }
    const actionId = inferShopActionId(action);
    if (!actionId) return;
    const lastEventType = this.state.events.at(-1)?.type ?? "";
    // 구매 실패/거부 이벤트일 경우 소비하지 않음
    if (lastEventType.endsWith("_denied") || lastEventType.endsWith("_ignored")) {
      return;
    }
    const entry = this.state.shopInventory.entries.find((entry) => entry.actionId === actionId);
    if (!entry || entry.stock <= 0) return;
    entry.stock -= 1;
  }

  private detectWaveMilestones(): void {
    if (this.state.phase === "starterChoice") {
      return;
    }
    const meta = ensureMetaCurrency(this.state);
    const award = awardWaveMilestone(meta, this.state.currentWave);
    if (award) {
      this.recordAchievementAward(award);
    }
  }

  private recordAchievementAward(award: AchievementAward): void {
    this.addEvent("tp_earned", award.message, { id: award.id, trainerPoints: award.trainerPoints });
  }

  private claimDexReward(speciesId: number): void {
    const unlocked = new Set(this.state.unlockedSpeciesIds ?? []);
    if (!unlocked.has(speciesId)) {
      this.addEvent("dex_reward_denied", "아직 발견하지 않은 포켓몬 도감 보상입니다.", {
        speciesId,
      });
      return;
    }

    const meta = ensureMetaCurrency(this.state);
    const award = awardDexUnlock(meta, speciesId);
    if (!award) {
      this.addEvent("dex_reward_denied", "이미 수령했거나 받을 수 없는 포켓몬 도감 보상입니다.", {
        speciesId,
      });
      return;
    }

    this.recordAchievementAward(award);
  }

  private claimSkillReward(moveId: string): void {
    const unlocked = new Set(this.state.unlockedMoveIds ?? []);
    if (!unlocked.has(moveId)) {
      this.addEvent("skill_reward_denied", "아직 발견하지 않은 기술 도감 보상입니다.", {
        moveId,
      });
      return;
    }

    const meta = ensureMetaCurrency(this.state);
    const award = awardSkillUnlock(meta, moveId);
    if (!award) {
      this.addEvent("skill_reward_denied", "이미 수령했거나 받을 수 없는 기술 도감 보상입니다.", {
        moveId,
      });
      return;
    }

    this.recordAchievementAward(award);
  }

  private discoverOwnedDexEntries(creatures: readonly Creature[] = this.state.team): void {
    const speciesIds = new Set(this.state.unlockedSpeciesIds ?? []);
    const moveIds = new Set(this.state.unlockedMoveIds ?? []);
    let changed = false;

    for (const creature of creatures) {
      if (!speciesIds.has(creature.speciesId)) {
        speciesIds.add(creature.speciesId);
        changed = true;
      }

      for (const move of creature.moves) {
        if (!moveIds.has(move.id)) {
          moveIds.add(move.id);
          changed = true;
        }
      }
    }

    if (!changed) {
      return;
    }

    this.state.unlockedSpeciesIds = Array.from(speciesIds);
    this.state.unlockedMoveIds = Array.from(moveIds);
  }

  private buyPremiumShopItem(offerId: PremiumOfferId, targetEntityId?: string): void {
    if (this.state.phase !== "ready") {
      this.addEvent("premium_ignored", "준비 상태에서만 프리미엄 상품을 구매할 수 있습니다.");
      return;
    }

    const offer = getPremiumOffer(offerId);
    const meta = ensureMetaCurrency(this.state);

    if (meta.trainerPoints < offer.tpCost) {
      this.addEvent("premium_denied", "보석이 부족합니다.");
      return;
    }

    const effect = offer.effect;

    if (effect.kind === "statBoost") {
      const target = this.findTeamMember(targetEntityId);
      if (!target) {
        this.addEvent("premium_denied", "대상 포켓몬을 찾을 수 없습니다.");
        return;
      }

      meta.trainerPoints -= offer.tpCost;
      this.applyStatBoostToTarget(target, effect.stat, effect.bonus);
      this.flashTeamEffect(target.instanceId, "stat-boost");
      this.addEvent(
        "premium_purchased",
        `${withJosa(target.speciesName, "이/가")} ${formatShopStatLabel(effect.stat)} +${effect.bonus}을(를) 얻었습니다.`,
        { offerId, target: target.speciesName, stat: effect.stat, bonus: effect.bonus },
      );
      return;
    }

    if (effect.kind === "teachMove") {
      const target = this.findTeamMember(targetEntityId);
      if (!target) {
        this.addEvent("premium_denied", "대상 포켓몬을 찾을 수 없습니다.");
        return;
      }

      const learnedMove = pickLearnsetMoveByType(target, effect.element, this.rng, effect.grade);
      if (!learnedMove) {
        this.addEvent("premium_denied", "해당 속성의 기술을 찾을 수 없습니다.");
        return;
      }

      if (target.moves.some((existing) => existing.id === learnedMove.id)) {
        this.addEvent(
          "premium_denied",
          `${target.speciesName}은(는) 이미 ${learnedMove.name}을(를) 알고 있습니다.`,
        );
        return;
      }

      meta.trainerPoints -= offer.tpCost;
      const replaceIndex = pickWeakestMoveIndex(target.moves);
      target.moves = target.moves.map((existing, index) =>
        index === replaceIndex ? cloneMove(learnedMove) : existing,
      );
      target.powerScore = scoreCreature({
        stats: target.stats,
        moves: target.moves,
        types: target.types,
      });
      this.discoverOwnedDexEntries([target]);
      this.flashTeamEffect(target.instanceId, "teach-move");
      this.addEvent(
        "premium_purchased",
        `${withJosa(target.speciesName, "이/가")} ${learnedMove.name}을(를) 배웠습니다.`,
        { offerId, target: target.speciesName, move: learnedMove.id, element: effect.element },
      );
      return;
    }

    meta.trainerPoints -= offer.tpCost;

    if (effect.kind === "heal") {
      const focusEntityId =
        effect.scope === "single"
          ? (targetEntityId ?? this.findMostDamagedCreatureId())
          : this.state.team[0]?.instanceId;
      const beforeHp = totalCurrentHp(this.state.team);
      this.state.team =
        effect.scope === "team"
          ? healTeamByRatio(this.state.team, effect.healRatio)
          : healSingleByRatio(this.state.team, effect.healRatio, targetEntityId);
      const healedHp = totalCurrentHp(this.state.team) - beforeHp;
      this.flashTeamEffect(focusEntityId, "heal");
      this.addEvent("premium_purchased", `${offer.label}으로 HP ${healedHp}을(를) 회복했습니다.`, {
        offerId,
        healedHp,
      });
      return;
    }

    if (effect.kind === "ball") {
      this.state.balls = {
        ...this.state.balls,
        [effect.ball]: this.state.balls[effect.ball] + effect.quantity,
      };
      this.addEvent(
        "premium_purchased",
        `${localizeBall(effect.ball)} ${effect.quantity}개를 받았습니다.`,
        {
          offerId,
          ball: effect.ball,
          quantity: effect.quantity,
        },
      );
      return;
    }

    if (effect.kind === "rarityBoost") {
      const existing =
        this.state.encounterBoost?.wave === this.state.currentWave
          ? this.state.encounterBoost
          : { wave: this.state.currentWave };
      this.state.encounterBoost = {
        ...existing,
        rarityBonus: Math.max(existing.rarityBonus ?? 0, effect.bonus),
      };
      this.addEvent(
        "premium_purchased",
        `희귀도 보정 +${Math.round(effect.bonus * 100)}%가 적용되었습니다.`,
        {
          offerId,
          bonus: effect.bonus,
        },
      );
      return;
    }

    if (effect.kind === "levelBoost") {
      const existing =
        this.state.encounterBoost?.wave === this.state.currentWave
          ? this.state.encounterBoost
          : { wave: this.state.currentWave };
      this.state.encounterBoost = {
        ...existing,
        levelMin: Math.max(existing.levelMin ?? 0, effect.min),
        levelMax: Math.max(existing.levelMax ?? 0, effect.max),
      };
      this.addEvent(
        "premium_purchased",
        `숙련도 보정 +${effect.min}~${effect.max}이(가) 적용되었습니다.`,
        {
          offerId,
          min: effect.min,
          max: effect.max,
        },
      );
      return;
    }

    if (effect.kind === "typeLock") {
      const existing =
        this.state.encounterBoost?.wave === this.state.currentWave
          ? this.state.encounterBoost
          : { wave: this.state.currentWave };
      this.state.encounterBoost = {
        ...existing,
        lockedType: effect.element,
      };
      this.addEvent(
        "premium_purchased",
        `다음 만남을 ${localizeType(effect.element)} 타입으로 고정했습니다.`,
        {
          offerId,
          element: effect.element,
        },
      );
    }
  }

  autoStep(strategy: AutoPlayOptions["strategy"] = "greedy"): GameState {
    const before = signature(this.state);

    if (this.state.phase === "starterChoice") {
      this.startRun(this.rng.pick(starterSpeciesIds));
    } else if (this.state.phase === "ready") {
      this.prepareForEncounter(strategy);
      this.chooseRoute(this.chooseAutoRoute(strategy));
      this.resolveNextEncounter();
    } else if (this.state.phase === "captureDecision") {
      const ball = this.chooseBall(strategy);

      if (ball) {
        this.tryCapture(ball);
      } else {
        this.discardCapture();
      }
    } else if (this.state.phase === "teamDecision") {
      const replaceIndex = this.state.pendingCapture
        ? chooseReplacementIndex(this.state.team, this.state.pendingCapture, strategy)
        : undefined;
      this.acceptCapture(replaceIndex, { chooseReplacement: false });
    }

    this.syncRngState();
    this.frameId += 1;

    if (before === signature(this.state) && this.state.phase !== "gameOver") {
      this.addEvent("stalled", "자동 진행이 더 이상 진행되지 않았습니다.");
    }

    return this.getSnapshot();
  }

  autoPlay(options: AutoPlayOptions): GameState {
    const maxSteps = options.maxSteps ?? options.maxWaves * 8 + 16;

    for (let step = 0; step < maxSteps; step += 1) {
      if (this.state.phase === "gameOver" || this.state.currentWave > options.maxWaves) {
        break;
      }

      this.autoStep(options.strategy ?? "greedy");
    }

    return this.getSnapshot();
  }

  getRunSummary(): RunSummary {
    return {
      seed: this.state.seed,
      trainerName: this.state.trainerName,
      finalWave: this.state.currentWave,
      phase: this.state.phase,
      money: this.state.money,
      balls: { ...this.state.balls },
      teamSize: this.state.team.length,
      teamPower: scoreTeam(this.state.team),
      events: this.state.events.length,
      gameOverReason: this.state.gameOverReason,
    };
  }

  private startRun(starterSpeciesId: number = starterSpeciesIds[0], trainerName?: string): void {
    if (this.state.phase !== "starterChoice" && this.state.phase !== "gameOver") {
      this.addEvent("start_ignored", "이미 진행 중인 도전입니다.");
      return;
    }

    const starter = createCreature({
      rng: this.rng,
      wave: 1,
      balance: this.balance,
      speciesId: starterSpeciesId,
      role: "starter",
    });

    const previousMeta = this.state.metaCurrency;
    const previousUnlocked = this.state.unlockedSpeciesIds;
    const previousUnlockedMoves = this.state.unlockedMoveIds;
    this.state = {
      version: 1,
      seed: this.state.seed,
      rngState: this.rng.getState(),
      trainerName: trainerName ?? this.state.trainerName,
      phase: "ready",
      currentWave: 1,
      money: this.balance.startingMoney,
      balls: createStartingBalls(this.balance),
      team: [starter],
      selectedRoute: undefined,
      events: [],
      metaCurrency: previousMeta,
      unlockedSpeciesIds: previousUnlocked,
      unlockedMoveIds: previousUnlockedMoves,
    };
    this.discoverOwnedDexEntries([starter]);
    this.state.shopDeal = this.generateShopDeal();
    this.state.shopInventory = this.generateShopInventory(0);
    this.nextEventId = 1;
    this.addEvent(
      "run_started",
      `${this.state.trainerName}님이 ${starter.speciesName}를 선택했습니다.`,
      {
        starterSpeciesId: starter.speciesId,
        starterPower: starter.powerScore,
      },
    );
  }

  private returnToStarterChoice(trainerName?: string): void {
    if (this.state.phase !== "gameOver") {
      this.addEvent("restart_ignored", "패배 화면에서만 스타터 선택으로 돌아갈 수 있습니다.");
      return;
    }

    const previousMeta = this.state.metaCurrency;
    const previousUnlocked = this.state.unlockedSpeciesIds;
    const previousUnlockedMoves = this.state.unlockedMoveIds;
    this.state = {
      version: 1,
      seed: this.state.seed,
      rngState: this.rng.getState(),
      trainerName: trainerName ?? this.state.trainerName,
      phase: "starterChoice",
      currentWave: 1,
      money: this.balance.startingMoney,
      balls: createStartingBalls(this.balance),
      team: [],
      events: [],
      metaCurrency: previousMeta,
      unlockedSpeciesIds: previousUnlocked,
      unlockedMoveIds: previousUnlockedMoves,
    };
    this.nextEventId = 1;
  }

  setMetaCurrency(meta: MetaCurrencyState): void {
    this.state.metaCurrency = { ...meta, claimedAchievements: [...meta.claimedAchievements] };
  }

  getMetaCurrency(): MetaCurrencyState {
    return ensureMetaCurrency(this.state);
  }

  private setTrainerName(trainerName: string): void {
    const normalized = trainerName.trim();

    if (!normalized) {
      this.addEvent("trainer_name_ignored", "팀 이름이 비어 있습니다.");
      return;
    }

    this.state.trainerName = normalized;
  }

  private chooseRoute(routeId: RouteId): void {
    if (this.state.phase !== "ready") {
      this.addEvent("route_ignored", "준비 상태에서만 길을 선택할 수 있습니다.");
      return;
    }

    if (routeId === "supply" && this.state.supplyUsedAtWave === this.state.currentWave) {
      this.addEvent("route_denied", "보급은 웨이브마다 한 번만 받을 수 있습니다.");
      return;
    }

    if (routeId === "supply" && this.state.money < this.balance.supplyRouteCost) {
      this.addEvent("route_denied", "보급에 필요한 코인이 부족합니다.");
      return;
    }

    this.state.selectedRoute = {
      id: routeId,
      wave: this.state.currentWave,
    };
    this.addEvent("route_chosen", `선택한 길: ${routeName(routeId)}.`, {
      routeId,
    });
  }

  private resolveNextEncounter(): void {
    if (this.state.phase !== "ready") {
      this.addEvent("encounter_ignored", "준비 상태에서만 다음 만남을 시작할 수 있습니다.");
      return;
    }

    const routeId = this.consumeSelectedRoute();

    if (routeId === "supply") {
      this.resolveSupplyRoute();
      return;
    }

    const encounter = this.createEncounter(routeId);
    const battleResult = runAutoBattle({
      kind: encounter.kind,
      playerTeam: this.state.team,
      enemyTeam: encounter.enemyTeam,
      rng: this.rng,
      damageScale: this.balance.battleDamageScale,
      normalizeLoadouts: true,
    });
    const battle = {
      ...battleResult,
      encounterSource: encounter.source,
      encounterRoute: encounter.routeId,
      opponentName: encounter.opponentName,
      opponentTeam: encounter.opponentTeam,
      opponentTeamRecordChange: encounter.opponentTeam?.record
        ? applyOpponentBattleOutcomeToSummary(
            encounter.opponentTeam.record,
            battleWinnerToOpponentOutcome(battleResult.winner),
          )
        : undefined,
    };

    this.state.team = battle.playerTeam;
    this.state.pendingEncounter = encounter;
    this.state.lastBattle = battle;
    const reward = calculateReward(this.state.currentWave, encounter.kind, this.balance, routeId);

    this.addEvent(
      "battle_resolved",
      `${withJosa(encounter.opponentName, "와/과")}의 전투에서 ${localizeWinner(battle.winner)}했습니다.`,
      {
        kind: encounter.kind,
        routeId,
        winner: battle.winner,
        opponentName: encounter.opponentName,
        turns: battle.turns,
        reward: battle.winner === "player" ? reward : 0,
        enemyPower: scoreTeam(battle.enemyTeam),
        teamPower: scoreTeam(battle.playerTeam),
      },
    );

    if (battle.winner !== "player") {
      this.state.phase = "gameOver";
      this.state.gameOverReason = `${formatWave(this.state.currentWave)}에서 ${encounter.opponentName}에게 패배했습니다.`;
      this.addEvent("game_over", this.state.gameOverReason, {
        wave: this.state.currentWave,
        opponentName: encounter.opponentName,
        kind: encounter.kind,
        enemyPower: scoreTeam(battle.enemyTeam),
        teamPower: scoreTeam(battle.playerTeam),
      });
      return;
    }

    this.state.money += reward;

    if (encounter.kind === "trainer") {
      const meta = ensureMetaCurrency(this.state);
      const checkpointAward = awardCheckpointDefeat(meta, this.state.currentWave, this.balance);
      if (checkpointAward) {
        this.recordAchievementAward(checkpointAward);
      }
      this.advanceWave();
      return;
    }

    const defeatedWild = battle.enemyTeam[0];
    this.state.pendingEncounter = {
      ...encounter,
      enemyTeam: [defeatedWild],
    };
    this.state.phase = "captureDecision";
  }

  private tryCapture(ball: BallType): void {
    if (this.state.phase !== "captureDecision" || !this.state.pendingEncounter) {
      this.addEvent("capture_ignored", "포획을 선택할 대상이 없습니다.");
      return;
    }

    if (this.state.balls[ball] <= 0) {
      this.addEvent("capture_no_ball", `${localizeBall(ball)}이 없습니다.`);
      return;
    }

    this.state.balls[ball] -= 1;

    const target = this.state.pendingEncounter.enemyTeam[0];
    const routeId = this.state.pendingEncounter.routeId ?? "normal";
    const result = attemptCapture(target, this.state.currentWave, ball, this.rng, {
      hpRatioFloor: this.balance.defeatedCaptureHpRatioFloor,
      chanceBonus: routeId === "elite" ? this.balance.eliteCaptureChanceBonus : 0,
    });

    this.addEvent(
      "capture_attempted",
      `${localizeBall(ball)} 포획에 ${result.success ? "성공" : "실패"}했습니다.`,
      {
        ball,
        chance: Number(result.chance.toFixed(4)),
        success: result.success,
        target: target.speciesName,
        routeId,
      },
    );

    if (result.success) {
      this.state.pendingCapture = createCaptureJoinCreature(target);
      this.state.phase = "teamDecision";
    } else {
      this.advanceWave();
    }
  }

  private acceptCapture(
    replaceIndex?: number,
    options: { chooseReplacement?: boolean } = {},
  ): void {
    if (this.state.phase !== "teamDecision" || !this.state.pendingCapture) {
      this.addEvent("team_decision_ignored", "편성할 포획 대상이 없습니다.");
      return;
    }

    const captured = createCaptureJoinCreature(this.state.pendingCapture);
    const resolvedIndex =
      replaceIndex ??
      (options.chooseReplacement === false
        ? undefined
        : chooseReplacementIndex(this.state.team, captured));
    const oldTeamPower = scoreTeam(this.state.team);
    this.state.team = replaceTeamAfterCapture(
      this.state.team,
      captured,
      this.balance.maxTeamSize,
      resolvedIndex,
    );
    const accepted =
      scoreTeam(this.state.team) > oldTeamPower || this.state.team.includes(captured);

    this.addEvent(
      accepted ? "capture_kept" : "capture_released",
      accepted
        ? `${captured.speciesName}가 팀에 합류했습니다.`
        : `${captured.speciesName}를 비교 후 놓아주었습니다.`,
      {
        accepted,
        replaceIndex: resolvedIndex,
        capturedPower: captured.powerScore,
        teamPower: scoreTeam(this.state.team),
      },
    );

    if (accepted) {
      this.discoverOwnedDexEntries([captured]);
    }

    this.advanceWave();
  }

  private discardCapture(): void {
    if (this.state.phase !== "captureDecision" && this.state.phase !== "teamDecision") {
      this.addEvent("discard_ignored", "지금은 포획 대상을 보낼 수 없습니다.");
      return;
    }

    const name =
      this.state.pendingCapture?.speciesName ??
      this.state.pendingEncounter?.enemyTeam[0]?.speciesName;
    this.addEvent("capture_skipped", `보낸 만남: ${name ?? "만남"}.`);
    this.advanceWave();
  }

  private restTeam(): void {
    if (this.state.phase !== "ready") {
      this.addEvent("rest_ignored", "휴식은 다음 만남 전 준비 상태에서만 가능합니다.");
      return;
    }

    const cost = calculateRestCost(this.state.currentWave, this.balance);

    if (this.state.money < cost) {
      this.addEvent("rest_denied", "팀 휴식에 필요한 코인이 부족합니다.");
      return;
    }

    this.state.money -= cost;
    this.state.team = healTeam(this.state.team);
    this.addEvent("team_rested", "팀의 HP가 모두 회복되었습니다.", {
      cost,
    });
  }

  private buyBall(ball: BallType, quantity: number): void {
    if (this.state.phase !== "ready") {
      this.addEvent("buy_ignored", "볼은 다음 만남 전 준비 상태에서만 살 수 있습니다.");
      return;
    }

    const cost = getBallCost(ball, this.balance);
    const affordableQuantity = Math.max(0, Math.min(quantity, Math.floor(this.state.money / cost)));

    if (affordableQuantity === 0) {
      this.addEvent("buy_denied", `${localizeBall(ball)} 구입에 필요한 코인이 부족합니다.`);
      return;
    }

    this.state.money -= affordableQuantity * cost;
    this.state.balls[ball] += affordableQuantity;
    this.addEvent("ball_bought", `${localizeBall(ball)} ${affordableQuantity}개를 샀습니다.`, {
      ball,
      quantity: affordableQuantity,
      cost: affordableQuantity * cost,
    });
  }

  private buyHeal(scope: HealScope, tier: HealTier, targetEntityId?: string): void {
    if (this.state.phase !== "ready") {
      this.addEvent("heal_ignored", "회복은 다음 만남 준비 상태에서만 사용할 수 있습니다.");
      return;
    }

    const product = getHealProduct(scope, tier);

    if (this.state.money < product.cost) {
      this.addEvent("heal_denied", "회복에 필요한 코인이 부족합니다.");
      return;
    }

    const focusEntityId =
      scope === "single"
        ? (targetEntityId ?? this.findMostDamagedCreatureId())
        : this.state.team[0]?.instanceId;
    const beforeHp = totalCurrentHp(this.state.team);
    this.state.money -= product.cost;
    this.state.team =
      scope === "team"
        ? healTeamByRatio(this.state.team, product.healRatio)
        : healSingleByRatio(this.state.team, product.healRatio, targetEntityId);
    const healedHp = totalCurrentHp(this.state.team) - beforeHp;
    this.flashTeamEffect(focusEntityId, "heal");
    this.addEvent(
      scope === "team" ? "team_healed" : "creature_healed",
      scope === "team"
        ? `전체 회복 ${tier}단계로 팀 HP를 ${healedHp} 회복했습니다.`
        : `단일 회복 ${tier}단계로 가장 다친 포켓몬 HP를 ${healedHp} 회복했습니다.`,
      {
        scope,
        tier,
        cost: product.cost,
        healedHp,
      },
    );
  }

  private findMostDamagedCreatureId(): string | undefined {
    let mostDamaged: Creature | undefined;
    let worstRatio = Infinity;
    for (const creature of this.state.team) {
      const ratio = creature.stats.hp === 0 ? 1 : creature.currentHp / creature.stats.hp;
      if (ratio < worstRatio) {
        worstRatio = ratio;
        mostDamaged = creature;
      }
    }
    return mostDamaged?.instanceId;
  }

  private flashTeamEffect(entityId: string | undefined, kind: TeamEffectFlash["kind"]): void {
    if (!entityId) return;
    this.state.lastTeamEffect = {
      entityId,
      kind,
      frameId: this.frameId + 1,
    };
  }

  private buyRarityBoost(tier: RarityBoostTier): void {
    if (this.state.phase !== "ready") {
      this.addEvent("boost_ignored", "준비 상태에서만 보정 아이템을 사용할 수 있습니다.");
      return;
    }

    const product = getRarityBoostProduct(tier);

    if (this.state.money < product.cost) {
      this.addEvent("boost_denied", "보정 아이템에 필요한 코인이 부족합니다.");
      return;
    }

    this.state.money -= product.cost;
    const existing =
      this.state.encounterBoost?.wave === this.state.currentWave
        ? this.state.encounterBoost
        : { wave: this.state.currentWave };
    this.state.encounterBoost = {
      ...existing,
      rarityBonus: Math.max(existing.rarityBonus ?? 0, product.bonus),
    };
    this.addEvent(
      "boost_applied",
      `희귀도 보정 +${Math.round(product.bonus * 100)}%가 적용되었습니다.`,
      { kind: "rarity", tier, bonus: product.bonus },
    );
  }

  private buyLevelBoost(tier: LevelBoostTier): void {
    if (this.state.phase !== "ready") {
      this.addEvent("boost_ignored", "준비 상태에서만 보정 아이템을 사용할 수 있습니다.");
      return;
    }

    const product = getLevelBoostProduct(tier);

    if (this.state.money < product.cost) {
      this.addEvent("boost_denied", "보정 아이템에 필요한 코인이 부족합니다.");
      return;
    }

    this.state.money -= product.cost;
    const existing =
      this.state.encounterBoost?.wave === this.state.currentWave
        ? this.state.encounterBoost
        : { wave: this.state.currentWave };
    this.state.encounterBoost = {
      ...existing,
      levelMin: Math.max(existing.levelMin ?? 0, product.min),
      levelMax: Math.max(existing.levelMax ?? 0, product.max),
    };
    this.addEvent(
      "boost_applied",
      `숙련도 보정 +${product.min}~${product.max}이(가) 적용되었습니다.`,
      { kind: "level", tier, min: product.min, max: product.max },
    );
  }

  private resolveDiscountedCost(actionId: string, baseCost: number): number {
    const deal = this.state.shopDeal;
    if (deal?.wave === this.state.currentWave && deal.discountedActionIds.includes(actionId)) {
      return Math.max(1, Math.round(baseCost * (1 - deal.discountRate)));
    }
    return baseCost;
  }

  private findTeamMember(targetEntityId: string | undefined): Creature | undefined {
    if (!targetEntityId) {
      return this.state.team[0];
    }
    return this.state.team.find((creature) => creature.instanceId === targetEntityId);
  }

  private buyStatBoost(
    stat: ShopStatKey,
    tier: StatBoostTier,
    targetEntityId: string | undefined,
  ): void {
    if (this.state.phase !== "ready") {
      this.addEvent("stat_boost_ignored", "준비 상태에서만 사용할 수 있습니다.");
      return;
    }

    const product = getStatBoostProduct(stat, tier);
    const cost = this.resolveDiscountedCost(`shop:stat-boost:${stat}:${tier}`, product.cost);

    if (this.state.money < cost) {
      this.addEvent("stat_boost_denied", "능력치 보정에 필요한 코인이 부족합니다.");
      return;
    }

    const target = this.findTeamMember(targetEntityId);
    if (!target) {
      this.addEvent("stat_boost_denied", "대상 포켓몬을 찾을 수 없습니다.");
      return;
    }

    this.state.money -= cost;
    this.applyStatBoostToTarget(target, stat, product.bonus);
    this.flashTeamEffect(target.instanceId, "stat-boost");
    this.addEvent(
      "stat_boost_applied",
      `${withJosa(target.speciesName, "이/가")} ${formatShopStatLabel(stat)} +${product.bonus}을(를) 얻었습니다.`,
      { target: target.speciesName, stat, tier, bonus: product.bonus },
    );
  }

  private applyStatBoostToTarget(target: Creature, stat: ShopStatKey, bonus: number): void {
    const oldMaxHp = target.stats.hp;
    target.stats = {
      ...target.stats,
      [stat]: target.stats[stat] + bonus,
    };
    if (stat === "hp") {
      target.currentHp = Math.min(target.stats.hp, target.currentHp + bonus);
    } else {
      target.currentHp = Math.min(target.currentHp, target.stats.hp || oldMaxHp);
    }
    target.powerScore = scoreCreature({
      stats: target.stats,
      moves: target.moves,
      types: target.types,
    });
  }

  private buyStatReroll(targetEntityId: string | undefined): void {
    if (this.state.phase !== "ready") {
      this.addEvent("stat_reroll_ignored", "준비 상태에서만 사용할 수 있습니다.");
      return;
    }

    const product = getStatRerollProduct();
    const cost = this.resolveDiscountedCost("shop:stat-reroll", product.cost);

    if (this.state.money < cost) {
      this.addEvent("stat_reroll_denied", "능력치 재추첨에 필요한 코인이 부족합니다.");
      return;
    }

    const target = this.findTeamMember(targetEntityId);
    if (!target) {
      this.addEvent("stat_reroll_denied", "대상 포켓몬을 찾을 수 없습니다.");
      return;
    }

    this.state.money -= cost;
    const rerollFactor = () => 0.94 + this.rng.nextFloat() * 0.2;
    const newStats: typeof target.stats = {
      hp: Math.max(5, Math.round(target.stats.hp * rerollFactor())),
      attack: Math.max(5, Math.round(target.stats.attack * rerollFactor())),
      defense: Math.max(5, Math.round(target.stats.defense * rerollFactor())),
      special: Math.max(5, Math.round(target.stats.special * rerollFactor())),
      speed: Math.max(5, Math.round(target.stats.speed * rerollFactor())),
    };
    const oldMaxHp = target.stats.hp;
    target.stats = newStats;
    target.currentHp = Math.max(
      1,
      Math.min(newStats.hp, Math.round((target.currentHp / Math.max(1, oldMaxHp)) * newStats.hp)),
    );
    target.powerScore = scoreCreature({
      stats: target.stats,
      moves: target.moves,
      types: target.types,
    });
    this.flashTeamEffect(target.instanceId, "stat-reroll");
    this.addEvent(
      "stat_reroll_applied",
      `${withJosa(target.speciesName, "이/가")} 능력치를 다시 굴렸습니다.`,
      { target: target.speciesName },
    );
  }

  private buyTeachMove(element: ElementType, targetEntityId: string | undefined): void {
    if (this.state.phase !== "ready") {
      this.addEvent("teach_move_ignored", "준비 상태에서만 사용할 수 있습니다.");
      return;
    }

    const product = getTeachMoveProduct(element);
    const cost = this.resolveDiscountedCost(`shop:teach-move:${element}`, product.cost);

    if (this.state.money < cost) {
      this.addEvent("teach_move_denied", "기술 머신에 필요한 코인이 부족합니다.");
      return;
    }

    const target = this.findTeamMember(targetEntityId);
    if (!target) {
      this.addEvent("teach_move_denied", "대상 포켓몬을 찾을 수 없습니다.");
      return;
    }

    const learnedMove = pickLearnsetMoveByType(target, element, this.rng);
    if (!learnedMove) {
      this.addEvent("teach_move_denied", "해당 속성의 기술을 찾을 수 없습니다.");
      return;
    }

    const alreadyKnows = target.moves.some((existing) => existing.id === learnedMove.id);
    if (alreadyKnows) {
      this.addEvent(
        "teach_move_denied",
        `${target.speciesName}는 이미 ${learnedMove.name}을(를) 습득했습니다.`,
      );
      return;
    }

    this.state.money -= cost;
    const replaceIndex = pickWeakestMoveIndex(target.moves);
    const updatedMoves = target.moves.map((existing, index) =>
      index === replaceIndex ? cloneMove(learnedMove) : existing,
    );
    target.moves = updatedMoves;
    target.powerScore = scoreCreature({
      stats: target.stats,
      moves: updatedMoves,
      types: target.types,
    });
    this.discoverOwnedDexEntries([target]);
    this.flashTeamEffect(target.instanceId, "teach-move");
    this.addEvent(
      "teach_move_applied",
      `${withJosa(target.speciesName, "이/가")} ${learnedMove.name}을(를) 익혔습니다.`,
      { target: target.speciesName, move: learnedMove.id, element },
    );
  }

  private buyTypeLock(element: ElementType): void {
    if (this.state.phase !== "ready") {
      this.addEvent("type_lock_ignored", "준비 상태에서만 사용할 수 있습니다.");
      return;
    }

    const product = getTypeLockProduct(element);
    const cost = this.resolveDiscountedCost(`shop:type-lock:${element}`, product.cost);

    if (this.state.money < cost) {
      this.addEvent("type_lock_denied", "타입 고정에 필요한 코인이 부족합니다.");
      return;
    }

    this.state.money -= cost;
    const existing =
      this.state.encounterBoost?.wave === this.state.currentWave
        ? this.state.encounterBoost
        : { wave: this.state.currentWave };
    this.state.encounterBoost = {
      ...existing,
      lockedType: element,
    };
    this.addEvent(
      "type_lock_applied",
      `다음 만남이 ${localizeType(element)} 속성으로 고정되었습니다.`,
      { element },
    );
  }

  private sortTeam(sortBy: TeamSortKey, direction: SortDirection): void {
    if (this.state.phase !== "ready") {
      this.addEvent("team_sort_ignored", "준비 상태에서만 팀 순서를 정렬할 수 있습니다.");
      return;
    }

    const product = getTeamSortProduct(sortBy, direction);
    const cost = this.resolveDiscountedCost(teamSortActionId(sortBy, direction), product.cost);

    if (this.state.money < cost) {
      this.addEvent("team_sort_denied", "팀 정렬에 필요한 코인이 부족합니다.");
      return;
    }

    const sorted = sortTeamMembers(this.state.team, sortBy, direction);
    if (isSameTeamOrder(this.state.team, sorted)) {
      this.addEvent("team_sort_denied", "이미 해당 기준으로 정렬되어 있습니다.", {
        sortBy,
        direction,
      });
      return;
    }

    this.state.money -= cost;
    this.state.team = sorted;
    this.flashTeamEffect(sorted[0]?.instanceId, "team-reroll");
    this.addEvent(
      "team_sorted",
      `${teamSortLabel(sortBy, direction)}으로 팀 순서를 정렬했습니다.`,
      {
        sortBy,
        direction,
        cost,
        order: sorted.map((creature) => creature.instanceId),
      },
    );
  }

  private buyScout(kind: ScoutKind, tier: ScoutTier): void {
    if (this.state.phase !== "ready") {
      this.addEvent("scout_ignored", "탐지는 다음 만남 준비 상태에서만 사용할 수 있습니다.");
      return;
    }

    const product = getScoutProduct(kind, tier);

    if (this.state.money < product.cost) {
      this.addEvent("scout_denied", "탐지에 필요한 코인이 부족합니다.");
      return;
    }

    const routeId = getSelectedRouteId(this.state);
    const previewRng = new SeededRng(this.rng.getState());
    const preview = this.createEncounterWithRng(routeId, previewRng);
    const enemyPower = scoreTeam(preview.enemyTeam);
    const maxRarity = Math.max(...preview.enemyTeam.map((creature) => creature.rarityScore));
    const report =
      kind === "rarity"
        ? createRarityScoutReport(tier, preview.opponentName, maxRarity)
        : createPowerScoutReport(
            tier,
            preview.opponentName,
            enemyPower,
            scoreTeam(this.state.team),
          );

    this.state.money -= product.cost;
    this.addEvent("scout_reported", report, {
      kind,
      tier,
      cost: product.cost,
      routeId,
      opponentName: preview.opponentName,
      enemyPower,
      maxRarity,
    });
  }

  private prepareForEncounter(strategy: AutoPlayOptions["strategy"]): void {
    const healthRatio = getTeamHealthRatio(this.state.team);
    const hasFaintedMember = this.state.team.some((creature) => creature.currentHp <= 0);
    const restCost = calculateRestCost(this.state.currentWave, this.balance);

    if ((healthRatio < 0.98 || hasFaintedMember) && this.state.money >= restCost) {
      this.restTeam();
    }

    if (strategy === "greedy" && this.state.balls.pokeBall <= 1) {
      this.buyBall("pokeBall", 2);
    }

    if (
      strategy === "greedy" &&
      this.state.currentWave >= 6 &&
      this.state.balls.greatBall === 0 &&
      this.state.money >= this.balance.greatBallCost
    ) {
      this.buyBall("greatBall", 1);
    }
  }

  private chooseAutoRoute(strategy: AutoPlayOptions["strategy"]): RouteId {
    const healthRatio = getTeamHealthRatio(this.state.team);
    const hasFaintedMember = this.state.team.some((creature) => creature.currentHp <= 0);
    const totalBalls = countBalls(this.state.balls);
    const restCost = calculateRestCost(this.state.currentWave, this.balance);
    const isCheckpoint = this.state.currentWave % this.balance.checkpointInterval === 0;

    if (strategy === "conserveBalls") {
      return (healthRatio < 0.5 || hasFaintedMember) &&
        this.state.supplyUsedAtWave !== this.state.currentWave &&
        this.state.money >= this.balance.supplyRouteCost
        ? "supply"
        : "normal";
    }

    if (
      healthRatio >= 0.9 &&
      !hasFaintedMember &&
      totalBalls >= 4 &&
      this.state.money >= restCost &&
      !isCheckpoint
    ) {
      return "elite";
    }

    return "normal";
  }

  private chooseBall(strategy: AutoPlayOptions["strategy"]): BallType | undefined {
    if (strategy === "conserveBalls" && this.state.currentWave < 4) {
      return undefined;
    }

    const preferredBalls: BallType[] =
      this.state.currentWave >= 10
        ? ["masterBall", "hyperBall", "ultraBall", "greatBall", "pokeBall"]
        : this.state.currentWave >= 7
          ? ["hyperBall", "ultraBall", "greatBall", "pokeBall", "masterBall"]
          : this.state.currentWave >= 4
            ? ["ultraBall", "greatBall", "pokeBall", "hyperBall", "masterBall"]
            : ["pokeBall", "greatBall", "ultraBall", "hyperBall", "masterBall"];

    return preferredBalls.find((ball) => this.state.balls[ball] > 0);
  }

  private createEncounter(routeId: RouteId): EncounterSnapshot {
    return this.createEncounterWithRng(routeId, this.rng);
  }

  private getActiveEncounterBoost(): EncounterBoost | undefined {
    if (this.state.encounterBoost?.wave === this.state.currentWave) {
      return this.state.encounterBoost;
    }
    return undefined;
  }

  private createEncounterWithRng(routeId: RouteId, rng: SeededRng): EncounterSnapshot {
    const snapshot = this.pickTrainerSnapshot(this.state.currentWave, rng);

    if (snapshot) {
      return createTrainerEncounterFromSnapshot(snapshot, this.balance, routeId);
    }

    const boost = this.getActiveEncounterBoost();
    return createEncounter(this.state.currentWave, rng, this.balance, routeId, boost);
  }

  private resolveSupplyRoute(): void {
    if (this.state.supplyUsedAtWave === this.state.currentWave) {
      this.addEvent("supply_denied", "보급은 웨이브마다 한 번만 받을 수 있습니다.");
      return;
    }

    if (this.state.money < this.balance.supplyRouteCost) {
      this.addEvent("supply_denied", "보급에 필요한 코인이 부족합니다.");
      return;
    }

    const beforeHp = totalCurrentHp(this.state.team);
    this.state.money -= this.balance.supplyRouteCost;
    this.state.supplyUsedAtWave = this.state.currentWave;
    this.state.team = this.state.team.map((creature) => {
      const triageHp = Math.ceil(creature.stats.hp * 0.5);

      return {
        ...creature,
        currentHp: Math.min(creature.stats.hp, Math.max(creature.currentHp, triageHp)),
      };
    });
    const healedHp = totalCurrentHp(this.state.team) - beforeHp;
    this.state.phase = "ready";
    this.state.pendingEncounter = undefined;
    this.state.pendingCapture = undefined;
    this.addEvent(
      "supply_resolved",
      healedHp > 0
        ? `보급로에서 팀을 응급 처치했습니다. 회복량: ${healedHp} HP.`
        : "보급로를 확인했습니다. 팀은 이미 충분히 버틸 수 있습니다.",
      {
        healedHp,
        cost: this.balance.supplyRouteCost,
      },
    );
  }

  private consumeSelectedRoute(): RouteId {
    const selectedRouteId =
      this.state.selectedRoute?.wave === this.state.currentWave
        ? this.state.selectedRoute.id
        : undefined;
    const routeId =
      selectedRouteId === "elite" || selectedRouteId === "supply" ? selectedRouteId : "normal";
    this.state.selectedRoute = undefined;
    return routeId;
  }

  private pickTrainerSnapshot(wave: number, rng: SeededRng): TrainerSnapshot | undefined {
    if (wave % this.balance.checkpointInterval !== 0) {
      return undefined;
    }

    const candidates = this.trainerSnapshots.filter((snapshot) => snapshot.wave === wave);

    return candidates.length > 0 ? rng.pick(candidates) : undefined;
  }

  private advanceWave(): void {
    this.state.currentWave += 1;
    this.state.phase = "ready";
    this.state.selectedRoute = undefined;
    this.state.encounterBoost = undefined;
    this.state.pendingEncounter = undefined;
    this.state.pendingCapture = undefined;
    this.state.shopDeal = this.generateShopDeal();
    this.state.shopInventory = this.generateShopInventory(0);
  }

  private generateShopDeal(): ShopDeal {
    const pool: string[] = [
      "shop:rest",
      "shop:heal:single:3",
      "shop:heal:single:4",
      "shop:heal:team:3",
      "shop:heal:team:4",
      "shop:pokeball",
      "shop:greatball",
      "shop:ultraball",
      "shop:hyperball",
      "shop:rarity-boost:2",
      "shop:level-boost:2",
      ...shopStatKeys.map((stat) => `shop:stat-boost:${stat}:2`),
      ...teachMoveElements.map((element) => `shop:teach-move:${element}`),
      ...teamSortOptions.map((option) => teamSortActionId(option.sortBy, option.direction)),
      ...typeLockElements.map((element) => `shop:type-lock:${element}`),
    ];
    const dealRng = new SeededRng(`${this.state.seed}:deal:${this.state.currentWave}`);
    const shuffled = dealRng.shuffle(pool);
    const dealCount = 1 + Math.floor(dealRng.nextFloat() * 2);
    const discountRate = 0.2 + Math.floor(dealRng.nextFloat() * 3) * 0.05;
    return {
      wave: this.state.currentWave,
      discountedActionIds: shuffled.slice(0, dealCount),
      discountRate,
    };
  }

  private addEvent(type: string, message: string, data?: Record<string, unknown>): void {
    const event: GameEvent = {
      id: this.nextEventId,
      wave: this.state.currentWave,
      type,
      message,
      data,
    };
    this.nextEventId += 1;
    this.state.events = [...this.state.events, event].slice(-80);
  }

  private syncRngState(): void {
    this.state.rngState = this.rng.getState();
  }
}

export function cloneState(state: GameState): GameState {
  const cloned = JSON.parse(JSON.stringify(state)) as GameState;
  return {
    ...cloned,
    balls: normalizeBalls(cloned.balls),
  };
}

function normalizeStateBattleLoadouts(state: GameState): GameState {
  const normalized: GameState = {
    ...state,
    team: state.team.map(normalizeCreatureBattleLoadout),
  };

  if (state.pendingCapture) {
    normalized.pendingCapture = normalizeCreatureBattleLoadout(state.pendingCapture);
  }

  if (state.pendingEncounter) {
    normalized.pendingEncounter = {
      ...state.pendingEncounter,
      enemyTeam: state.pendingEncounter.enemyTeam.map(normalizeCreatureBattleLoadout),
    };
  }

  if (state.lastBattle) {
    normalized.lastBattle = {
      ...state.lastBattle,
      playerTeam: state.lastBattle.playerTeam.map(normalizeCreatureBattleLoadout),
      enemyTeam: state.lastBattle.enemyTeam.map(normalizeCreatureBattleLoadout),
    };
  }

  return normalizeStateDexEntries(normalized);
}

function normalizeStateDexEntries(state: GameState): GameState {
  const speciesIds = new Set<number>();
  const moveIds = new Set<string>();

  for (const speciesId of state.unlockedSpeciesIds ?? []) {
    if (isValidSpeciesId(speciesId)) {
      speciesIds.add(speciesId);
    }
  }

  for (const moveId of state.unlockedMoveIds ?? []) {
    if (isValidMoveId(moveId)) {
      moveIds.add(moveId);
    }
  }

  for (const creature of state.team) {
    if (isValidSpeciesId(creature.speciesId)) {
      speciesIds.add(creature.speciesId);
    }

    for (const move of creature.moves) {
      if (isValidMoveId(move.id)) {
        moveIds.add(move.id);
      }
    }
  }

  return {
    ...state,
    unlockedSpeciesIds: Array.from(speciesIds),
    unlockedMoveIds: Array.from(moveIds),
  };
}

export function cloneClientSnapshot(snapshot: HeadlessClientSnapshot): HeadlessClientSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as HeadlessClientSnapshot;
}

function cloneTrainerSnapshot(snapshot: TrainerSnapshot): TrainerSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as TrainerSnapshot;
}

function normalizeBalance(balance?: Partial<GameBalance>): GameBalance {
  return { ...defaultBalance, ...balance };
}

function totalCurrentHp(team: GameState["team"]): number {
  return team.reduce((total, creature) => total + Math.max(0, creature.currentHp), 0);
}

function createStartingBalls(balance: GameBalance): GameState["balls"] {
  return {
    pokeBall: balance.startingPokeBalls,
    greatBall: balance.startingGreatBalls,
    ultraBall: balance.startingUltraBalls,
    hyperBall: balance.startingHyperBalls,
    masterBall: balance.startingMasterBalls,
  };
}

function normalizeBalls(balls: Partial<Record<BallType, number>> | undefined): GameState["balls"] {
  return {
    pokeBall: normalizeBallCount(balls?.pokeBall),
    greatBall: normalizeBallCount(balls?.greatBall),
    ultraBall: normalizeBallCount(balls?.ultraBall),
    hyperBall: normalizeBallCount(balls?.hyperBall),
    masterBall: normalizeBallCount(balls?.masterBall),
  };
}

function normalizeBallCount(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function isValidSpeciesId(speciesId: number): boolean {
  if (!Number.isInteger(speciesId) || speciesId <= 0) {
    return false;
  }

  try {
    getSpecies(speciesId);
    return true;
  } catch {
    return false;
  }
}

function isValidMoveId(moveId: string): boolean {
  if (!moveId) {
    return false;
  }

  try {
    getMove(moveId);
    return true;
  } catch {
    return false;
  }
}

function countBalls(balls: GameState["balls"]): number {
  return ballTypes.reduce((total, ball) => total + balls[ball], 0);
}

function rollActivePremiumOffers(seed: string, wave: number): PremiumOfferId[] {
  const rng = new SeededRng(`${seed}:premium:${wave}`);
  const shuffled = rng.shuffle(premiumOfferIds);
  const count = 1 + Math.floor(rng.nextFloat() * 2);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function pickWeightedShopEntry(
  group: readonly ShopInventoryPoolEntry[],
  rng: SeededRng,
): ShopInventoryPoolEntry {
  if (group.length === 0) {
    throw new Error("Shop inventory group is empty.");
  }

  const totalWeight = group.reduce((sum, entry) => sum + entry.weight, 0);
  let ticket = rng.nextFloat() * totalWeight;
  for (const entry of group) {
    ticket -= entry.weight;
    if (ticket <= 0) {
      return entry;
    }
  }

  return group[group.length - 1];
}

function pickUniqueWeightedShopEntry(
  group: readonly ShopInventoryPoolEntry[],
  rng: SeededRng,
  excludedActionIds: ReadonlySet<string>,
): ShopInventoryPoolEntry {
  const available = group.filter((entry) => !excludedActionIds.has(entry.actionId));
  return pickWeightedShopEntry(available.length > 0 ? available : group, rng);
}

function createShopInventoryEntry(entry: ShopInventoryPoolEntry): ShopInventoryEntry {
  return {
    actionId: entry.actionId,
    stock: entry.stock,
    initialStock: entry.stock,
  };
}

function getTypeWeightedShopWeight(element: ElementType): number {
  if (element === "dragon" || element === "ghost" || element === "ice") return 2;
  if (element === "psychic" || element === "dark" || element === "steel" || element === "fairy") {
    return 3;
  }
  return 4;
}

function formatShopStatLabel(stat: ShopStatKey): string {
  switch (stat) {
    case "hp":
      return "HP";
    case "attack":
      return "공";
    case "defense":
      return "방";
    case "special":
      return "특";
    case "speed":
      return "스";
  }
}

function isRecoveryShopAction(actionId: string): boolean {
  return actionId === "shop:rest" || actionId.startsWith("shop:heal:");
}

function isBallShopAction(actionId: string): boolean {
  return (
    actionId === "shop:pokeball" ||
    actionId === "shop:greatball" ||
    actionId === "shop:ultraball" ||
    actionId === "shop:hyperball" ||
    actionId === "shop:masterball"
  );
}

function isEncounterBoostShopAction(actionId: string): boolean {
  return (
    actionId.startsWith("shop:rarity-boost:") ||
    actionId.startsWith("shop:level-boost:") ||
    actionId.startsWith("shop:type-lock:")
  );
}

function isTeamUpgradeShopAction(actionId: string): boolean {
  return (
    actionId.startsWith("shop:stat-boost:") ||
    actionId.startsWith("shop:teach-move:") ||
    actionId.startsWith("shop:team-sort:")
  );
}

function sortTeamMembers(
  team: readonly Creature[],
  sortBy: TeamSortKey,
  direction: SortDirection,
): Creature[] {
  const directionFactor = direction === "asc" ? 1 : -1;
  return team
    .map((creature, index) => ({
      creature,
      index,
      value: teamSortValue(creature, sortBy),
    }))
    .sort((left, right) => (left.value - right.value) * directionFactor || left.index - right.index)
    .map((entry) => entry.creature);
}

function teamSortValue(creature: Creature, sortBy: TeamSortKey): number {
  if (sortBy === "power") {
    return creature.powerScore;
  }

  return creature.stats.hp <= 0 ? 0 : creature.currentHp / creature.stats.hp;
}

function isSameTeamOrder(left: readonly Creature[], right: readonly Creature[]): boolean {
  return (
    left.length === right.length &&
    left.every((creature, index) => creature.instanceId === right[index]?.instanceId)
  );
}

function teamSortLabel(sortBy: TeamSortKey, direction: SortDirection): string {
  const sortLabel = sortBy === "power" ? "전투력" : "건강상태";
  const directionLabel = direction === "asc" ? "오름차순" : "내림차순";
  return `${sortLabel} ${directionLabel}`;
}

function createCaptureJoinCreature(creature: Creature): Creature {
  const maxHp = Math.max(0, creature.stats.hp);
  const joinHp = maxHp <= 0 ? 0 : Math.max(1, Math.ceil(maxHp * 0.5));
  return {
    ...creature,
    currentHp: Math.min(maxHp, joinHp),
  };
}

function healTeamByRatio(team: GameState["team"], healRatio: number): GameState["team"] {
  return team.map((creature) => healCreatureByRatio(creature, healRatio));
}

function healSingleByRatio(
  team: GameState["team"],
  healRatio: number,
  targetEntityId?: string,
): GameState["team"] {
  const explicitTarget = targetEntityId
    ? team.findIndex((creature) => creature.instanceId === targetEntityId)
    : -1;
  const target =
    explicitTarget >= 0
      ? { index: explicitTarget }
      : team
          .map((creature, index) => ({
            index,
            missingHp: Math.max(0, creature.stats.hp - creature.currentHp),
            hpRatio: creature.stats.hp <= 0 ? 1 : creature.currentHp / creature.stats.hp,
          }))
          .filter((candidate) => candidate.missingHp > 0)
          .sort(
            (left, right) => left.hpRatio - right.hpRatio || right.missingHp - left.missingHp,
          )[0];

  if (!target) {
    return [...team];
  }

  return team.map((creature, index) =>
    index === target.index ? healCreatureByRatio(creature, healRatio) : creature,
  );
}

function healCreatureByRatio(
  creature: GameState["team"][number],
  healRatio: number,
): GameState["team"][number] {
  const amount = Math.ceil(creature.stats.hp * healRatio);
  return {
    ...creature,
    currentHp: Math.min(creature.stats.hp, creature.currentHp + amount),
  };
}

function getSelectedRouteId(state: GameState): RouteId {
  return state.selectedRoute?.wave === state.currentWave ? state.selectedRoute.id : "normal";
}

function createRarityScoutReport(tier: ScoutTier, opponentName: string, maxRarity: number): string {
  if (tier === 1) {
    const band = maxRarity >= 8 ? "높음" : maxRarity >= 5 ? "보통" : "낮음";
    return `희귀 탐지 ${tier}단계: 다음 만남의 희귀도는 ${band}입니다.`;
  }

  if (tier === 2) {
    return `희귀 탐지 ${tier}단계: 다음 만남의 최고 희귀도는 약 ${maxRarity}입니다.`;
  }

  return `희귀 탐지 ${tier}단계: ${opponentName}의 최고 희귀도는 ${maxRarity}입니다.`;
}

function createPowerScoutReport(
  tier: ScoutTier,
  opponentName: string,
  enemyPower: number,
  teamPower: number,
): string {
  if (tier === 1) {
    const ratio = teamPower <= 0 ? 1 : enemyPower / teamPower;
    const band = ratio >= 1.15 ? "위험" : ratio >= 0.85 ? "비슷함" : "유리";
    return `강도 탐지 ${tier}단계: 다음 전투 강도는 ${band}입니다.`;
  }

  if (tier === 2) {
    return `강도 탐지 ${tier}단계: 다음 상대 전투력은 약 ${enemyPower}입니다.`;
  }

  return `강도 탐지 ${tier}단계: ${opponentName} 전투력 ${enemyPower}입니다.`;
}

function routeName(routeId: RouteId): string {
  switch (routeId) {
    case "normal":
      return "일반로";
    case "elite":
      return "정예로";
    case "supply":
      return "보급로";
  }
}

function battleWinnerToOpponentOutcome(winner: "player" | "enemy"): "win" | "loss" {
  return winner === "enemy" ? "win" : "loss";
}

function assertValidClientSnapshot(snapshot: HeadlessClientSnapshot): void {
  if (snapshot.version !== 1) {
    throw new Error(`Unsupported headless snapshot version: ${snapshot.version}`);
  }

  if (snapshot.state.version !== 1) {
    throw new Error(`Unsupported game state version: ${snapshot.state.version}`);
  }

  if (!Number.isInteger(snapshot.frameId) || snapshot.frameId < 0) {
    throw new Error(`Invalid snapshot frame id: ${snapshot.frameId}`);
  }

  if (!Number.isInteger(snapshot.nextEventId) || snapshot.nextEventId < 1) {
    throw new Error(`Invalid snapshot next event id: ${snapshot.nextEventId}`);
  }

  if (!Number.isInteger(snapshot.state.rngState) || snapshot.state.rngState <= 0) {
    throw new Error(`Invalid snapshot RNG state: ${snapshot.state.rngState}`);
  }

  if (!Array.isArray(snapshot.trainerSnapshots)) {
    throw new Error("Headless snapshot trainerSnapshots must be an array.");
  }
}

function signature(state: GameState): string {
  return [
    state.phase,
    state.currentWave,
    state.money,
    ...ballTypes.map((ball) => state.balls[ball]),
    state.events.length,
  ].join(":");
}

function inferShopActionId(action: GameAction): string | undefined {
  switch (action.type) {
    case "REST_TEAM":
      return "shop:rest";
    case "BUY_HEAL":
      return `shop:heal:${action.scope}:${action.tier}`;
    case "BUY_BALL":
      return `shop:${ballActionSlugFor(action.ball)}`;
    case "BUY_SCOUT":
      return `shop:scout:${action.kind}:${action.tier}`;
    case "BUY_RARITY_BOOST":
      return `shop:rarity-boost:${action.tier}`;
    case "BUY_LEVEL_BOOST":
      return `shop:level-boost:${action.tier}`;
    case "BUY_STAT_BOOST":
      return `shop:stat-boost:${action.stat}:${action.tier}`;
    case "BUY_STAT_REROLL":
      return "shop:stat-reroll";
    case "BUY_TEACH_MOVE":
      return `shop:teach-move:${action.element}`;
    case "BUY_TYPE_LOCK":
      return `shop:type-lock:${action.element}`;
    case "SORT_TEAM":
      return teamSortActionId(action.sortBy, action.direction);
    case "BUY_PREMIUM_SHOP_ITEM":
      return `shop:${action.offerId}`;
    case "BUY_PREMIUM_MASTERBALL":
      return "shop:premium:masterball";
    case "BUY_PREMIUM_REVIVE_ALL":
      return "shop:premium:revive";
    case "BUY_PREMIUM_COIN_BAG":
      return "shop:premium:coin-bag";
    case "BUY_PREMIUM_TEAM_REROLL":
      return "shop:premium:team-reroll";
    case "BUY_PREMIUM_DEX_UNLOCK":
      return "shop:premium:dex-unlock";
    default:
      return undefined;
  }
}

function ballActionSlugFor(ball: BallType): string {
  switch (ball) {
    case "pokeBall":
      return "pokeball";
    case "greatBall":
      return "greatball";
    case "ultraBall":
      return "ultraball";
    case "hyperBall":
      return "hyperball";
    case "masterBall":
      return "masterball";
  }
}

function pickLearnsetMoveByType(
  creature: Creature,
  element: ElementType,
  rng: SeededRng,
  grade?: 1 | 2 | 3,
): MoveDefinition | undefined {
  const candidates = getLearnableLevelUpMoves(creature, element, { grade });

  return candidates.length > 0 ? rng.pick(candidates) : undefined;
}

function pickWeakestMoveIndex(moves: readonly MoveDefinition[]): number {
  if (moves.length === 0) return 0;
  let weakestIndex = 0;
  let weakestPower = Number.POSITIVE_INFINITY;
  for (let index = 0; index < moves.length; index += 1) {
    const power = moves[index].power ?? 0;
    if (power < weakestPower) {
      weakestPower = power;
      weakestIndex = index;
    }
  }
  return weakestIndex;
}

function cloneMove(move: MoveDefinition): MoveDefinition {
  const catalogMove = movesById[move.id];
  const source = catalogMove ?? getMove(move.id);
  return {
    ...source,
    flags: [...(source.flags ?? [])],
    statChanges: (source.statChanges ?? []).map((change) => ({ ...change })),
    meta: { ...source.meta },
    statusEffect: source.statusEffect ? { ...source.statusEffect } : undefined,
  };
}
