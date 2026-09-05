import { ChannelPackSchema } from '../../src/models.js';

/** Initial ID mapping only. Unspecified editorial policies are deliberately absent. */
export const nihonZupzupPack = ChannelPackSchema.parse({
  id: 'nihon_zupzup', version: '1.0',
  profiles: [
    ...['anime_analysis', 'drama_analysis', 'practical_explainer', 'wasei_eigo', 'dialect', 'trend'].map(id => ({ id, contentType: 'discovery_long' })),
    ...['shadowing_training', 'repetition_training', 'practical_dialogue_training'].map(id => ({ id, contentType: 'training_long' })),
    ...['anime_discovery_short', 'drama_discovery_short', 'dialect_discovery_short', 'trend_discovery_short', 'wasei_discovery_short'].map(id => ({ id, contentType: 'discovery_short' })),
    ...['phrase_learning_short', 'vocabulary_learning_short', 'pronunciation_learning_short'].map(id => ({ id, contentType: 'learning_short' }))
  ],
  themes: [{ id: 'nihon-discovery-v1', fontPrimaryKR: 'sans-serif', fontPrimaryJP: 'sans-serif', fontCaption: 'sans-serif', fontNumber: 'sans-serif', colors: { background: '#ffffff', foreground: '#111111' }, defaultTransition: 'CUT' }]
});
