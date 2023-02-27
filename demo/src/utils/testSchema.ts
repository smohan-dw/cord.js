import * as Cord from '@cord.network/sdk'

// Return Schema.
export function getSchema(): Cord.ISchema {
  return Cord.Schema.fromProperties('Test Demo Schema', {
    name: {
      type: 'string',
    },
    age: {
      type: 'integer',
    },
    gender: {
      type: 'string',
    },
    credit: {
      type: 'integer',
    },
  })
}
