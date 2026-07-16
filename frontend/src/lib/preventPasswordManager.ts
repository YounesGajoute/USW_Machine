import type { CSSProperties, InputHTMLAttributes } from 'react'

/** Props for credential fields on kiosk — blocks Chromium "Save password?" heuristics. */
export const NO_PASSWORD_MANAGER_INPUT_PROPS: InputHTMLAttributes<HTMLInputElement> = {
  autoComplete: 'off',
  ...({
    'data-form-type': 'other',
    'data-lpignore': 'true',
    'data-1p-ignore': 'true',
    'data-bwignore': 'true',
  } as Record<string, string>),
}

/**
 * Mask a text input like a password without using type="password".
 * Chromium's Password Leak Detection only runs on real password fields;
 * type="password" is what triggers the "Change your password" dialog.
 */
export function passwordMaskStyle(masked: boolean): CSSProperties {
  if (!masked) return {}
  return {
    WebkitTextSecurity: 'disc',
  } as CSSProperties
}
