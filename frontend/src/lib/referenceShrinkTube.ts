/** UI rule: every reference must be linked to an active shrink tube profile. */
export const REFERENCE_SHRINK_TUBE_REQUIRED_MSG =
  'Select a shrink tube profile — required for every reference.'

export function referenceHasShrinkTube(
  ref: { shrink_tube_id?: string | null } | null | undefined,
): boolean {
  const id = ref?.shrink_tube_id
  return id != null && String(id).trim() !== ''
}

export function validateReferenceShrinkTubeForm(form: Record<string, unknown>): string | null {
  const id = form.shrink_tube_id
  if (id == null || String(id).trim() === '') {
    return REFERENCE_SHRINK_TUBE_REQUIRED_MSG
  }
  return null
}
