declare module 'present' {
  function present(): number;

  interface present {
    noConflict(): void;
    conflict(): void;
  }

  export = present;
}
