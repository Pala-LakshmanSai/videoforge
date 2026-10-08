export interface SavedVoiceCollection {
  id: string;
  name: string;
  email?: string;
  is_current_user: boolean;
  voice_ids: string[];
}

export function canUseCatalogVoice(
  voice: { voice_id: string; imported?: boolean },
  own: { voice_id: string; imported: boolean; saved?: boolean }[],
  collections: SavedVoiceCollection[],
  libraryOwner: boolean,
): boolean {
  return (
    !voice.imported ||
    libraryOwner ||
    own.some((saved) => saved.voice_id === voice.voice_id && (saved.imported || saved.saved)) ||
    collections.some((collection) => collection.voice_ids.includes(voice.voice_id))
  );
}
