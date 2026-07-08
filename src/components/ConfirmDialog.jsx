/**
 * Minimal destructive-action confirm dialog shared by the review galleries.
 */
const ConfirmDialog = ({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80">
    <div className="bg-[#1a1a1a] border border-white/10 p-6 rounded-xl w-full max-w-md">
      <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
      <p className="text-white/60 text-sm mb-4">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

export default ConfirmDialog;
