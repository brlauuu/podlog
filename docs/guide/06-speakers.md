# Speaker Management

Podlog automatically labels speakers in each episode and offers tools to rename and merge them.

## Automatic Speaker Labeling

After transcription, pyannote analyzes the audio to detect different speakers. Each speaker is assigned a label: `SPEAKER_00`, `SPEAKER_01`, etc. These labels are consistent within an episode but not across episodes (the same person may be SPEAKER_00 in one episode and SPEAKER_01 in another).

## AI-Inferred Names

If `INFERENCE_ENABLED=true` (the default), Podlog runs spaCy named entity recognition on each speaker's text to guess their name. For example, if SPEAKER_00 says "I'm Dr. Smith and today we're discussing...", the system may infer the name "Dr. Smith."

Inferred names show an "AI" badge to distinguish them from user-confirmed names. They're a starting point — override them if they're wrong.

## Renaming a Speaker

1. On the episode detail page, click any speaker name
2. Type the correct name
3. The name is saved immediately and marked as user-confirmed

User-confirmed names take priority over AI-inferred names and won't be overwritten by future inference runs.

## Merging Speakers

Sometimes pyannote splits one real speaker into multiple labels (e.g., SPEAKER_00 and SPEAKER_02 are both the host). To fix this:

1. On the episode detail page, open the speaker panel
2. Select the speakers you want to merge (checkboxes)
3. Choose the target speaker (the one to keep)
4. Click **Merge**

All segments from the source speakers are reassigned to the target. The merge is atomic — it either fully completes or doesn't change anything.

## When Diarization Fails

If pyannote can't process the audio (too noisy, unsupported language, etc.), the episode is still transcribed — you just won't have speaker labels. The transcript shows all text without speaker separation.

In this case, renaming and merging are unavailable since there are no speaker labels to work with.

---

**Next:** [Audio Playback](07-audio-playback.md) | **Back:** [Episodes & Transcripts](05-episodes.md) | **Home:** [Guide](README.md)
