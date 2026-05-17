/** Hidden inputs that absorb Chromium autofill before real credential fields. */
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
      <input type="text" name="username" tabIndex={-1} aria-hidden autoComplete="username" style={style} />
      <input type="password" name="password" tabIndex={-1} aria-hidden autoComplete="current-password" style={style} />
    </>
  )
}
