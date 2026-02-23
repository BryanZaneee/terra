import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function useTags() {
  const [tags, setTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);

  const loadTags = useCallback(async () => {
    try {
      const result = await invoke('get_all_tags');
      setTags(result);
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  }, []);

  return {
    tags,
    selectedTagIds,
    setSelectedTagIds,
    loadTags,
  };
}
