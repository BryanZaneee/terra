import { createContext, useContext } from 'react';
import { useSelection } from '../hooks/useSelection';
import { useViewContext } from './ViewContext';

const SelectionContext = createContext(null);

export function SelectionProvider({ children }) {
  const { flatVisiblePhotos } = useViewContext();
  const selectionHook = useSelection(flatVisiblePhotos);

  return (
    <SelectionContext.Provider value={selectionHook}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelectionContext() {
  const context = useContext(SelectionContext);
  if (!context) throw new Error('useSelectionContext must be used within SelectionProvider');
  return context;
}
