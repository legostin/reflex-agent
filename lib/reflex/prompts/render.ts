/**
 * Minimal `{{var}}` template renderer. Whitespace around the name is allowed
 * (`{{ var }}`). Unknown variables are left untouched so they don't silently
 * vanish on a typo.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, key) => {
    const v = vars[key as string];
    if (v === undefined) return m;
    return String(v);
  });
}
