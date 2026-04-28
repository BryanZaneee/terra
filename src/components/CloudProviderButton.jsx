import { Download } from 'lucide-react';

const CloudProviderButton = ({ icon: Icon, name, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-mono text-white/60 hover:bg-white/5 hover:text-white transition-all border border-transparent hover:border-white/5 group"
  >
    <div className="flex items-center space-x-3">
      <Icon size={14} />
      <span>{name}</span>
    </div>
    <Download size={12} className="opacity-0 group-hover:opacity-50" />
  </button>
);

export default CloudProviderButton;
