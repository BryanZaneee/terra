const POSITION_CLASSES = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const Tooltip = ({ children, label, position = 'top', className = '' }) => {
  if (!label) return children;

  return (
    <div className={`relative group/tooltip inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`absolute ${POSITION_CLASSES[position]} px-2 py-1 rounded-md
          bg-black/95 border border-white/15 text-white text-xs font-mono
          whitespace-nowrap opacity-0 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100
          pointer-events-none transition-opacity duration-150 backdrop-blur-md
          shadow-lg z-[60]`}
      >
        {label}
      </span>
    </div>
  );
};

export default Tooltip;
