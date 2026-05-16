import type {MajorStatus, MoveCategory} from '../core/types';

export const statusLabels: Record<MajorStatus, string> = {
  brn: '화상',
  par: '마비',
  psn: '독',
  slp: '수면',
  frz: '얼음',
};

export const volatileLabels: Record<string, string> = {
  confusion: '혼란',
  leechseed: '씨앗',
  partiallytrapped: '묶임',
  substitute: '대타',
  mist: '흰안개',
  lightscreen: '빛장막',
  reflect: '리플렉터',
  disable: '봉인',
  focusenergy: '기합',
};

export const categoryLabels: Record<MoveCategory, string> = {
  Physical: '물리',
  Special: '특수',
  Status: '보조',
};
