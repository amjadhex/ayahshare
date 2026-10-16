-- "My language" (Track F): the ISO code the person picked (translation, chips, tafsir and reflections language), kept
-- with the account so it follows them to other devices. NULL until they pick one; the device keeps its own copy.
ALTER TABLE users ADD COLUMN lang TEXT;
