const PhotoCardSkeleton = () => (
  <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 border border-white/5 animate-pulse" />
);

const SkeletonGrid = ({ rows = 3, cols = 5 }) => {
  const count = rows * cols;
  return (
    <div className="space-y-8 pb-20">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {Array.from({ length: count }, (_, i) => (
          <PhotoCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
};

export { PhotoCardSkeleton, SkeletonGrid };
