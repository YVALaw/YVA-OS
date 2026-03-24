import { useMemo } from 'react'

type Props = {
  section: 'reports' | 'invoice' | 'employees' | 'clients' | 'projects' | 'settings'
}

/**
 * Temporary bridge during the refactor.
 * Loads the proven legacy app inside an iframe, pinned to a specific section.
 * This keeps behavior identical while we progressively port features to React.
 */
export default function LegacyFrame({ section }: Props) {
  const src = useMemo(() => `/legacy/index.html?section=${encodeURIComponent(section)}`, [section])

  return (
    <div style={{ height: 'calc(100vh - 24px)', width: '100%' }}>
      <iframe
        title={`Legacy - ${section}`}
        src={src}
        style={{
          width: '100%',
          height: '100%',
          border: '0',
          borderRadius: 16,
          background: 'white',
        }}
      />
    </div>
  )
}
