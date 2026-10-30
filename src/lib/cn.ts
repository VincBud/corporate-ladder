/** Joins truthy class names. Intentionally tiny; no merge semantics. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
