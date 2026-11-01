import type { StageSettingSpec } from '../wire';

type Settings = Record<string, Record<string, string>>;

/** The settings with `provider.key` set to `text`; an empty text removes the key and an emptied provider block. */
export function setStageValue(
  settings: Settings,
  provider: string,
  key: string,
  text: string,
): Settings {
  const { [provider]: block = {}, ...others } = settings;
  const { [key]: _removed, ...rest } = block;
  const next = text === '' ? rest : { ...rest, [key]: text };
  return Object.keys(next).length === 0 ? others : { ...others, [provider]: next };
}

/** Whether `text` is empty (provider default) or a whole number inside the spec's range. */
export function stageValueValid(spec: StageSettingSpec, text: string): boolean {
  if (text === '') return true;
  if (!/^\d+$/.test(text)) return false;
  const n = Number(text);
  return n >= spec.min && n <= spec.max;
}
