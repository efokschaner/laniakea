declare module 'xxhashjs' {
  /**
   * UINT32 from the as-yet untyped 'cuint' package
   */
  interface UINT32 {
    /**
     * Convert this _UINT32_ to a number
     * @method toNumber
     * @return the converted UINT32
     */
    toNumber(): number;

    /**
     * Convert this _UINT32_ to a string
     * @method toString
     * @param radix (optional, default=10)
     * @return the converted UINT32
     */
    toString(radix?: number): string;
  }

  /**
   * UINT64 from the as-yet untyped 'cuint' package
   */
  interface UINT64 {
    /**
     * Convert this _UINT64_ to a number
     * @method toNumber
     * @return the converted UINT64
     */
    toNumber(): number;

    /**
     * Convert this _UINT64_ to a string
     * @method toString
     * @param radix (optional, default=10)
     * @return the converted UINT64
     */
    toString(radix?: number): string;
  }

  /**
   * Object that manages an iterative 32-bit hash calculation
   */
  interface XXH32Instance {
    /**
     * Initialize the XXH instance with the given seed
     * @method init
     * @param {Number|UINT32} seed as a number or an unsigned 32 bits integer
     * @return ThisExpression
     */
    init(seed: number | UINT32): this;

    /**
     * Add data to be computed for the XXH hash
     * @method update
     * @param {String|ArrayBuffer|Uint8Array} input as a string or nodejs Buffer or ArrayBuffer
     * @return ThisExpression
     */
    update(input: string | ArrayBuffer | Uint8Array): this;

    /**
     * Finalize the XXH computation. The XXH instance is ready for reuse for the given seed
     * @method digest
     * @return {UINT32} xxHash
     */
    digest(): UINT32;
  }

  /**
   * Object that manages an iterative 64-bit hash calculation
   */
  interface XXH64Instance {
    /**
     * Initialize the XXH instance with the given seed
     * @method init
     * @param seed as a number or an unsigned 64 bits integer
     * @return ThisExpression
     */
    init(seed: number | UINT64): this;

    /**
     * Add data to be computed for the XXH hash
     * @method update
     * @param input as a string or nodejs Buffer or ArrayBuffer
     * @return ThisExpression
     */
    update(input: string | ArrayBuffer | Uint8Array): this;

    /**
     * Finalize the XXH computation. The XXH instance is ready for reuse for the given seed
     * @method digest
     * @return xxHash
     */
    digest(): UINT64;
  }

  interface XXH32 {
    /**
     * Calculate the 32-bit xxhash of the given data, using the given seed
     */
    (data: string | ArrayBuffer | Uint8Array, seed: number | UINT32): UINT32;

    /**
     * Construct an XXH instance with the given seed
     * @param seed as a number or an unsigned 32 bits integer
     */
    new (seed: number | UINT32): XXH32Instance;
  }

  interface XXH64 {
    /**
     * Calculate the 64-bit xxhash of the given data, using the given seed
     */
    (data: string | ArrayBuffer | Uint8Array, seed: number | UINT64): UINT64;

    /**
     * Construct an XXH instance with the given seed
     * @param seed as a number or an unsigned 64 bits integer
     */
    new (seed: number | UINT64): XXH64Instance;
  }

  /**
   * 32-bit xxhash
   */
  export let h32: XXH32;

  /**
   * 64-bit xxhash
   */
  export let h64: XXH64;
}
