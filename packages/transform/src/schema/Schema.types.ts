import { JsonSchema } from '@cord.network/utils'

export const SchemaModelV1: JsonSchema.Schema & { $id: string } = {
  $id: 'http://cord.network/draft-01/schema#',
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'CORD Metaschema',
  description: 'Describes a JSON schema for validating  stream types.',
  type: 'object',
  properties: {
    $id: {
      pattern: '^schema:cord:m[0-9a-zA-Z]+$',
      type: 'string',
    },
    $schema: {
      type: 'string',
    },
    $metadata: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
        },
        slug: {
          type: 'string',
        },
        discoverable: {
          type: 'boolean',
        },
      },
    },
    title: { type: 'string' },
    description: {
      type: 'string',
    },
    type: { const: 'object', type: 'string' },
    properties: {
      patternProperties: {
        '^.+$': {
          oneOf: [
            { $ref: '#/definitions/string' },
            { $ref: '#/definitions/number' },
            { $ref: '#/definitions/boolean' },
            { $ref: '#/definitions/schemaReference' },
            { $ref: '#/definitions/array' },
            { $ref: '#/definitions/object' },
          ],
        },
      },
      type: 'object',
    },
    additionalProperties: { const: false, type: 'boolean' },
    required: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
  required: [
    '$id',
    '$schema',
    'additionalProperties',
    'properties',
    'title',
    'type',
  ],
  definitions: {
    schemaReference: {
      additionalProperties: false,
      properties: {
        $ref: {
          pattern: '^schema:cord:m[0-9a-zA-Z]+(#/properties/.+)?$',
          format: 'uri',
          type: 'string',
        },
      },
      required: ['$ref'],
    },
    string: {
      additionalProperties: false,
      properties: {
        type: {
          const: 'string',
        },
        format: { enum: ['date', 'time', 'uri'] },
        enum: {
          type: 'array',
          items: { type: 'string' },
        },
        minLength: {
          type: 'number',
        },
        maxLength: {
          type: 'number',
        },
      },
      required: ['type'],
    },
    boolean: {
      additionalProperties: false,
      properties: {
        type: {
          const: 'boolean',
        },
      },
      required: ['type'],
    },
    number: {
      additionalProperties: false,
      properties: {
        type: {
          enum: ['integer', 'number'],
        },
        enum: {
          type: 'array',
          items: { type: 'number' },
        },
        minimum: {
          type: 'number',
        },
        maximum: {
          type: 'number',
        },
      },
      required: ['type'],
    },
    array: {
      additionalProperties: false,
      properties: {
        type: { const: 'array' },
        items: {
          oneOf: [
            { $ref: '#/definitions/string' },
            { $ref: '#/definitions/number' },
            { $ref: '#/definitions/boolean' },
            { $ref: '#/definitions/schemaReference' },
          ],
        },
        minItems: {
          type: 'number',
        },
        maxItems: {
          type: 'number',
        },
      },
      required: ['type', 'items'],
    },
    object: {
      additionalProperties: false,
      properties: {
        type: { const: 'object' },
        properties: {
          type: 'object',
          patternProperties: {
            '^.+$': {
              oneOf: [
                { $ref: '#/definitions/string' },
                { $ref: '#/definitions/number' },
                { $ref: '#/definitions/boolean' },
                { $ref: '#/definitions/schemaReference' },
                { $ref: '#/definitions/array' },
                { $ref: '#/definitions/object' },
              ],
            },
          },
        },
        patternProperties: {
          '^.+$': {
            oneOf: [
              { $ref: '#/definitions/string' },
              { $ref: '#/definitions/number' },
              { $ref: '#/definitions/boolean' },
              { $ref: '#/definitions/schemaReference' },
              { $ref: '#/definitions/array' },
              { $ref: '#/definitions/object' },
            ],
          },
        },
      },
      required: ['type'],
    },
  },
}

export const SchemaModel: JsonSchema.Schema = {
  $schema: 'http://json-schema.org/draft-07/schema',
  allOf: [
    {
      properties: {
        $schema: {
          type: 'string',
          const: SchemaModelV1.$id,
        },
      },
    },
    {
      $ref: SchemaModelV1.$id,
    },
  ],

  definitions: {
    [SchemaModelV1.$id]: SchemaModelV1,
  },
}

export const MetadataModel: JsonSchema.Schema = {
  $id: 'http://cord.network/draft-01/schema-metadata',
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    metadata: {
      type: 'object',
      properties: {
        title: {
          type: 'object',
          properties: {
            default: {
              type: 'string',
            },
          },
          patternProperties: {
            '^.*$': {
              type: 'string',
            },
          },
          required: ['default'],
        },
        description: {
          type: 'object',
          properties: {
            default: {
              type: 'string',
            },
          },
          patternProperties: {
            '^.*$': {
              type: 'string',
            },
          },
          required: ['default'],
        },
        properties: {
          type: 'object',
          patternProperties: {
            '^.*$': {
              type: 'object',
              properties: {
                title: {
                  type: 'object',
                  properties: {
                    default: {
                      type: 'string',
                    },
                  },
                  patternProperties: {
                    '^.*$': {
                      type: 'string',
                    },
                  },
                  required: ['default'],
                },
                description: {
                  type: 'object',
                  properties: {
                    default: {
                      type: 'string',
                    },
                  },
                  patternProperties: {
                    '^.*$': {
                      type: 'string',
                    },
                  },
                  required: ['default'],
                },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
        },
      },
      required: ['title', 'properties'],
      additionalProperties: false,
    },
    schemaId: { type: 'string', minLength: 1 },
  },
  required: ['metadata', 'schemaId'],
  additionalProperties: false,
}
