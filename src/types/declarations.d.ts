// src/types/declarations.d.ts (or scripts/declarations.d.ts)

declare module 'simplify-js' {
    // Define the basic shape of the function you're importing
    // It takes an array of points {x, y}, tolerance, and quality flag
    // and returns an array of the same type of points.
    function simplify<T extends { x: number; y: number }>(
      points: T[],
      tolerance?: number,
      highQuality?: boolean
    ): T[];
  
    // Export the function as the default export (if that's how simplify-js works)
    // or named exports if needed. Checking simplify-js source/docs, it seems
    // it uses module.exports = simplify, so this should work.
    export = simplify;
  }