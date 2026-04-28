import { useMemo } from 'react';
import { Camera, ChevronDown, ChevronRight } from 'lucide-react';
import { GroupedVirtuoso } from 'react-virtuoso';
import PhotoCard from './PhotoCard';
import { SkeletonGrid } from './Skeleton';
import { useResponsiveColumns } from '../hooks/useResponsiveColumns';

const COLS_TO_GRID_CLASS = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

const PhotoGrid = ({
  loading,
  photos,
  groupedPhotos,
  expandedGroups,
  toggleGroup,
  selectedPhotos,
  selectionMode,
  onPhotoClick,
  onToggleSelection,
  uploadStatus,
  onEndReached,
}) => {
  const cols = useResponsiveColumns();

  // Build (groupCounts, rows) so GroupedVirtuoso can virtualize across groups.
  // Each "item" is a row of `cols` photos rendered in a CSS grid.
  const { groupCounts, rows } = useMemo(() => {
    const groupCounts = [];
    const rows = [];
    groupedPhotos.forEach(([groupKey, items]) => {
      if (!expandedGroups[groupKey]) {
        groupCounts.push(0);
        return;
      }
      const rowCount = Math.ceil(items.length / cols);
      groupCounts.push(rowCount);
      for (let i = 0; i < rowCount; i++) {
        rows.push(items.slice(i * cols, (i + 1) * cols));
      }
    });
    return { groupCounts, rows };
  }, [groupedPhotos, expandedGroups, cols]);

  if (loading && photos.length === 0) {
    return <SkeletonGrid rows={3} cols={5} />;
  }

  if (!loading && photos.length === 0) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
        <Camera size={48} className="text-white/20" />
        <div className="font-mono text-sm text-white/50 text-center">
          No photos in library yet.<br />
          Click "Upload Photos" to get started.
        </div>
      </div>
    );
  }

  const gridClass = COLS_TO_GRID_CLASS[cols] || 'grid-cols-5';

  return (
    <>
      {loading && uploadStatus && (
        <div className="fixed top-4 right-4 z-50 flex items-center space-x-2 bg-black/60 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1.5">
          <div className="w-3 h-3 border border-white/20 border-t-emerald-400 rounded-full animate-spin" />
          <span className="font-mono text-xs text-white/60">{uploadStatus}</span>
        </div>
      )}

      <GroupedVirtuoso
        useWindowScroll
        groupCounts={groupCounts}
        endReached={onEndReached}
        groupContent={(index) => {
          const [groupKey, items] = groupedPhotos[index] || [];
          const expanded = !!expandedGroups[groupKey];
          return (
            <div
              className="flex items-center space-x-2 py-3 cursor-pointer select-none group bg-black/40 backdrop-blur-sm"
              onClick={() => toggleGroup(groupKey)}
            >
              <div className="p-1 rounded bg-white/5 group-hover:bg-white/10 transition-colors">
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>
              <h2 className="text-xl font-light tracking-wide text-white/90">{groupKey}</h2>
              <div className="h-px flex-grow bg-gradient-to-r from-white/20 to-transparent ml-4"></div>
              <span className="text-xs font-mono text-white/40">{items?.length ?? 0} items</span>
            </div>
          );
        }}
        itemContent={(rowIndex) => {
          const rowItems = rows[rowIndex];
          if (!rowItems) return null;
          return (
            <div className={`grid ${gridClass} gap-4 pb-4`}>
              {rowItems.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  isSelected={selectedPhotos.has(photo.path)}
                  selectionMode={selectionMode}
                  onPhotoClick={onPhotoClick}
                  onToggleSelection={onToggleSelection}
                />
              ))}
            </div>
          );
        }}
        initialItemCount={Math.min(rows.length, 50)}
      />
    </>
  );
};

export default PhotoGrid;
