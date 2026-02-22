import React, { useState } from 'react';
import {
  HardDrive, Monitor, Calendar, Smartphone, EyeOff,
  ChevronDown, ChevronRight
} from 'lucide-react';

const ICON_MAP = {
  'hard-drive': HardDrive,
  'monitor': Monitor,
  'calendar': Calendar,
  'smartphone': Smartphone,
  'eye-off': EyeOff,
};

const CATEGORY_LABELS = {
  size: 'By Size',
  dimension: 'By Dimension',
  time: 'By Time',
  status: 'By Status',
};

const CATEGORY_ORDER = ['size', 'dimension', 'time', 'status'];

const SmartCollections = ({ collections, activeCollectionId, onSelect, onScanFileSizes }) => {
  const [expandedCategories, setExpandedCategories] = useState({ size: true, dimension: true, time: true, status: true });

  if (!collections || collections.length === 0) return null;

  // Group by category
  const grouped = {};
  collections.forEach((c) => {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push(c);
  });

  // Check if size-based collections all have count 0
  const sizeCollections = grouped['size'] || [];
  const allSizeZero = sizeCollections.length > 0 && sizeCollections.every(c => c.count === 0);

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="space-y-1">
      {CATEGORY_ORDER.map((category) => {
        const items = grouped[category];
        if (!items || items.length === 0) return null;

        return (
          <div key={category}>
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-white/30 uppercase tracking-widest hover:text-white/50 transition-colors"
            >
              {expandedCategories[category] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {CATEGORY_LABELS[category]}
            </button>

            {expandedCategories[category] && (
              <div className="space-y-0.5">
                {items.map((collection) => {
                  const Icon = ICON_MAP[collection.icon] || HardDrive;
                  const isActive = activeCollectionId === `collection:${collection.id}`;

                  return (
                    <button
                      key={collection.id}
                      onClick={() => onSelect(collection.id)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-all ${
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-white/60 hover:bg-white/5 hover:text-white/80'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={14} />
                        <span>{collection.name}</span>
                      </div>
                      <span className="text-[10px] opacity-50">{collection.count}</span>
                    </button>
                  );
                })}

                {/* Scan file sizes banner */}
                {category === 'size' && allSizeZero && onScanFileSizes && (
                  <button
                    onClick={onScanFileSizes}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-yellow-400/70 hover:text-yellow-400 hover:bg-yellow-500/5 transition-colors"
                  >
                    <HardDrive size={12} />
                    <span>Scan file sizes to populate</span>
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SmartCollections;
