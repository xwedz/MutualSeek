-- Which version of the "Before you start" guidelines each user has accepted (see GUIDELINES_VERSION in src/index.ts).
--
-- They're shown the first time a logged-in user opens Find people, and again whenever GUIDELINES_VERSION is raised
-- after an important change. 0 = never accepted. Logging in again doesn't reset it (the login upsert only updates
-- tokens and profile fields); "Delete my data" removes the account row, so they're shown again after the next login.

ALTER TABLE accounts ADD COLUMN guidelines_version INTEGER NOT NULL DEFAULT 0;
