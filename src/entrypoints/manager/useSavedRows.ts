// The agent manager's rows of the last time (manager/saved): read once, restored stopped, then kept
// again whenever what is kept of them changes (not before they are read: none would be kept).
import { useEffect, useRef, useState, type Dispatch } from 'react';
import { bestEffort } from '../../core/errors';
import { listConversations } from '../../history/store';
import type { Row, RowsAction } from '../../manager/rows';
import { loadSavedRows, saveRows, savedOf } from '../../manager/saved';

export function useSavedRows(rows: Row[], dispatch: Dispatch<RowsAction>): void {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void bestEffort(listConversations().then((list) => loadSavedRows(new Set(list.map((c) => c.id)))), 'manager-rows').then((saved) => {
      if (saved?.length) dispatch({ type: 'restore', rows: saved });
      setLoaded(true);
    });
  }, [dispatch]);
  const keptAs = useRef('');
  useEffect(() => {
    if (!loaded) return;
    const kept = JSON.stringify(savedOf(rows));
    if (kept === keptAs.current) return; // a status that changes nothing kept
    keptAs.current = kept;
    void bestEffort(saveRows(rows), 'manager-rows');
  }, [rows, loaded]);
}
