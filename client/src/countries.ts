// Country codes (ISO 3166, e.g. TW) to country names.
// Uses the browser's built-in Intl.DisplayNames instead of maintaining a list of 236 names.

let names: Intl.DisplayNames | null = null;
try {
    names = new Intl.DisplayNames(['en'], { type: 'region' });
} catch {
    // Very old browsers don't support it: fall back to showing the code
}

export function countryName(code: string): string {
    try {
        return names?.of(code) ?? code;
    } catch {
        return code; // of() throws for an invalid code
    }
}
