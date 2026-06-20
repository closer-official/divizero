interface Props {
  content: string
  filename: string
  onClose: () => void
}

export default function MdPreviewModal({ content, filename, onClose }: Props) {
  function handleDownload() {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-2xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <i className="fa-solid fa-file-lines text-violet-500" />
          <span className="font-bold text-sm text-slate-800 flex-1 truncate">{filename}</span>
          <button className="text-slate-400 hover:text-slate-700 p-1 transition" onClick={onClose}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto cs p-4">
          <pre className="text-[12px] text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button className="btn-sec text-xs" onClick={onClose}>閉じる</button>
          <button className="btn-primary text-xs" onClick={handleDownload}>
            <i className="fa-solid fa-file-arrow-down" />ダウンロード
          </button>
        </div>
      </div>
    </div>
  )
}
