import type { InputHTMLAttributes } from 'react'

/** Props for credential fields on kiosk — blocks Chromium "Save password?" heuristics. */
export const NO_PASSWORD_MANAGER_INPUT_PROPS: InputHTMLAttributes<HTMLInputElement> = {
  autoComplete: 'off',
  ...({
    'data-form-type': 'other',
    'data-lpignore': 'true',
    'data-1p-ignore': 'true',
  } as Record<string, string>),
}
