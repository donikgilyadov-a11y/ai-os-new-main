import { useStore } from '../store'

export default function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <>
      {toasts.map((t, index) => (
        <div
          key={t.id}
          className="toast"
          style={{ bottom: 62 + index * 40, borderColor: t.kind === 'error' ? 'rgba(224,108,117,.5)' : undefined }}
          onClick={() => dismiss(t.id)}
        >
          {t.text}
        </div>
      ))}
    </>
  )
}
