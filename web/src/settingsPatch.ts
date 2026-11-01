import type { Settings } from '../../src/shared/types';

export type SettingsForm = Omit<Settings, 'checkEveryHours' | 'openWebPages'> & { checkEveryHours: string; memory: string };

/**
 * Only what the user changed since the sheet opened, so a stale copy never overwrites newer values
 * (memory Duet appended, settings changed elsewhere). An emptied number field keeps the current value.
 */
export function settingsPatch(initial: SettingsForm, form: SettingsForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(form) as (keyof SettingsForm)[]) if (form[key] !== initial[key]) patch[key] = form[key];
  if ('checkEveryHours' in patch) {
    if (form.checkEveryHours.trim() === '') delete patch.checkEveryHours;
    else patch.checkEveryHours = Number(form.checkEveryHours);
  }
  return patch;
}
