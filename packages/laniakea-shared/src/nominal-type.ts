// Trick to get nominally typed Id types
// See Approach 4 in https://michalzalecki.com/nominal-typing-in-typescript/
export type NominalType<AliasedType, TypeNameString> = AliasedType & { __brand: TypeNameString }
