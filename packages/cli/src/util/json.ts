/*
 *   JSON
 ***************************************************************************************************/
export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
