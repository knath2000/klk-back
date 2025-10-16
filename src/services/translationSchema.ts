import { z } from 'zod';

export const DictionarySenseSchema = z.object({
  sense_number: z.number(),
  registers: z.array(z.string()).optional(),
  regions: z.array(z.string()).optional(),
  gloss: z.string(),
  usage_notes: z.string().optional(),
  examples: z.array(z.object({ es: z.string(), en: z.string() })),
  synonyms: z.array(z.string()).optional(),
  antonyms: z.array(z.string()).optional(),
  cross_references: z.array(z.string()).optional(),
  translation_es: z.string().optional(),
});

export const DictionaryEntrySchema = z.object({
  headword: z.string(),
  pronunciation: z.object({
    ipa: z.string(),
    syllabification: z.string().optional(),
  }),
  part_of_speech: z.string(),
  gender: z.enum(['m', 'f', 'mf']).nullable(),
  inflections: z.array(z.string()),
  frequency: z.number().optional(),
  senses: z.array(DictionarySenseSchema).min(1),
});

export const TranslationResponseSchema = z.object({
  headword: z.string().optional(),
  part_of_speech: z.string().optional(),
  senses: z.array(DictionarySenseSchema).optional(),
  definitions: z.array(z.object({
    text: z.string().optional(),
    meaning: z.string().optional(),
    partOfSpeech: z.string().optional(),
    pos: z.string().optional(),
    examples: z.array(z.string()).optional(),
    usage: z.string().optional(),
  })).default([]),
  examples: z.array(z.object({
    text: z.string().optional(),
    translation: z.string().optional(),
    spanish: z.string().optional(),
    english: z.string().optional(),
    context: z.string().optional(),
  })).default([]),
  conjugations: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  audio: z.union([
    z.array(z.object({ url: z.string().optional(), pronunciation: z.string().optional(), text: z.string().optional(), type: z.string().optional() })),
    z.object({ ipa: z.string().optional(), suggestions: z.array(z.string()).optional() })
  ]).default({ ipa: '', suggestions: [] }),
  related: z.union([
    z.array(z.object({ word: z.string(), type: z.string() })),
    z.object({ synonyms: z.array(z.string()).optional(), antonyms: z.array(z.string()).optional() })
  ]).default({ synonyms: [], antonyms: [] }),
  entry: DictionaryEntrySchema.optional(),
});