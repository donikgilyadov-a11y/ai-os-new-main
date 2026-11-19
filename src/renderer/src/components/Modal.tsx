import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export default function Modal({
  title,
  children,
  footer,
  onClose
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}): JSX.Element {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
