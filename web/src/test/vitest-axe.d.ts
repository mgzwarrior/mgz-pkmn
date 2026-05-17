/**
 * Type augmentation for vitest-axe's `toHaveNoViolations` matcher.
 *
 * vitest-axe ships its own augmentation, but it targets the legacy `Vi`
 * namespace that Vitest 4 no longer uses. Re-augment against the modern
 * `vitest` module so the matcher type-checks. Runtime registration of
 * the matcher itself lives in `./setup.ts`.
 *
 * The `_phantom?: T` field is unused at runtime — TypeScript module
 * augmentation requires the generic parameter signature to match
 * `@vitest/expect`'s `Assertion<T = any>` declaration, and using `T` once
 * in the interface body keeps the type parameter live.
 */
import type { AxeMatchers } from 'vitest-axe/matchers'

declare module 'vitest' {
  // `any` mirrors @vitest/expect's `Assertion<T = any>` signature — module
  // augmentation requires identical parameter defaults to merge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends AxeMatchers {
    _phantom?: T
  }
  // Empty extension is the standard pattern for module augmentation —
  // it's how @testing-library/jest-dom augments AsymmetricMatchersContaining.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
