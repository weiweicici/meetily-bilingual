-- Migration: Add translation column to transcripts table
-- Enables direct persistence of bilingual translations in SQLite
ALTER TABLE transcripts ADD COLUMN translation TEXT;
