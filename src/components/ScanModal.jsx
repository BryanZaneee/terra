import { CheckCircle } from 'lucide-react';

const ScanModal = ({ isOpen, onClose, title, progress, phase, icon: Icon }) => {
  if (!isOpen) return null;

  const getPhaseText = () => {
    switch (phase) {
      case 'hashing': return 'Analyzing photos...';
      case 'analyzing': return 'Detecting patterns...';
      case 'saving': return 'Saving results...';
      case 'complete': return 'Scan complete!';
      default: return 'Processing...';
    }
  };

  const percentage = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 p-8 rounded-xl w-full max-w-md shadow-2xl text-center">
        <div className="w-20 h-20 mx-auto mb-6 relative">
          <div className="absolute inset-0 rounded-full border-4 border-white/10"></div>
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="46"
              fill="none"
              stroke="rgb(52, 211, 153)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.89} 289`}
              className="transition-all duration-300"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {phase === 'complete' ? (
              <CheckCircle size={32} className="text-emerald-400" />
            ) : (
              <Icon size={32} className="text-white/60 animate-pulse" />
            )}
          </div>
        </div>

        <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
        <p className="text-white/60 text-sm mb-4">{getPhaseText()}</p>

        <div className="bg-white/5 rounded-full h-2 mb-2 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>

        <p className="text-xs font-mono text-white/40">
          {progress.processed} / {progress.total} photos
        </p>

        {phase === 'complete' && (
          <button
            onClick={onClose}
            className="mt-6 px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            View Results
          </button>
        )}
      </div>
    </div>
  );
};

export default ScanModal;
