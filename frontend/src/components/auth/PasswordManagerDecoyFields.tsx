/**
 * Hidden decoys that absorb Chromium autofill before real credential fields.
 * Never use type="password" here — that triggers Password Leak Detection
 * ("Change your password" / "Modifiez votre mot de passe").
 */
export function PasswordManagerDecoyFields() {
  const style: React.CSSProperties = {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0,0,0,0)',
    whiteSpace: 'nowrap',
    border: 0,
    opacity: 0,
    pointerEvents: 'none',
  }

  return (
    <>
      <input type="text" name="usm-decoy-user" tabIndex={-1} aria-hidden autoComplete="off" style={style} readOnly />
      <input type="text" name="usm-decoy-secret" tabIndex={-1} aria-hidden autoComplete="off" style={style} readOnly />
    </>
  )
}
