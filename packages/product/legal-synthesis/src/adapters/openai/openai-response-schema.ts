/**
 * This schema mirrors Law Afrique's Phase 9L transport response.
 *
 * IMPORTANT:
 * The model returns only proposition text and evidence ordinals.
 * It cannot return source IDs, version IDs, passage IDs, locators or
 * authoritative citation identity.
 */
export const openAiLegalSynthesisResponseSchema = Object.freeze({
  type: 'object',

  additionalProperties: false,

  properties: {
    schemaVersion: {
      type: 'integer',

      enum: [1],
    },

    summary: {
      type: 'string',
    },

    propositions: {
      type: 'array',

      maxItems: 64,

      items: {
        type: 'object',

        additionalProperties: false,

        properties: {
          text: {
            type: 'string',
          },

          evidenceOrdinals: {
            type: 'array',

            minItems: 1,

            maxItems: 50,

            items: {
              type: 'integer',

              minimum: 0,
            },
          },
        },

        required: ['text', 'evidenceOrdinals'],
      },
    },

    unresolvedIssues: {
      type: 'array',

      maxItems: 64,

      items: {
        type: 'string',
      },
    },

    insufficientEvidence: {
      type: 'boolean',
    },
  },

  required: [
    'schemaVersion',
    'summary',
    'propositions',
    'unresolvedIssues',
    'insufficientEvidence',
  ],
} as const);
