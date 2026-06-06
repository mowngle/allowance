import { describe, it, expect } from 'vitest';
import { CHEER_PHRASES, phraseText } from './cheers';

describe('cheers', () => {
  it('has unique non-empty ids and texts', () => {
    const ids = CHEER_PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CHEER_PHRASES.every((p) => p.id && p.text)).toBe(true);
  });

  it('phraseText looks up by id, null for unknown', () => {
    expect(phraseText(CHEER_PHRASES[0].id)).toBe(CHEER_PHRASES[0].text);
    expect(phraseText('nope')).toBeNull();
  });
});
