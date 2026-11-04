-- The logo version is unique across logos, so picking another logo changes what the Hub caches by.
CREATE SEQUENCE "application_logos_version_seq";
-- Start above every version in use, then renumber, so a picture the Hub already has is fetched again.
SELECT setval('"application_logos_version_seq"', COALESCE((SELECT MAX("version") FROM "application_logos"), 0) + 1, false);
UPDATE "application_logos" SET "version" = nextval('"application_logos_version_seq"');
ALTER TABLE "application_logos" ALTER COLUMN "version" SET DEFAULT nextval('"application_logos_version_seq"');
ALTER SEQUENCE "application_logos_version_seq" OWNED BY "application_logos"."version";
