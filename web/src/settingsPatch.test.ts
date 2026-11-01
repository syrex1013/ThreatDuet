import { describe, expect, it } from 'vitest';
import { settingsPatch, type SettingsForm } from './settingsPatch';

const initial: SettingsForm = {
  model: 'm',
  language: 'en',
  briefAt: '08:00',
  reportAt: '18:00',
  checkEveryHours: '3',
  quietStart: '22:00',
  quietEnd: '07:00',
  focus: 'work',
  kiloMode: 'api',
  memory: '',
};

describe('settingsPatch', () => {
  it('sends only changed fields', () => {
    expect(settingsPatch(initial, { ...initial })).toEqual({});
    expect(settingsPatch(initial, { ...initial, briefAt: '07:30', checkEveryHours: '1.5' })).toEqual({ briefAt: '07:30', checkEveryHours: 1.5 });
  });
  it('keeps the current check-in interval when the field is emptied', () => {
    expect(settingsPatch(initial, { ...initial, checkEveryHours: ' ' })).toEqual({});
    expect(settingsPatch(initial, { ...initial, checkEveryHours: '0' })).toEqual({ checkEveryHours: 0 });
  });
});
