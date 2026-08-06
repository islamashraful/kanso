-- Runs once, when Postgres initialises an empty data directory.
--
-- Integration tests wipe their database between cases, so they run against a
-- separate one rather than the development database. Creating it here makes it
-- part of `docker compose up` instead of a setup step someone has to be told.
CREATE DATABASE kanso_test OWNER kanso;
