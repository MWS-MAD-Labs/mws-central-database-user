-- Google photo hashes noted while Central still kept its own photo would make the sync skip a photo that never replaced it.
UPDATE "persons" SET "google_photo_hash" = NULL WHERE "google_photo_hash" IS NOT NULL;
