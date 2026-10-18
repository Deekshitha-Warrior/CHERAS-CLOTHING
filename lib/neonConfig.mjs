import { types } from '@neondatabase/serverless';

// Match the JSON values expected by the POS and its Server Actions.
types.setTypeParser(1700, Number); // NUMERIC prices, quantities and totals
types.setTypeParser(1082, value => value); // DATE: preserve YYYY-MM-DD
types.setTypeParser(1114, value => new Date(`${value}Z`).toISOString());
types.setTypeParser(1184, value => new Date(value).toISOString());
