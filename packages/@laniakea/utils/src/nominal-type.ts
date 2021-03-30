/**
 * Utility to get nominally typed type-aliases
 * See Approach 4 in https://michalzalecki.com/nominal-typing-in-typescript/
 */
export type NominalType<AliasedType, TypeNameString> = AliasedType & {
  __brand: TypeNameString;
};
